import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import systemRouter from "../routes/system";
import fs from "fs";

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

// Mock admin-auth middleware to allow all requests
vi.mock("../middleware/admin-auth", () => ({
  adminAuthMiddleware: (req: any, res: any, next: any) => {
    next();
  },
}));

describe("System Routes Path Traversal", () => {
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

  it("should block path traversal via /services/:name/logs", async () => {
    // We are trying to reach something like /etc/passwd or a different log
    // `normalizedName` will be something like "../../etc/passwd"
    const maliciousServiceName = encodeURIComponent("../../etc/passwd");

    // We mock fs.existsSync and fs.readFileSync to check if we attempt to read the malicious path
    const existsSyncSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const readFileSyncSpy = vi.spyOn(fs, "readFileSync").mockReturnValue("test log content");

    try {
        const res = await fetch(`${baseUrl}/system/services/${maliciousServiceName}/logs`);
        expect(res.status).toBe(400); // the route should reject the input

        const body = await res.json() as any;
        console.log(body);

        // Check if the read path contains the traversal characters
        const readCalls = readFileSyncSpy.mock.calls;
        if (readCalls.length > 0) {
            const attemptedPath = readCalls[0][0] as string;
            console.log("Attempted to read file:", attemptedPath);
            // We want to ensure it DOES NOT resolve to outside the log directory,
            // or we should reject it completely (e.g. 400 Bad Request)
            expect(attemptedPath).not.toContain("../");
            expect(attemptedPath).not.toBe("/etc/passwd");
        }
    } finally {
        existsSyncSpy.mockRestore();
        readFileSyncSpy.mockRestore();
    }
  });

  it("should allow safe service names via /services/:name/logs", async () => {
    const safeServiceName = "ipfs";

    const existsSyncSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const readFileSyncSpy = vi.spyOn(fs, "readFileSync").mockReturnValue("test log content ipfs");

    const res = await fetch(`${baseUrl}/system/services/${safeServiceName}/logs`);
    expect(res.status).toBe(200);

    existsSyncSpy.mockRestore();
    readFileSyncSpy.mockRestore();
  });
});
