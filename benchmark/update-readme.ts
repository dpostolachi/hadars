#!/usr/bin/env bun
/**
 * Reads a bench-results.json produced by run.ts --json-out and rewrites
 * the section between <!-- BENCHMARK_START --> and <!-- BENCHMARK_END --> in README.md.
 *
 * Usage:
 *   bun update-readme.ts --json=bench-results.json --readme=../README.md
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args       = process.argv.slice(2);
const jsonPath   = args.find(a => a.startsWith('--json='))?.split('=')[1]   ?? path.join(import.meta.dir, 'bench-results.json');
const readmePath = args.find(a => a.startsWith('--readme='))?.split('=')[1] ?? path.join(import.meta.dir, '..', 'README.md');

interface BenchResults {
    date:        string;
    duration:    number;
    connections: number;
    throughput: {
        hadars: { rps: number; latP50: number; latP99: number; mbps: number; peakRssMb: number; avgRssMb: number };
        nextjs: { rps: number; latP50: number; latP99: number; mbps: number; peakRssMb: number; avgRssMb: number };
    };
    build: { hadarsMs: number; nextjsMs: number };
    playwright: {
        hadars: { ttfb: number; fcp: number; domContentLoaded: number; load: number; peakRssMb: number };
        nextjs: { ttfb: number; fcp: number; domContentLoaded: number; load: number; peakRssMb: number };
    };
}

const r: BenchResults = JSON.parse(readFileSync(jsonPath, 'utf8'));

const fmtMs  = (n: number) => `${n.toFixed(0)} ms`;
const fmtMB  = (n: number) => `${n.toFixed(1)} MB`;
const fmtSec = (ms: number) => ms > 0 ? `${(ms / 1000).toFixed(1)} s` : 'n/a';
const fmtMBs = (n: number) => `${(n / 1_048_576).toFixed(2)} MB/s`;
const winner = (hVal: number, nVal: number, lowerIsBetter = false): [string, string] => {
    const hWins = lowerIsBetter ? hVal <= nVal : hVal >= nVal;
    return hWins ? ['**' + String(hVal) + '**', String(nVal)] : [String(hVal), '**' + String(nVal) + '**'];
};

const hR = r.throughput.hadars;
const nR = r.throughput.nextjs;

const [hRps, nRps]     = winner(hR.rps, nR.rps);
const [hLat50, nLat50] = winner(hR.latP50, nR.latP50, true);
const [hLat99, nLat99] = winner(hR.latP99, nR.latP99, true);
const [hMBs, nMBs]     = winner(Number((hR.mbps / 1_048_576).toFixed(2)), Number((nR.mbps / 1_048_576).toFixed(2)));
const [hPeakRss, nPeakRss] = winner(Number(hR.peakRssMb.toFixed(1)), Number(nR.peakRssMb.toFixed(1)), true);
const [hAvgRss,  nAvgRss]  = winner(Number(hR.avgRssMb.toFixed(1)),  Number(nR.avgRssMb.toFixed(1)),  true);

const hBuild = fmtSec(r.build.hadarsMs);
const nBuild = fmtSec(r.build.nextjsMs);

const hPw = r.playwright.hadars;
const nPw = r.playwright.nextjs;
const [hTtfb, nTtfb] = winner(hPw.ttfb, nPw.ttfb, true);
const [hFcp,  nFcp]  = winner(hPw.fcp,  nPw.fcp,  true);
const [hDcl,  nDcl]  = winner(hPw.domContentLoaded, nPw.domContentLoaded, true);
const [hLoad, nLoad] = winner(hPw.load, nPw.load, true);
const [hPwRss, nPwRss] = winner(Number(hPw.peakRssMb.toFixed(1)), Number(nPw.peakRssMb.toFixed(1)), true);

const fmtRaw = (v: string, unit: (n: number) => string) => {
    const raw = Number(v.replace(/\*/g, ''));
    const fmt = unit(raw);
    return v.startsWith('**') ? `**${fmt}**` : fmt;
};

const speedup = hR.rps / (nR.rps || 1);
const summary = speedup >= 1
    ? `hadars is **${speedup.toFixed(1)}x faster** in requests/sec`
    : `Next.js is **${(1 / speedup).toFixed(1)}x faster** in requests/sec`;

const section = `\
> Last run: ${r.date} · ${r.duration}s · ${r.connections} connections · Bun runtime
> ${summary}

**Throughput** (autocannon, ${r.duration}s)

| Metric | hadars | Next.js |
|---|---:|---:|
| Requests/sec | ${fmtRaw(hRps, String)} | ${fmtRaw(nRps, String)} |
| Latency median | ${fmtRaw(hLat50, fmtMs)} | ${fmtRaw(nLat50, fmtMs)} |
| Latency p99 | ${fmtRaw(hLat99, fmtMs)} | ${fmtRaw(nLat99, fmtMs)} |
| Throughput | ${fmtRaw(hMBs, String)} MB/s | ${fmtRaw(nMBs, String)} MB/s |
| Peak RSS | ${fmtRaw(hPeakRss, fmtMB)} | ${fmtRaw(nPeakRss, fmtMB)} |
| Avg RSS | ${fmtRaw(hAvgRss, fmtMB)} | ${fmtRaw(nAvgRss, fmtMB)} |
| Build time | ${hBuild} | ${nBuild} |

**Page load** (Playwright · Chromium headless · median)

| Metric | hadars | Next.js |
|---|---:|---:|
| TTFB | ${fmtRaw(hTtfb, fmtMs)} | ${fmtRaw(nTtfb, fmtMs)} |
| FCP | ${fmtRaw(hFcp, fmtMs)} | ${fmtRaw(nFcp, fmtMs)} |
| DOMContentLoaded | ${fmtRaw(hDcl, fmtMs)} | ${fmtRaw(nDcl, fmtMs)} |
| Load | ${fmtRaw(hLoad, fmtMs)} | ${fmtRaw(nLoad, fmtMs)} |
| Peak RSS | ${fmtRaw(hPwRss, fmtMB)} | ${fmtRaw(nPwRss, fmtMB)} |
`;

const START_MARKER = '<!-- BENCHMARK_START -->';
const END_MARKER   = '<!-- BENCHMARK_END -->';

const readme = readFileSync(readmePath, 'utf8');

const startIdx = readme.indexOf(START_MARKER);
const endIdx   = readme.indexOf(END_MARKER);

if (startIdx === -1 || endIdx === -1) {
    console.error('Markers not found in README.md — add <!-- BENCHMARK_START --> and <!-- BENCHMARK_END -->');
    process.exit(1);
}

const updated =
    readme.slice(0, startIdx + START_MARKER.length) +
    '\n' + section +
    readme.slice(endIdx);

writeFileSync(readmePath, updated, 'utf8');
console.log(`README.md updated (${readmePath})`);
