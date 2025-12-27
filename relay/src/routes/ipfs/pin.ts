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
  const { adminOrApiKeyAuthMiddleware: authMiddleware } = await import("../../middleware/admin-or-api-key-auth");
  authMiddleware(req, res, next);
}

/**
 * IPFS Pin add endpoint (aligned with Kubo's /api/v0/pin/add)
 */
router.post("/pin/add", adminOrApiKeyAuthMiddleware, async (req, res) => {
  try {
    loggers.server.debug({ body: req.body }, "🔍 IPFS Pin add request");
    const { cid } = req.body;

    if (!cid) {
      loggers.server.warn("❌ IPFS Pin add error: CID is required");
      return res.status(400).json({ success: false, error: "CID is required" });
    }

    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/pin/add?arg=${cid}`,
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
          res.json({ success: true, message: "CID pinned successfully", result });
        } catch (parseError) {
          res
            .status(500)
            .json({ success: false, error: "Failed to parse IPFS response", rawResponse: data });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err }, "❌ IPFS Pin add error");
      res.status(500).json({ success: false, error: err.message });
    });

    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ IPFS Pin add error");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * IPFS Pin remove endpoint (aligned with Kubo's /api/v0/pin/rm)
 */
router.post("/pin/rm", adminOrApiKeyAuthMiddleware, async (req, res) => {
  try {
    loggers.server.debug({ body: req.body }, "🔍 IPFS Pin rm request");
    const { cid } = req.body;
    loggers.server.debug({ cid }, `🔍 IPFS Pin rm request for CID`);

    if (!cid) {
      loggers.server.warn("❌ IPFS Pin rm error: CID is required");
      return res.status(400).json({ success: false, error: "CID is required" });
    }

    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/pin/rm?arg=${cid}`,
      method: "POST",
      headers: { "Content-Length": "0" },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      loggers.server.debug("🔐 IPFS API token found, adding authorization header");
    } else {
      loggers.server.warn("⚠️ No IPFS API token configured");
    }

    loggers.server.debug(
      { hostname: requestOptions.hostname, port: requestOptions.port, path: requestOptions.path },
      `📡 Making IPFS API request`
    );

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      loggers.server.debug(
        { statusCode: ipfsRes.statusCode, headers: ipfsRes.headers },
        `📡 IPFS API response`
      );

      let data = "";
      ipfsRes.on("data", (chunk) => {
        data += chunk;
        loggers.server.debug({ chunk: chunk.toString() }, `📡 IPFS API data chunk`);
      });

      ipfsRes.on("end", () => {
        loggers.server.debug({ data }, `📡 IPFS API complete response`);

        try {
          const result = JSON.parse(data);
          loggers.server.info({ cid, result }, `✅ IPFS Pin rm success`);
          res.json({ success: true, message: "CID unpinned successfully", result });
        } catch (parseError) {
          loggers.server.error(
            { err: parseError, cid, rawResponse: data },
            `❌ IPFS Pin rm parse error`
          );
          res.status(500).json({
            success: false,
            error: "Failed to parse IPFS response",
            rawResponse: data,
            parseError: parseError instanceof Error ? parseError.message : String(parseError),
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, cid }, `❌ IPFS Pin rm network error`);
      res
        .status(500)
        .json({
          success: false,
          error: err.message,
          details: "Network error connecting to IPFS API",
        });
    });

    ipfsReq.on("timeout", () => {
      loggers.server.error({ cid }, `❌ IPFS Pin rm timeout`);
      ipfsReq.destroy();
      res.status(408).json({ success: false, error: "IPFS API request timeout" });
    });

    ipfsReq.setTimeout(30000);
    loggers.server.debug({ cid }, `📡 Sending IPFS API request`);
    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error, cid: req.body?.cid }, `❌ IPFS Pin rm unexpected error`);
    res
      .status(500)
      .json({ success: false, error: errorMessage, details: "Unexpected error in pin removal" });
  }
});

/**
 * Alias endpoint for shogun-ipfs compatibility: /pins/rm -> /pin/rm
 */
router.post("/pins/rm", adminOrApiKeyAuthMiddleware, async (req, res) => {
  try {
    loggers.server.debug({ body: req.body }, "🔍 IPFS Pin rm (alias /pins/rm) request");
    const { cid } = req.body;

    if (!cid) {
      loggers.server.warn("❌ IPFS Pin rm (alias /pins/rm) error: CID is required");
      return res.status(400).json({ success: false, error: "CID is required" });
    }

    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/pin/rm?arg=${cid}`,
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
        if (ipfsRes.statusCode === 200) {
          try {
            const result = JSON.parse(data);
            loggers.server.info({ cid, result }, `✅ IPFS Pin rm (alias /pins/rm) success`);
            res.json({
              success: true,
              message: `Pin removed successfully for CID: ${cid}`,
              data: result,
            });
          } catch (parseError) {
            loggers.server.error(
              { err: parseError, cid },
              `❌ IPFS Pin rm (alias /pins/rm) parse error`
            );
            res.json({
              success: true,
              message: `Pin removed successfully for CID: ${cid}`,
              rawResponse: data,
            });
          }
        } else {
          const statusCode = ipfsRes.statusCode || 500;
          loggers.server.error({ cid, statusCode }, `❌ IPFS Pin rm (alias /pins/rm) failed`);
          res
            .status(statusCode)
            .json({
              success: false,
              error: `IPFS pin removal failed: ${statusCode}`,
              details: data,
            });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, cid }, `❌ IPFS Pin rm (alias /pins/rm) network error`);
      res.status(500).json({ success: false, error: "Network error", details: err.message });
    });

    ipfsReq.setTimeout(30000);
    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error(
      { err: error, cid: req.body?.cid },
      `❌ IPFS Pin rm (alias /pins/rm) unexpected error`
    );
    res
      .status(500)
      .json({ success: false, error: errorMessage, details: "Unexpected error in pin removal" });
  }
});

/**
 * IPFS Pin list endpoint (aligned with Kubo's /api/v0/pin/ls)
 */
router.get("/pin/ls", adminOrApiKeyAuthMiddleware, async (req, res) => {
  try {
    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/pin/ls",
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
          res.json({
            success: true,
            pins: result.Keys || {},
            count: Object.keys(result.Keys || {}).length,
          });
        } catch (parseError) {
          res
            .status(500)
            .json({ success: false, error: "Failed to parse IPFS response", rawResponse: data });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err }, "❌ IPFS Pin ls error");
      res.status(500).json({ success: false, error: err.message });
    });

    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ IPFS Pin ls error");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;
