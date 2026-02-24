import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";
import uploadsRouter from "../routes/uploads";
import { GUN_PATHS } from "../utils/gun-paths";

// Mock dependencies
vi.mock("../utils/logger", () => ({
  loggers: {
    uploads: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

vi.mock("../config", () => ({
  authConfig: { adminPassword: "test-admin-password" },
}));

vi.mock("../utils/gun-paths", () => ({
  GUN_PATHS: {
    UPLOADS: "uploads",
    SYSTEM_HASH: "system-hashes",
  },
}));

// Mock http.request
const mockHttpRequest = vi.spyOn(http, "request").mockImplementation((options: any, callback?: any) => {
  const req: any = {
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };
  // Simulate immediate response to prevent hanging
  if (callback) {
      const res: any = {
          on: vi.fn((event, cb) => {
              if (event === 'end') cb();
          }),
          statusCode: 200
      };
      callback(res);
  }
  return req as any;
});

describe("Uploads Route Security", () => {
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;
  let mockGun: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());

    // Mock Gun instance
    mockGun = {
      get: vi.fn().mockReturnThis(),
      once: vi.fn((cb) => {
          // Default behavior: return file data immediately
          if (cb) cb({ size: 1024, name: "test.txt" });
          return mockGun;
      }),
      put: vi.fn((data, cb) => {
        if (cb) cb({ err: null });
        return mockGun;
      }),
    };

    app.use((req, res, next) => {
      req.app.set("gunInstance", mockGun);
      next();
    });

    app.use("/user-uploads", uploadsRouter);

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

  it("should NOT attempt SSRF via http.request but delete hash directly", async () => {
    // We need to simulate the gun node structure specifically for the delete operation
    // The route does: gun.get(UPLOADS).get(identifier).get(hash).once(...)

    // Setup specific mock return for the file lookup
    const fileNode = {
        once: vi.fn((cb) => {
            cb({ size: 1024, name: "test.txt", hash: "testhash" });
        }),
        put: vi.fn((data, cb) => {
            cb({ err: null });
        })
    };

    const userNode = {
        get: vi.fn().mockReturnValue(fileNode)
    };

    // Mock system hash node
    const systemHashNode = {
        get: vi.fn().mockReturnThis(),
        put: vi.fn((data, cb) => {
             if (cb) cb({ err: null });
             return systemHashNode;
        })
    };

    mockGun.get.mockImplementation((path: any) => {
        if (path === GUN_PATHS.UPLOADS) return { get: vi.fn().mockReturnValue(userNode) };
        if (path === GUN_PATHS.SYSTEM_HASH) return systemHashNode;
        return mockGun;
    });

    await fetch(`${baseUrl}/user-uploads/testuser/testhash`, {
        method: "DELETE"
    });

    // Verify http.request was NOT called (SSRF fix)
    expect(mockHttpRequest).not.toHaveBeenCalled();

    // Verify system hash deletion called directly
    expect(systemHashNode.get).toHaveBeenCalledWith("testhash");
    expect(systemHashNode.put).toHaveBeenCalledWith(null, expect.any(Function));
  });
});
