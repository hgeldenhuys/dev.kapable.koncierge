#!/usr/bin/env bun
/**
 * Smoke test for Koncierge integration.
 *
 * Verifies:
 * 1. UI component exports are resolvable (KonciergePanel, KonciergeWithTools, etc.)
 * 2. BFF exports are resolvable (handleKonciergeProxy, createKonciergeRoute, etc.)
 * 3. Koncierge server /health endpoint responds (if running)
 * 4. BFF message endpoint responds with 2xx or 401 (not 404/500)
 *
 * Exit 0 = all checks pass. Exit 1 = something is broken.
 */

const KONCIERGE_PORT = Number(process.env.KONCIERGE_PORT) || 3101;
const KONCIERGE_BASE = `http://localhost:${KONCIERGE_PORT}`;

let failures = 0;

function pass(label: string) {
  console.log(`  ✓ ${label}`);
}

function fail(label: string, detail?: string) {
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  failures++;
}

// ─── 1. UI exports ──────────────────────────────────────────────────────────

console.log("\n[1/4] Checking UI component exports…");

try {
  const ui = await import("../src/ui/index");
  const requiredExports = [
    "KonciergePanel",
    "KonciergeRuntimeProvider",
    "KonciergeWithTools",
    "createKonciergeAdapter",
    "useKonciergeTools",
    "useReactRouterRoute",
    "parseToolCalls",
    "parseSSE",
  ];

  for (const name of requiredExports) {
    if (name in ui) {
      pass(`export "${name}" resolvable`);
    } else {
      fail(`export "${name}" missing from @kapable/koncierge/ui`);
    }
  }
} catch (err) {
  fail("UI module import", err instanceof Error ? err.message : String(err));
}

// ─── 2. BFF exports ─────────────────────────────────────────────────────────

console.log("\n[2/4] Checking BFF exports…");

try {
  const bff = await import("../src/bff/index");
  const requiredExports = [
    "handleKonciergeProxy",
    "configFromEnv",
    "createKonciergeHandler",
    "createKonciergeRoute",
    "generateSessionToken",
    "extractKonciergeToken",
    "createConsoleRequireAuth",
  ];

  for (const name of requiredExports) {
    if (name in bff) {
      pass(`export "${name}" resolvable`);
    } else {
      fail(`export "${name}" missing from @kapable/koncierge/bff`);
    }
  }
} catch (err) {
  fail("BFF module import", err instanceof Error ? err.message : String(err));
}

// ─── 3. Health endpoint ─────────────────────────────────────────────────────

console.log("\n[3/4] Checking Koncierge server health…");

try {
  const res = await fetch(`${KONCIERGE_BASE}/health`, {
    signal: AbortSignal.timeout(3000),
  });
  if (res.ok) {
    const body = await res.json();
    pass(`/health responded ${res.status} — version ${body.version ?? "unknown"}`);
  } else {
    fail(`/health responded ${res.status}`);
  }
} catch (err) {
  // Server not running is acceptable — skip rather than fail
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
    console.log("  ⊘ Koncierge server not running (skipped)");
  } else {
    fail("/health request", msg);
  }
}

// ─── 4. Message endpoint ────────────────────────────────────────────────────

console.log("\n[4/4] Checking message endpoint…");

try {
  const res = await fetch(`${KONCIERGE_BASE}/v1/koncierge/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "smoke test" }),
    signal: AbortSignal.timeout(5000),
  });

  // 2xx or 401 means the route is mounted and responding correctly
  // 404 or 500 means integration is broken
  if (res.ok || res.status === 401) {
    pass(`/v1/koncierge/message responded ${res.status}`);
  } else if (res.status === 404) {
    fail(`/v1/koncierge/message returned 404 — route not mounted`);
  } else if (res.status >= 500) {
    fail(`/v1/koncierge/message returned ${res.status} — server error`);
  } else {
    // 400 is also acceptable (bad request but route exists)
    pass(`/v1/koncierge/message responded ${res.status}`);
  }
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("ECONNREFUSED") || msg.includes("fetch failed")) {
    console.log("  ⊘ Koncierge server not running (skipped)");
  } else {
    fail("/v1/koncierge/message request", msg);
  }
}

// ─── Result ─────────────────────────────────────────────────────────────────

console.log("");
if (failures > 0) {
  console.error(`FAIL: ${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log("PASS: All smoke checks passed");
  process.exit(0);
}
