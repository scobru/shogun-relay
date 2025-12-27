import { Router, Request, Response, NextFunction } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import type { ClientRequest, IncomingMessage as HttpIncomingMessage } from "http";
import { loggers } from "../../utils/logger";
import { authConfig } from "../../config";
import { IPFS_API_URL, IPFS_API_TOKEN } from "./utils";

const router: Router = Router();

/**
 * IPFS API Proxy - for API calls to the IPFS node
 * Example: /api/v0/add, /api/v0/cat, etc.
 * SECURED: This generic proxy requires the admin token for any access.
 */
router.use(
  "/proxy",
  async (req: Request, res: Response, next: NextFunction) => {
    // Middleware di autenticazione per il proxy (admin or API key)
    const { adminOrApiKeyAuthMiddleware } = await import("../../middleware/admin-or-api-key-auth");
    adminOrApiKeyAuthMiddleware(req, res, next);
  },
  createProxyMiddleware({
    target: IPFS_API_URL,
    changeOrigin: true,
    pathRewrite: {
      "^/proxy": "/api/v0",
    },
    onProxyReq: (proxyReq: ClientRequest, req: ExpressRequest, res: ExpressResponse) => {
      loggers.server.debug(
        {
          method: req.method,
          url: req.url,
          target: `${IPFS_API_URL}${req.url}`,
        },
        `🔧 IPFS API Request`
      );

      // Add authentication headers for IPFS API
      if (IPFS_API_TOKEN) {
        proxyReq.setHeader("Authorization", `Bearer ${IPFS_API_TOKEN}`);
      }

      // IPFS API requires POST method for most endpoints
      // Override GET requests to POST for IPFS API endpoints
      if (
        req.method === "GET" &&
        (req.url?.includes("/version") || req.url?.includes("/id") || req.url?.includes("/peers"))
      ) {
        proxyReq.method = "POST";
        proxyReq.setHeader("Content-Length", "0");
      }

      // Add query parameter to get JSON response
      if (req.url?.includes("/version")) {
        const originalPath = proxyReq.path || "";
        proxyReq.path = originalPath + (originalPath.includes("?") ? "&" : "?") + "format=json";
      }
    },
    onProxyRes: (proxyRes: HttpIncomingMessage, req: ExpressRequest, res: ExpressResponse) => {
      loggers.server.debug(
        { statusCode: proxyRes.statusCode, method: req.method, url: req.url },
        `📤 IPFS API Response`
      );

      // Handle non-JSON responses from IPFS
      if (
        proxyRes.headers["content-type"] &&
        !proxyRes.headers["content-type"].includes("application/json")
      ) {
        loggers.server.debug(
          { contentType: proxyRes.headers["content-type"] },
          `📝 IPFS Response Content-Type`
        );
      }
    },
    onError: (err: Error, req: ExpressRequest, res: ExpressResponse) => {
      loggers.server.error({ err }, "❌ IPFS API Proxy Error");
      res.status(500).json({
        success: false,
        error: "IPFS API unavailable",
        details: err.message,
      });
    },
  } as any)
);

export default router;
