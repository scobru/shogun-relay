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
        path: adminPath
      });
    }
    
    // Aggiungi header per prevenire il caching
    res.set({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
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
        path: filePath
      });
    }
    
    // Set correct content type for JavaScript files
    res.setHeader('Content-Type', 'application/javascript');
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
        path: filePath
      });
    }
    
    // Set correct content type for CSS files
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(filePath);
  });

  app.get("/drive", (req, res) => {
    const publicPath = path.resolve(__dirname, "../public");
    res.sendFile(path.resolve(publicPath, "drive.html"));
  });


  // Route per IPFS content
  app.get("/ipfs-content/:cid", async (req, res) => {
    const { cid } = req.params;
    const { token } = req.query;
    const IPFS_GATEWAY_URL =
      process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";

    console.log(
      `🔍 IPFS Content Request - CID: ${cid}, Token: ${
        token ? "present" : "missing"
      }`
    );

    if (!cid) {
      return res.status(400).json({
        success: false,
        error: "CID is required",
      });
    }

    try {
      const gatewayUrl = new URL(IPFS_GATEWAY_URL);
      const protocolModule =
        gatewayUrl.protocol === "https:"
          ? await import("https")
          : await import("http");

      const requestOptions = {
        hostname: gatewayUrl.hostname,
        port: gatewayUrl.port
          ? Number(gatewayUrl.port)
          : gatewayUrl.protocol === "https:"
          ? 443
          : 80,
        path: `/ipfs/${cid}`,
        method: "GET",
        headers: {
          Host: gatewayUrl.host,
        },
      };

      const ipfsReq = protocolModule.request(requestOptions, (ipfsRes) => {
        // If no token, just stream the response
        if (!token) {
          console.log(
            `📤 Streaming content without decryption for CID: ${cid}`
          );
          res.setHeader(
            "Content-Type",
            ipfsRes.headers["content-type"] || "application/octet-stream"
          );
          ipfsRes.pipe(res);
          return;
        }

        // If token is provided, buffer the response to decrypt it
        console.log(`🔓 Attempting decryption for CID: ${cid}`);
        let body = "";
        ipfsRes.on("data", (chunk) => (body += chunk));
        ipfsRes.on("end", async () => {
          try {
            const SEA = await import("gun/sea.js");
            const decrypted = await SEA.default.decrypt(body, token);

            if (decrypted) {
              console.log(`🧪 Decryption successful!`);

              // Controlla se i dati decrittati sono un data URL
              if (decrypted.startsWith("data:")) {
                console.log(
                  `📁 Detected data URL, extracting content type and data`
                );

                // Estrai il content type e i dati dal data URL
                const matches = decrypted.match(/^data:([^;]+);base64,(.+)$/);
                if (matches) {
                  const contentType = matches[1];
                  const base64Data = matches[2];

                  // Decodifica il base64 e restituisci direttamente
                  const buffer = Buffer.from(base64Data, "base64");

                  res.setHeader("Content-Type", contentType);
                  res.setHeader("Content-Length", buffer.length);
                  res.setHeader("Cache-Control", "public, max-age=3600");
                  res.send(buffer);
                } else {
                  // Fallback: restituisci come JSON
                  res.json({
                    success: true,
                    message:
                      "Decryption successful but could not parse data URL",
                    decryptedData: decrypted,
                    originalLength: body.length,
                  });
                }
              } else {
                // Se non è un data URL, restituisci come testo
                res.setHeader("Content-Type", "text/plain");
                res.send(decrypted);
              }
            } else {
              res.status(400).json({
                success: false,
                error: "Decryption failed",
              });
            }
          } catch (decryptError) {
            console.error("❌ Decryption error:", decryptError);
            res.status(500).json({
              success: false,
              error: "Decryption error",
              details: decryptError.message,
            });
          }
          res.end(chunk);
        });
      });

      ipfsReq.on("error", (error) => {
        console.error("❌ IPFS Gateway error:", error);
        res.status(500).json({
          success: false,
          error: "IPFS Gateway error",
          details: error.message,
        });
      });

      ipfsReq.end();
    } catch (error) {
      console.error("❌ IPFS Content error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/ipfs-content-json/:cid", async (req, res) => {
    const { cid } = req.params;
    const { token } = req.query;
    const IPFS_GATEWAY_URL =
      process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";

    if (!cid) {
      return res.status(400).json({
        success: false,
        error: "CID is required",
      });
    }

    try {
      const gatewayUrl = new URL(IPFS_GATEWAY_URL);
      const protocolModule =
        gatewayUrl.protocol === "https:"
          ? await import("https")
          : await import("http");

      const requestOptions = {
        hostname: gatewayUrl.hostname,
        port: gatewayUrl.port
          ? Number(gatewayUrl.port)
          : gatewayUrl.protocol === "https:"
          ? 443
          : 80,
        path: `/ipfs/${cid}`,
        method: "GET",
        headers: {
          Host: gatewayUrl.host,
        },
      };

      const ipfsReq = protocolModule.request(requestOptions, (ipfsRes) => {
        if (!token) {
          let body = "";
          ipfsRes.on("data", (chunk) => (body += chunk));
          ipfsRes.on("end", () => {
            try {
              const jsonData = JSON.parse(body);
              res.json({
                success: true,
                data: jsonData,
              });
            } catch (parseError) {
              res.status(400).json({
                success: false,
                error: "Invalid JSON content",
              });
            }
          });
          return;
        }

        let body = "";
        ipfsRes.on("data", (chunk) => (body += chunk));
        ipfsRes.on("end", async () => {
          try {
            const SEA = await import("gun/sea.js");
            const decrypted = await SEA.default.decrypt(body, token);

            if (decrypted) {
              try {
                const jsonData = JSON.parse(decrypted);
                res.json({
                  success: true,
                  data: jsonData,
                });
              } catch (parseError) {
                res.status(400).json({
                  success: false,
                  error: "Invalid JSON content after decryption",
                });
              }
            } else {
              res.status(400).json({
                success: false,
                error: "Decryption failed",
              });
            }
          } catch (decryptError) {
            res.status(500).json({
              success: false,
              error: "Decryption error",
              details: decryptError.message,
            });
          }
        });
      });

      ipfsReq.on("error", (error) => {
        res.status(500).json({
          success: false,
          error: "IPFS Gateway error",
          details: error.message,
        });
      });

      ipfsReq.end();
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
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
      adminPassword: process.env.ADMIN_PASSWORD ? "CONFIGURED" : "NOT_CONFIGURED",
      adminPasswordLength: process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.length : 0,
      adminPasswordPreview: process.env.ADMIN_PASSWORD ? 
        process.env.ADMIN_PASSWORD.substring(0, 4) + "..." + process.env.ADMIN_PASSWORD.substring(process.env.ADMIN_PASSWORD.length - 4) : 
        "N/A",
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
          `${baseRoute}/health`,
          `${baseRoute}/users`,
          `${baseRoute}/users/profile`,
          `${baseRoute}/users/:pubkey`,
          `${baseRoute}/users/search/:query`,
          `${baseRoute}/user-uploads/system-hashes`,
          `${baseRoute}/user-uploads/:identifier`,
          `${baseRoute}/user-uploads/:identifier/:hash`,
          `${baseRoute}/ipfs/upload`,
          `${baseRoute}/ipfs/status`,
          `${baseRoute}/ipfs/content/:cid`,
          `${baseRoute}/ipfs/content-json/:cid`,
          `${baseRoute}/ipfs/pins/add`,
          `${baseRoute}/system/health`,
          `${baseRoute}/system/stats`,
          `${baseRoute}/system/alldata`,
          `${baseRoute}/notes`,
          `${baseRoute}/notes/regular`,
          `${baseRoute}/debug/mb-usage/:userAddress`,
          `${baseRoute}/services/status`,
          `${baseRoute}/services/:service/restart`,
          `${baseRoute}/visualGraph`,
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
        console.log(`❌ Accesso negato a ${path} - Token mancante o non valido`);
        return res.status(401).json({ 
          success: false, 
          error: "Unauthorized - Admin authentication required",
          message: "Questa pagina richiede autenticazione admin. Inserisci la password admin nella pagina principale."
        });
      }
    } else {
      // Route pubblica, continua
      next();
    }
  });
};
