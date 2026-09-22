/**
 * Guards the startup validation of the HTML template's required markers.
 *
 * `makePrecontentHtmlGetter` locates `HADARS_HEAD` and `HADARS_BODY` with
 * `indexOf` and slices the template into three segments around them. Without a
 * check, a missing marker yields -1 and the slices still "work": the head gets
 * injected at the wrong offset and the final character of the document is
 * dropped. The result is a shell that half-renders, which is considerably
 * harder to diagnose than a template that is rejected outright — the docs say
 * both markers are required, so say so at startup.
 */

import { test, expect } from 'bun:test';
import { makePrecontentHtmlGetter, HEAD_MARKER, BODY_MARKER } from '../src/utils/ssrHandler';

const shell = (head: string, body: string) =>
    `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

/** Resolves to the thrown error, or null if the template was accepted. */
const settle = (html: string) =>
    Promise.resolve(makePrecontentHtmlGetter(Promise.resolve(html))('<title>t</title>'))
        .then(() => null, (e: Error) => e);

test('a template with both markers is accepted and splits around them', async () => {
    const getter = makePrecontentHtmlGetter(Promise.resolve(shell(HEAD_MARKER, BODY_MARKER)));
    const [precontent, postContent] = await Promise.resolve(getter('<title>t</title>'));

    expect(precontent).toContain('<title>t</title>');
    expect(precontent.startsWith('<!doctype html>')).toBe(true);
    // Nothing silently truncated off the end.
    expect(postContent).toBe('</body></html>');
});

test('a template missing HADARS_BODY is rejected', async () => {
    const err = await settle(shell(HEAD_MARKER, ''));
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('HADARS_BODY');
});

test('a template missing HADARS_HEAD is rejected', async () => {
    const err = await settle(shell('', BODY_MARKER));
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('HADARS_HEAD');
});

test('a template missing both markers is rejected and names both', async () => {
    const err = await settle(shell('', ''));
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('HADARS_HEAD');
    expect(err!.message).toContain('HADARS_BODY');
});

test('markers in the wrong order are rejected rather than sliced backwards', async () => {
    // contentStart < headEnd makes the middle slice empty and silently swallows
    // everything between them, so this cannot be allowed through either.
    const err = await settle(shell(BODY_MARKER, HEAD_MARKER));
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain('before');
});

test('a bad template does not raise an unhandled rejection before the first request', async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
        // Construct the getter and never call it — the priming promise rejects on
        // its own. It must already carry a handler or the process would die here.
        makePrecontentHtmlGetter(Promise.resolve(shell('', '')));
        await new Promise(r => setTimeout(r, 50));
    } finally {
        process.off('unhandledRejection', onUnhandled);
    }
    expect(seen).toEqual([]);
});
