/**
 * Opt-in compilation of the live useServerData request. Keeping this transform
 * out of ordinary builds preserves their generated client and server bytes.
 * Both distributed JS and source TS are supported; no app fetch is rewritten.
 */
export default function splitClientLoader(this: any, source: string): string {
    if (!source.includes('pendingDataFetch =') || !source.includes('fetch(pathKey,')) return source;
    // Resolve beside the containing module so a symlinked package shares the
    // public error constructor and guard state with its own client entry.
    const runtime = /Head\.tsx$/.test(this.resourcePath ?? '') ? './releaseClient' : './utils/releaseClient.js';
    const replacements: [RegExp, string][] = [
        [/(const|var) pendingDataFetch =/, 'const __releaseErrors = new Map(); $1 pendingDataFetch ='],
        [/(const pathKey = [^;]+;)/, '$1 if (__releaseErrors.has(pathKey)) throw __releaseErrors.get(pathKey);'],
        [/fetch\(pathKey,/, '__releaseFetch(pathKey,'],
        [/let resolve(?:: \(\) => void|!:\s*\(\) => void)?;/, 'let resolve; let reject;'],
        [/new Promise(?:<void>)?\(\(?res\)? => \{\s*resolve = res;\s*\}\)/, 'new Promise((res, rej) => { resolve = res; reject = rej; })'],
        [/\} finally \{\s*fetchedPaths.add\(pathKey\);/, '} catch (error) { __releaseErrors.set(pathKey, error); reject(error); } finally { fetchedPaths.add(pathKey);'],
    ];
    for (const [pattern, replacement] of replacements) {
        if (!pattern.test(source)) throw new Error('Split client request transform no longer matches the data runtime');
        source = source.replace(pattern, replacement);
    }
    return `import { releaseFetch as __releaseFetch } from ${JSON.stringify(runtime)};\n` + source;
}
