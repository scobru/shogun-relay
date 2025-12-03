import express from "express";
import rateLimit from "express-rate-limit";
import { createProxyMiddleware } from "http-proxy-middleware";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import multer from "multer";
import FormData from "form-data";

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
      onProxyRes: (proxyRes, req, res) => {
        console.log(
          `📁 IPFS Gateway Response: ${proxyRes.statusCode} for ${req.url}`
        );

        // If local gateway fails with 404, try to add fallback headers
        if (proxyRes.statusCode === 404) {
          const hash = req.url.split("/ipfs/")[1];
          if (hash) {
            console.log(
              `⚠️ Local gateway 404 for hash: ${hash}, adding fallback headers`
            );
            proxyRes.headers[
              "X-IPFS-Fallback"
            ] = `https://ipfs.io/ipfs/${hash}`;
            // Add CORS headers
            proxyRes.headers["Access-Control-Allow-Origin"] = "*";
            proxyRes.headers["Access-Control-Allow-Methods"] =
              "GET, HEAD, OPTIONS";
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
