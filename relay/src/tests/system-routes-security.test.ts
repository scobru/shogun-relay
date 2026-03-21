import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import systemRouter from "../routes/system";

import http from "http";
import dns from "dns/promises";
import ip from "ip";

// Mock dns/promises
vi.mock("dns/promises", () => ({
  default: {
    lookup: vi.fn(async (hostname) => {
      if (hostname === "localhost") return { address: "127.0.0.1", family: 4 };
      if (hostname === "example.internal") return { address: "10.0.0.1", family: 4 };
      if (hostname === "aws.metadata") return { address: "169.254.169.254", family: 4 };
      if (hostname === "example.com") return { address: "93.184.216.34", family: 4 };
      return { address: "8.8.8.8", family: 4 };
    }),
  },
}));

// Mock ip module
vi.mock("ip", () => ({
  default: {
    isPrivate: vi.fn((address) => {
      if (address === "127.0.0.1" || address === "10.0.0.1" || address === "169.254.169.254")
        return true;
      return false;
    }),
  },
}));

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
  },
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
  adminAuthMiddleware: (req: any, res: any, next: any) => {
    const auth = req.headers.authorization;
    if (auth === "Bearer test-password") {
      next();
    } else {
      res.status(401).json({ error: "Unauthorized" });
    }
  },
}));

describe("System Routes Security", () => {
  let app: express.Application;
  let server: any;
  let baseUrl: string;

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
        const addr = server.address() as any;
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
    const body = (await res.json()) as any;
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
    // @ts-ignore
    global.fetch = vi.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ result: "success" }),
        status: 200,
      })
    ) as any;

    try {
      const res = await fetch(`${baseUrl}/system/rpc/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-password",
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

  it("should block SSRF attempts to localhost via /rpc/execute", async () => {
    const res = await fetch(`${baseUrl}/system/rpc/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-password",
      },
      body: JSON.stringify({
        endpoint: "http://localhost:8080/admin",
        request: { method: "test", jsonrpc: "2.0" },
      }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain("Access to private or internal network resources is forbidden");
  });

  it("should block SSRF attempts to internal IPs via /rpc/execute", async () => {
    const res = await fetch(`${baseUrl}/system/rpc/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-password",
      },
      body: JSON.stringify({
        endpoint: "http://example.internal/api",
        request: { method: "test", jsonrpc: "2.0" },
      }),
    });

    expect(res.status).toBe(403);
  });

  it("should block SSRF attempts to AWS metadata service via /rpc/execute", async () => {
    const res = await fetch(`${baseUrl}/system/rpc/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-password",
      },
      body: JSON.stringify({
        endpoint: "http://aws.metadata/latest/meta-data/",
        request: { method: "test", jsonrpc: "2.0" },
      }),
    });

    expect(res.status).toBe(403);
  });

  it("should block non HTTP/HTTPS protocols in /rpc/execute", async () => {
    const res = await fetch(`${baseUrl}/system/rpc/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-password",
      },
      body: JSON.stringify({
        endpoint: "file:///etc/passwd",
        request: { method: "test", jsonrpc: "2.0" },
      }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toContain("Invalid protocol");
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

  it("should NOT allow unauthenticated POST access to /node/*", async () => {
    const res = await fetch(`${baseUrl}/system/node/some/path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "some data" }),
    });
    expect(res.status).toBe(401);
  });

  it("should NOT allow unauthenticated DELETE access to /node/*", async () => {
    const res = await fetch(`${baseUrl}/system/node/some/path`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });

  it("should NOT allow unauthenticated access to /stats/update", async () => {
    const res = await fetch(`${baseUrl}/system/stats/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "test", value: 123 }),
    });
    expect(res.status).toBe(401);
  });

  it("should NOT allow unauthenticated access to /peers/add", async () => {
    const res = await fetch(`${baseUrl}/system/peers/add`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peer: "http://example.com/gun" }),
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
