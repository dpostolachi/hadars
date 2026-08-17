import fs from 'node:fs'
import fsp from 'node:fs/promises'
import pathMod from 'node:path'

// Tracks which process (and its spawned worker, if any) currently owns the
// .hadars/ output directory, so dev/build/run can detect and refuse to race
// each other instead of silently overwriting one another's output.

export interface LockInfo {
    pid: number
    childPid?: number
    port: number
    startedAt: number
}

const LOCK_FILENAME = '.hadars-lock.json'

export function lockPath(hadarsFolder: string): string {
    return pathMod.join(hadarsFolder, LOCK_FILENAME)
}

/** Checks whether a pid is still alive without sending a real signal. */
export function isPidAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch {
        return false
    }
}

export async function writeLock(hadarsFolder: string, info: LockInfo): Promise<void> {
    await fsp.mkdir(hadarsFolder, { recursive: true })
    await fsp.writeFile(lockPath(hadarsFolder), JSON.stringify(info, null, 2), 'utf-8')
}

/** Merges a partial update (e.g. the worker pid, known only after spawning) into an existing lock. */
export async function updateLock(hadarsFolder: string, patch: Partial<LockInfo>): Promise<void> {
    const existing = readLock(hadarsFolder)
    if (!existing) return
    await writeLock(hadarsFolder, { ...existing, ...patch })
}

export function readLock(hadarsFolder: string): LockInfo | null {
    try {
        const raw = fs.readFileSync(lockPath(hadarsFolder), 'utf-8')
        return JSON.parse(raw) as LockInfo
    } catch {
        return null
    }
}

export async function removeLock(hadarsFolder: string): Promise<void> {
    await fsp.rm(lockPath(hadarsFolder), { force: true })
}

/**
 * Returns the live LockInfo if a dev/run process currently owns hadarsFolder.
 * A lock whose pid (and worker pid, if any) is no longer running is stale —
 * it's removed automatically and null is returned.
 */
export async function checkLiveLock(hadarsFolder: string): Promise<LockInfo | null> {
    const lock = readLock(hadarsFolder)
    if (!lock) return null

    const alive = isPidAlive(lock.pid) || (lock.childPid !== undefined && isPidAlive(lock.childPid))
    if (!alive) {
        await removeLock(hadarsFolder)
        return null
    }
    return lock
}
