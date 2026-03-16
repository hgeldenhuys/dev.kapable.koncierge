#!/usr/bin/env bun
/**
 * Dev runner: starts the Koncierge server alongside whatever else is running.
 *
 * Usage from the console project's package.json:
 *   "dev:koncierge": "bun run ../dev.kapable.koncierge/scripts/dev-with-koncierge.ts"
 *
 * Or standalone:
 *   bun run scripts/dev-with-koncierge.ts
 *
 * Features:
 * - Auto-restarts on crash (up to 5 times within 60s)
 * - Loads .env from the Koncierge project root
 * - Waits for /health to respond before printing "ready"
 * - Forwards SIGINT/SIGTERM for clean shutdown
 */

import { Subprocess } from "bun";
import { resolve, dirname } from "path";

const PROJECT_ROOT = resolve(dirname(import.meta.dir));
const SERVER_ENTRY = resolve(PROJECT_ROOT, "src/server.ts");
const PORT = Number(process.env.PORT) || 3101;
const HEALTH_URL = `http://localhost:${PORT}/health`;

const MAX_RESTARTS = 5;
const RESTART_WINDOW_MS = 60_000;

let child: Subprocess | null = null;
let restartTimestamps: number[] = [];
let shuttingDown = false;

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[koncierge-dev ${ts}] ${msg}`);
}

/** Load .env file from project root if it exists */
async function loadEnv(): Promise<void> {
  const envPath = resolve(PROJECT_ROOT, ".env");
  const file = Bun.file(envPath);
  if (!(await file.exists())) {
    log("No .env file found — using existing environment");
    return;
  }

  const text = await file.text();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Only set if not already defined (existing env takes precedence)
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
  log(".env loaded");
}

/** Wait for the health endpoint to respond */
async function waitForHealth(timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(HEALTH_URL);
      if (res.ok) return true;
    } catch {
      // Server not ready yet
    }
    await Bun.sleep(500);
  }
  return false;
}

/** Spawn the Koncierge server */
function spawnServer(): Subprocess {
  log(`Starting server: bun --watch run ${SERVER_ENTRY}`);
  const proc = Bun.spawn(["bun", "--watch", "run", SERVER_ENTRY], {
    cwd: PROJECT_ROOT,
    env: process.env as Record<string, string>,
    stdout: "inherit",
    stderr: "inherit",
    onExit(_proc, exitCode, _signal, _err) {
      if (shuttingDown) return;

      log(`Server exited with code ${exitCode}`);

      // Track restart frequency
      const now = Date.now();
      restartTimestamps.push(now);
      // Keep only timestamps within the restart window
      restartTimestamps = restartTimestamps.filter(
        (ts) => now - ts < RESTART_WINDOW_MS,
      );

      if (restartTimestamps.length > MAX_RESTARTS) {
        log(`Too many restarts (${MAX_RESTARTS} in ${RESTART_WINDOW_MS / 1000}s) — giving up`);
        process.exit(1);
      }

      log(`Restarting (${restartTimestamps.length}/${MAX_RESTARTS} in window)...`);
      child = spawnServer();
    },
  });

  return proc;
}

/** Clean shutdown */
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log("Shutting down...");
  if (child) {
    child.kill("SIGTERM");
  }
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ── Main ──
await loadEnv();
child = spawnServer();

const healthy = await waitForHealth();
if (healthy) {
  log(`Server ready at ${HEALTH_URL}`);
} else {
  log("Warning: health check timed out — server may still be starting");
}
