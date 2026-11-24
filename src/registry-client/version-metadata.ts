import { spawnSync } from 'node:child_process';
import type { VersionMetadata } from '../registry-protocol';

export function gitMetadata(project: string, overrides: VersionMetadata = {}): VersionMetadata {
    const git = (...args: string[]) => {
        const result = spawnSync('git', ['-C', project, ...args], { encoding: 'utf8' });
        return result.status === 0 ? result.stdout.trim() || undefined : undefined;
    };
    const detected: VersionMetadata = { commit: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), author: git('log', '-1', '--format=%an'), message: git('log', '-1', '--format=%s') };
    return Object.fromEntries(Object.entries({ ...detected, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) }).filter(([, v]) => v !== undefined));
}
