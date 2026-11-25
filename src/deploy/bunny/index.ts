import { readinessProbe, probeTimeout } from './probe';
export { probeTimeout } from './probe';
import { receipt, checkRuleCapacity, safeSplitZone, activateReceipt, SplitActivationError, type SplitReceipt, type ProbeSummary, type LiveRule } from './split-release';
import { verifySplitOutput, matchGroup, type SplitManifest } from './split';
import { summarizeConfig, type RuntimeConfig, type ConfigSummary } from './config';
export * from './config';
export * from './layout';
export * from './zones';
export * from './gc';
export * from './artifact';
export * from './client';
export * from './output';
export * from './split';
export * from './linked';
export * from './split-release';
import { verifyOutput, outputHash, type OutputVerification } from './output';
import { dnsHostname } from './zones';
import { staticLayout } from './layout';
import { createHash } from 'node:crypto';
import { Bunny, storage } from './client';

export interface ArtifactFile { role?: 'unit' | 'manifest' | 'static' | 'pin'; path: string; bytes: Uint8Array; module?: string }
export interface LinkedModule { buildId: string; clientOnly: boolean; server: LinkedFile[]; client: LinkedFile[] }
export interface LinkedFile { path: string; size: number; sha256: string }
export interface NativeProvenance { snapshot: string; shell: string; modules: Record<string, LinkedModule> }
export interface CompositionBinding { snapshotId: string; shell: string; modules: Record<string, string>; libraries: Record<string, string>; linkedServers?: Record<string, { buildId: string; clientOnly: boolean; files: LinkedFile[] }> }
/** Produced by the trusted exporter, outside the public static tree. Hashes cover the entire deploy payload. */
export interface CompositionProvenance extends CompositionBinding { version: 1; outputs: Record<string, { size: number; sha256: string }> }
export interface Artifact { entry: string; files: ArtifactFile[]; provenance?: CompositionProvenance; nativeProvenance?: NativeProvenance }
export interface Revision { project: string; environment: string; revision: number; artifact: Artifact }
export interface Plan extends Revision { splitManifest?: SplitManifest; name: string; artifactSummary: { files: number; bytes: number }; breakdown: string; configSummary?: ConfigSummary; staticHashes?: Record<string, string>; staticPaths?: string[]; outputVerification?: OutputVerification; adaptedScript?: Uint8Array }
export interface StageResource { scriptId: string; name: string; linkedZoneIds: string[]; disposition: 'created' | 'reused'; remaining?: string[]; cleanup?: 'cleaned' | 'kept' | 'remaining' }
export interface StageAttempt { resources: StageResource[]; probeFailures?: Record<string, string> }
export interface StagedRevision { /** Runtime-only identity map; persisted on Deployment, never in staged. */ liveRules?: LiveRule[]; split?: SplitReceipt; scriptId: string; hostname: string; revision: number; name: string; assets?: { reused: number; uploaded: number } }
export interface VerifyResult { ok: boolean; error?: string }
export interface DeployTarget {
    readonly maxArtifactBytes: number;
    readonly supportsRuntimeConfig?: boolean;
    plan(revision: Revision, config?: RuntimeConfig): Plan;
    stage(plan: Plan, config?: RuntimeConfig): Promise<StagedRevision>;
    verify(staged: StagedRevision, config?: ConfigSummary): Promise<VerifyResult>;
    activate(staged: StagedRevision, options?: { previous?: StagedRevision; noAutoRollback?: boolean }): Promise<void>;
    rollback(previous: StagedRevision, options?: { previous?: StagedRevision; noAutoRollback?: boolean }): Promise<void>;
}
export interface BunnyClient {
    request(method: string, path: string, body?: unknown): Promise<any>;
    publish(id: string, code: string): Promise<void>;
}
export interface BunnyConfig { key: string; publicZoneId: string; storageZone: string; storageKey: string; assetsHost?: string; sharedStorage?: boolean; assetConcurrency?: number }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const safePath = (path: string) => path && !path.includes('\\') && !path.split('/').some(p => !p || p === '.' || p === '..');

/** Parallel static-object transfers during staging. */
const ASSET_CONCURRENCY = 12;

export class BunnyTarget implements DeployTarget {
    readonly supportsRuntimeConfig = true;
    readonly maxArtifactBytes = 10_000_000;
    private readonly client: BunnyClient;
    activationProbes?: ProbeSummary;
    activationRules?: LiveRule[];
    probeTimeoutSeconds = 120;
    attempt: StageAttempt = { resources: [] };
    onAttempt?: (attempt: StageAttempt) => Promise<void>;
    beginAttempt() { this.attempt = { resources: [] }; this.journalChain = Promise.resolve(); }
    private journalChain: Promise<void> = Promise.resolve();
    /**
     * Writes happen one at a time and each carries the attempt as it is when the write starts, so concurrent stages can never
     * leave an older snapshot behind a newer one. When this resolves, a snapshot that includes the caller's change is recorded.
     */
    private journal() {
        const write = this.journalChain.then(() => this.onAttempt?.(structuredClone(this.attempt)));
        this.journalChain = write.catch(() => {});
        return write;
    }
    constructor(private readonly config: BunnyConfig, private readonly send: typeof fetch = fetch, client?: BunnyClient, private readonly pause: (ms?: number) => Promise<void> = (ms = 1000) => new Promise(resolve => setTimeout(resolve, ms))) {
        this.client = client ?? new Bunny(config.key, send);
        if (!/^\d+$/.test(config.publicZoneId) || !/^[a-z0-9-]+$/.test(config.storageZone)) throw new Error('Invalid Bunny zone configuration');
        if (config.assetConcurrency !== undefined && (!Number.isSafeInteger(config.assetConcurrency) || config.assetConcurrency < 1 || config.assetConcurrency > 32)) throw new Error('Asset concurrency must be an integer from 1 to 32');
        if (config.assetsHost !== undefined && !dnsHostname(config.assetsHost) || config.sharedStorage !== undefined && typeof config.sharedStorage !== 'boolean') throw new Error('Invalid Bunny assets configuration');
    }
    get assetBase() { return this.config.assetsHost ? `https://${this.config.assetsHost}` : undefined; }
    plan(input: Revision, config?: RuntimeConfig): Plan {
        if (!/^[a-z0-9-]+$/.test(input.project) || !/^[a-z0-9-]{1,40}$/.test(input.environment) || !Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('Invalid environment revision');
        const { files, entry } = input.artifact;
        let splitManifest: SplitManifest | undefined;
        if (files.some(f => f.path === '.hadars/split-manifest.json')) {
            verifySplitOutput(input.artifact);
            splitManifest = JSON.parse(new TextDecoder().decode(files.find(f => f.path === '.hadars/split-manifest.json')!.bytes));
            if (matchGroup(splitManifest!, splitManifest!.probe.path) !== splitManifest!.defaultGroup) throw new Error('Split routing shadows the required default public release probe');
            for (const g of splitManifest!.groups) if (g.unit.size > this.maxArtifactBytes) throw new Error(`Bunny group ${g.name} exceeds the ${this.maxArtifactBytes} byte limit`);
        }
        if (!files.length || new Set(files.map(f => splitManifest ? `${f.role ?? ''}:${f.path}` : f.path)).size !== files.length || files.some(f => !safePath(f.path))) throw new Error('Invalid artifact paths');
        const script = files.find(f => f.path === entry && f.role !== 'static');
        if (!script?.bytes.length) throw new Error('Artifact needs a nonempty script entry');
        const breakdown = files.map(f => `${f.path}${f.module ? ` (${f.module})` : ''}: ${f.bytes.length} bytes${f.path === entry ? ' (script)' : ' (static)'}`).join('\n');
        if (script.bytes.length > this.maxArtifactBytes) throw new Error(`Bunny script exceeds the ${this.maxArtifactBytes} byte limit. Export smaller per-module units or reduce this script.\n${breakdown}`);
        const layout = staticLayout(input.artifact);
        if (this.config.assetsHost && config?.variables.HADARS_ASSET_BASE_URL !== `https://${this.config.assetsHost}`) throw new Error('HADARS_ASSET_BASE_URL must equal the project assets zone root');
        return { ...input, ...(splitManifest ? { splitManifest } : {}), staticPaths: layout.paths, staticHashes: Object.fromEntries(layout.files.map(f => [f.path, hash(f.bytes)])), configSummary: summarizeConfig(config ?? { variables: {}, secrets: {}, required: [] }), name: `${input.project}-${input.environment}-r${input.revision}`, artifactSummary: { files: files.length, bytes: files.reduce((sum, f) => sum + f.bytes.length, 0) }, breakdown };
    }
    async planSplitRules(plan: Plan, offline = false) {
        if (!plan.splitManifest) throw new Error('Split manifest required');
        const zone = offline ? { OriginType: 4, EdgeScriptId: 0, EnableSmartCache: true, IgnoreQueryStrings: false, DisableCookies: false, AddHostHeader: true, Hostnames: [{ Value: 'public-host-placeholder.invalid' }], EdgeRules: [] } : await this.client.request('GET', `/pullzone/${this.config.publicZoneId}`);
        const groups = plan.splitManifest.groups.map(g => ({ group: g.name, scriptId: '0', hostname: 'unit-host-placeholder.invalid', name: `${plan.name}-${g.name}` }));
        const split = receipt(plan.splitManifest, plan.project, plan.environment, plan.configSummary!.digest, groups, zone);
        return { hostnames: split.publicHostnames, rules: split.rules, count: checkRuleCapacity(zone.EdgeRules, split.rules, split.owner) };
    }
    async scripts(): Promise<Array<{ Id: number; Name: string }>> {
        // Bunny returns one page per call. Read until HasMore is false; refuse if the list is still incomplete.
        const incomplete = () => new Error('Incomplete Bunny script list; refusing revision reuse or cleanup');
        const items: Array<{ Id: number; Name: string }> = [];
        for (let page = 1; page <= 100; page++) {
            const result = await this.client.request('GET', `/compute/script?page=${page}&perPage=100`);
            if (Array.isArray(result)) return result;
            if (!Array.isArray(result?.Items)) { console.log('DBGSCRIPTS', JSON.stringify(result).slice(0, 300)); throw incomplete(); }
            items.push(...result.Items);
            if (!result.HasMore) {
                if (result.TotalItems > items.length) throw incomplete();
                return items;
            }
        }
        throw incomplete();
    }
    async stage(plan: Plan, config?: RuntimeConfig, reuseOnly = false): Promise<StagedRevision> {
        if (plan.splitManifest) return this.stageSplit(plan, config, reuseOnly);
        const artifact = structuredClone(plan.artifact);
        if (plan.outputVerification) {
            const current = verifyOutput(artifact, plan.outputVerification.allowUnboundOutput);
            for (const key of ['scriptSha256', 'staticSha256', 'metadataSha256', 'allowUnboundOutput'] as const) {
                if (current[key] !== plan.outputVerification[key]) throw new Error(`Staged output differs from verified output: ${key}`);
            }
        }
        const scriptBytes = new Uint8Array(plan.adaptedScript ?? artifact.files.find(f => f.path === plan.artifact.entry)!.bytes);
        if (plan.outputVerification && outputHash(scriptBytes) !== (plan.outputVerification.adaptedSha256 ?? plan.outputVerification.scriptSha256)) throw new Error('Staged script differs from verified script');
        const scriptCode = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(scriptBytes);
        if (outputHash(new TextEncoder().encode(scriptCode)) !== outputHash(scriptBytes)) throw new Error('Script UTF-8 roundtrip differs from verified bytes');
        if (JSON.stringify(summarizeConfig(config ?? { variables: {}, secrets: {}, required: [] })) !== JSON.stringify(plan.configSummary)) throw new Error('Runtime configuration differs from plan');

        const assets = await this.uploadAssets(artifact);
        return { ...await this.stageScript(plan.name, plan.revision, scriptCode, config, reuseOnly), assets };
    }
    /** Live release's static hashes; a file with the same path and hash needs no lookup at all. */
    private knownStatic: Record<string, string> = {};
    setKnownStatic(hashes: Record<string, string>) { this.knownStatic = { ...hashes }; }
    private async uploadAssets(artifact: Artifact) {
        const assets = { reused: 0, uploaded: 0 };
        const files = staticLayout(artifact).files;
        const one = async (file: (typeof files)[number]) => {
            if (this.knownStatic[file.path] === hash(file.bytes)) { assets.reused++; return; }
            // Never overwrite an asset still referenced by a live or rollback script.
            const url = `https://storage.bunnycdn.com/${this.config.storageZone}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
            const old = await this.send(url, { headers: { AccessKey: this.config.storageKey }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
            if (old.ok) {
                // The lookup already downloaded the stored bytes and matched them; a second read would repeat that check.
                if (hash(new Uint8Array(await old.arrayBuffer())) !== hash(file.bytes)) throw new Error(`Static asset collision: ${file.path}; export content-addressed assets`);
                assets.reused++;
                return;
            }
            if (old.status !== 404) throw new Error(`Asset lookup failed (${old.status})`);
            await storage('PUT', this.config.storageZone, this.config.storageKey, file.path, file.bytes, this.send);
            assets.uploaded++;
            // Only a new object needs reading back: the storage write itself is what is verified here.
            const read = await storage('GET', this.config.storageZone, this.config.storageKey, file.path, undefined, this.send);
            if (hash(new Uint8Array(await read.arrayBuffer())) !== hash(file.bytes)) throw new Error(`Asset verification failed: ${file.path}`);
        };
        // Files are independent (each path is its own object), so they share a bounded pool. Every worker stops at its first failure,
        // and the first error in file order is the one reported, so a failing deploy names the same file as a sequential one would.
        const errors: Array<{ index: number; error: unknown }> = [];
        let next = 0;
        const worker = async () => {
            while (!errors.length && next < files.length) {
                const index = next++;
                try { await one(files[index]!); } catch (error) { errors.push({ index, error }); }
            }
        };
        await Promise.all(Array.from({ length: Math.min(this.config.assetConcurrency ?? ASSET_CONCURRENCY, files.length) }, worker));
        if (errors.length) throw errors.sort((a, b) => a.index - b.index)[0]!.error;
        return assets;
    }
    private async stageScript(name: string, revision: number, code: string, config?: RuntimeConfig, reuseOnly = false): Promise<StagedRevision> {
        const matches = (await this.scripts()).filter(s => s.Name === name);
        if (matches.length > 1) throw new Error(`Duplicate immutable script name ${name}; reconcile provider inventory`);
        if (!matches.length) {
            if (reuseOnly) throw new Error(`Cannot reuse immutable script ${name}: missing script; reconcile live/previous receipt`);
            try { return await this.createScript(name, revision, code, config); }
            catch (error) {
                // A successful create can lose its reply. The caller's environment lock and
                // absent exact name above establish this attempt's ownership.
                if (!this.attempt.resources.some(r => r.name === name)) {
                    for (const row of (await this.scripts()).filter(s => s.Name === name)) {
                        this.attempt.resources.push({ scriptId: String(row.Id), name, linkedZoneIds: [], disposition: 'created' });
                    }
                    await this.journal();
                }
                throw error;
            }
        }
        const scriptId = String(matches[0]!.Id);
        const mismatch = (reason: string) => new Error(`Cannot reuse immutable script ${name} (${scriptId}): ${reason}; restore the exact export/config or use a new revision; remove only an unreferenced failed stage`);
        let published: any;
        try { published = await this.client.request('GET', `/compute/script/${scriptId}/code`); }
        catch { throw mismatch('code readback unavailable; reuse refused'); }
        if (typeof published?.Code !== 'string') throw mismatch('incomplete code readback');
        if (outputHash(Buffer.from(published.Code)) !== outputHash(Buffer.from(code))) throw mismatch(`code SHA-256 differs (expected ${outputHash(Buffer.from(code))}, actual ${outputHash(Buffer.from(published.Code))})`);
        try { await this.verifyConfig(scriptId, summarizeConfig(config ?? { variables: {}, secrets: {}, required: [] }), config ?? { variables: {}, secrets: {}, required: [] }); }
        catch (error) { throw mismatch((error as Error).message); }
        const details = await this.client.request('GET', `/compute/script/${scriptId}`);
        const hostname = String(details.DefaultHostname ?? '').replace(/^https:\/\//, '').replace(/\/$/, '');
        if (!/^[a-z0-9.-]+\.bunny\.run$/.test(hostname)) throw mismatch('invalid hostname');
        this.attempt.resources.push({ scriptId, name, linkedZoneIds: [], disposition: 'reused' });
        await this.journal();
        return { scriptId, name, revision, hostname };
    }
    /** Only attempt-created identities are eligible. Public pointers and retained receipts always win. */
    async cleanupAttempt(protectedStages: StagedRevision[] = [], keep = false): Promise<StageAttempt> {
        const protectedIds = new Set(protectedStages.flatMap(s => s.split?.groups.map(g => g.scriptId) ?? [s.scriptId]));
        for (const resource of this.attempt.resources) {
            resource.cleanup = 'kept';
            delete resource.remaining;
            if (keep || resource.disposition === 'reused' || protectedIds.has(resource.scriptId)) continue;
            try {
                const zones = await this.client.request('GET', '/pullzone');
                const rows = Array.isArray(zones) ? zones : zones?.Items;
                if (!Array.isArray(rows) || zones.HasMore || zones.TotalItems > rows.length) throw new Error();
                const linked = rows.filter((z: any) => String(z.Id) !== this.config.publicZoneId && (resource.linkedZoneIds.includes(String(z.Id)) || z.Name === resource.name && String(z.EdgeScriptId) === resource.scriptId));
                if (rows.some((z: any) => !linked.includes(z) && (String(z.EdgeScriptId) === resource.scriptId || z.EdgeRules?.some((r: any) => r.ActionType === 21 && String(r.ActionParameter1) === resource.scriptId)))) continue;
                for (const z of linked) {
                    if (!resource.linkedZoneIds.includes(String(z.Id))) resource.linkedZoneIds.push(String(z.Id));
                }
                await this.journal();
                for (const id of resource.linkedZoneIds) {
                    if (linked.some((z: any) => String(z.Id) === id)) {
                        try { await this.client.request('DELETE', `/pullzone/${id}`); } catch { /* readback decides */ }
                    }
                }
                const after = await this.client.request('GET', '/pullzone');
                const remaining = Array.isArray(after) ? after : after?.Items;
                if (!Array.isArray(remaining) || after.HasMore || after.TotalItems > remaining.length || remaining.some((z: any) => resource.linkedZoneIds.includes(String(z.Id)))) throw new Error();
                if ((await this.scripts()).some(s => String(s.Id) === resource.scriptId && s.Name === resource.name)) {
                    try { await this.client.request('DELETE', `/compute/script/${resource.scriptId}`); } catch { /* readback decides */ }
                }
                if ((await this.scripts()).some(s => String(s.Id) === resource.scriptId)) throw new Error();
                resource.cleanup = 'cleaned';
            } catch {
                resource.cleanup = 'remaining';
                resource.remaining = [];
                try { if ((await this.scripts()).some(s => String(s.Id) === resource.scriptId)) resource.remaining.push(`script ${resource.scriptId}`); }
                catch { resource.remaining.push(`script ${resource.scriptId} (readback unavailable)`); }
                try {
                    const zones = await this.client.request('GET', '/pullzone');
                    const rows = Array.isArray(zones) ? zones : zones?.Items;
                    if (!Array.isArray(rows) || zones.HasMore || zones.TotalItems > rows.length) throw new Error();
                    for (const z of rows.filter((z: any) => resource.linkedZoneIds.includes(String(z.Id)) || z.Name === resource.name && String(z.EdgeScriptId) === resource.scriptId)) resource.remaining.push(`linked zone ${z.Id}`);
                } catch { resource.remaining.push(`linked zones [${resource.linkedZoneIds.join(',')}] (readback unavailable)`); }
            }
        }
        await this.journal();
        return structuredClone(this.attempt);
    }
    private async createScript(name: string, revision: number, scriptCode: string, config?: RuntimeConfig): Promise<StagedRevision> {
        const script = await this.client.request('POST', '/compute/script', { Name: name, ScriptType: 1, CreateLinkedPullZone: true });
        const scriptId = String(script?.Id);
        if (!/^[1-9]\d*$/.test(scriptId)) throw new Error('Bunny returned an invalid created script ID; reconcile immutable name');
        const resource: StageResource = { scriptId, name, linkedZoneIds: [], disposition: 'created' };
        this.attempt.resources.push(resource);
        await this.journal();
        const zones = await this.client.request('GET', '/pullzone');
        const rows = Array.isArray(zones) ? zones : zones?.Items;
        if (!Array.isArray(rows) || zones.HasMore || zones.TotalItems > rows.length) throw new Error('Incomplete linked zone inventory');
        resource.linkedZoneIds = rows.filter((z: any) => z.Name === name && String(z.EdgeScriptId) === scriptId).map((z: any) => String(z.Id));
        await this.journal();
        const details = await this.client.request('GET', `/compute/script/${scriptId}`);
        const hostname = String(details.DefaultHostname ?? '').replace(/^https:\/\//, '').replace(/\/$/, '');
        if (!/^\d+$/.test(scriptId) || typeof hostname !== 'string' || !/^[a-z0-9.-]+\.bunny\.run$/.test(hostname)) throw new Error('Bunny returned an invalid script hostname');
        if (config) {
            for (const [Name, DefaultValue] of Object.entries(config.variables)) {
                try { await this.client.request('PUT', `/compute/script/${scriptId}/variables`, { Name, DefaultValue, Required: config.required.includes(Name) }); }
                catch { throw new Error(`Could not provision runtime variable ${Name}`); }
            }
            for (const [Name, Secret] of Object.entries(config.secrets)) {
                try { await this.client.request('PUT', `/compute/script/${scriptId}/secrets`, { Name, Secret }); }
                catch { throw new Error(`Could not provision runtime secret ${Name}`); }
            }
            await this.verifyConfig(scriptId, summarizeConfig(config));
        }
        await this.client.publish(scriptId, scriptCode);
        return { scriptId, hostname, revision, name };
    }
    private async stageSplit(plan: Plan, config?: RuntimeConfig, reuseOnly = false): Promise<StagedRevision> {
        const artifact = structuredClone(plan.artifact), verified = verifySplitOutput(artifact);
        if (plan.adaptedScript) throw new Error('Split units cannot use the single-script adapter');
        if (plan.outputVerification && JSON.stringify(verified) !== JSON.stringify(plan.outputVerification)) throw new Error('Staged split output differs from verified output');
        if (JSON.stringify(summarizeConfig(config ?? { variables: {}, secrets: {}, required: [] })) !== JSON.stringify(plan.configSummary)) throw new Error('Runtime configuration differs from plan');
        const m: SplitManifest = JSON.parse(new TextDecoder().decode(artifact.files.find(f => f.path === '.hadars/split-manifest.json')!.bytes));
        const codes = m.groups.map(g => {
            const bytes = artifact.files.find(f => f.path === g.unit.file && f.role !== 'static')!.bytes;
            const code = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
            if (outputHash(Buffer.from(code)) !== outputHash(bytes) || bytes.length > this.maxArtifactBytes) throw new Error('Invalid split script bytes');
            return code;
        });
        const zone = await this.client.request('GET', `/pullzone/${this.config.publicZoneId}`);
        safeSplitZone(zone);
        const placeholders = m.groups.map(g => ({ group: g.name, scriptId: '0', hostname: 'plan.bunny.run', name: `${plan.name}-${g.name}` }));
        receipt(m, plan.project, plan.environment, plan.configSummary!.digest, placeholders, zone);

        // Assets finish before any immutable script exists: a collision or corrupt upload must leave nothing to clean up.
        const assets = await this.uploadAssets(artifact);
        // The units are independent scripts, so they are staged together. Every one runs to its end before a failure is reported
        // (the first in group order), so cleanup sees every script this attempt created.
        const settled = await Promise.allSettled(m.groups.map((g, i) => this.stageScript(`${plan.name}-${g.name}`, plan.revision, codes[i]!, config, reuseOnly)));
        const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failed) throw failed.reason;
        const groups = m.groups.map((g, i) => { const unit = (settled[i] as PromiseFulfilledResult<StagedRevision>).value; return { group: g.name, scriptId: unit.scriptId, hostname: unit.hostname, name: unit.name }; });
        const split = receipt(m, plan.project, plan.environment, plan.configSummary!.digest, groups, zone);
        const main = groups.find(g => g.group === m.defaultGroup)!;
        return { scriptId: main.scriptId, hostname: main.hostname, name: main.name, revision: plan.revision, split, assets };
    }
    /** Official script details list variables; the secrets endpoint returns names only. */
    async verifyConfig(scriptId: string, expected: ConfigSummary, runtime?: RuntimeConfig): Promise<void> {
        try {
            const details = await this.client.request('GET', `/compute/script/${scriptId}`);
            const listed = await this.client.request('GET', `/compute/script/${scriptId}/secrets`);
            // The official schemas allow null for an empty collection; missing fields still fail closed.
            const variables = details.EdgeScriptVariables === null ? [] : details.EdgeScriptVariables;
            const secrets = listed.Secrets === null ? [] : listed.Secrets;
            if (!Array.isArray(variables) || !Array.isArray(secrets)) throw new Error();
            const config: RuntimeConfig = { variables: Object.create(null), secrets: Object.create(null), required: [] };
            for (const v of variables) {
                if (Object.hasOwn(config.variables, v.Name)) throw new Error();
                config.variables[v.Name] = v.DefaultValue;
                if (v.Required) config.required.push(v.Name);
            }
            for (const s of secrets) {
                if (Object.hasOwn(config.secrets, s.Name)) throw new Error();
                config.secrets[s.Name] = '';
            }
            // Required on secrets is a local presence constraint, not a provider field.
            const actual = summarizeConfig(config);
            if (runtime) {
                const differences = [...new Set([...Object.keys(config.variables), ...Object.keys(runtime.variables)])].filter(n => config.variables[n] !== runtime.variables[n]);
                if (differences.length) throw new Error(`non-secret variable mismatch: ${differences.map(n => `${n} (${!Object.hasOwn(config.variables, n) ? 'missing' : !Object.hasOwn(runtime.variables, n) ? 'unexpected' : 'value changed'})`).join(', ')}`);
                if (JSON.stringify(actual.secrets) !== JSON.stringify(expected.secrets)) throw new Error(`secret names differ (missing: ${expected.secrets.filter(n => !actual.secrets.includes(n)).join(', ') || '(none)'}; extra: ${actual.secrets.filter(n => !expected.secrets.includes(n)).join(', ') || '(none)'})`);
            }
            if (JSON.stringify(actual.variables) !== JSON.stringify(expected.variables) || JSON.stringify(actual.secrets) !== JSON.stringify(expected.secrets)) throw new Error();
            // Secret values cannot be read back; only their names are compared.
            if (actual.digest !== expected.digest) throw new Error();
        } catch (error) { if (runtime && error instanceof Error && /^(non-secret variable mismatch:|secret names differ)/.test(error.message)) throw error; throw new Error('Runtime configuration drift or incomplete provider configuration response'); }
    }
    async verify(staged: StagedRevision, config?: ConfigSummary): Promise<VerifyResult> {
        const seconds = probeTimeout(this.probeTimeoutSeconds);
        const groups = staged.split?.groups ?? [{ ...staged, group: 'default' }];
        const tasks = groups.map(async g => {
            if (config) {
                try { await this.verifyConfig(g.scriptId, config); }
                catch { return [g.group, 'runtime configuration drift or incomplete provider configuration response'] as const; }
            }
            const r = staged.split;
            const error = await readinessProbe(this.send, `https://${g.hostname}${r ? '/__hadars/release' : '/'}`, seconds, ms => this.pause(ms), r ? { release: r.releaseId, group: g.group, shell: r.shell } : undefined);
            return [g.group, error] as const;
        });
        if (staged.split) tasks.push((async () => ['default smoke', await readinessProbe(this.send, `https://${staged.hostname}/`, seconds, ms => this.pause(ms))] as const)());
        const failures = (await Promise.all(tasks)).filter((row): row is readonly [string, string] => row[1] !== undefined);
        this.attempt.probeFailures = Object.fromEntries(failures);
        if (failures.length) return { ok: false, error: `Staged unit probe failed: ${failures.map(([group, reason]) => `${group}: ${reason}`).join('; ')}` };
        return { ok: true };
    }
    async activate(staged: StagedRevision, options?: { previous?: StagedRevision; noAutoRollback?: boolean }) {
        this.activationProbes = undefined;
        this.activationRules = undefined;
        if (staged.split || options?.previous?.split) {
            try { this.activationProbes = await activateReceipt(this.client, this.config.publicZoneId, staged, this.send, this.pause, options?.previous, options?.noAutoRollback, rules => { this.activationRules = rules; }); }
            catch (error) {
                if (error instanceof SplitActivationError) throw error;
                // The transaction wraps every write failure. Other errors are preflight,
                // before any live mutation, so the caller's lock can safely be released.
                throw new SplitActivationError(`Split activation preflight failed: ${(error as Error).message}`, true);
            }
            return;
        }
        await this.client.request('POST', `/pullzone/${this.config.publicZoneId}`, { EdgeScriptId: Number(staged.scriptId), OriginType: 4, OriginUrl: 'https://bunnycdn.com' });
        // The pull zone caches script responses (query strings are not part of its cache key by default), so without a purge
        // the previous revision keeps being served from cache after the pointer moves, and a rollback would be cached the same way.
        await this.client.request('POST', `/pullzone/${this.config.publicZoneId}/purgeCache`);
    }
    rollback(previous: StagedRevision, options?: { previous?: StagedRevision; noAutoRollback?: boolean }) { return this.activate(previous, options); }
    async retain(project: string, environment: string, live: string, previous?: string, receipts?: StagedRevision[], history: StagedRevision[] = []) {
        if (receipts?.some(r => r.split)) return this.retainSplit(project, environment, receipts, history);
        const scripts = await this.scripts();
        const prefix = `${project}-${environment}-r`;
        const owned = scripts.filter((s: { Name: string }) => s.Name.startsWith(prefix) && /^\d+(?:-c[1-9]\d*)?$/.test(s.Name.slice(prefix.length))) as Array<{ Id: number; Name: string }>;
        owned.sort((a, b) => b.Id - a.Id);
        const keep = new Set([live, ...(previous ? [previous] : [])]);
        for (const s of owned) if (keep.size < 5) keep.add(String(s.Id));
        for (const s of owned) if (!keep.has(String(s.Id))) await this.client.request('DELETE', `/compute/script/${s.Id}`);
    }
    private async retainSplit(project: string, environment: string, receipts: StagedRevision[], history: StagedRevision[]) {
        const zone = await this.client.request('GET', `/pullzone/${this.config.publicZoneId}`);
        safeSplitZone(zone);
        const protectedIds = new Set([String(zone.EdgeScriptId), ...zone.EdgeRules.filter((r: any) => r.ActionType === 21).map((r: any) => String(r.ActionParameter1)), ...receipts.flatMap(r => r.split ? r.split.groups.map(g => g.scriptId) : [r.scriptId])]);
        const scripts = await this.scripts(), releases = new Map<string, typeof scripts>();
        // A name-shaped lookalike alone never establishes ownership. Only recorded
        // script identities/names are candidates; unknown failed-stage orphans stay.
        for (const record of [...history, ...receipts]) {
            const groups = record.split?.groups ?? [{ group: '', scriptId: record.scriptId, name: record.name }];
            const base = record.split ? record.name.slice(0, -(record.split.defaultGroup.length + 1)) : record.name;
            if (!base.startsWith(`${project}-${environment}-r`)) throw new Error('Foreign retention receipt');
            const rows = scripts.filter(s => groups.some(g => String(s.Id) === g.scriptId && s.Name === g.name));
            const old = releases.get(base) ?? [];
            releases.set(base, [...old, ...rows.filter(s => !old.some(o => o.Id === s.Id))]);
        }
        const ordered = [...releases.values()].sort((a, b) => Math.max(...b.map(s => s.Id)) - Math.max(...a.map(s => s.Id)));
        const keep = new Set(ordered.filter(rows => rows.some(s => protectedIds.has(String(s.Id)))));
        for (const rows of ordered) if (keep.size < 5) keep.add(rows);
        for (const rows of ordered) if (!keep.has(rows)) for (const s of rows) await this.client.request('DELETE', `/compute/script/${s.Id}`);
    }

}
