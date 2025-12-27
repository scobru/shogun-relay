import express, { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import multer from "multer";
import FormData from "form-data";
import { secureCompare, hashToken } from "../utils/security";
// http import removed

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurazione multer per upload file
const upload = multer({ storage: multer.memoryStorage() });

// Cache admin password hash (computed once)
let adminPasswordHash: string | null = null;
function getAdminPasswordHash(): string | null {
  if (!adminPasswordHash && authConfig.adminPassword) {
    adminPasswordHash = hashToken(authConfig.adminPassword);
  }
  return adminPasswordHash;
}

// Middleware di autenticazione admin (secure, timing-safe)
const tokenAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers["authorization"];
  const bearerToken = authHeader && authHeader.split(" ")[1];

  // Check custom token header (for Gun/Wormhole compatibility)
  const customToken = req.headers["token"] as string | undefined;

  // Accept either format
  const token = bearerToken || customToken;

  if (!token) {
    loggers.server.warn(
      { bearerToken: !!bearerToken, customToken: !!customToken },
      "Auth failed - no token"
    );
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  // Secure comparison using hash and timing-safe comparison
  const tokenHash = hashToken(token);
  const adminHash = getAdminPasswordHash();

  if (adminHash && secureCompare(tokenHash, adminHash)) {
    next();
  } else {
    loggers.server.warn(
      { bearerToken: !!bearerToken, customToken: !!customToken },
      "Auth failed - invalid token"
    );
    res.status(401).json({ success: false, error: "Unauthorized" });
  }
};

// Importa i moduli delle routes
import uploadsRouter from "./uploads";
import ipfsRouter from "./ipfs";
import systemRouter from "./system";
import debugRouter from "./debug";
import servicesRouter from "./services";
import visualGraphRouter from "./visualGraph";
import x402Router from "./x402";
import networkRouter from "./network";
import dealsRouter from "./deals";
import registryRouter from "./registry";
import bridgeRouter from "./bridge";
import torrentRouter from "./torrent";
import driveRouter from "./drive";
import { ipfsRequest } from "../utils/ipfs-client";
import { generateOpenAPISpec } from "../utils/openapi-generator";
import { loggers } from "../utils/logger";
import { authConfig, ipfsConfig, registryConfig, packageConfig, x402Config, bridgeConfig, dealsConfig, torrentConfig, holsterConfig } from "../config";

// Rate limiting generale
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 1000, // massimo 1000 richieste per IP
  message: {
    success: false as any, // Type assertion for compatibility
    message: "Troppe richieste. Riprova tra 15 minuti.",
    data: null,
  } as any, // Type assertion to match rate-limit types
});

export default (app: express.Application) => {
  // Configurazione generale delle route
  const baseRoute = "/api/v1";

  // OpenAPI Specification endpoint - Must be registered BEFORE other API routes
  app.get("/api/openapi.json", (req, res) => {
    try {
      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const spec = generateOpenAPISpec(baseUrl);
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Access-Control-Allow-Origin", "*"); // Allow CORS for API docs
      res.json(spec);
    } catch (error: any) {
      loggers.server.error({ err: error }, "Error generating OpenAPI spec");
      res.status(500).json({
        success: false,
        error: "Failed to generate OpenAPI specification",
        details: error.message,
      });
    }
  });

  // Applica rate limiting generale
  app.use(generalLimiter);

  // --- IPFS Desktop Proxy Configuration ---
  const IPFS_GATEWAY_URL = ipfsConfig.gatewayUrl;
  const IPFS_API_TOKEN = ipfsConfig.apiToken as string | undefined;
  const IPFS_API_URL = ipfsConfig.apiUrl as string;

  loggers.server.info(
    { IPFS_API_URL, IPFS_GATEWAY_URL, authConfigured: !!IPFS_API_TOKEN },
    `🌐 IPFS Proxy Configuration`
  );

  // IPFS Gateway handler with direct IPFS API fallback
  app.get("/ipfs/:cid", async (req: Request, res: Response, next: NextFunction) => {
    const { cid } = req.params;
    // Try to retrieve file directly from IPFS API
    try {
      loggers.server.debug({ cid }, `📁 Direct IPFS retrieval attempt`);

      // Try to get file from IPFS directly using HTTP API
      const fileBuffer = (await ipfsRequest(`/cat?arg=${encodeURIComponent(cid)}`, {
        responseType: "arraybuffer",
      })) as Buffer;

      if (fileBuffer && fileBuffer.length > 0) {
        // Try to detect content type from first bytes
        let contentType = "application/octet-stream";
        const firstBytes = fileBuffer.slice(0, 512);

        // Basic content type detection
        if (
          firstBytes[0] === 0x89 &&
          firstBytes[1] === 0x50 &&
          firstBytes[2] === 0x4e &&
          firstBytes[3] === 0x47
        ) {
          contentType = "image/png";
        } else if (firstBytes[0] === 0xff && firstBytes[1] === 0xd8) {
          contentType = "image/jpeg";
        } else if (firstBytes[0] === 0x47 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46) {
          contentType = "image/gif";
        } else if (
          firstBytes[0] === 0x25 &&
          firstBytes[1] === 0x50 &&
          firstBytes[2] === 0x44 &&
          firstBytes[3] === 0x46
        ) {
          contentType = "application/pdf";
        } else if (
          fileBuffer.slice(0, 5).toString() === "<html" ||
          fileBuffer.slice(0, 9).toString() === "<!DOCTYPE"
        ) {
          contentType = "text/html";
        } else {
          // Try to detect JSON
          try {
            JSON.parse(fileBuffer.toString());
            contentType = "application/json";
          } catch (e) {
            // Not JSON, keep default
          }
        }

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", fileBuffer.length);
        res.setHeader("Cache-Control", "public, max-age=31536000"); // 1 year
        res.setHeader("X-Content-Source", "ipfs-direct");

        loggers.server.info(
          { cid, size: fileBuffer.length, contentType },
          `✅ Served CID directly from IPFS API`
        );
        return res.send(fileBuffer);
      }
    } catch (error: any) {
      loggers.server.warn({ err: error, cid }, `⚠️ Direct IPFS retrieval failed`);
      // Fall through to proxy gateway
    }

    // If direct retrieval fails or IPFS not available, pass to proxy
    next();
  });

  // IPFS Gateway Proxy with fallback - for accessing files via IPFS hash
  app.use(
    "/ipfs",
    createProxyMiddleware({
      target: IPFS_GATEWAY_URL,
      changeOrigin: true,
      pathRewrite: {
        "^/ipfs": "/ipfs", // Changed to preserve /ipfs in the path
      },
      // @ts-ignore - http-proxy-middleware types
      onProxyReq: (proxyReq: any, req: any, res: any) => {
        loggers.server.debug(
          {
            method: req.method,
            url: req.url,
            target: `${IPFS_GATEWAY_URL}${proxyReq.path}`,
          },
          `📁 IPFS Gateway Request`
        );
      },
      // @ts-ignore - http-proxy-middleware types
      onProxyRes: async (proxyRes: any, req: any, res: any) => {
        loggers.server.debug(
          { statusCode: proxyRes.statusCode, url: req.url },
          `📁 IPFS Gateway Response`
        );

        // If local gateway fails with 404, show user-friendly error page with fallback links
        if (proxyRes.statusCode === 404) {
          const hash = req.url.split("/ipfs/")[1]?.split("?")[0]?.split("#")[0]; // Get CID, remove query/hash
          if (hash) {
            loggers.server.warn({ hash }, `⚠️ Local gateway 404, showing fallback page`);

            // Stop the proxy response and send our own HTML page
            const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IPFS Content Not Found - Shogun Relay</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 100%);
      color: #ffffff;
      margin: 0;
      padding: 0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      max-width: 600px;
      padding: 40px;
      text-align: center;
    }
    h1 {
      font-size: 32px;
      margin-bottom: 16px;
      color: #ff6b6b;
    }
    p {
      font-size: 18px;
      line-height: 1.6;
      color: #b0b0b0;
      margin-bottom: 32px;
    }
    .cid {
      font-family: 'Courier New', monospace;
      background: #3a3a3a;
      padding: 12px;
      border-radius: 8px;
      word-break: break-all;
      margin: 20px 0;
      color: #4fc3f7;
    }
    .fallback-links {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-top: 32px;
    }
    .fallback-link {
      display: block;
      padding: 16px 24px;
      background: #4a4a4a;
      border: 2px solid #5a5a5a;
      border-radius: 8px;
      color: #ffffff;
      text-decoration: none;
      transition: all 0.3s ease;
    }
    .fallback-link:hover {
      background: #5a5a5a;
      border-color: #6a6a6a;
      transform: translateY(-2px);
    }
    .fallback-link strong {
      display: block;
      margin-bottom: 4px;
      color: #4fc3f7;
    }
    .fallback-link span {
      font-size: 14px;
      color: #b0b0b0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📦 IPFS Content Not Found</h1>
    <p>The requested content is not available on this relay's local IPFS node.</p>
    <div class="cid">CID: ${hash}</div>
    <p>Try accessing it via a public IPFS gateway:</p>
    <div class="fallback-links">
      <a href="https://ipfs.io/ipfs/${hash}" target="_blank" class="fallback-link">
        <strong>🌐 IPFS.io Gateway</strong>
        <span>ipfs.io/ipfs/${hash}</span>
      </a>
      <a href="https://cloudflare-ipfs.com/ipfs/${hash}" target="_blank" class="fallback-link">
        <strong>☁️ Cloudflare Gateway</strong>
        <span>cloudflare-ipfs.com/ipfs/${hash}</span>
      </a>
      <a href="https://dweb.link/ipfs/${hash}" target="_blank" class="fallback-link">
        <strong>🔗 DWeb Link</strong>
        <span>dweb.link/ipfs/${hash}</span>
      </a>
    </div>
  </div>
</body>
</html>
            `;

            res.status(404);
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.setHeader("Content-Length", Buffer.byteLength(html));
            res.setHeader("X-IPFS-Fallback", `https://ipfs.io/ipfs/${hash}`);
            res.end(html);
            return;
          }
        }
      },
      // @ts-ignore - http-proxy-middleware types
      onError: (err: any, req: any, res: any) => {
        loggers.server.error({ err }, "❌ IPFS Gateway Proxy Error");

        // Extract hash from URL for fallback
        const hash = req.url.split("/ipfs/")[1];

        res.status(502).json({
          success: false,
          error: "Local IPFS Gateway unavailable",
          details: err.message,
          fallback: hash
            ? {
                publicGateway: `https://ipfs.io/ipfs/${hash}`,
                cloudflareGateway: `https://cloudflare-ipfs.com/ipfs/${hash}`,
                dweb: `https://dweb.link/ipfs/${hash}`,
              }
            : undefined,
        });
      },
    })
  );

  app.use(
    "/ipns",
    createProxyMiddleware({
      target: IPFS_GATEWAY_URL,
      changeOrigin: true,
      pathRewrite: {
        "^/ipns": "/ipns",
      },
      // @ts-ignore - http-proxy-middleware types
      onProxyReq: (proxyReq: any, req: any, res: any) => {
        loggers.server.debug(
          {
            method: req.method,
            url: req.url,
            target: `${IPFS_GATEWAY_URL}${req.url}`,
          },
          `📁 IPNS Gateway Request`
        );
      },
      // @ts-ignore - http-proxy-middleware types
      onError: (err: any, req: any, res: any) => {
        loggers.server.error({ err }, "❌ IPNS Gateway Proxy Error");
        res.status(500).json({
          success: false,
          error: "IPFS Gateway unavailable",
          details: err.message,
        });
      },
    })
  );

  // Route mancanti dall'index-old.js
  app.get("/blog/:id", (req: any, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    const indexPath = path.resolve(publicPath, "index.html");
    const htmlData = fs.readFileSync(indexPath, "utf8");
    let numberOfTries = 0;
    const gun = req.app.get("gunInstance");
    const chain = gun
      .get(`hal9000/post`)
      .get(req.params.id)
      .on((post: any) => {
        numberOfTries++;
        if (!post) {
          if (numberOfTries > 1) {
            chain.off();
            return res.sendStatus(404);
          }
          return;
        }
        if (res.writableEnded) {
          chain.off();
          return;
        }
        const finalHtml = `
            <!DOCTYPE html>
            <html>
               <head>
                  <title>${post.title || "Blog Post"}</title>
                  <meta name="description" content="${post.description || ""}" />
               </head>
               <body>
                  ${post.content}
               </body>
            </html>
         `;
        return res.send(finalHtml);
      });
    setTimeout(() => {
      if (!res.writableEnded) {
        res.sendStatus(408);
      }
      chain.off();
    }, 5000);
  });

  app.get("/api/v1/ipfs/webui", (req, res) => {
    const token =
      req.query?.auth_token ||
      req.query?._auth_token ||
      (req.headers["authorization"] && (req.headers["authorization"] as string).split(" ")[1]) ||
      req.headers["token"];

    if (token === authConfig.adminPassword) {
      res.redirect("/api/v1/ipfs/webui/?auth_token=" + encodeURIComponent(token as string));
      return;
    }

    res.redirect(`/admin?error=unauthorized&path=${encodeURIComponent(req.originalUrl)}`);
  });

  app.get("/admin", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    const adminPath = path.resolve(publicPath, "admin.html");

    loggers.server.debug(
      { publicPath, adminPath, exists: fs.existsSync(adminPath) },
      `🔍 Admin route requested`
    );

    if (!fs.existsSync(adminPath)) {
      loggers.server.error({ adminPath }, `❌ Admin file not found`);
      return res.status(404).json({
        success: false,
        error: "Admin panel HTML file not found",
        path: adminPath,
      });
    }

    // Aggiungi header per prevenire il caching
    res.set({
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    res.sendFile(adminPath);
  });

  app.get("/stats", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "stats.html"));
  });

  app.get("/charts", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "charts.html"));
  });

  app.get("/services-dashboard", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "services-dashboard.html"));
  });

  app.get("/pin-manager", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "pin-manager.html"));
  });

  app.get("/notes", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "notes.html"));
  });

  app.get("/upload", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "upload.html"));
  });

  app.get("/graph", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "graph.html"));
  });

  // Removed /chat and /subscription - these files have been deleted
  // Chat and subscription functionality is now handled by external apps

  // Deals dashboard removed - now using external @shogun-deals app

  app.get("/registry-dashboard", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "registry-dashboard.html"));
  });

  app.get("/network-stats", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "network-stats.html"));
  });

  app.get("/rpc-console", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "rpc-console.html"));
  });

  app.get("/endpoints", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "endpoints.html"));
  });

  app.get("/torrent.html", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "torrent.html"));
  });

  // Route per servire i file JavaScript dalla directory lib
  app.get("/lib/:filename", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    const filePath = path.resolve(publicPath, "lib", req.params.filename);

    loggers.server.debug(
      {
        filename: req.params.filename,
        filePath,
        exists: fs.existsSync(filePath),
      },
      `🔍 Lib file requested`
    );

    if (!fs.existsSync(filePath)) {
      loggers.server.error({ filePath }, `❌ Lib file not found`);
      return res.status(404).json({
        success: false,
        error: "JavaScript file not found",
        path: filePath,
      });
    }

    // Set correct content type for JavaScript files
    res.setHeader("Content-Type", "application/javascript");
    res.sendFile(filePath);
  });

  // Route per servire i file CSS dalla directory styles
  app.get("/styles/:filename", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    const filePath = path.resolve(publicPath, "styles", req.params.filename);

    loggers.server.debug(
      {
        filename: req.params.filename,
        filePath,
        exists: fs.existsSync(filePath),
      },
      `🔍 Styles file requested`
    );

    if (!fs.existsSync(filePath)) {
      loggers.server.error({ filePath }, `❌ Styles file not found`);
      return res.status(404).json({
        success: false,
        error: "CSS file not found",
        path: filePath,
      });
    }

    // Set correct content type for CSS files
    res.setHeader("Content-Type", "text/css");
    res.sendFile(filePath);
  });

  // Route di autenticazione

  // Route per gli upload degli utenti
  app.use(`${baseRoute}/user-uploads`, uploadsRouter);

  // Route per IPFS (conditional)
  if (ipfsConfig.enabled) {
    app.use(`${baseRoute}/ipfs`, ipfsRouter);
    loggers.server.info(`✅ IPFS routes registered`);
  } else {
    loggers.server.info(`⏭️ IPFS routes disabled (IPFS_ENABLED=false)`);
    // Return disabled message for any IPFS route request
    app.use(`${baseRoute}/ipfs/*`, (req, res) => {
      res.status(503).json({ success: false, error: "IPFS module is disabled" });
    });
  }

  // Route di sistema e debug (always enabled - core functionality)
  app.use(`${baseRoute}/system`, systemRouter);
  app.use(`${baseRoute}/debug`, debugRouter);

  // Route per i servizi (always enabled)
  app.use(`${baseRoute}/services`, servicesRouter);

  // Route per il grafico visivo (always enabled)
  app.use(`${baseRoute}/visualGraph`, visualGraphRouter);

  // Route per x402 payments e subscriptions (conditional)
  if (x402Config.enabled) {
    app.use(`${baseRoute}/x402`, x402Router);
    loggers.server.info(`✅ X402 routes registered`);
  } else {
    loggers.server.info(`⏭️ X402 routes disabled (X402_ENABLED=false)`);
    app.use(`${baseRoute}/x402/*`, (req, res) => {
      res.status(503).json({ success: false, error: "X402 module is disabled" });
    });
  }

  // Route per network federation, discovery e storage proofs (always enabled)
  app.use(`${baseRoute}/network`, networkRouter);

  // Route per storage deals (conditional)
  if (dealsConfig.enabled) {
    app.use(`${baseRoute}/deals`, dealsRouter);
    loggers.server.info(`✅ Deals routes registered`);
  } else {
    loggers.server.info(`⏭️ Deals routes disabled (DEALS_ENABLED=false)`);
    app.use(`${baseRoute}/deals/*`, (req, res) => {
      res.status(503).json({ success: false, error: "Deals module is disabled" });
    });
  }

  // Route per on-chain registry management (conditional)
  if (registryConfig.enabled) {
    app.use(`${baseRoute}/registry`, registryRouter);
    loggers.server.info(`✅ Registry routes registered`);
  } else {
    loggers.server.info(`⏭️ Registry routes disabled (REGISTRY_ENABLED=false)`);
    app.use(`${baseRoute}/registry/*`, (req, res) => {
      res.status(503).json({ success: false, error: "Registry module is disabled" });
    });
  }

  // Route per L2 Bridge (conditional)
  if (bridgeConfig.enabled) {
    app.use(`${baseRoute}/bridge`, bridgeRouter);
    loggers.server.info(`✅ Bridge routes registered`);
  } else {
    loggers.server.info(`⏭️ Bridge routes disabled (BRIDGE_ENABLED=false)`);
    app.use(`${baseRoute}/bridge/*`, (req, res) => {
      res.status(503).json({ success: false, error: "Bridge module is disabled" });
    });
  }

  // Route per Torrent (conditional)
  if (torrentConfig.enabled) {
    app.use(`${baseRoute}/torrent`, torrentRouter);
    loggers.server.info(`✅ Torrent routes registered`);
  } else {
    loggers.server.info(`⏭️ Torrent routes disabled (TORRENT_ENABLED=false)`);
    app.use(`${baseRoute}/torrent/*`, (req, res) => {
      res.status(503).json({ success: false, error: "Torrent module is disabled" });
    });
  }

  // Route per Drive (always enabled, admin-only)
  app.use(`${baseRoute}/drive`, driveRouter);
  loggers.server.info(`✅ Drive routes registered`);

  // Route di test per verificare se le route sono registrate correttamente
  app.get(`${baseRoute}/test`, (req, res) => {
    res.json({
      success: true,
      message: "API routes are working",
      timestamp: Date.now(),
      baseRoute: baseRoute,
    });
  });

  // Debug endpoint per verificare la configurazione admin
  app.get(`${baseRoute}/debug/admin-config`, (req, res) => {
    res.json({
      success: true,
      adminPassword: authConfig.adminPassword ? "CONFIGURED" : "NOT_CONFIGURED",
      adminPasswordLength: authConfig.adminPassword ? authConfig.adminPassword.length : 0,
      adminPasswordPreview: authConfig.adminPassword
        ? authConfig.adminPassword.substring(0, 4) +
          "..." +
          authConfig.adminPassword.substring(authConfig.adminPassword.length - 4)
        : "N/A",
      timestamp: Date.now(),
    });
  });

  // Route principale per il visual graph
  app.use("/visualGraph", visualGraphRouter);

  // IPFS API Proxy - for API calls to the IPFS node
  // Example: /api/v0/add, /api/v0/cat, etc.
  // SECURED: This generic proxy requires the admin token for any access.
  app.use(
    "/api/v0",
    (req, res, next) => {
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const token = bearerToken || customToken;

      if (token === authConfig.adminPassword) {
        next();
      } else {
        res.status(401).json({ success: false, error: "Unauthorized" });
      }
    },
    createProxyMiddleware({
      target: IPFS_API_URL,
      changeOrigin: true,
      pathRewrite: {
        "^/api/v0": "/api/v0",
      },
      // @ts-ignore - http-proxy-middleware types
      onProxyReq: (proxyReq: any, req: any, res: any) => {
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
          (req.url.includes("/version") || req.url.includes("/id") || req.url.includes("/peers"))
        ) {
          proxyReq.method = "POST";
          proxyReq.setHeader("Content-Length", "0");
        }

        // Add query parameter to get JSON response
        if (req.url.includes("/version")) {
          const originalPath = proxyReq.path;
          proxyReq.path = originalPath + (originalPath.includes("?") ? "&" : "?") + "format=json";
        }
      },
      // @ts-ignore - http-proxy-middleware types
      onProxyRes: (proxyRes: any, req: any, res: any) => {
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
      // @ts-ignore - http-proxy-middleware types
      onError: (err: any, req: any, res: any) => {
        loggers.server.error({ err }, "❌ IPFS API Proxy Error");
        res.status(500).json({
          success: false,
          error: "IPFS API unavailable",
          details: err.message,
        });
      },
    })
  );

  // --- FINE ROUTE LEGACY ---

  // Route di health check with module status
  app.get(`${baseRoute}/health`, (req, res) => {
    res.json({
      success: true,
      message: "Shogun Relay API is running",
      data: {
        timestamp: new Date().toISOString(),
        version: packageConfig.version || "1.0.0",
        uptime: process.uptime(),
        modules: {
          ipfs: ipfsConfig.enabled,
          holster: holsterConfig.enabled,
          x402: x402Config.enabled,
          deals: dealsConfig.enabled,
          registry: registryConfig.enabled,
          bridge: bridgeConfig.enabled,
          torrent: torrentConfig.enabled,
        },
      },
    });
  });

  // Route di default per API non trovate
  app.use(`${baseRoute}/*`, (req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      message: "API endpoint non trovato",
      data: {
        path: req.path,
        method: req.method,
        availableEndpoints: [
          // Health & System
          `${baseRoute}/health`,
          `${baseRoute}/system/health`,
          `${baseRoute}/system/stats`,
          `${baseRoute}/system/alldata`,
          // User Uploads
          `${baseRoute}/user-uploads/system-hashes`,
          `${baseRoute}/user-uploads/:identifier`,
          `${baseRoute}/user-uploads/:identifier/:hash`,
          // IPFS (aligned with Kubo API)
          `${baseRoute}/ipfs/upload`,
          `${baseRoute}/ipfs/status`,
          `${baseRoute}/ipfs/cat/:cid`,
          `${baseRoute}/ipfs/cat/:cid/json`,
          `${baseRoute}/ipfs/cat/:cid/decrypt`,
          `${baseRoute}/ipfs/pin/add`,
          `${baseRoute}/ipfs/pin/rm`,
          `${baseRoute}/ipfs/pin/ls`,
          `${baseRoute}/ipfs/repo/gc`,
          `${baseRoute}/ipfs/repo/stat`,
          `${baseRoute}/ipfs/version`,
          `${baseRoute}/ipfs/user-uploads/:userAddress`,
          // Gateway proxy
          `/ipfs/:cid`,
          `/ipns/:name`,
          // Notes
          `${baseRoute}/notes`,
          `${baseRoute}/notes/regular`,
          // Debug
          `${baseRoute}/debug/mb-usage/:userAddress`,
          // Services
          `${baseRoute}/services/status`,
          `${baseRoute}/services/:service/restart`,
          // Visual Graph
          `${baseRoute}/visualGraph`,
          // x402 Subscriptions
          `${baseRoute}/x402/tiers`,
          `${baseRoute}/x402/subscription/:userAddress`,
          `${baseRoute}/x402/subscribe`,
          `${baseRoute}/x402/payment-requirements/:tier`,
          `${baseRoute}/x402/can-upload/:userAddress`,
          `${baseRoute}/x402/can-upload-verified/:userAddress`,
          `${baseRoute}/x402/storage/:userAddress`,
          `${baseRoute}/x402/storage/sync/:userAddress`,
          `${baseRoute}/x402/config`,
          // Network Federation & Storage Proofs
          `${baseRoute}/network/relays`,
          `${baseRoute}/network/relay/:host`,
          `${baseRoute}/network/stats`,
          `${baseRoute}/network/proof/:cid`,
          `${baseRoute}/network/verify-proof`,
          `${baseRoute}/network/pin-request`,
          `${baseRoute}/network/pin-requests`,
          `${baseRoute}/network/pin-response`,
          // Reputation System
          `${baseRoute}/network/reputation`,
          `${baseRoute}/network/reputation/:host`,
          `${baseRoute}/network/reputation/record-proof`,
          `${baseRoute}/network/best-relays`,
          // Verified (Frozen/Immutable) Data
          `${baseRoute}/network/verified/relays`,
          `${baseRoute}/network/verified/relay/:host`,
          `${baseRoute}/network/verified/observation`,
          `${baseRoute}/network/verified/observations/:host`,
          `${baseRoute}/network/verified/entry/:namespace/:hash`,
          // Storage Deals (per-file contracts)
          `${baseRoute}/deals/pricing`,
          `${baseRoute}/deals/overhead`,
          `${baseRoute}/deals/create`,
          `${baseRoute}/deals/:dealId`,
          `${baseRoute}/deals/:dealId/activate`,
          `${baseRoute}/deals/:dealId/renew`,
          `${baseRoute}/deals/:dealId/terminate`,
          `${baseRoute}/deals/by-cid/:cid`,
          `${baseRoute}/deals/by-client/:address`,
          `${baseRoute}/deals/relay/active`,
          `${baseRoute}/deals/stats`,
          `${baseRoute}/deals/leaderboard`,
        ],
      },
    });
  });

  // Fallback to index.html per tutte le altre route
  app.get("/*", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    const indexPath = path.resolve(publicPath, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send("Index file not found");
    }
  });
};
