#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { runCli } from './cli-lib'

// When the #!/usr/bin/env node shebang forces Node.js as the interpreter,
// try to re-exec with Bun so the server runs under Bun's runtime
// (native Bun.serve, WebSocket support, etc.).
// Falls back to Node.js silently if bun is not in PATH.
if (typeof (globalThis as any).Bun === 'undefined' && typeof (globalThis as any).Deno === 'undefined') {
    const child = spawn('bun', [process.argv[1]!, ...process.argv.slice(2)], {
        stdio: 'inherit',
        env: process.env,
    });
    const sigs = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
    const fwd = (sig: NodeJS.Signals) => () => { try { child.kill(sig); } catch {} };
    for (const sig of sigs) process.on(sig, fwd(sig));
    child.on('error', (err: any) => {
        for (const sig of sigs) process.removeAllListeners(sig);
        if (err.code !== 'ENOENT') { console.error(err); process.exit(1); }
        // bun not found — fall through and run with Node.js
        runCli(process.argv).catch((e) => {
            console.error(e);
            try { process.exit(1); } catch (_) { throw e; }
        });
    });
    child.on('exit', (code: number | null) => process.exit(code ?? 0));
} else {
    runCli(process.argv).catch((err) => {
        console.error(err)
        try {
            process.exit(1)
        } catch (_) {
            throw err
        }
    })
}