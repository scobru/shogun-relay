import { Router, Request, Response, NextFunction } from "express";
import http from "http";
import { loggers } from "../../utils/logger";
import { authConfig } from "../../config";
import { IPFS_API_TOKEN } from "./utils";
import type { IpfsRequestOptions } from "./types";

const router: Router = Router();

/**
 * Admin or API Key authentication middleware helper
 */
async function adminOrApiKeyAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const { adminOrApiKeyAuthMiddleware: authMiddleware } =
    await import("../../middleware/admin-or-api-key-auth");
  authMiddleware(req, res, next);
}

/**
 * IPFS Status endpoint
 */
router.get("/status", async (req: Request, res: Response) => {
  try {
    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/version",
      method: "POST",
      headers: { "Content-Length": "0" },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        try {
          const versionData = JSON.parse(data);
          res.json({
            success: true,
            status: "connected",
            version: versionData.Version,
            commit: versionData.Commit,
            go: versionData.Golang,
          });
        } catch (parseError) {
          res.json({ success: false, status: "error", error: "Failed to parse IPFS response" });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      res.json({
        success: false,
        status: "disconnected",
        error: err.message,
        message: "IPFS daemon may still be starting up",
      });
    });

    ipfsReq.setTimeout(5000);
    ipfsReq.on("timeout", () => {
      ipfsReq.destroy();
      res.json({
        success: false,
        status: "timeout",
        error: "Connection timeout - IPFS daemon may still be starting",
      });
    });

    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, status: "error", error: errorMessage });
  }
});

/**
 * IPFS Repo GC endpoint
 */
router.post("/repo/gc", adminOrApiKeyAuthMiddleware, async (req, res) => {
  try {
    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/repo/gc",
      method: "POST",
      headers: { "Content-Length": "0" },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        try {
          const lines = data.trim().split("\n");
          const results = lines.map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return line;
            }
          });

          res.json({ success: true, message: "Garbage collection completed", results });
        } catch (parseError) {
          res
            .status(500)
            .json({ success: false, error: "Failed to parse IPFS response", rawResponse: data });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err }, "❌ IPFS Repo GC error");
      res.status(500).json({ success: false, error: err.message });
    });

    ipfsReq.setTimeout(60000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({ success: false, error: "Garbage collection timeout" });
      }
    });

    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ IPFS Repo GC error");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * IPFS API connectivity test endpoint
 */
router.get("/test", adminOrApiKeyAuthMiddleware, async (req, res) => {
  try {
    loggers.server.debug("🔍 Testing IPFS API connectivity...");

    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/version",
      method: "POST",
      headers: { "Content-Length": "0" },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    loggers.server.debug(
      { hostname: requestOptions.hostname, port: requestOptions.port, path: requestOptions.path },
      `📡 Testing IPFS API`
    );

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      loggers.server.debug({ statusCode: ipfsRes.statusCode }, `📡 IPFS API test response status`);

      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        loggers.server.debug({ data }, `📡 IPFS API test response`);

        try {
          const result = JSON.parse(data);
          res.json({
            success: true,
            message: "IPFS API is reachable",
            version: result.Version,
            apiVersion: result["Api-Version"],
            statusCode: ipfsRes.statusCode,
          });
        } catch (parseError) {
          res.json({
            success: false,
            error: "IPFS API responded but with invalid JSON",
            rawResponse: data,
            statusCode: ipfsRes.statusCode,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err }, "❌ IPFS API test error");
      res.status(500).json({
        success: false,
        error: "IPFS API is not reachable",
        details: err.message,
      });
    });

    ipfsReq.setTimeout(10000, () => {
      ipfsReq.destroy();
      loggers.server.error("❌ IPFS API test timeout");
      if (!res.headersSent) {
        res.status(408).json({ success: false, error: "IPFS API connection timeout" });
      }
    });

    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ IPFS API test unexpected error");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * IPFS object/block stat endpoint - get info about a CID
 */
router.get("/stat/:cid", async (req: Request, res: Response) => {
  const { cid } = req.params;

  if (!cid) {
    return res.status(400).json({ success: false, error: "CID is required" });
  }

  try {
    const objectStatOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/object/stat?arg=${cid}`,
      method: "POST",
      headers: { "Content-Length": "0" },
    };

    if (IPFS_API_TOKEN) {
      objectStatOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const stat: any = await new Promise((resolve, reject) => {
      const statReq = http.request(objectStatOptions, (statRes) => {
        let data = "";
        statRes.on("data", (chunk) => (data += chunk));
        statRes.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Failed to parse stat response"));
          }
        });
      });

      statReq.on("error", reject);
      statReq.setTimeout(15000, () => {
        statReq.destroy();
        reject(new Error("Stat request timeout"));
      });
      statReq.end();
    });

    res.json({
      success: true,
      cid,
      stat: {
        Hash: stat.Hash,
        NumLinks: stat.NumLinks,
        BlockSize: stat.BlockSize,
        LinksSize: stat.LinksSize,
        DataSize: stat.DataSize,
        CumulativeSize: stat.CumulativeSize,
      },
    });
  } catch (error: unknown) {
    // Fallback to block/stat
    try {
      const blockStatOptions: IpfsRequestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: `/api/v0/block/stat?arg=${cid}`,
        method: "POST",
        headers: { "Content-Length": "0" },
      };

      if (IPFS_API_TOKEN) {
        blockStatOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const blockStat: any = await new Promise((resolve, reject) => {
        const blockReq = http.request(blockStatOptions, (blockRes) => {
          let data = "";
          blockRes.on("data", (chunk) => (data += chunk));
          blockRes.on("end", () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              reject(new Error("Failed to parse block stat response"));
            }
          });
        });

        blockReq.on("error", reject);
        blockReq.setTimeout(15000, () => {
          blockReq.destroy();
          reject(new Error("Block stat timeout"));
        });
        blockReq.end();
      });

      res.json({
        success: true,
        cid,
        stat: {
          Hash: blockStat.Key,
          CumulativeSize: blockStat.Size,
          BlockSize: blockStat.Size,
        },
      });
    } catch (blockError) {
      res.status(404).json({ success: false, error: "CID not found or not accessible", cid });
    }
  }
});

/**
 * IPFS Repo Stats endpoint
 */
router.get("/repo/stat", adminOrApiKeyAuthMiddleware, async (req, res) => {
  try {
    loggers.server.debug("📊 Getting IPFS repository statistics...");

    // Get all pins first
    const pinsPromise = new Promise((resolve, reject) => {
      const pinsRequestOptions: IpfsRequestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/pin/ls",
        method: "POST",
        headers: { "Content-Length": "0" },
      };

      if (IPFS_API_TOKEN) {
        pinsRequestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const pinsReq = http.request(pinsRequestOptions, (pinsRes) => {
        let data = "";
        pinsRes.on("data", (chunk) => (data += chunk));
        pinsRes.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ Keys: {} });
          }
        });
      });

      pinsReq.on("error", () => resolve({ Keys: {} }));
      pinsReq.setTimeout(10000, () => {
        pinsReq.destroy();
        reject(new Error("Pins request timeout"));
      });

      pinsReq.end();
    });

    // Get storage info from repo/stat
    const storagePromise = new Promise((resolve, reject) => {
      const storageRequestOptions: IpfsRequestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/repo/stat?size-only=true&human=false",
        method: "POST",
        headers: { "Content-Length": "0" },
      };

      if (IPFS_API_TOKEN) {
        storageRequestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const storageReq = http.request(storageRequestOptions, (storageRes) => {
        let data = "";
        storageRes.on("data", (chunk) => (data += chunk));
        storageRes.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({});
          }
        });
      });

      storageReq.on("error", (err) => reject(err));
      storageReq.setTimeout(10000, () => {
        storageReq.destroy();
        reject(new Error("Storage request timeout"));
      });

      storageReq.end();
    });

    // Get version info
    const versionPromise = new Promise((resolve, reject) => {
      const versionRequestOptions: IpfsRequestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/version",
        method: "POST",
        headers: { "Content-Length": "0" },
      };

      if (IPFS_API_TOKEN) {
        versionRequestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const versionReq = http.request(versionRequestOptions, (versionRes) => {
        let data = "";
        versionRes.on("data", (chunk) => (data += chunk));
        versionRes.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({});
          }
        });
      });

      versionReq.on("error", () => resolve({}));
      versionReq.setTimeout(10000, () => {
        versionReq.destroy();
        reject(new Error("Version request timeout"));
      });

      versionReq.end();
    });

    const [pinsData, storageData, versionData] = await Promise.all([
      pinsPromise,
      storagePromise,
      versionPromise,
    ]);

    const pinsDataObj = pinsData as any;
    const storageDataObj = storageData as any;
    const versionDataObj = versionData as any;

    const pinnedCount = Object.keys(pinsDataObj.Keys || {}).length;

    // Get total size from storage
    let totalSize = storageDataObj.RepoSize || storageDataObj.Size || 0;
    if (typeof totalSize === "string") {
      totalSize = parseInt(totalSize, 10) || 0;
    }

    // Get storage max (if available)
    let storageMax = storageDataObj.StorageMax || storageDataObj.storageMax || 0;
    if (typeof storageMax === "string") {
      storageMax = parseInt(storageMax, 10) || 0;
    }

    res.json({
      success: true,
      stats: {
        pinnedCount,
        totalSizeBytes: totalSize,
        totalSizeMB: parseFloat((totalSize / (1024 * 1024)).toFixed(2)),
        totalSizeGB: parseFloat((totalSize / (1024 * 1024 * 1024)).toFixed(4)),
        storageMaxBytes: storageMax,
        storageMaxMB: storageMax > 0 ? parseFloat((storageMax / (1024 * 1024)).toFixed(2)) : 0,
        storageMaxGB:
          storageMax > 0 ? parseFloat((storageMax / (1024 * 1024 * 1024)).toFixed(4)) : 0,
        repoSizeMB: parseFloat((totalSize / (1024 * 1024)).toFixed(2)), // Alias for backward compatibility
        numObjects: storageDataObj.NumObjects || 0,
        repoPath: storageDataObj.RepoPath || "unknown",
        version: versionDataObj.Version || "unknown",
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ IPFS Repo stat error");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * IPFS Version endpoint
 */
router.get("/version", async (req: Request, res: Response) => {
  try {
    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/version",
      method: "POST",
      headers: { "Content-Length": "0" },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        try {
          const result = JSON.parse(data);
          res.json({ success: true, ...result });
        } catch (parseError) {
          res
            .status(500)
            .json({ success: false, error: "Failed to parse IPFS version", rawResponse: data });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err }, "❌ IPFS version error");
      res.status(500).json({ success: false, error: err.message });
    });

    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;
