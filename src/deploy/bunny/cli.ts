import { fileStore } from './store';
import { deployEnvironment } from './deploy';
import { gcProject, loadDeployConfig, loadProjectZones, projectBunny, setupProjectZones } from './target';
import { loadArtifact } from './artifact';

export const DEPLOY_USAGE = `Usage:
  hadars deploy setup --project <name> --env <env> [--target-config deploy.target.json] [--fix-public-zone-settings]
  hadars deploy bunny <artifact-dir> --env <env> [--project <name>] [--revision N] [--config file] [--var NAME=VALUE]
        [--dry-run [--read-provider]] [--allow-unbound-output] [--no-auto-rollback] [--probe-timeout-seconds N] [--keep-failed-stage]
  hadars deploy rollback --env <env> [--to <revision>] [--project <name>]
  hadars deploy gc [--env <env>] [--keep N] [--grace-seconds N] [--dry-run|--delete]
Common: [--target-config deploy.target.json] [--state .hadars/deploy-state.json]
Credentials come from the process environment: BUNNY_API_KEY (management) and BUNNY_STORAGE_KEY (storage zone).`;

function flag(args: string[], name: string): string | undefined {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Use ${name} <value>`);
    return value;
}
const integer = (text: string, name: string, min = 0) => {
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < min) throw new Error(`${name} must be an integer`);
    return Number(text);
};

/** Runs a `hadars deploy ...` command; returns the process exit code. Provider and store are injectable for tests. */
export async function deployCommand(args: string[], io: { env?: Record<string, string | undefined>; out?: (line: string) => void; err?: (line: string) => void; send?: typeof fetch; configureTarget?: (target: import('./index').BunnyTarget) => void } = {}): Promise<number> {
    const env = io.env ?? process.env, out = io.out ?? console.log, err = io.err ?? console.error, send = io.send ?? fetch;
    const verb = args[0];
    try {
        if (!verb || verb === 'help' || verb === '--help') { err(DEPLOY_USAGE); return verb ? 0 : 2; }
        const targetConfig = flag(args, '--target-config');
        const store = fileStore(flag(args, '--state') ?? '.hadars/deploy-state.json');
        if (verb === 'setup') {
            const project = flag(args, '--project'), environment = flag(args, '--env');
            if (!project || !environment) throw new Error('Use hadars deploy setup --project <name> --env <env>');
            await setupProjectZones(project, environment, targetConfig ?? 'deploy.target.json', env, out, send, { fixPublicZoneSettings: args.includes('--fix-public-zone-settings') });
            return 0;
        }
        const zones = await loadProjectZones(targetConfig);
        const project = flag(args, '--project') ?? zones.project;
        if (verb === 'gc') {
            const environment = flag(args, '--env') ?? Object.keys(zones.publicZones)[0];
            if (!environment) throw new Error('Target configuration has no public zones');
            if (args.includes('--delete') && args.includes('--dry-run')) throw new Error('Use --dry-run or --delete, not both');
            const target = projectBunny(zones, project, environment, env, false, send);
            io.configureTarget?.(target);
            await gcProject({ store, project, zones, target, env, send, graceSeconds: integer(flag(args, '--grace-seconds') ?? '3600', '--grace-seconds'), keep: integer(flag(args, '--keep') ?? '5', '--keep'), execute: args.includes('--delete'), out });
            return 0;
        }
        const rollback = verb === 'rollback';
        if (!rollback && verb !== 'bunny') throw new Error(`Unknown deploy command: ${verb}`);
        const environment = flag(args, '--env');
        const directory = rollback ? undefined : args[1];
        if (!environment || (!rollback && (!directory || directory.startsWith('--')))) throw new Error(rollback ? 'Use hadars deploy rollback --env <env>' : 'Use hadars deploy bunny <artifact-dir> --env <env>');
        const dryRun = args.includes('--dry-run'), readProvider = args.includes('--read-provider');
        if (readProvider && !dryRun) throw new Error('--read-provider requires --dry-run');
        const revisionText = flag(args, '--revision'), toText = flag(args, '--to');
        if (toText !== undefined && !rollback) throw new Error('--to belongs to hadars deploy rollback');
        const probeText = flag(args, '--probe-timeout-seconds') ?? env.HADARS_DEPLOY_PROBE_TIMEOUT ?? '120';
        const probe = integer(probeText, 'Probe timeout', 1);
        if (probe > 600) throw new Error('Probe timeout must be an integer from 1 to 600 seconds');
        const configFile = flag(args, '--config'), overrides: string[] = [];
        for (let i = 0; i < args.length; i++) if (args[i] === '--var') { if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error('Use --var NAME=VALUE'); overrides.push(args[++i]!); }
        if (rollback && (configFile || overrides.length)) throw new Error('Rollback uses the original script configuration');
        const config = rollback ? undefined : await loadDeployConfig(configFile, overrides, process.cwd(), env);
        const target = projectBunny(zones, project, environment, env, dryRun && !readProvider, send, readProvider);
        io.configureTarget?.(target);
        await deployEnvironment({
            store, project, environment, target, config, rollback, rollbackTo: toText === undefined ? undefined : integer(toText, '--to', 1), dryRun, readProvider, out,
            artifact: directory ? await loadArtifact(directory) : undefined,
            revision: revisionText === undefined ? undefined : integer(revisionText, '--revision', 1),
            probeTimeoutSeconds: probe, keepFailedStage: args.includes('--keep-failed-stage'),
            allowUnboundOutput: args.includes('--allow-unbound-output'), noAutoRollback: args.includes('--no-auto-rollback'),
        });
        return 0;
    } catch (error) { err((error as Error).message); return 1; }
}
