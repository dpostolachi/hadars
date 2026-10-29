import { test, expect } from 'bun:test';
import '../src/utils/lazyModules';

const g = globalThis as any;

test('an edited module is loaded again instead of served from the previous load', async () => {
    const before = g.__hadarsLoadModule('./Page', () => Promise.resolve({ version: 1 }));
    const after = g.__hadarsLoadModule('./Page', () => Promise.resolve({ version: 2, edited: true }));
    expect((await before).version).toBe(1);
    expect((await after).version).toBe(2);
});

test('the same unchanged loader reuses its load, so a render that already loaded is synchronous', async () => {
    const loader = () => Promise.resolve({ version: 3 });
    const first = g.__hadarsLoadModule('./Card', loader);
    await first;
    const again = g.__hadarsLoadModule('./Card', loader);
    expect(again.status).toBe('fulfilled');
});
