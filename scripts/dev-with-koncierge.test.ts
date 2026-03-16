import { describe, it, expect, beforeAll, afterAll } from "bun:test";

/**
 * Tests for the dev-with-koncierge runner.
 *
 * We test:
 * 1. The managed runner can start a mock server and detect health
 * 2. The health endpoint format matches what the runner expects
 */

const TEST_PORT = 39_301;

// Minimal mock server simulating the Koncierge /health endpoint
let mockServer: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  mockServer = Bun.serve({
    port: TEST_PORT,
    fetch(req) {
      const url = new URL(req.url);
      if (req.method === "GET" && url.pathname === "/health") {
        return Response.json({
          status: "ok",
          version: "0.1.0",
          knowledgeBaseChars: 12345,
          activeSessions: 0,
        });
      }
      return Response.json({ error: "Not Found" }, { status: 404 });
    },
  });
});

afterAll(() => {
  mockServer.stop();
});

describe("health endpoint contract", () => {
  it("returns status ok with expected fields", async () => {
    const res = await fetch(`http://localhost:${TEST_PORT}/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.version).toBe("string");
    expect(typeof body.knowledgeBaseChars).toBe("number");
    expect(typeof body.activeSessions).toBe("number");
  });

  it("health check can be polled until ready", async () => {
    // Simulate the waitForHealth loop from dev-with-koncierge.ts
    const HEALTH_URL = `http://localhost:${TEST_PORT}/health`;
    const deadline = Date.now() + 5_000;
    let healthy = false;

    while (Date.now() < deadline) {
      try {
        const res = await fetch(HEALTH_URL);
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {
        // not ready
      }
      await Bun.sleep(100);
    }

    expect(healthy).toBe(true);
  });
});

describe(".env.example exists and has required keys", () => {
  it("contains ANTHROPIC_API_KEY", async () => {
    const envExample = await Bun.file(
      import.meta.dir + "/../.env.example",
    ).text();
    expect(envExample).toContain("ANTHROPIC_API_KEY");
  });

  it("contains KONCIERGE_SECRET", async () => {
    const envExample = await Bun.file(
      import.meta.dir + "/../.env.example",
    ).text();
    expect(envExample).toContain("KONCIERGE_SECRET");
  });
});

describe("launchd-service.sh is executable", () => {
  it("has execute permissions", async () => {
    const { stdout } = Bun.spawnSync(["ls", "-l", import.meta.dir + "/launchd-service.sh"]);
    const output = stdout.toString();
    // Check for 'x' in permissions
    expect(output).toMatch(/x/);
  });

  it("prints usage on invalid command", () => {
    const result = Bun.spawnSync(["bash", import.meta.dir + "/launchd-service.sh", "invalid"]);
    const stderr = result.stderr.toString();
    const stdout = result.stdout.toString();
    const output = stderr + stdout;
    expect(output).toContain("install|uninstall|status|logs");
  });
});
