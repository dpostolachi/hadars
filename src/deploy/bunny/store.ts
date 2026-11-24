import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { ConfigSummary } from './config';
import type { GcRecord } from './gc';
import type { OutputVerification } from './output';
import type { ProbeSummary, LiveRule } from './split-release';
import type { StageAttempt, StagedRevision } from './index';

export type DeploymentStatus = 'pending' | 'staged' | 'verifying' | 'live' | 'failed' | 'superseded' | 'rolled_back';
const ACTIVE = ['pending', 'staged', 'verifying'];

/** One deploy attempt. A store keeps these so rollback, GC and the no-op check can see what is live. */
export interface DeploymentRecord extends GcRecord {
    target: 'bunny';
    status: DeploymentStatus;
    staged?: StagedRevision;
    outputVerification?: OutputVerification;
    probeResults?: ProbeSummary;
    liveRules?: LiveRule[];
    stageAttempt?: StageAttempt;
    configSummary?: ConfigSummary;
    artifactSummary: { files: number; bytes: number };
    finishedAt?: number;
    error?: string;
    rollbackOf?: string;
}
export type DeploymentInput = Omit<DeploymentRecord, 'startedAt' | 'finishedAt' | 'previousDeploymentId'>;

/** Where deployments are remembered. The default keeps them in a file; a service can supply its own. */
export interface DeployStore {
    /** Records for one environment, newest revision first. */
    list(environment: string): Promise<DeploymentRecord[]>;
    /** Every environment, for GC protection. */
    listAll(): Promise<DeploymentRecord[]>;
    /** Creates or updates by id. A record that goes live supersedes the previous live one. */
    record(input: DeploymentInput): Promise<void>;
    /** Holds the exclusive right to change an environment (or GC) for the duration of `fn`. */
    exclusive<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

interface StateFile { version: 1; deployments: DeploymentRecord[] }

/** JSON file store. Writes are atomic renames; `exclusive` takes a lock file next to the state. */
export function fileStore(file: string, now: () => number = Date.now): DeployStore {
    const read = async (): Promise<StateFile> => {
        try {
            const state = JSON.parse(await readFile(file, 'utf8'));
            if (state?.version !== 1 || !Array.isArray(state.deployments)) throw new Error('unsupported');
            return state;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, deployments: [] };
            throw new Error(`Could not read deploy state ${file}`);
        }
    };
    const write = async (state: StateFile) => {
        await mkdir(dirname(file), { recursive: true });
        const temp = `${file}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify(state, null, 2) + '\n');
        await rename(temp, file);
    };
    const newestFirst = (a: DeploymentRecord, b: DeploymentRecord) => b.revision - a.revision || b.startedAt - a.startedAt;
    return {
        async list(environment) { return (await read()).deployments.filter(d => d.environment === environment).sort(newestFirst); },
        async listAll() { return (await read()).deployments.sort(newestFirst); },
        async record(input) {
            const state = await read();
            const old = state.deployments.find(d => d.id === input.id);
            const live = state.deployments.find(d => d.environment === input.environment && d.status === 'live' && d.id !== input.id);
            const next: DeploymentRecord = {
                ...input, startedAt: old?.startedAt ?? now(),
                ...(old?.previousDeploymentId ? { previousDeploymentId: old.previousDeploymentId } : {}),
                ...(input.status === 'live' && live ? { previousDeploymentId: live.id } : {}),
                ...(!ACTIVE.includes(input.status) ? { finishedAt: now() } : {}),
            };
            if (input.status === 'live' && live) live.status = input.rollbackOf ? 'rolled_back' : 'superseded';
            state.deployments = [...state.deployments.filter(d => d.id !== input.id), next];
            await write(state);
        },
        async exclusive(name, fn) {
            if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('Invalid lock name');
            const lock = `${file}.${name}.lock`;
            await mkdir(dirname(file), { recursive: true });
            let handle;
            try { handle = await open(lock, 'wx'); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`Another deploy holds ${name}; if none is running, remove ${lock}`);
                throw error;
            }
            try { await handle.writeFile(String(process.pid)); await handle.close(); return await fn(); }
            finally { await rm(lock, { force: true }); }
        },
    };
}
