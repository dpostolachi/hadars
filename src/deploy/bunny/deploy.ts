import { BunnyTarget, type Artifact, type DeployTarget, type Plan, type StagedRevision } from './index';
import { probeTimeout } from './probe';
import { SplitActivationError, SplitRuleCapacityError, publicProbes, MAX_EDGE_RULES_PER_ZONE } from './split-release';
import { summarizeConfig, validateRuntimeConfig, type RuntimeConfig } from './config';
import { verifyOutput, type OutputVerification } from './output';
import type { DeployStore, DeploymentInput, DeploymentRecord, DeploymentStatus } from './store';

export interface DeployOptions {
    store: DeployStore;
    project: string;
    environment: string;
    target: DeployTarget;
    artifact?: Artifact;
    config?: RuntimeConfig;
    /** Defaults to the next revision of the environment. Repeating a live revision re-checks it instead of redeploying. */
    revision?: number;
    rollback?: boolean;
    dryRun?: boolean;
    /** With dryRun: read provider state (GET only) so rule capacity and hostnames are real. */
    readProvider?: boolean;
    noAutoRollback?: boolean;
    keepFailedStage?: boolean;
    probeTimeoutSeconds?: number;
    allowUnboundOutput?: boolean;
    out: (text: string) => void;
}
class ActivationRecordingError extends Error {}
class ArtifactVerificationError extends Error {}
class StageDiagnosticError extends Error {}

export async function deployEnvironment(o: DeployOptions) {
    if (o.readProvider && !o.dryRun) throw new Error('--read-provider requires --dry-run');
    if (o.target instanceof BunnyTarget) o.target.probeTimeoutSeconds = probeTimeout(o.probeTimeoutSeconds ?? process.env.HADARS_DEPLOY_PROBE_TIMEOUT ?? 120);
    if (!o.rollback && o.target instanceof BunnyTarget && o.target.assetBase) {
        const base = o.target.assetBase;
        if (o.config?.secrets.HADARS_ASSET_BASE_URL !== undefined || o.config?.variables.HADARS_ASSET_BASE_URL !== undefined && o.config.variables.HADARS_ASSET_BASE_URL !== base) throw new Error('HADARS_ASSET_BASE_URL must equal the project assets zone root');
        o = { ...o, config: { variables: { ...o.config?.variables, HADARS_ASSET_BASE_URL: base }, secrets: { ...o.config?.secrets }, required: [...new Set([...(o.config?.required ?? []), 'HADARS_ASSET_BASE_URL'])] } };
    }
    if (o.rollback && o.config) throw new Error('Rollback uses the original script configuration; omit config and --var');
    if (o.config) {
        validateRuntimeConfig(o.config);
        if (!o.target.supportsRuntimeConfig) throw new Error('This deploy target does not support runtime variables or secrets');
    }
    // Provider errors may reflect request payloads. Keep resolved secrets out of errors.
    try {
        if (!o.rollback && !o.artifact) throw new Error('Deploy needs an artifact directory');
        return o.dryRun ? await runDeploy(o) : await o.store.exclusive(o.environment, () => runDeploy(o));
    } catch (error) {
        if (error instanceof ActivationRecordingError || error instanceof ArtifactVerificationError || error instanceof StageDiagnosticError) throw error;
        if (error instanceof Error && error.message.startsWith('Cannot reuse immutable script')) throw error;
        if (error instanceof SplitRuleCapacityError) throw error;
        if (o.config && Object.keys(o.config.secrets).length) throw new Error('Deployment with runtime secrets failed; inspect provider state without logging secret payloads');
        throw error;
    }
}
const baseName = (r: DeploymentRecord) => r.staged!.split ? r.staged!.name.slice(0, -(r.staged!.split.defaultGroup.length + 1)) : r.staged!.name;

async function runDeploy(o: DeployOptions) {
    let records = await o.store.list(o.environment);
    let live = records.find(d => d.status === 'live');
    const previous = o.rollback ? records.find(d => d.id === live?.previousDeploymentId) : undefined;
    if (o.rollback && (!previous?.staged || previous.target !== 'bunny')) throw new Error('No previous live deployment is available for rollback');
    const revision = o.rollback ? previous!.revision : o.revision ?? Math.max(0, ...records.map(r => r.revision)) + 1;
    let plan: Plan | undefined;
    let outputVerification: OutputVerification | undefined = previous?.outputVerification;
    if (!o.rollback) {
        const artifact = structuredClone(o.artifact!);
        // Local diagnostics contain artifact identities, never reflected provider/config payloads.
        try { outputVerification = verifyOutput(artifact, o.allowUnboundOutput); }
        catch (error) { throw new ArtifactVerificationError((error as Error).message); }
        if (outputVerification.allowUnboundOutput) o.out('WARNING: --allow-unbound-output: UNVERIFIED OUTPUT; producer final-output binding is absent');
        plan = o.target.plan({ project: o.project, environment: o.environment, revision, artifact }, o.config) as Plan;
        plan.outputVerification = outputVerification;
        o.out(`Plan ${o.environment} revision ${revision}: ${plan.artifactSummary.files} files, ${plan.artifactSummary.bytes} bytes`);
        if (o.config) {
            const summary = summarizeConfig(o.config);
            o.out(`Runtime config: variables ${summary.variables.join(', ') || '(none)'}; secrets ${summary.secrets.join(', ') || '(none)'}; sha256 ${summary.digest.slice(0, 12)}`);
        }
    } else o.out(`Plan rollback ${o.environment} to revision ${revision}`);
    const samePayload = (record: DeploymentRecord) => record.revision === revision
        && record.configSummary?.digest === plan?.configSummary?.digest
        && !!record.outputVerification && JSON.stringify(record.outputVerification) === JSON.stringify(outputVerification);
    if (plan?.splitManifest) {
        const digests = new Set(records.filter(d => d.revision === revision && d.staged).map(d => d.configSummary?.digest));
        const variant = digests.size + (digests.has(plan.configSummary?.digest) ? 0 : 1);
        const matching = records.find(d => d.revision === revision && d.staged?.split && d.configSummary?.digest === plan!.configSummary?.digest);
        plan.name = matching ? baseName(matching) : `${o.project}-${o.environment}-r${revision}${variant > 1 ? `-c${variant}` : ''}`;
        const m = plan.splitManifest;
        o.out(`Split release ${m.releaseId}; immutable base ${plan.name}; ${m.groups.length} groups`);
        if (!(o.target instanceof BunnyTarget)) throw new Error('Split rule planning requires BunnyTarget');
        const offline = !!o.dryRun && !o.readProvider;
        const native = await o.target.planSplitRules(plan, offline);
        o.out(`Public hostnames${offline ? ' (OFFLINE PLACEHOLDERS)' : ''}: ${native.hostnames.join(', ')}; unit hostnames: unit-host-placeholder.invalid (assigned at staging)`);
        if (offline) o.out('rule capacity: not checked offline (needs provider readback)');
        else o.out(`Zone rule count: ${native.count}/${MAX_EDGE_RULES_PER_ZONE} (including foreign rules and owned tombstones); active split rules: ${native.rules.length}`);
        for (const rule of native.rules) o.out(`RunEdgeScript ${rule.Description}: ${JSON.stringify(rule.Triggers[0]!.PatternMatches)}`);
        for (const g of m.groups) o.out(`Group ${g.name}: create ${plan.name}-${g.name}; ${g.unit.size} bytes; staged GET /__hadars/release${g.name === m.defaultGroup ? ' and smoke GET /' : ''}`);
        o.out(`Static inventory: ${plan.staticPaths!.length} objects; additions only, up to ${plan.staticPaths!.length} uploads (existing identical objects reused)`);
        o.out('Order: stage all units/config/static; probe all units; upsert owned rules in plan order; disable obsolete owned rules; default pointer LAST; read back rules/pointer; purge; public probes. A failure restores the previous rules and pointer.');
        o.out(`Expected public probes: ${JSON.stringify(publicProbes(m))}`);
    }
    if (o.rollback && previous?.staged?.split) {
        const receipt = previous.staged.split;
        o.out(`Restore split release ${receipt.releaseId}; retained groups ${JSON.stringify(receipt.groups)}; no script creation or static uploads`);
        o.out(`Restore native rules ${JSON.stringify(receipt.rules)}; disable obsolete owned rules; default pointer LAST; readback; purge; public probes ${JSON.stringify(receipt.probes)}`);
    }
    if (o.dryRun) return;
    if (!o.rollback && live?.staged && samePayload(live) && o.target instanceof BunnyTarget) {
        plan!.name = baseName(live);
        o.target.beginAttempt();
        const checked = await o.target.stage(plan!, o.config, true);
        for (const resource of o.target.attempt.resources) o.out(`Script ${resource.name}: ${resource.disposition}`);
        const verified = await o.target.verify(checked, plan!.configSummary);
        if (!verified.ok) throw new StageDiagnosticError(verified.error ?? 'Staged verification failed');
        o.out(`No-op: ${o.environment} revision ${revision} already live with identical artifact and runtime config (readback verified)`);
        return;
    }
    const staticPaths = plan?.staticPaths ?? previous?.staticPaths;
    const configSummary = plan?.configSummary ?? previous?.configSummary;
    const input: DeploymentInput = {
        id: crypto.randomUUID(), environment: o.environment, revision, target: 'bunny', status: 'pending',
        ...(staticPaths ? { staticPaths } : {}), ...(configSummary ? { configSummary } : {}), ...(outputVerification ? { outputVerification } : {}),
        artifactSummary: plan?.artifactSummary ?? previous!.artifactSummary, ...(previous ? { rollbackOf: previous.id } : {}),
    };
    let staged: StagedRevision | undefined, activated = false, activationAttempted = false, activationStarted = false;
    const report = async (status: DeploymentStatus, error?: string) => {
        await o.store.record({ ...input, status, ...(staged ? { staged } : {}), ...(error ? { error } : {}) });
        o.out(`${o.environment} revision ${revision}: ${status}`);
    };
    if (o.target instanceof BunnyTarget) {
        o.target.beginAttempt();
        o.target.onAttempt = async attempt => {
            input.stageAttempt = attempt;
            await o.store.record({ ...input, status: 'pending' });
        };
    }
    await report('pending');
    try {
        // Names are allocated only inside the environment lock. Old unsuffixed scripts are config variant 1.
        records = await o.store.list(o.environment);
        live = records.find(d => d.status === 'live');
        if (plan) {
            const deployed = records.filter(d => d.revision === revision && d.staged);
            const digests = new Set(deployed.map(d => d.configSummary?.digest));
            const matching = deployed.find(d => d.configSummary?.digest === plan!.configSummary?.digest);
            const count = digests.size + (digests.has(plan.configSummary?.digest) ? 0 : 1);
            plan.name = (matching ? baseName(matching) : undefined) ?? `${o.project}-${o.environment}-r${revision}${count > 1 ? `-c${count}` : ''}`;
        }
        staged = previous?.staged ?? await o.target.stage(plan!, o.config);
        if (o.target instanceof BunnyTarget) {
            o.target.onAttempt = undefined;
            input.stageAttempt = structuredClone(o.target.attempt);
            for (const resource of o.target.attempt.resources) o.out(`Script ${resource.name}: ${resource.disposition}`);
        }
        if (staged.assets) o.out(`Static objects: ${staged.assets.reused} reused, ${staged.assets.uploaded} uploaded`);
        await report('staged');
        await report('verifying');
        const verified = await o.target.verify(staged, input.configSummary);
        if (!verified.ok) throw new Error(verified.error ?? 'Staged verification failed');
        if (!o.rollback) {
            const latest = Math.max(0, ...(await o.store.list(o.environment)).map(r => r.revision));
            if (latest > revision && !o.revision) throw new Error(`Environment revision changed between plan and activate: expected head ${revision}, got ${latest}`);
        }
        activationStarted = true;
        activationAttempted = true;
        const nativeStage = { ...staged, ...(previous?.liveRules ? { liveRules: previous.liveRules } : {}) };
        const nativePrevious = live?.staged ? { ...live.staged, ...(live.liveRules ? { liveRules: live.liveRules } : {}) } : undefined;
        if (o.rollback) await o.target.rollback(nativeStage, { previous: nativePrevious, noAutoRollback: o.noAutoRollback }); else await o.target.activate(nativeStage, { previous: nativePrevious, noAutoRollback: o.noAutoRollback });
        if (o.target instanceof BunnyTarget && o.target.activationRules) input.liveRules = o.target.activationRules;
        if (o.target instanceof BunnyTarget && o.target.activationProbes) input.probeResults = o.target.activationProbes;
        for (const result of input.probeResults?.advisory ?? []) o.out(`Advisory public probes ${result.hostname}: ${result.checked - result.failed}/${result.checked} passed (${result.failed} failed)`);
        activated = true;
        // Keep the lock until cleanup has protected the actual predecessor.
        if (o.target instanceof BunnyTarget) {
            try { await o.target.retain(o.project, o.environment, staged.scriptId, live?.staged?.scriptId, [staged, ...(live?.staged ? [live.staged] : [])], records.flatMap(r => r.staged ? [r.staged] : [])); }
            catch { o.out('Live; old script cleanup failed. Retry retention separately.'); }
        }
        await report('live');
    } catch (error) {
        if (error instanceof SplitActivationError && error.restored) activationAttempted = false;
        if (activationAttempted) throw new ActivationRecordingError(activated
            ? 'Bunny activation succeeded but recording live failed. Fix the deploy state before another deploy.'
            : 'Bunny activation outcome is uncertain. Check the public pointer and the deploy state before another deploy.');
        let cleanup = '';
        if (o.target instanceof BunnyTarget) {
            o.target.onAttempt = undefined;
            const protectedIds = new Set([live?.id, live?.previousDeploymentId].filter(Boolean));
            input.stageAttempt = await o.target.cleanupAttempt(records.filter(r => protectedIds.has(r.id)).flatMap(r => r.staged ? [r.staged] : []), o.keepFailedStage || activationStarted);
            cleanup = input.stageAttempt.resources.map(r => `${r.name} script ${r.scriptId}, linked zones [${r.linkedZoneIds.join(',')}]: ${r.cleanup}${r.remaining?.length ? ' (' + r.remaining.join(', ') + ')' : ''}`).join('; ');
            if (cleanup) o.out(`Failed stage resources: ${cleanup}`);
        }
        const safe = error instanceof Error && /^(Staged unit probe failed:|Default smoke probe failed:|Cannot reuse immutable script)/.test(error.message);
        const reason = safe ? (error as Error).message : o.config && Object.keys(o.config.secrets).length ? 'Deployment with runtime secrets failed' : (error instanceof Error ? error.message : 'Deployment failed').slice(0, 1000);
        await report('failed', `${reason}${cleanup ? '; resources: ' + cleanup : ''}`.slice(0, 1000));
        if (safe) throw new StageDiagnosticError(`${reason}${cleanup ? '; resources: ' + cleanup : ''}`);
        throw error;
    } finally {
        if (o.target instanceof BunnyTarget) o.target.onAttempt = undefined;
    }
    o.out(`Live: ${o.environment} revision ${revision}`);
}
