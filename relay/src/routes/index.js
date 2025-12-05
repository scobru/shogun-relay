import express from "express";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import multer from "multer";
import FormData from "form-data";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurazione multer per upload file
const upload = multer({ storage: multer.memoryStorage() });

// Middleware di autenticazione
const tokenAuthMiddleware = (req, res, next) => {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers["authorization"];
  const bearerToken = authHeader && authHeader.split(" ")[1];

  // Check custom token header (for Gun/Wormhole compatibility)
  const customToken = req.headers["token"];

  // Accept either format
  const token = bearerToken || customToken;

  if (token === process.env.ADMIN_PASSWORD) {
    // Use a more secure token in production
    next();
  } else {
    console.log("Auth failed - Bearer:", bearerToken, "Custom:", customToken);
    res.status(401).json({ success: false, error: "Unauthorized" });
  }
};

// Importa i moduli delle routes
import uploadsRouter from "./uploads.js";
import ipfsRouter from "./ipfs.js";
import systemRouter from "./system.js";
import debugRouter from "./debug.js";
import servicesRouter from "./services.js";
import visualGraphRouter from "./visualGraph.js";
import x402Router from "./x402.js";
import networkRouter from "./network.js";
import dealsRouter from "./deals.js";
import registryRouter from "./registry.js";

// Rate limiting generale
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 1000, // massimo 1000 richieste per IP
  message: {
    success: false,
    message: "Troppe richieste. Riprova tra 15 minuti.",
    data: null,
  },
});

export default (app) => {
  // Configurazione generale delle route
  const baseRoute = "/api/v1";

  // Applica rate limiting generale
  app.use(generalLimiter);

  // --- IPFS Desktop Proxy Configuration ---
  const IPFS_GATEWAY_URL =
    process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";
  const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN || process.env.IPFS_API_KEY;
  const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";

  console.log(`🌐 IPFS API Proxy: ${IPFS_API_URL}`);
  console.log(`🌐 IPFS Gateway Proxy: ${IPFS_GATEWAY_URL}`);
  console.log(`🔐 IPFS Auth: ${IPFS_API_TOKEN ? "configured" : "not set"}`);

  // IPFS Gateway handler with direct IPFS API fallback
  app.get("/ipfs/:cid", async (req, res, next) => {
    const { cid } = req.params;
    const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
    const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN || process.env.IPFS_API_KEY;
    
    // Helper function to make IPFS API HTTP requests
    const makeIpfsRequest = (path, method = 'POST', isBinary = false) => {
      return new Promise((resolve, reject) => {
        const url = new URL(IPFS_API_URL);
        const options = {
          hostname: url.hostname,
          port: url.port || 5001,
          path: `/api/v0${path}`,
          method,
          headers: { 
            'Content-Type': 'application/json',
            'Content-Length': '0'
          },
        };
        
        if (IPFS_API_TOKEN) {
          options.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
        }
        
        const req = http.request(options, (res) => {
          const chunks = [];
          res.on('data', chunk => chunks.push(chunk));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            if (res.statusCode === 200) {
              if (isBinary) {
                resolve(buffer);
              } else {
                try {
                  resolve(JSON.parse(buffer.toString()));
                } catch (e) {
                  resolve({ raw: buffer.toString() });
                }
              }
            } else {
              reject(new Error(`IPFS API returned ${res.statusCode}: ${buffer.toString().substring(0, 200)}`));
            }
          });
        });
        
        req.on('error', reject);
        req.setTimeout(30000, () => {
          req.destroy();
          reject(new Error('IPFS request timeout'));
        });
        req.end();
      });
    };
    
    // Try to retrieve file directly from IPFS API
    try {
      console.log(`📁 Direct IPFS retrieval attempt for CID: ${cid}`);
      
      // Try to get file from IPFS directly using HTTP API
      const fileBuffer = await makeIpfsRequest(`/cat?arg=${encodeURIComponent(cid)}`, 'POST', true);
      
      if (fileBuffer && fileBuffer.length > 0) {
        // Try to detect content type from first bytes
        let contentType = 'application/octet-stream';
        const firstBytes = fileBuffer.slice(0, 512);
        
        // Basic content type detection
        if (firstBytes[0] === 0x89 && firstBytes[1] === 0x50 && firstBytes[2] === 0x4E && firstBytes[3] === 0x47) {
          contentType = 'image/png';
        } else if (firstBytes[0] === 0xFF && firstBytes[1] === 0xD8) {
          contentType = 'image/jpeg';
        } else if (firstBytes[0] === 0x47 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46) {
          contentType = 'image/gif';
        } else if (firstBytes[0] === 0x25 && firstBytes[1] === 0x50 && firstBytes[2] === 0x44 && firstBytes[3] === 0x46) {
          contentType = 'application/pdf';
        } else if (fileBuffer.slice(0, 5).toString() === '<html' || fileBuffer.slice(0, 9).toString() === '<!DOCTYPE') {
          contentType = 'text/html';
        } else {
          // Try to detect JSON
          try {
            JSON.parse(fileBuffer.toString());
            contentType = 'application/json';
          } catch (e) {
            // Not JSON, keep default
          }
        }
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', fileBuffer.length);
        res.setHeader('Cache-Control', 'public, max-age=31536000'); // 1 year
        res.setHeader('X-Content-Source', 'ipfs-direct');
        
        console.log(`✅ Served CID ${cid} directly from IPFS API (${fileBuffer.length} bytes, ${contentType})`);
        return res.send(fileBuffer);
      }
    } catch (error) {
      console.log(`⚠️ Direct IPFS retrieval failed for ${cid}:`, error.message);
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
      onProxyReq: (proxyReq, req, res) => {
        console.log(
          `📁 IPFS Gateway Request: ${req.method} ${req.url} -> ${IPFS_GATEWAY_URL}${proxyReq.path}`
        );
      },
      onProxyRes: async (proxyRes, req, res) => {
        console.log(
          `📁 IPFS Gateway Response: ${proxyRes.statusCode} for ${req.url}`
        );

        // If local gateway fails with 404, show user-friendly error page with fallback links
        if (proxyRes.statusCode === 404) {
          const hash = req.url.split("/ipfs/")[1]?.split('?')[0]?.split('#')[0]; // Get CID, remove query/hash
          if (hash) {
            console.log(`⚠️ Local gateway 404 for hash: ${hash}, showing fallback page`);
            
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
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Length', Buffer.byteLength(html));
            res.setHeader('X-IPFS-Fallback', `https://ipfs.io/ipfs/${hash}`);
            res.end(html);
            return;
          }
        }
      },
      onError: (err, req, res) => {
        console.error("❌ IPFS Gateway Proxy Error:", err.message);

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
      onProxyReq: (proxyReq, req, res) => {
        console.log(
          `📁 IPNS Gateway Request: ${req.method} ${req.url} -> ${IPFS_GATEWAY_URL}${req.url}`
        );
      },
      onError: (err, req, res) => {
        console.error("❌ IPNS Gateway Proxy Error:", err.message);
        res.status(500).json({
          success: false,
          error: "IPFS Gateway unavailable",
          details: err.message,
        });
      },
    })
  );

  // Route mancanti dall'index-old.js
  app.get("/blog/:id", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    const indexPath = path.resolve(publicPath, "index.html");
    const htmlData = fs.readFileSync(indexPath, "utf8");
    let numberOfTries = 0;
    const gun = req.app.get("gunInstance");

    const chain = gun
      .get(`hal9000/post`)
      .get(req.params.id)
      .on((post) => {
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
                  <meta name="description" content="${
                    post.description || ""
                  }" />
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
      (req.headers["authorization"] &&
        req.headers["authorization"].split(" ")[1]) ||
      req.headers["token"];

    if (token === process.env.ADMIN_PASSWORD) {
      res.redirect(
        "/api/v1/ipfs/webui/?auth_token=" + encodeURIComponent(token)
      );
      return;
    }

    res.redirect(
      `/admin?error=unauthorized&path=${encodeURIComponent(req.originalUrl)}`
    );
  });

  app.get("/admin", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    const adminPath = path.resolve(publicPath, "admin.html");

    console.log(`🔍 Admin route requested`);
    console.log(`📁 Public path: ${publicPath}`);
    console.log(`📄 Admin file path: ${adminPath}`);
    console.log(`📄 Admin file exists: ${fs.existsSync(adminPath)}`);

    if (!fs.existsSync(adminPath)) {
      console.error(`❌ Admin file not found: ${adminPath}`);
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

  app.get("/chat", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "chat.html"));
  });

  app.get("/charts", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "charts.html"));
  });

  app.get("/subscription", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "subscription.html"));
  });

  app.get("/deals", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "deals-dashboard.html"));
  });

  app.get("/registry-dashboard", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "registry-dashboard.html"));
  });

  app.get("/endpoints", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "endpoints.html"));
  });

  // Route per servire i file JavaScript dalla directory lib
  app.get("/lib/:filename", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    const filePath = path.resolve(publicPath, "lib", req.params.filename);

    console.log(`🔍 Lib file requested: ${req.params.filename}`);
    console.log(`📄 File path: ${filePath}`);
    console.log(`📄 File exists: ${fs.existsSync(filePath)}`);

    if (!fs.existsSync(filePath)) {
      console.error(`❌ Lib file not found: ${filePath}`);
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

    console.log(`🔍 Styles file requested: ${req.params.filename}`);
    console.log(`📄 File path: ${filePath}`);
    console.log(`📄 File exists: ${fs.existsSync(filePath)}`);

    if (!fs.existsSync(filePath)) {
      console.error(`❌ Styles file not found: ${filePath}`);
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

  // Route per IPFS
  app.use(`${baseRoute}/ipfs`, ipfsRouter);

  // Route di sistema e debug
  app.use(`${baseRoute}/system`, systemRouter);

  // Route di debug
  app.use(`${baseRoute}/debug`, debugRouter);

  // Route per i servizi
  app.use(`${baseRoute}/services`, servicesRouter);

  // Route per il grafico visivo
  app.use(`${baseRoute}/visualGraph`, visualGraphRouter);

  // Route per x402 payments e subscriptions
  app.use(`${baseRoute}/x402`, x402Router);

  // Route per network federation, discovery e storage proofs
  app.use(`${baseRoute}/network`, networkRouter);

  // Route per storage deals (per-file contracts)
  app.use(`${baseRoute}/deals`, dealsRouter);

  // Route per on-chain registry management (staking, registration)
  app.use(`${baseRoute}/registry`, registryRouter);

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
      adminPassword: process.env.ADMIN_PASSWORD
        ? "CONFIGURED"
        : "NOT_CONFIGURED",
      adminPasswordLength: process.env.ADMIN_PASSWORD
        ? process.env.ADMIN_PASSWORD.length
        : 0,
      adminPasswordPreview: process.env.ADMIN_PASSWORD
        ? process.env.ADMIN_PASSWORD.substring(0, 4) +
          "..." +
          process.env.ADMIN_PASSWORD.substring(
            process.env.ADMIN_PASSWORD.length - 4
          )
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

      if (token === process.env.ADMIN_PASSWORD) {
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
      onProxyReq: (proxyReq, req, res) => {
        console.log(
          `🔧 IPFS API Request: ${req.method} ${req.url} -> ${IPFS_API_URL}${req.url}`
        );

        // Add authentication headers for IPFS API
        if (IPFS_API_TOKEN) {
          proxyReq.setHeader("Authorization", `Bearer ${IPFS_API_TOKEN}`);
        }

        // IPFS API requires POST method for most endpoints
        // Override GET requests to POST for IPFS API endpoints
        if (
          req.method === "GET" &&
          (req.url.includes("/version") ||
            req.url.includes("/id") ||
            req.url.includes("/peers"))
        ) {
          proxyReq.method = "POST";
          proxyReq.setHeader("Content-Length", "0");
        }

        // Add query parameter to get JSON response
        if (req.url.includes("/version")) {
          const originalPath = proxyReq.path;
          proxyReq.path =
            originalPath +
            (originalPath.includes("?") ? "&" : "?") +
            "format=json";
        }
      },
      onProxyRes: (proxyRes, req, res) => {
        console.log(
          `📤 IPFS API Response: ${proxyRes.statusCode} for ${req.method} ${req.url}`
        );

        // Handle non-JSON responses from IPFS
        if (
          proxyRes.headers["content-type"] &&
          !proxyRes.headers["content-type"].includes("application/json")
        ) {
          console.log(
            `📝 IPFS Response Content-Type: ${proxyRes.headers["content-type"]}`
          );
        }
      },
      onError: (err, req, res) => {
        console.error("❌ IPFS API Proxy Error:", err.message);
        res.status(500).json({
          success: false,
          error: "IPFS API unavailable",
          details: err.message,
        });
      },
    })
  );

  // --- FINE ROUTE LEGACY ---

  // Route di health check
  app.get(`${baseRoute}/health`, (req, res) => {
    res.json({
      success: true,
      message: "Shogun Relay API is running",
      data: {
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || "1.0.0",
        uptime: process.uptime(),
      },
    });
  });

  // Route di default per API non trovate
  app.use(`${baseRoute}/*`, (req, res) => {
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

  // Aggiungi middleware per proteggere le route statiche che richiedono autenticazione
  const protectedStaticRoutes = [
    "/stats",
    "/services-dashboard",
    "/pin-manager",
    "/notes",
    "/upload",
    "/graph",
    "/chat",
    "/charts",
    "/drive",
  ];

  app.use((req, res, next) => {
    const path = req.path;

    // Controlla se la route richiede autenticazione admin
    if (protectedStaticRoutes.includes(path)) {
      // Verifica autenticazione admin
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const formToken = req.query["_auth_token"]; // Token inviato tramite form
      const queryToken = req.query["auth_token"];
      const token = bearerToken || customToken || formToken || queryToken;

      if (token === process.env.ADMIN_PASSWORD) {
        next();
      } else {
        console.log(
          `❌ Accesso negato a ${path} - Token mancante o non valido`
        );
        return res.status(401).json({
          success: false,
          error: "Unauthorized - Admin authentication required",
          message:
            "Questa pagina richiede autenticazione admin. Inserisci la password admin nella pagina principale.",
        });
      }
    } else {
      // Route pubblica, continua
      next();
    }
  });
};
