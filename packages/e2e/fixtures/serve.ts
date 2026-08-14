import { spawn } from 'node:child_process';
import { ROOT, SERVER_MAIN, instanceEnv } from './instance.js';
import { prepareInstance } from './prepare.js';

/**
 * What Playwright's `webServer` runs: build the instance, then start the real
 * server on top of it.
 *
 * The two steps are one command because they are ordered — the cache has to be
 * on disk before `MediaCache.load()` reads it — and because Playwright starts
 * its web servers **before** `globalSetup`, which leaves no earlier hook to
 * prepare anything in.
 *
 * The server runs as a **child process**, `node dist/main.js`, rather than being
 * imported here. Importing it would fix the libuv thread pool from a process
 * that has already read a hundred files, which is precisely the startup order
 * `threadpool.ts` exists to protect.
 */
await prepareInstance();

const server = spawn(process.execPath, [SERVER_MAIN], {
  cwd: ROOT,
  env: instanceEnv(),
  stdio: 'inherit',
});

// Playwright signals this process when the run ends; the server is what has to
// hear it, or the port stays held until the terminal closes.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.kill(signal));
}

server.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
