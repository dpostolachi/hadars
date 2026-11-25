import { forbidsReuse } from './probe';
import type { BunnyClient, StagedRevision } from './index';
import { dnsHostname, settingsDrift } from './zones';
import { literalPrefix, matchGroup, routingPlan, rulePatterns, validateSplit as validateSplitReceiptManifest, type SplitManifest } from './split';
import { outputCanonical } from './output';

export interface NativeRule {
    Guid?: string; Description: string; Enabled: boolean; TriggerMatchingType: number; ActionType: number;
    ActionParameter1: string; ActionParameter2: string; ActionParameter3: string;
    Triggers: { Type: number; PatternMatches: string[]; PatternMatchingType: number; Parameter1: string }[];
}
export interface LiveRule { Description: string; Guid: string }
const validGuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export function validateLiveRules(r: SplitReceipt, rules: LiveRule[]): void {
    if (!Array.isArray(rules) || rules.length !== r.rules.length || new Set(rules.map(x => x?.Guid)).size !== rules.length || new Set(rules.map(x => x?.Description)).size !== rules.length || rules.some(x => !x || Object.keys(x).sort().join(',') !== 'Description,Guid' || !validGuid(x.Guid) || !r.rules.some(p => p.Description === x.Description && (!p.Guid || p.Guid === x.Guid)))) throw new Error('Invalid split live rule GUID map');
}
export interface GroupScript { group: string; scriptId: string; hostname: string; name: string }
export interface PublicProbe { path: string; group: string }
export interface SplitReceipt {
    version: 1 | 2 | 3; releaseId: string; shell: string; snapshot: string; defaultGroup: string; owner: string;
    configDigest: string; publicHostname: string; publicHostnames: string[]; plan: ReturnType<typeof routingPlan>; groups: GroupScript[];
    rules: NativeRule[]; probes: PublicProbe[];
    probeHostnames?: { required: string[]; advisory: string[] };
}
export interface ProbeSummary { release: string; checked: number; attempts: number; advisory?: { hostname: string; checked: number; failed: number }[] }
export const MAX_URL_PATTERNS_PER_CONDITION = 5;
export const classifyProbeHostnames = (hosts: string[]) => ({ required: hosts.filter(h => !h.endsWith('.bunny.run')), advisory: hosts.filter(h => h.endsWith('.bunny.run')) });
export const MAX_EDGE_RULES_PER_ZONE = 50;
// Exact identities win. Historical group-only / single-index rules are then
// adopted in native order, once each. GUIDs also permit restoring old receipts.
function assignRules(prior: NativeRule[], wanted: NativeRule[], owner: string): void {
    const used = new Set<NativeRule>();
    for (const r of wanted) {
        const old = prior.find(p => !used.has(p) && (r.Guid ? p.Guid === r.Guid : p.Description === r.Description));
        if (old) { used.add(old); r.Guid = old.Guid; }
    }
    for (const r of wanted.filter(r => !r.Guid)) {
        const group = r.Description.slice(owner.length).split(':')[0];
        const old = prior.find(p => {
            const parts = p.Description.slice(owner.length).split(':');
            return !used.has(p) && parts[0] === group && (parts.length === 1 || parts.length === 2 && /^[0-9]+$/.test(parts[1]!));
        });
        if (old) { used.add(old); r.Guid = old.Guid; }
    }
}
export class SplitRuleCapacityError extends Error {
    constructor(needed: number, foreign: number) {
        super(`Split rule capacity exceeded: needed ${needed}, existing foreign ${foreign}, cap ${MAX_EDGE_RULES_PER_ZONE}; reduce hostnames or mounts`);
    }
}
export function checkRuleCapacity(existing: NativeRule[], wanted: NativeRule[], owner: string): number {
    const foreign = existing.filter(r => !r.Description?.startsWith(owner)).length;
    const owned = existing.length - foreign;
    const reused = wanted.filter(r => r.Guid && existing.some(p => p.Guid === r.Guid && p.Description?.startsWith(owner))).length;
    const needed = foreign + owned + wanted.length - reused;
    if (needed > MAX_EDGE_RULES_PER_ZONE) throw new SplitRuleCapacityError(needed, foreign);
    return needed;
}
export class SplitActivationError extends Error { constructor(message: string, readonly restored: boolean) { super(message); } }
export function safeSplitZone(zone: any): string {
    if (zone?.OriginType !== 4 || !/^\d+$/.test(String(zone.EdgeScriptId)) || settingsDrift(zone).length) throw new Error('Public zone must have an EdgeScript origin and production-safe settings; run setup drift check');
    if (!Array.isArray(zone.EdgeRules)) throw new Error('Incomplete public zone edge rules');
    return splitHostnames(zone)[0]!;
}
function splitHostnames(zone: any): string[] {
    const hosts = zone.Hostnames?.map((h: any) => h.Value);
    if (!Array.isArray(hosts) || !hosts.length || hosts.some(h => !dnsHostname(h)) || new Set(hosts).size !== hosts.length) throw new Error('Split routing requires explicit public zone hostnames');
    return hosts.sort();
}

export function publicProbes(m: SplitManifest, historical = false): PublicProbe[] {
    const paths = new Set<string>([m.probe.path, '/', '/?x=1']);
    for (const g of m.groups) for (const pattern of g.patterns) {
        const p = literalPrefix(pattern);
        for (const path of [p, p + '?x=1', p === '/' ? '/x' : p + '/', p === '/' ? '/x/y?z=1' : p + '/__hadars_smoke?y=2', p + '2', p + 'istrator', p.toUpperCase(), '/x' + p, ...(historical ? ['/?next=' + p] : []), ...(historical ? [] : [p + '/x', p + '/x/y', p + '/x?y=2'])]) paths.add(path);
    }
    return [...paths].map(path => ({ path, group: matchGroup(m, path) }));
}
export function receipt(m: SplitManifest, project: string, environment: string, configDigest: string, groups: GroupScript[], zone: any, legacy: boolean | 2 = false): SplitReceipt {
    const publicHostname = safeSplitZone(zone), publicHostnames = splitHostnames(zone), owner = `hadars:${project}:${environment}:`;
    const version = legacy === true ? 1 : legacy === 2 ? 2 : 3;
    const rules: NativeRule[] = m.groups.filter(g => g.name !== m.defaultGroup).flatMap(g => {
        const mounts = version === 1 ? [g.patterns] : [...g.patterns].sort().map(p => [p]);
        return mounts.flatMap((patterns, mountIndex) => {
            const historicalPatterns = (host: string) => patterns.flatMap(p => { const base = `https://${host}${literalPrefix(p)}`; return p.endsWith('/**') ? [base, base + '?*', base + '/*'] : [base, base + '?*']; });
            const chunks: string[][] = [];
            if (version < 3) chunks.push(version === 1 ? publicHostnames.flatMap(historicalPatterns) : historicalPatterns('*'));
            else for (const host of publicHostnames) {
                const pair = rulePatterns(patterns, host);
                if (!chunks.length || chunks[chunks.length - 1]!.length + pair.length > MAX_URL_PATTERNS_PER_CONDITION) chunks.push([]);
                chunks[chunks.length - 1]!.push(...pair);
            }
            return chunks.map((PatternMatches, chunkIndex) => ({ Description: owner + g.name + (version === 1 ? '' : `:${mountIndex}`) + (version === 3 ? `:${chunkIndex}` : ''), Enabled: true, TriggerMatchingType: 0, ActionType: 21,
                ActionParameter1: groups.find(s => s.group === g.name)!.scriptId, ActionParameter2: '', ActionParameter3: '',
                Triggers: [{ Type: 0, PatternMatches, PatternMatchingType: 0, Parameter1: '' }] }));
        });
    });
    if (new Set(zone.EdgeRules.filter((r: NativeRule) => r.Description?.startsWith(owner)).map((r: NativeRule) => r.Description)).size !== zone.EdgeRules.filter((r: NativeRule) => r.Description?.startsWith(owner)).length) throw new Error('Ambiguous owned edge rule');
    assignRules(zone.EdgeRules.filter((r: NativeRule) => r.Description?.startsWith(owner)), rules, owner);
    if (version === 3) checkRuleCapacity(zone.EdgeRules, rules, owner);
    const probeHostnames = classifyProbeHostnames(publicHostnames);
    if (version !== 1 && !probeHostnames.required.length) throw new Error('Split routing requires at least one required public hostname');
    return { version, releaseId: m.releaseId, shell: m.shell, snapshot: m.snapshot, defaultGroup: m.defaultGroup, owner, configDigest, publicHostname, publicHostnames, plan: routingPlan(m), groups, rules, probes: publicProbes(m, version < 3), ...(version !== 1 ? { probeHostnames } : {}) };
}

const ruleFields = (r: NativeRule): NativeRule => ({ ...(r.Guid ? { Guid: r.Guid } : {}), Description: r.Description, Enabled: r.Enabled, TriggerMatchingType: r.TriggerMatchingType, ActionType: r.ActionType,
    ActionParameter1: r.ActionParameter1, ActionParameter2: r.ActionParameter2, ActionParameter3: r.ActionParameter3, Triggers: r.Triggers });
// Provider identity and native order are observations, not planned routing fields.
const comparableRule = (r: NativeRule) => { const { Guid, ...fields } = ruleFields(r); return outputCanonical(fields); };
export async function probeReceipt(r: SplitReceipt, send: typeof fetch, pause: () => Promise<void>): Promise<ProbeSummary> {
    const hosts = r.version !== 1 ? r.probeHostnames! : { required: r.publicHostnames, advisory: [] };
    const check = async (host: string, p: PublicProbe) => {
        try {
            const response = await send(`https://${host}${p.path}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { 'cache-control': 'no-cache' } });
            let ok = response.headers.get('x-hadars-release') === r.releaseId && response.headers.get('x-hadars-group') === p.group;
            if (p.path === '/__hadars/release') {
                const data = await response.json();
                ok &&= response.status === 200 && data.release === r.releaseId && data.group === r.defaultGroup && data.shell === r.shell && forbidsReuse(response.headers.get('cache-control'));
            }
            await response.body?.cancel().catch(() => {});
            return ok;
        } catch { return false; }
    };
    for (let attempt = 0; attempt < 12; attempt++) {
        let ok = true;
        for (const host of hosts.required) for (const p of r.probes) if (!await check(host, p)) ok = false;
        if (ok) {
            const advisory = [];
            for (const hostname of hosts.advisory) {
                let failed = 0;
                for (const p of r.probes) if (!await check(hostname, p)) failed++;
                advisory.push({ hostname, checked: r.probes.length, failed });
            }
            return { release: r.releaseId, checked: r.probes.length * hosts.required.length, attempts: attempt + 1, ...(r.version !== 1 ? { advisory } : {}) };
        }
        if (attempt < 11) await pause();
    }
    throw new Error('Public split probes did not converge (release/group, exact mount, sub-path or near-miss mismatch)');
}

async function probeSingle(hostname: string, send: typeof fetch, pause: () => Promise<void>): Promise<void> {
    for (let attempt = 0; attempt < 12; attempt++) {
        try { const response = await send(`https://${hostname}/`, { redirect: 'error', signal: AbortSignal.timeout(10_000) }); const ok = response.ok; await response.body?.cancel(); if (ok) return; } catch {}
        if (attempt < 11) await pause();
    }
    throw new Error('Previous single-script public smoke did not converge');
}
/** Every possibly applied write has an undo registered BEFORE sending it, including
 * lost replies. Undo is idempotent and reversed: pointer first, disabled tombstones, updates.
 * No script deletion occurs in this transaction. Foreign rules are never written.
 */
export async function activateReceipt(client: BunnyClient, zoneId: string, staged: StagedRevision, send: typeof fetch, pause: () => Promise<void>, previous?: StagedRevision, noAutoRollback = false, recordRules?: (rules: LiveRule[]) => void, adoptRecreatedZone = false): Promise<ProbeSummary | undefined> {
    const path = `/pullzone/${zoneId}`, before = await client.request('GET', path);
    const desired = staged.split;
    if (!desired && !previous?.split) throw new Error('Native transaction requires a split receipt');
    const hostname = safeSplitZone(before), owner = desired?.owner ?? previous!.split!.owner;
    if (desired && (hostname !== desired.publicHostname || outputCanonical(splitHostnames(before)) !== outputCanonical(desired.publicHostnames))) throw new Error('Public hostname drift');
    // Opt-in for a public zone that was deleted and recreated: the previous rules and receipt belonged to the old zone.
    // Only when the zone holds no owned rules at all; otherwise the checks below run as before.
    const adopt = adoptRecreatedZone && !before.EdgeRules.some((r: NativeRule) => r.Description?.startsWith(owner));
    if (previous?.split && !adopt) {
        if (previous.liveRules) {
            validateLiveRules(previous.split, previous.liveRules);
            if (previous.liveRules.some(r => !before.EdgeRules.some((a: NativeRule) => a.Description === r.Description && a.Guid === r.Guid))) throw new Error('Previous live rule identity drift');
        }
        const liveRules = before.EdgeRules.filter((r: NativeRule) => r.Description?.startsWith(owner) && r.Enabled);
        if (String(before.EdgeScriptId) !== previous.scriptId || liveRules.length !== previous.split.rules.length || previous.split.rules.some(r => !liveRules.some((a: NativeRule) => comparableRule(a) === comparableRule(r)))) throw new Error('Previous split receipt does not match live native state; reconcile drift');
    }
    const prior = before.EdgeRules.filter((r: NativeRule) => r.Description?.startsWith(owner)) as NativeRule[];
    if (new Set(prior.map(r => r.Description)).size !== prior.length) throw new Error('Ambiguous owned edge rule');
    if (desired && staged.liveRules) validateLiveRules(desired, staged.liveRules);
    const wanted = structuredClone(desired?.rules ?? []);
    for (const r of wanted) r.Guid = staged.liveRules?.find(p => p.Description === r.Description)?.Guid ?? r.Guid;
    assignRules(prior, wanted, owner);
    checkRuleCapacity(before.EdgeRules, wanted, owner);
    for (const r of wanted) {
        const old = prior.find(p => p.Guid === r.Guid);
        const expected = staged.liveRules?.find(p => p.Description === r.Description)?.Guid ?? r.Guid;
        if (expected && old?.Guid !== expected) throw new Error('Rollback live rule identity drift');
    }
    // Keep obsolete GUIDs in place as disabled tombstones. Recreating a deleted
    // rule cannot promise its old OrderIndex using the measured API. Point every
    // tombstone at the current default, so it never pins an obsolete script.
    const retired = prior.filter(p => !wanted.some(w => w.Guid === p.Guid)).map(r => ({ ...ruleFields(r), Enabled: false, ActionParameter1: staged.scriptId }));
    const after = [...wanted, ...retired];
    if (prior.some(r => !validGuid(r.Guid)) || new Set(prior.map(r => r.Guid)).size !== prior.length) throw new Error('Invalid owned rule readback');
    for (const r of wanted) if (before.EdgeRules.some((old: NativeRule) => old.Guid === r.Guid && !old.Description?.startsWith(owner))) throw new Error('Rule GUID belongs to a foreign rule');
    const upsert = (r: NativeRule) => client.request('POST', path + '/edgerules/addOrUpdate', ruleFields(r));
    const remove = async (guid: string) => {
        // DELETE of an already absent rule may be 404: readback makes undo safe
        // after a failed create or a lost deletion reply without inventing an API status.
        const zone = await client.request('GET', path);
        if (!Array.isArray(zone.EdgeRules)) throw new Error('Incomplete rule removal readback');
        if (zone.EdgeRules.some((r: NativeRule) => r.Guid === guid)) await client.request('DELETE', path + '/edgerules/' + guid);
    };
    const pointer = (id: string | number) => client.request('POST', path, { EdgeScriptId: Number(id), OriginType: 4, OriginUrl: 'https://bunnycdn.com' });
    const readback = async (rules: NativeRule[], id: string | number) => {
        const zone = await client.request('GET', path);
        safeSplitZone(zone);
        const actual = zone.EdgeRules.filter((r: NativeRule) => r.Description?.startsWith(owner));
        if (String(zone.EdgeScriptId) !== String(id) || actual.length !== rules.length || rules.some(r => !actual.some((a: NativeRule) => comparableRule(a) === comparableRule(r)))) throw new Error('Native rule/default pointer readback mismatch');
    };
    // All selected scripts must still exist before any live writes (including rollback).
    const listed = await client.request('GET', '/compute/script');
    const scripts = Array.isArray(listed) ? listed : listed?.Items;
    if (!Array.isArray(scripts) || listed.HasMore || listed.TotalItems > scripts.length || [staged.scriptId, String(before.EdgeScriptId), ...prior.filter(r => r.ActionType === 21).map(r => String(r.ActionParameter1)), ...(desired?.groups.map(g => g.scriptId) ?? [])].some(id => !scripts.some((s: any) => String(s.Id) === id))) throw new Error('Missing staged group script or incomplete script inventory');
    const undo: (() => Promise<unknown>)[] = [];
    try {
        for (const r of wanted) {
            const old = prior.find(p => p.Guid === r.Guid);
            if (old) { undo.push(() => upsert(old)); await upsert(r); continue; }
            // Register before create: a lost reply still needs deletion by the observed Guid.
            let createdGuid: string | undefined;
            undo.push(async () => {
                if (createdGuid) return remove(createdGuid);
                const zone = await client.request('GET', path);
                if (!Array.isArray(zone.EdgeRules)) throw new Error('Incomplete create undo readback');
                const found = zone.EdgeRules.filter((a: NativeRule) => a.Description === r.Description);
                if (found.length > 1) throw new Error('Ambiguous created rule');
                if (found.length) { if (!validGuid(found[0].Guid)) throw new Error('Invalid created Guid'); await remove(found[0].Guid); }
            });
            const created = await upsert(r); // no Guid means CREATE
            if (!validGuid(created?.Guid) || before.EdgeRules.some((a: NativeRule) => a.Guid === created.Guid) || wanted.some(w => w.Guid === created.Guid)) throw new Error('Rule creation returned invalid Guid');
            createdGuid = created.Guid;
            r.Guid = created.Guid;
        }
        for (const r of retired) { const old = prior.find(p => p.Guid === r.Guid)!; undo.push(() => upsert(old)); await upsert(r); }
        undo.push(() => pointer(before.EdgeScriptId)); await pointer(staged.scriptId);
        await readback(after, staged.scriptId);
        await client.request('POST', path + '/purgeCache');
        if (desired) {
            const probes = await probeReceipt(desired, send, pause);
            recordRules?.(wanted.map(r => ({ Description: r.Description, Guid: r.Guid! })));
            return probes;
        }
        await probeSingle(hostname, send, pause);
        return undefined;
    } catch (error) {
        if (noAutoRollback) throw new SplitActivationError('Split activation failed; automatic rollback disabled; reconcile native state', false);
        try {
            for (const action of undo.reverse()) {
                // Continue unwinding even when one undo call fails. The final full
                // readback decides success; retries replay only idempotent operations.
                for (let attempt = 0; attempt < 3; attempt++) {
                    try { await action(); break; } catch { if (attempt < 2) await pause(); }
                }
            }
            await readback(prior, before.EdgeScriptId);
            await client.request('POST', path + '/purgeCache');
            if (previous?.split) await probeReceipt(previous.split, send, pause);
            else await probeSingle(hostname, send, pause);
        } catch { throw new SplitActivationError('Split activation failed and restoration could not be verified; reconcile native state', false); }
        throw new SplitActivationError(`Split activation failed; previous native state restored: ${(error as Error).message}`, true);
    }
}

/** Persistence boundary: a stored receipt is public data, but must not become an arbitrary
 * native API request or a forged retention-ownership claim. */
export function validateReceipt(r: SplitReceipt, revisionName: string, staged: StagedRevision): void {
    if (!r || (r.version !== 1 && r.version !== 2 && r.version !== 3) || !/^[a-f0-9]{16}$/.test(r.releaseId) || !/^[a-f0-9]{64}$/.test(r.configDigest) || !dnsHostname(r.publicHostname) || !Array.isArray(r.publicHostnames) || !r.publicHostnames.length || r.publicHostnames.some(h => !dnsHostname(h)) || r.publicHostname !== r.publicHostnames[0] || typeof r.shell !== 'string' || typeof r.snapshot !== 'string' || !Array.isArray(r.groups) || !Array.isArray(r.plan) || !Array.isArray(r.rules) || !Array.isArray(r.probes)) throw new Error('Invalid split receipt');
    const main = r.groups.find(g => g.group === r.defaultGroup);
    if (!main || main.scriptId !== staged.scriptId || main.hostname !== staged.hostname || main.name !== staged.name) throw new Error('Split default script mismatch');
    const base = main.name.slice(0, -(r.defaultGroup.length + 1));
    if (!(base === revisionName || base.startsWith(revisionName + '-c') && /^[1-9]\d*$/.test(base.slice(revisionName.length + 2)))) throw new Error('Invalid split script name');
    if (new Set(r.groups.map(g => g.scriptId)).size !== r.groups.length || r.groups.some(g => !/^\d+$/.test(g.scriptId) || !/^[a-z0-9.-]+\.bunny\.run$/.test(g.hostname) || g.name !== `${base}-${g.group}`)) throw new Error('Invalid split group scripts');
    const m: SplitManifest = { version: 1, mode: 'per-module', releaseId: r.releaseId, defaultGroup: r.defaultGroup, shell: r.shell, snapshot: r.snapshot, budgets: { unitBytes: 1 }, probe: { path: '/__hadars/release' },
        groups: r.plan.map(p => ({ name: p.group, patterns: p.patterns, modules: p.group === r.defaultGroup ? [] : [p.group], unit: { file: `units/${p.group}/bunny.mjs`, sha256: '0'.repeat(64), size: 0 } })) };
    // Reuse manifest grammar/ordering validation without trusting unknown receipt data.
    validateSplitReceiptManifest(m);
    if (outputCanonical(r.plan.map(p => p.group)) !== outputCanonical(r.groups.map(g => g.group))) throw new Error('Split script/plan membership mismatch');
    const parts = /^hadars:([a-z0-9-]+):([a-z0-9-]+):$/.exec(r.owner);
    if (!parts || !revisionName.startsWith(`${parts[1]}-${parts[2]}-r`)) throw new Error('Invalid split rule ownership');
    if (new Set(r.rules.map(rule => rule.Description)).size !== r.rules.length || new Set(r.rules.filter(rule => rule.Guid !== undefined).map(rule => rule.Guid)).size !== r.rules.filter(rule => rule.Guid !== undefined).length || r.rules.some(rule => rule.Guid !== undefined && !validGuid(rule.Guid))) throw new Error('Invalid split rule GUID');
    const rebuilt = receipt(m, parts[1]!, parts[2]!, r.configDigest, r.groups, { OriginType: 4, EdgeScriptId: Number(staged.scriptId), EnableSmartCache: true, IgnoreQueryStrings: false, DisableCookies: false, AddHostHeader: true, Hostnames: r.publicHostnames.map(Value => ({ Value })), EdgeRules: r.rules }, r.version === 1 ? true : r.version === 2 ? 2 : false);
    if (outputCanonical(rebuilt.probeHostnames) !== outputCanonical(r.probeHostnames) || new Set(r.publicHostnames).size !== r.publicHostnames.length || outputCanonical([...r.publicHostnames].sort()) !== outputCanonical(r.publicHostnames)) throw new Error('Invalid split probe hostnames');
    if (outputCanonical(rebuilt.rules) !== outputCanonical(r.rules) || outputCanonical(rebuilt.probes) !== outputCanonical(r.probes)) throw new Error('Invalid split native plan or probes');
}
