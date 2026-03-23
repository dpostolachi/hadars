/**
 * Static site export core — rendering and file I/O.
 *
 * Imported by cli-lib.ts (bundled into dist/cli.js via esbuild) and by tests.
 * Has no dependency on the rspack build pipeline — only SSR utilities.
 */

import { cp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { parseRequest } from './utils/request';
import { getReactResponse, buildHeadHtml } from './utils/response';
import { buildSsrHtml, makePrecontentHtmlGetter } from './utils/ssrHandler';
import type { HadarsEntryModule, HadarsStaticContext, GraphQLExecutor } from './types/hadars';

export interface StaticRenderResult {
    /** URL paths that were successfully rendered. */
    rendered: string[];
    /** Paths that failed, with the caught error. */
    errors: Array<{ path: string; error: Error }>;
}

/**
 * Pre-renders a list of URL paths to HTML files and copies static assets.
 *
 * Pages are rendered serially — `getReactResponse` writes to
 * `globalThis.__hadarsUnsuspend / __hadarsContext` which are not re-entrant-safe.
 */
export async function renderStaticSite(opts: {
    ssrModule:   HadarsEntryModule<any>;
    htmlSource:  string;
    staticSrc:   string;
    paths:       string[];
    outputDir:   string;
    graphql?:    GraphQLExecutor;
}): Promise<StaticRenderResult> {
    const { ssrModule, htmlSource, staticSrc, paths, outputDir } = opts;

    const staticCtx: HadarsStaticContext = {
        graphql: opts.graphql ?? (() => Promise.reject(
            new Error('[hadars] No graphql executor configured. Add a `graphql` function to your hadars.config.'),
        )),
    };
    const getPrecontentHtml = makePrecontentHtmlGetter(Promise.resolve(htmlSource));

    await mkdir(outputDir, { recursive: true });

    const rendered: string[] = [];
    const errors: Array<{ path: string; error: Error }> = [];

    for (const urlPath of paths) {
        try {
            const req = parseRequest(new Request('http://localhost' + urlPath));

            // Expose the executor globally so useGraphQL() in components can reach it.
            (globalThis as any).__hadarsGraphQL = staticCtx.graphql;

            const { head, getAppBody, finalize } = await getReactResponse(req, {
                document: {
                    body:          ssrModule.default as any,
                    getInitProps:  ssrModule.getInitProps,
                    getFinalProps: ssrModule.getFinalProps,
                },
                staticCtx,
            });

            const bodyHtml        = await getAppBody();
            const { clientProps } = await finalize();
            const headHtml        = buildHeadHtml(head);
            // Inject a flag so the client knows it's a static export and should
            // fetch index.json sidecars directly instead of hitting a live server.
            const staticClientProps = { ...clientProps, __hadarsStatic: true };
            const html = await buildSsrHtml(bodyHtml, staticClientProps, headHtml, getPrecontentHtml);

            // '/'      → <outputDir>/index.html
            // '/about' → <outputDir>/about/index.html
            const cleanPath = urlPath.replace(/\/$/, '');
            const pageDir   = cleanPath === '' ? outputDir : join(outputDir, cleanPath);
            await mkdir(pageDir, { recursive: true });
            await writeFile(join(pageDir, 'index.html'), html, 'utf-8');

            // Write a JSON sidecar so useServerData can hydrate on client-side
            // navigation without a live server. The format matches the live
            // server's Accept: application/json response: { serverData: {...} }.
            const serverData = (staticClientProps as any).__serverData ?? {};
            await writeFile(
                join(pageDir, 'index.json'),
                JSON.stringify({ serverData }),
                'utf-8',
            );

            rendered.push(urlPath);
        } catch (err: any) {
            errors.push({
                path:  urlPath,
                error: err instanceof Error ? err : new Error(String(err)),
            });
        }
    }

    // Copy .hadars/static/ → <outputDir>/static/, excluding the SSR template.
    const staticDest = join(outputDir, 'static');
    await mkdir(staticDest, { recursive: true });
    await cp(staticSrc, staticDest, {
        recursive: true,
        filter: (src: string) => basename(src) !== 'out.html',
    });

    return { rendered, errors };
}
