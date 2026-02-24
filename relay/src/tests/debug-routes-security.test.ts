
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import debugRouter from "../routes/debug";
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

vi.mock("../config/env-config", () => ({
  authConfig: { adminPassword: "test-password" },
}));

// Mock Gun
const mockGun = {
  get: vi.fn().mockReturnThis(),
  put: vi.fn().mockImplementation((data, cb) => {
    if (cb) cb({ err: null });
    return mockGun;
  }),
  once: vi.fn().mockImplementation((cb) => {
    cb({ mbUsed: 50 });
    return mockGun;
  }),
};

describe("Debug Routes Security", () => {
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    app = express();
    app.use(express.json());

    // Mock app.get for gunInstance
    app.use((req, res, next) => {
      req.app.set("gunInstance", mockGun);
      next();
    });

    app.use("/debug", debugRouter);

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

  it("should prevent unauthenticated access to /user-mb-usage/:identifier/reset", async () => {
    const res = await fetch(`${baseUrl}/debug/user-mb-usage/test-user/reset`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("should allow authenticated access to /user-mb-usage/:identifier/reset", async () => {
    const res = await fetch(`${baseUrl}/debug/user-mb-usage/test-user/reset`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer test-password"
      }
    });
    expect(res.status).toBe(200);
  });

  it("should prevent unauthenticated access to /cleanup-aliases", async () => {
    const res = await fetch(`${baseUrl}/debug/cleanup-aliases`, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  it("should allow authenticated access to /cleanup-aliases", async () => {
    const res = await fetch(`${baseUrl}/debug/cleanup-aliases`, {
      method: "POST",
      headers: {
        "Authorization": "Bearer test-password"
      }
    });
    // It returns 200 with "Not implemented" message in current implementation
    expect(res.status).toBe(200);
  });

  it("should prevent unauthenticated access to /test-gun", async () => {
    const res = await fetch(`${baseUrl}/debug/test-gun`);
    expect(res.status).toBe(401);
  });

  it("should prevent unauthenticated access to /test-gun-save/:identifier/:hash", async () => {
    const res = await fetch(`${baseUrl}/debug/test-gun-save/user/hash`);
    expect(res.status).toBe(401);
  });
});
