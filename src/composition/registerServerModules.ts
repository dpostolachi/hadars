import { createRequire } from 'node:module';
import { statSync } from 'node:fs';
import path from 'node:path';
import type { PinnedBuild } from './pinnedTypes';
import { registerLinkedModule } from './registry';

const stamps = new Map<string, string>();

/** Node counterpart of generated links: defer evaluation until the app asks for exports. */
export function registerServerModules(builds?: Record<string, PinnedBuild>): void {
    for (const build of Object.values(builds ?? {})) {
        if (build.clientOnly || build.kind !== 'module' || !build.server.manifest.js.length) continue;
        const file = path.join(build.server.dir, build.server.manifest.js[0]!);
        const require = createRequire(file);
        registerLinkedModule(build.name, () => {
            const st = statSync(file);
            const stamp = `${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
            if (stamps.get(file) !== stamp) {
                delete require.cache[file];
                stamps.set(file, stamp);
            }
            return require(file);
        });
    }
}
