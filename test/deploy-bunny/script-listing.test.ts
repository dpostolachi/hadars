import { test, expect } from 'bun:test';
import { BunnyTarget } from '../../src/deploy/bunny';

// Reads the script list through the target's own method with a stub client that serves Bunny-style pages.
function listing(pages: Array<{ Items: Array<{ Id: number; Name: string }>; HasMore: boolean; TotalItems: number }>) {
    const requested: string[] = [];
    const client = { request: async (_method: string, path: string) => { requested.push(path); const n = Number(new URL(`https://x${path}`).searchParams.get('page')); return pages[n - 1]; } };
    return { scripts: () => (BunnyTarget.prototype.scripts as any).call({ client }), requested };
}

test('script listing reads every page until HasMore is false', async () => {
    const a = Array.from({ length: 20 }, (_, i) => ({ Id: i + 1, Name: `a${i}` }));
    const b = [{ Id: 99, Name: 'b' }];
    const stub = listing([{ Items: a, HasMore: true, TotalItems: 21 }, { Items: b, HasMore: false, TotalItems: 21 }]);
    const scripts = await stub.scripts();
    expect(scripts).toHaveLength(21);
    expect(stub.requested).toEqual(['/compute/script?page=1&perPage=100', '/compute/script?page=2&perPage=100']);
});

test('script listing refuses an incomplete list', async () => {
    const stub = listing([{ Items: [{ Id: 1, Name: 'a' }], HasMore: false, TotalItems: 3 }]);
    await expect(stub.scripts()).rejects.toThrow('Incomplete Bunny script list');
});
