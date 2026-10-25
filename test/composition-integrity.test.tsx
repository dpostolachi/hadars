import { test, expect } from 'bun:test';
import { ModuleHead } from '../src/composition';
import { getReactResponse, buildHeadHtml } from '../src/utils/response';
import { parseRequest } from '../src/utils/request';

test('SSR module tags carry integrity and crossorigin only for mapped files', async () => {
    const client = { baseUrl: 'https://cdn.example/build/', manifest: { js: ['signed #.js', 'plain.js'], css: ['signed %.css', 'plain.css'] },
        integrity: { 'signed #.js': 'sha256-script', 'signed %.css': 'sha256-style' } };
    const { head } = await getReactResponse(parseRequest(new Request('https://example.test')), {
        document: { body: () => <ModuleHead client={client} />, lang: 'en', getInitProps: undefined, getFinalProps: undefined }, singlePass: true,
    });
    const html = buildHeadHtml(head);
    expect(html).toContain('integrity="sha256-script"');
    expect(html).toContain('integrity="sha256-style"');
    expect(html.match(/crossorigin="anonymous"/g)?.length).toBe(2);
    expect(html.match(/integrity=/g)?.length).toBe(2);
    expect(html).toContain('https://cdn.example/build/signed%20%23.js');
    expect(html).toContain('https://cdn.example/build/signed%20%25.css');
    expect(html).toContain('https://cdn.example/build/plain.css');
    expect(html).toContain('https://cdn.example/build/plain.js');
});
