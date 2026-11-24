import { CompositionCompatibilityError } from './errors';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { satisfies, valid, validRange } from 'semver';
import { DEFAULT_SHARED } from './constants';
import type { BuildModuleOptions } from './moduleBuild';

/** Fill exact requirements from the packages actually resolved from the module project. */
export function resolveModuleRequires(opts: BuildModuleOptions): Record<string, string> {
    const result: Record<string, string> = {};
    if (opts.inferRequires) {
        const req = createRequire(path.resolve(opts.cwd, 'package.json'));
        const packages = Array.isArray(opts.inferRequires) ? opts.inferRequires : [...DEFAULT_SHARED, ...(opts.composition.shared ?? [])];
        for (const pkg of packages) {
            const packageName = pkg.startsWith('@') ? pkg.split('/').slice(0, 2).join('/') : pkg.split('/')[0];
            let dir = path.dirname(req.resolve(pkg));
            for (;;) {
                try {
                    const metadata = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
                    if (metadata.name === packageName && valid(metadata.version)) { result[pkg] = metadata.version; break; }
                } catch (err: any) { if (err.code !== 'ENOENT') throw err; }
                const parent = path.dirname(dir);
                if (parent === dir) throw new Error(`Cannot resolve a package version for ${pkg}`);
                dir = parent;
            }
        }
    }
    return { ...result, ...opts.composition.requires };
}

export function assertVersionContracts(name: string, requires: Record<string, string>, provides: string[] | Record<string, string>): void {
    for (const [pkg, range] of Object.entries(requires)) {
        const version = Array.isArray(provides) ? undefined : provides[pkg];
        if (!validRange(range) || !version || !valid(version) || !satisfies(version, range)) {
            throw new CompositionCompatibilityError(`Module "${name}" requires package "${pkg}" range "${range}"; shell provides "${version ?? 'missing'}"`,
                { module: name, package: pkg, requiredRange: range, providedVersion: version, kind: 'version' });
        }
    }
}
