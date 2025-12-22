import { Router, Request, Response } from "express";
import http from "http";
import { loggers } from "../../utils/logger";
import type { CustomRequest, IpfsRequestOptions } from "./types";
import { IPFS_API_TOKEN, getContentTypeFromExtension, detectContentType } from "./utils";

const router: Router = Router();

/**
 * Compatibility endpoint for shogun-ipfs: /api/v0/cat
 * This endpoint doesn't need JSON body parsing - it only uses query params
 */
router.post(
  "/api/v0/cat",
  (req, res, next) => {
    req.body = undefined;
    next();
  },
  async (req: CustomRequest, res: Response) => {
    try {
      const { arg } = req.query;
      const cid = Array.isArray(arg) ? arg[0] : arg;

      if (!cid || typeof cid !== "string") {
        return res.status(400).json({
          success: false,
          error: "CID parameter (arg) is required",
        });
      }

      loggers.server.debug({ cid }, `📄 IPFS API v0 cat (compatibility endpoint) request`);

      let ipfsPath: string;
      if (cid.includes("/")) {
        const [directoryCid, ...pathParts] = cid.split("/");
        const encodedPath = pathParts.map((p) => encodeURIComponent(p)).join("/");
        ipfsPath = `/api/v0/cat?arg=${encodeURIComponent(directoryCid)}/${encodedPath}`;
      } else {
        ipfsPath = `/api/v0/cat?arg=${encodeURIComponent(cid)}`;
      }

      const requestOptions: IpfsRequestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: ipfsPath,
        method: "POST",
        headers: { "Content-Length": "0" },
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        if (ipfsRes.statusCode && ipfsRes.statusCode >= 400) {
          let errorData = "";
          ipfsRes.on("data", (chunk) => {
            errorData += chunk.toString();
          });
          ipfsRes.on("end", () => {
            if (!res.headersSent) {
              loggers.server.error(
                { cid, statusCode: ipfsRes.statusCode, errorData },
                `❌ IPFS API v0 cat returned error`
              );
              res.status(ipfsRes.statusCode || 500).json({
                success: false,
                error: errorData || `IPFS error: ${ipfsRes.statusCode}`,
              });
            }
          });
          return;
        }

        let contentType = ipfsRes.headers["content-type"];
        if (
          !contentType ||
          contentType === "application/octet-stream" ||
          contentType === "text/plain"
        ) {
          const pathParts = cid.split("/");
          const filename = pathParts.length > 1 ? pathParts[pathParts.length - 1] : "";
          contentType = getContentTypeFromExtension(filename);
          loggers.server.debug({ filename, contentType }, `📝 Deduced Content-Type from filename`);
        }

        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=31536000");
        ipfsRes.pipe(res);

        ipfsRes.on("error", (err) => {
          loggers.server.error({ err, cid }, `❌ IPFS API v0 cat error`);
          if (!res.headersSent) {
            res.status(500).json({ success: false, error: err.message });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        loggers.server.error({ err, cid }, `❌ IPFS API v0 cat request error`);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: err.message });
        }
      });

      ipfsReq.setTimeout(30000, () => {
        ipfsReq.destroy();
        if (!res.headersSent) {
          res.status(408).json({ success: false, error: "Content retrieval timeout" });
        }
      });

      ipfsReq.end();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error }, `❌ IPFS API v0 cat error`);
      res.status(500).json({ success: false, error: errorMessage });
    }
  }
);

/**
 * Endpoint per recuperare file da una directory IPFS
 * Format: /api/v1/ipfs/cat-directory/:directoryCid/:filePath(*)
 */
router.get(
  "/cat-directory/:directoryCid/:filePath(*)",
  async (req: CustomRequest, res: Response) => {
    try {
      const { directoryCid, filePath } = req.params;

      if (!directoryCid || !filePath) {
        return res.status(400).json({
          success: false,
          error: "Directory CID and file path are required",
        });
      }

      loggers.server.debug({ directoryCid, filePath }, `📄 IPFS Cat from directory request`);

      const requestOptions: IpfsRequestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: `/api/v0/cat?arg=${encodeURIComponent(directoryCid)}/${filePath}`,
        method: "POST",
        headers: { "Content-Length": "0" },
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Cache-Control", "public, max-age=31536000");
        ipfsRes.pipe(res);

        ipfsRes.on("error", (err) => {
          loggers.server.error({ err, directoryCid, filePath }, `❌ IPFS Cat from directory error`);
          if (!res.headersSent) {
            res.status(500).json({ success: false, error: err.message });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        loggers.server.error(
          { err, directoryCid, filePath },
          `❌ IPFS Cat from directory request error`
        );
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: err.message });
        }
      });

      ipfsReq.setTimeout(30000, () => {
        ipfsReq.destroy();
        if (!res.headersSent) {
          res.status(408).json({ success: false, error: "Content retrieval timeout" });
        }
      });

      ipfsReq.end();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error }, `❌ IPFS Cat from directory error`);
      res.status(500).json({ success: false, error: errorMessage });
    }
  }
);

/**
 * Custom IPFS API endpoints with better error handling
 */
router.post("/api/:endpoint(*)", async (req: CustomRequest, res: Response) => {
  try {
    const endpoint = req.params.endpoint;
    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/${endpoint}`,
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
        loggers.server.debug({ endpoint, data }, `📡 IPFS API raw response`);

        try {
          const jsonData = JSON.parse(data);
          res.json({ success: true, endpoint, data: jsonData });
        } catch (parseError) {
          if (data.trim()) {
            const cleanData = data.replace(/^\uFEFF/, "");
            try {
              const jsonData = JSON.parse(cleanData);
              res.json({ success: true, endpoint, data: jsonData });
            } catch (cleanParseError: unknown) {
              const errorMessage =
                cleanParseError instanceof Error
                  ? cleanParseError.message
                  : String(cleanParseError);
              res.json({
                success: false,
                endpoint,
                error: "Invalid JSON response",
                rawResponse: data,
                parseError: errorMessage,
              });
            }
          } else {
            res.json({ success: false, endpoint, error: "Empty response", rawResponse: data });
          }
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, endpoint }, `❌ IPFS API error`);
      res.status(500).json({ success: false, endpoint, error: err.message });
    });

    ipfsReq.setTimeout(10000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({ success: false, endpoint, error: "Request timeout" });
      }
    });

    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * IPFS Cat endpoint (aligned with Kubo's /api/v0/cat)
 */
router.get("/cat/:cid", async (req, res) => {
  try {
    const { cid } = req.params;
    loggers.server.debug({ cid }, `📄 IPFS Content request`);

    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${cid}`,
      method: "POST",
      headers: { "Content-Length": "0" },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${cid}"`);
      res.setHeader("Cache-Control", "public, max-age=31536000");
      ipfsRes.pipe(res);

      ipfsRes.on("error", (err) => {
        loggers.server.error({ err, cid }, `❌ IPFS Content error`);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: err.message });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, cid }, `❌ IPFS Content request error`);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    ipfsReq.setTimeout(30000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({ success: false, error: "Content retrieval timeout" });
      }
    });

    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error, cid: req.params.cid }, `❌ IPFS Content error`);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * Compatibility endpoint for shogun-ipfs: /content/:cid
 */
router.get("/content/:cid", async (req, res) => {
  const { cid } = req.params;
  loggers.server.debug({ cid }, `📄 IPFS Content (compatibility endpoint) request`);

  try {
    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${cid}`,
      method: "POST",
      headers: { "Content-Length": "0" },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${cid}"`);
      res.setHeader("Cache-Control", "public, max-age=31536000");
      ipfsRes.pipe(res);

      ipfsRes.on("error", (err) => {
        loggers.server.error({ err, cid }, `❌ IPFS Content error`);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: err.message });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, cid }, `❌ IPFS Content request error`);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    ipfsReq.setTimeout(30000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({ success: false, error: "Content retrieval timeout" });
      }
    });

    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error, cid: req.params.cid }, `❌ IPFS Content error`);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * Compatibility endpoint for shogun-ipfs: /ipfs/:cid (under /api/v1/ipfs/)
 */
router.get("/ipfs/:cid", async (req, res) => {
  const { cid } = req.params;
  loggers.server.debug({ cid }, `📄 IPFS Gateway (compatibility endpoint) request`);

  try {
    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${cid}`,
      method: "POST",
      headers: { "Content-Length": "0" },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let contentType = "application/octet-stream";
      const chunks: Buffer[] = [];

      ipfsRes.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        if (chunks.length === 1 && chunk.length > 0) {
          contentType = detectContentType(chunk);
        }
      });

      ipfsRes.on("end", () => {
        const buffer = Buffer.concat(chunks);
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", buffer.length.toString());
        res.setHeader("Cache-Control", "public, max-age=31536000");
        res.send(buffer);
      });

      ipfsRes.on("error", (err) => {
        loggers.server.error({ err, cid }, `❌ IPFS Gateway error`);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: err.message });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, cid }, `❌ IPFS Gateway request error`);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    ipfsReq.setTimeout(30000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({ success: false, error: "Content retrieval timeout" });
      }
    });

    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error, cid: req.params.cid }, `❌ IPFS Gateway error`);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * IPFS Cat JSON endpoint (content parsed as JSON)
 */
router.get("/cat/:cid/json", async (req: Request, res: Response) => {
  try {
    const { cid } = req.params;
    loggers.server.debug({ cid }, `📄 IPFS Content JSON request`);

    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${cid}`,
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
          const jsonData = JSON.parse(data);
          res.json({ success: true, cid, data: jsonData });
        } catch (parseError) {
          res.json({ success: true, cid, data, type: "text" });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, cid }, `❌ IPFS Content JSON error`);
      res.status(500).json({ success: false, error: err.message });
    });

    ipfsReq.setTimeout(30000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({ success: false, error: "Content retrieval timeout" });
      }
    });

    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error, cid: req.params.cid }, `❌ IPFS Content JSON error`);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;
