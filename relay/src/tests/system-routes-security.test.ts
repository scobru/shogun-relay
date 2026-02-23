
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import systemRouter from "../routes/system";
import http from "http";

// Mock dependencies
vi.mock("../utils/logger", () => ({
  loggers: {
    server: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

vi.mock("../config", () => ({
  packageConfig: { version: "1.0.0" },
  authConfig: { adminPassword: "test-password" },
}));

vi.mock("../config/env-config", () => ({
  config: {
    relay: { name: "Test Relay" },
  },
  driveConfig: {
      dataDir: "/tmp/test-data",
  }
}));

vi.mock("../utils/gun-paths", () => ({
  GUN_PATHS: {
    SHOGUN: "shogun",
    LOGS: "logs",
  },
  getGunNode: vi.fn(() => ({
    once: vi.fn(),
    put: vi.fn(),
    get: vi.fn(() => ({ put: vi.fn() })),
  })),
}));

// Mock admin-auth middleware
vi.mock("../middleware/admin-auth", () => ({
  adminAuthMiddleware: (req, res, next) => {
    const auth = req.headers.authorization;
    if (auth === "Bearer test-password") {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  },
}));

describe("System Routes Security", () => {
  let app;
  let server;
  let baseUrl;

  beforeEach(async () => {
    app = express();
    app.use(express.json());

    // Mock app.get for gunInstance
    app.use((req, res, next) => {
      req.app.set("gunInstance", {});
      req.app.set("relayUserPub", "test-pub-key");
      next();
    });

    app.use("/system", systemRouter);

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        baseUrl = `http://localhost:${addr.port}`;
        resolve(null);
      });
    });
  });

  afterEach(() => {
    server.close();
  });

  it("should allow public access to health check", async () => {
    const res = await fetch(`${baseUrl}/system/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it("should NOT allow unauthenticated access to /rpc/execute", async () => {
    const res = await fetch(`${baseUrl}/system/rpc/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: "https://example.com",
        request: { method: "test", jsonrpc: "2.0" },
      }),
    });

    // IF THIS FAILS (returns 200 or 500), IT CONFIRMS THE VULNERABILITY
    // We expect 401 Unauthorized
    expect(res.status).toBe(401);
  });

  it("should allow authenticated access to /rpc/execute", async () => {
    // We need to mock fetch global for the router handler itself
    // But since we are running in the same process, we can mock it on global
    const originalFetch = global.fetch;
    global.fetch = vi.fn(() => Promise.resolve({
        json: () => Promise.resolve({ result: "success" }),
        status: 200
    }));

    try {
        const res = await fetch(`${baseUrl}/system/rpc/execute`, {
          method: "POST",
          headers: {
              "Content-Type": "application/json",
              "Authorization": "Bearer test-password"
          },
          body: JSON.stringify({
            endpoint: "https://example.com",
            request: { method: "test", jsonrpc: "2.0" },
          }),
        });

        // If middleware is applied, this should proceed to the handler
        expect(res.status).not.toBe(401);
    } finally {
        global.fetch = originalFetch;
    }
  });

  it("should NOT allow unauthenticated access to /alldata", async () => {
    const res = await fetch(`${baseUrl}/system/alldata`);
    expect(res.status).toBe(401);
  });

  it("should NOT allow unauthenticated access to /logs", async () => {
    const res = await fetch(`${baseUrl}/system/logs`);
    expect(res.status).toBe(401);
  });

  it("should NOT allow unauthenticated access to /node/*", async () => {
     const res = await fetch(`${baseUrl}/system/node/some/path`);
     expect(res.status).toBe(401);
  });

  it("should NOT allow unauthenticated access to /stats/update", async () => {
    const res = await fetch(`${baseUrl}/system/stats/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "test", value: 123 })
    });
    expect(res.status).toBe(401);
  });

  it("should NOT allow unauthenticated access to /peers/add", async () => {
    const res = await fetch(`${baseUrl}/system/peers/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peer: "http://example.com/gun" })
    });
    expect(res.status).toBe(401);
  });

  it("should NOT allow unauthenticated access to /stats", async () => {
    const res = await fetch(`${baseUrl}/system/stats`);
    expect(res.status).toBe(401);
  });

  it("should NOT allow unauthenticated access to /services/test/logs", async () => {
    const res = await fetch(`${baseUrl}/system/services/test/logs`);
    expect(res.status).toBe(401);
  });
});
