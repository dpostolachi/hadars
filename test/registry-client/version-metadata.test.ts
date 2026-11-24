import { expect, test } from 'bun:test';
import { gitMetadata } from '../../src/registry-client/version-metadata';

test('git metadata discovers the project and explicit overrides take precedence', () => {
    const detected = gitMetadata(process.cwd());
    expect(detected.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(gitMetadata(process.cwd(), { commit: 'custom', message: 'release', label: 'v1' })).toMatchObject({ commit: 'custom', message: 'release', label: 'v1' });
    expect(gitMetadata('/tmp/no-such-hadars-project', { author: 'Ada' })).toEqual({ author: 'Ada' });
});
