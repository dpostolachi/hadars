#!/usr/bin/env bun
/**
 * Benchmark runner: hadars vs Next.js (App Router)
 *
 * Usage:
 *   cd benchmark
 *   bun install
 *   bunx playwright install chromium   # first run only
 *   bun run run.ts [--skip-install] [--skip-build] [--duration=10] [--connections=1000] [--pw-iterations=50]
 */

import { spawnSync, spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import autocannon, { type Result } from 'autocannon';
import { chromium } from 'playwright';

// ── config ────────────────────────────────────────────────────────────────────

const DIR         = import.meta.dir;
const HADARS_DIR  = path.join(DIR, 'hadars');
const NEXTJS_DIR  = path.join(DIR, 'nextjs');
const HADARS_PORT = 3031;
const NEXTJS_PORT = 3032;
const HADARS_URL  = `http://localhost:${HADARS_PORT}/`;
const NEXTJS_URL  = `http://localhost:${NEXTJS_PORT}/`;

const args        = process.argv.slice(2);
const skipInstall = args.includes('--skip-install');
const skipBuild   = args.includes('--skip-build');
const DURATION      = Number(args.find(a => a.startsWith('--duration='))?.split('=')[1] ?? 30);
const CONNECTIONS   = Number(args.find(a => a.startsWith('--connections='))?.split('=')[1] ?? 100);
const PW_ITERATIONS = Number(args.find(a => a.startsWith('--pw-iterations='))?.split('=')[1] ?? 50);
const JSON_OUT      = args.find(a => a.startsWith('--json-out='))?.split('=')[1];

// ── helpers ───────────────────────────────────────────────────────────────────

// Suppress the spurious TimeoutNegativeWarning emitted by autocannon's retimer
// dependency when connection timers expire at the exact end of a benchmark run.
// The warning is cosmetic — results are unaffected.
process.on('warning', (w) => { if (w.name !== 'TimeoutNegativeWarning') console.warn(w); });

const c = {
    bold:  (s: string | number) => `\x1b[1m${s}\x1b[0m`,
    dim:   (s: string | number) => `\x1b[2m${s}\x1b[0m`,
    green: (s: string | number) => `\x1b[32;1m${s}\x1b[0m`,
    cyan:  (s: string | number) => `\x1b[36m${s}\x1b[0m`,
};

function log(msg: string) {
    console.log(`\n${c.cyan('▸')} ${msg}`);
}

function run(cmd: string, args: string[], cwd: string, label: string) {
    process.stdout.write(`  ${label}…`);
    const result = spawnSync(cmd, args, { cwd, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status !== 0) {
        console.error(`\n  FAILED: ${cmd} ${args.join(' ')}`);
        console.error(result.stderr?.toString());
        process.exit(1);
    }
    console.log(' done');
}

function startServer(cmd: string, args: string[], cwd: string): ChildProcess {
    return spawn(cmd, args, { cwd, shell: false, stdio: 'pipe' });
}

// ── memory sampler ────────────────────────────────────────────────────────────

/**
 * Walk the entire process tree rooted at `rootPid` and return the sum of
 * VmRSS (KB) across all processes in that tree.  This is necessary because
 * both Bun and Next.js spawn worker/render child processes — reading only the
 * direct child gives just the thin launcher (~10 MB) instead of the real total.
 */
function rssTreeKb(rootPid: number): number {
    const fs = require('node:fs') as typeof import('fs');
    // Build pid → { ppid, rss } map in one pass over /proc
    const procs = new Map<number, { ppid: number; rss: number }>();
    try {
        for (const entry of fs.readdirSync('/proc')) {
            const pid = Number(entry);
            if (!Number.isFinite(pid) || pid <= 0) continue;
            try {
                const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
                const ppidM = /PPid:\s+(\d+)/.exec(status);
                const rssM  = /VmRSS:\s+(\d+)/.exec(status);
                if (ppidM && rssM) {
                    procs.set(pid, { ppid: Number(ppidM[1]), rss: Number(rssM[1]) });
                }
            } catch { /* process already gone */ }
        }
    } catch { return 0; }

    // Build children map for O(n) DFS instead of O(n²) scan each level
    const children = new Map<number, number[]>();
    for (const [pid, { ppid }] of procs) {
        const list = children.get(ppid);
        if (list) list.push(pid);
        else children.set(ppid, [pid]);
    }

    // DFS from rootPid, summing RSS of every process in the tree
    let total = 0;
    const stack = [rootPid];
    while (stack.length > 0) {
        const cur = stack.pop()!;
        const info = procs.get(cur);
        if (info) total += info.rss;
        const kids = children.get(cur);
        if (kids) for (const k of kids) stack.push(k);
    }
    return total;
}

class MemorySampler {
    private samples: number[] = [];
    private timer: ReturnType<typeof setInterval> | null = null;

    start(pid: number, intervalMs = 200) {
        this.samples = [];
        this.timer = setInterval(() => {
            const rss = rssTreeKb(pid);
            if (rss > 0) this.samples.push(rss);
        }, intervalMs);
    }

    stop(): { peakMb: number; avgMb: number } {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        if (this.samples.length === 0) return { peakMb: 0, avgMb: 0 };
        const peak = Math.max(...this.samples);
        const avg  = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
        return { peakMb: peak / 1024, avgMb: avg / 1024 };
    }
}

async function waitForPort(port: number, label: string, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    process.stdout.write(`  Waiting for ${label} (port ${port})`);
    while (Date.now() < deadline) {
        try {
            const res = await fetch(`http://localhost:${port}/`);
            if (res.status < 500) { console.log(' ready'); return; }
        } catch {
            // not ready yet
        }
        process.stdout.write('.');
        await sleep(300);
    }
    throw new Error(`${label} did not become ready within ${timeoutMs / 1000}s`);
}

async function validateServer(url: string, label: string): Promise<void> {
    process.stdout.write(`  Validating ${label} response…`);
    let res: Response;
    try {
        res = await fetch(url);
    } catch (err) {
        throw new Error(`${label}: failed to connect — ${(err as Error).message}`);
    }
    if (res.status !== 200) {
        throw new Error(`${label}: expected HTTP 200, got ${res.status}`);
    }
    const body = await res.text();
    if (!body.includes('<html') && !body.includes('<!DOCTYPE')) {
        throw new Error(`${label}: response does not look like HTML (body length ${body.length})`);
    }
    if (body.length < 500) {
        throw new Error(`${label}: HTML response is suspiciously short (${body.length} bytes) — server may be returning an error page`);
    }
    console.log(` ok (${body.length} bytes)`);
}

function bench(url: string): Promise<Result> {
    return new Promise((resolve, reject) => {
        autocannon(
            { url, duration: DURATION, connections: CONNECTIONS, pipelining: 1 },
            (err, result) => { if (err) reject(err); else resolve(result); },
        );
    });
}

function warmup(url: string): Promise<Result> {
    return new Promise((resolve, reject) => {
        autocannon({ url, duration: 3, connections: 5 }, (err, r) => {
            if (err) reject(err); else resolve(r);
        });
    });
}

// ── table printer ─────────────────────────────────────────────────────────────

type Row = [label: string, hadars: string, next: string, hadarsBetter: boolean | null];

function printTable(rows: Row[]) {
    const COL = [21, 18, 18] as const;

    const line = (ch = '─') =>
        `  ├${'─'.repeat(COL[0] + 2)}┼${'─'.repeat(COL[1] + 2)}┼${'─'.repeat(COL[2] + 2)}┤`;
    const top  = `  ┌${'─'.repeat(COL[0] + 2)}┬${'─'.repeat(COL[1] + 2)}┬${'─'.repeat(COL[2] + 2)}┐`;
    const bot  = `  └${'─'.repeat(COL[0] + 2)}┴${'─'.repeat(COL[1] + 2)}┴${'─'.repeat(COL[2] + 2)}┘`;

    const cell = (s: string, width: number, colored = false) => {
        const padded = s.padStart(width);
        return colored ? c.green(padded) : padded;
    };

    console.log(top);
    console.log(
        `  │ ${'Metric'.padEnd(COL[0])} │ ${c.bold('hadars'.padStart(COL[1]))} │ ${'Next.js'.padStart(COL[2])} │`
    );
    console.log(line());

    for (const [label, hVal, nVal, hadarsBetter] of rows) {
        const hColored = hadarsBetter === true;
        const nColored = hadarsBetter === false;
        console.log(
            `  │ ${label.padEnd(COL[0])} │ ${cell(hVal, COL[1], hColored)} │ ${cell(nVal, COL[2], nColored)} │`
        );
    }

    console.log(bot);
}

// ── playwright benchmark ───────────────────────────────────────────────────────

interface PwMetrics {
    ttfb:             number; // responseStart - requestStart  (server response time)
    fcp:              number; // first-contentful-paint paint entry
    domContentLoaded: number; // domContentLoadedEventEnd - startTime
    load:             number; // loadEventEnd - startTime
}

function median(arr: number[]): number {
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
}

async function benchPlaywright(url: string, label: string, iterations: number): Promise<PwMetrics> {
    const browser = await chromium.launch({ headless: true });

    const ttfbs: number[]             = [];
    const fcps: number[]              = [];
    const domContentLoadeds: number[] = [];
    const loads: number[]             = [];

    process.stdout.write(`  ${label} (${iterations} loads)`);

    for (let i = 0; i < iterations; i++) {
        const context = await browser.newContext();
        const page    = await context.newPage();

        await page.goto(url, { waitUntil: 'load' });

        const m = await page.evaluate((): PwMetrics => {
            const nav  = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
            const paint = performance.getEntriesByType('paint');
            const fcp  = paint.find(p => p.name === 'first-contentful-paint')?.startTime ?? 0;
            return {
                ttfb:             nav.responseStart - nav.requestStart,
                fcp,
                domContentLoaded: nav.domContentLoadedEventEnd - nav.startTime,
                load:             nav.loadEventEnd - nav.startTime,
            };
        });

        ttfbs.push(m.ttfb);
        fcps.push(m.fcp);
        domContentLoadeds.push(m.domContentLoaded);
        loads.push(m.load);

        await context.close();

        if ((i + 1) % 10 === 0) process.stdout.write('.');
    }

    await browser.close();
    console.log(' done');

    return {
        ttfb:             median(ttfbs),
        fcp:              median(fcps),
        domContentLoaded: median(domContentLoadeds),
        load:             median(loads),
    };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log();
    console.log(c.bold('  ╔══════════════════════════════════════════════════════════╗'));
    console.log(c.bold('  ║         hadars vs Next.js (App Router) — SSR Benchmark  ║'));
    console.log(c.bold('  ╚══════════════════════════════════════════════════════════╝'));
    console.log(c.dim(`\n  Scenario  : 40-post listing page with comments, 5ms simulated DB query`));
    console.log(c.dim(`  Duration  : ${DURATION}s · Connections: ${CONNECTIONS} · PW iterations: ${PW_ITERATIONS}`));
    console.log(c.dim(`  hadars    : Bun runtime · port ${HADARS_PORT}`));
    console.log(c.dim(`  Next.js   : Bun runtime · port ${NEXTJS_PORT}`));

    // 1. Install
    if (!skipInstall) {
        log('Installing dependencies');
        run('bun', ['install'], HADARS_DIR, 'hadars app');
        run('bun', ['install'], NEXTJS_DIR, 'Next.js app');
    }

    // 2. Build
    let hadarsBuildMs = 0;
    let nextBuildMs   = 0;

    if (!skipBuild) {
        log('Building hadars app');
        const t0 = Date.now();
        run('bunx', ['hadars', 'build'], HADARS_DIR, 'hadars build');
        hadarsBuildMs = Date.now() - t0;

        log('Building Next.js app');
        const t1 = Date.now();
        run('bunx', ['next', 'build'], NEXTJS_DIR, 'next build');
        nextBuildMs = Date.now() - t1;
    }

    // Keep mutable refs so cleanup() always kills whatever is currently running.
    let hadarsProc: ChildProcess | undefined;
    let nextProc:   ChildProcess | undefined;

    const cleanup = () => {
        hadarsProc?.kill('SIGTERM');
        nextProc?.kill('SIGTERM');
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(0); });

    // Kill a server and wait until the OS has released its port.
    const stopServer = async (proc: ChildProcess, port: number) => {
        proc.kill('SIGTERM');
        const deadline = Date.now() + 15_000;
        while (Date.now() < deadline) {
            await sleep(250);
            try { await fetch(`http://localhost:${port}/`); }
            catch { return; } // connection refused — port is free
        }
    };

    const startHadars = async (): Promise<ChildProcess> => {
        const proc = startServer('bunx', ['hadars', 'run'], HADARS_DIR);
        proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`  [hadars] ${d}`));
        hadarsProc = proc;
        await waitForPort(HADARS_PORT, 'hadars');
        await validateServer(HADARS_URL, 'hadars');
        return proc;
    };

    const startNextjs = async (): Promise<ChildProcess> => {
        const proc = startServer('bunx', ['next', 'start', '-p', String(NEXTJS_PORT)], NEXTJS_DIR);
        proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`  [next]   ${d}`));
        nextProc = proc;
        await waitForPort(NEXTJS_PORT, 'Next.js');
        await validateServer(NEXTJS_URL, 'Next.js');
        return proc;
    };

    // 4–6. Throughput benchmark — one server alive at a time, warmed up individually.
    const sampler = new MemorySampler();

    log('Starting hadars…');
    await startHadars();
    log('Warming up hadars (3s)…');
    await warmup(HADARS_URL);

    log(`Benchmarking hadars (${DURATION}s)…`);
    sampler.start(hadarsProc!.pid!);
    const hResult = await bench(HADARS_URL);
    const hMem = sampler.stop();
    await sleep(500); // let autocannon internals settle before killing the server
    await stopServer(hadarsProc!, HADARS_PORT);

    log('Starting Next.js…');
    await startNextjs();
    log('Warming up Next.js (3s)…');
    await warmup(NEXTJS_URL);

    log(`Benchmarking Next.js (${DURATION}s)…`);
    sampler.start(nextProc!.pid!);
    const nResult = await bench(NEXTJS_URL);
    const nMem = sampler.stop();
    await sleep(500);
    await stopServer(nextProc!, NEXTJS_PORT);

    // 7. Playwright — also isolated, with a brief warmup before each.
    log('Starting hadars for Playwright phase…');
    await startHadars();
    await warmup(HADARS_URL);

    log(`Playwright hadars (${PW_ITERATIONS} iterations)…`);
    sampler.start(hadarsProc!.pid!);
    const hPw = await benchPlaywright(HADARS_URL, 'hadars', PW_ITERATIONS);
    const hMemPw = sampler.stop();
    await stopServer(hadarsProc!, HADARS_PORT);

    log('Starting Next.js for Playwright phase…');
    await startNextjs();
    await warmup(NEXTJS_URL);

    log(`Playwright Next.js (${PW_ITERATIONS} iterations)…`);
    sampler.start(nextProc!.pid!);
    const nPw = await benchPlaywright(NEXTJS_URL, 'Next.js', PW_ITERATIONS);
    const nMemPw = sampler.stop();

    // 8. Teardown + print results
    cleanup();

    const hRps      = Math.round(hResult.requests.average);
    const nRps      = Math.round(nResult.requests.average);
    const hLatMed   = hResult.latency.p50;
    const nLatMed   = nResult.latency.p50;
    const hLatP99   = hResult.latency.p99;
    const nLatP99   = nResult.latency.p99;
    const hThroughput = hResult.throughput.average;
    const nThroughput = nResult.throughput.average;

    const fmt    = (n: number) => n.toLocaleString();
    const fmtMs  = (n: number) => `${n.toFixed(2)} ms`;
    const fmtMBs = (n: number) => `${(n / 1_048_576).toFixed(2)} MB/s`;
    const fmtSec = (ms: number) => ms > 0 ? `${(ms / 1000).toFixed(1)} s` : 'n/a';

    const fmtMB  = (n: number) => `${n.toFixed(1)} MB`;

    console.log('\n');
    console.log(c.bold('  Results'));

    const rows: Row[] = [
        ['Requests/sec',       fmt(hRps),              fmt(nRps),              hRps >= nRps],
        ['Latency median',     fmtMs(hLatMed),         fmtMs(nLatMed),         hLatMed <= nLatMed],
        ['Latency p99',        fmtMs(hLatP99),         fmtMs(nLatP99),         hLatP99 <= nLatP99],
        ['Throughput',         fmtMBs(hThroughput),    fmtMBs(nThroughput),    hThroughput >= nThroughput],
        ['Peak RSS',           fmtMB(hMem.peakMb),     fmtMB(nMem.peakMb),     hMem.peakMb <= nMem.peakMb],
        ['Avg RSS',            fmtMB(hMem.avgMb),      fmtMB(nMem.avgMb),      hMem.avgMb <= nMem.avgMb],
        ['Build time',         fmtSec(hadarsBuildMs),  fmtSec(nextBuildMs),    hadarsBuildMs > 0 && nextBuildMs > 0 ? hadarsBuildMs <= nextBuildMs : null],
    ];

    printTable(rows);

    // Playwright results
    console.log('\n');
    console.log(c.bold('  Page Load (Playwright · Chromium headless · median of ' + PW_ITERATIONS + ' runs)'));

    const pwRows: Row[] = [
        ['TTFB',               fmtMs(hPw.ttfb),             fmtMs(nPw.ttfb),             hPw.ttfb <= nPw.ttfb],
        ['FCP',                fmtMs(hPw.fcp),              fmtMs(nPw.fcp),              hPw.fcp <= nPw.fcp],
        ['DOMContentLoaded',   fmtMs(hPw.domContentLoaded), fmtMs(nPw.domContentLoaded), hPw.domContentLoaded <= nPw.domContentLoaded],
        ['Load',               fmtMs(hPw.load),             fmtMs(nPw.load),             hPw.load <= nPw.load],
        ['Peak RSS',           fmtMB(hMemPw.peakMb),        fmtMB(nMemPw.peakMb),        hMemPw.peakMb <= nMemPw.peakMb],
    ];

    printTable(pwRows);

    // Summary
    const speedup = hRps / nRps;
    const winner  = speedup >= 1
        ? `hadars is ${c.green(speedup.toFixed(2) + 'x')} faster (req/s)`
        : `Next.js is ${c.green((1 / speedup).toFixed(2) + 'x')} faster (req/s)`;
    console.log(`\n  ${c.dim('(green = winner)')}  ·  ${winner}\n`);

    // Optional JSON output for tooling (e.g. README auto-update).
    if (JSON_OUT) {
        const out = {
            date:       new Date().toISOString().slice(0, 10),
            duration:   DURATION,
            connections: CONNECTIONS,
            throughput: { hadars: { rps: hRps, latP50: hLatMed, latP99: hLatP99, mbps: hThroughput, peakRssMb: hMem.peakMb, avgRssMb: hMem.avgMb },
                          nextjs: { rps: nRps, latP50: nLatMed, latP99: nLatP99, mbps: nThroughput, peakRssMb: nMem.peakMb, avgRssMb: nMem.avgMb } },
            build:      { hadarsMs: hadarsBuildMs, nextjsMs: nextBuildMs },
            playwright: { hadars: { ...hPw, peakRssMb: hMemPw.peakMb }, nextjs: { ...nPw, peakRssMb: nMemPw.peakMb } },
        };
        await Bun.write(JSON_OUT, JSON.stringify(out, null, 2) + '\n');
        console.log(`  JSON results written to ${JSON_OUT}`);
    }

    process.exit(0);
}

main().catch(err => {
    console.error('\n  Error:', err.message ?? err);
    process.exit(1);
});
