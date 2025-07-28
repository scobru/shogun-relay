import express from 'express';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Importa i moduli delle routes
import contractsRouter from './contracts.js';
import uploadsRouter from './uploads.js';
import ipfsRouter from './ipfs.js';
import systemRouter from './system.js';
import notesRouter from './notes.js';
import debugRouter from './debug.js';
import authRouter from './auth.js';
import usersRouter from './users.js';
import subscriptionsRouter from './subscriptions.js';
import servicesRouter from './services.js';

// Rate limiting generale
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 1000, // massimo 1000 richieste per IP
  message: { 
    success: false, 
    message: 'Troppe richieste. Riprova tra 15 minuti.', 
    data: null 
  }
});

export default (app) => {
  // Configurazione generale delle route
  const baseRoute = '/api/v1';
  
  // Applica rate limiting generale
  app.use(generalLimiter);
  
  // --- IPFS Desktop Proxy Configuration ---
  const IPFS_GATEWAY_URL = process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";
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
    const publicPath = path.resolve(__dirname, '../public');
    const indexPath = path.resolve(publicPath, "index.html");
    const htmlData = fs.readFileSync(indexPath, "utf8");
    let numberOfTries = 0;
    const gun = req.app.get('gunInstance');
    
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

  // Route per servire i file HTML specifici (DOPO le route API)
  app.get("/user-upload", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "user-upload.html"));
  });

  app.get("/subscribe", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "subscribe.html"));
  });

  app.get("/stats", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "stats.html"));
  });

  app.get("/services-dashboard", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "services-dashboard.html"));
  });

  app.get("/pin-manager", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "pin-manager.html"));
  });

  app.get("/notes", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "notes.html"));
  });

  app.get("/upload", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "upload.html"));
  });

  app.get("/create", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "create.html"));
  });

  app.get("/view", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "view.html"));
  });

  app.get("/edit", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "edit.html"));
  });

  app.get("/derive", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "derive.html"));
  });

  app.get("/graph", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "graph.html"));
  });

  app.get("/chat", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "chat.html"));
  });

  app.get("/charts", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "charts.html"));
  });

  app.get("/visualGraph", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "visualGraph/visualGraph.html"));
  });

  app.get("/drive", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    res.sendFile(path.resolve(publicPath, "drive.html"));
  });

  // Route per IPFS content
  app.get("/ipfs-content/:cid", async (req, res) => {
    const { cid } = req.params;
    const { token } = req.query;
    const IPFS_GATEWAY_URL = process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";

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
      // Create request to local gateway
      const requestOptions = {
        hostname: new URL(IPFS_GATEWAY_URL).hostname,
        port: new URL(IPFS_GATEWAY_URL).port,
        path: `/ipfs/${cid}`,
        method: "GET",
      };

      const http = await import('http');
      const ipfsReq = http.get(requestOptions, (ipfsRes) => {
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
            const SEA = await import('gun/sea.js');
            const decrypted = await SEA.default.decrypt(body, token);

            if (decrypted) {
              console.log(`🧪 Decryption successful!`);

              // Controlla se i dati decrittati sono un data URL
              if (decrypted.startsWith("data:")) {
                console.log(`📁 Detected data URL, extracting content type and data`);

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
                    message: "Decryption successful but could not parse data URL",
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
    const IPFS_GATEWAY_URL = process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";

    if (!cid) {
      return res.status(400).json({
        success: false,
        error: "CID is required",
      });
    }

    try {
      const requestOptions = {
        hostname: new URL(IPFS_GATEWAY_URL).hostname,
        port: new URL(IPFS_GATEWAY_URL).port,
        path: `/ipfs/${cid}`,
        method: "GET",
      };

      const http = await import('http');
      const ipfsReq = http.get(requestOptions, (ipfsRes) => {
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
            const SEA = await import('gun/sea.js');
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
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
  
  // Route di autenticazione
  app.use(`${baseRoute}/auth`, authRouter);
  
  // Route per la gestione utenti
  app.use(`${baseRoute}/users`, usersRouter);
  
  // Route per i contratti smart contract
  app.use(`${baseRoute}/contracts`, contractsRouter);
  
  // Route per gli upload degli utenti
  app.use(`${baseRoute}/user-uploads`, uploadsRouter);
  
  // Route per IPFS
  app.use(`${baseRoute}/ipfs`, ipfsRouter);
  
  // Route di sistema e debug
  app.use(`${baseRoute}/system`, systemRouter);
  
  // Route per le note
  app.use(`${baseRoute}/notes`, notesRouter);
  
  // Route di debug
  app.use(`${baseRoute}/debug`, debugRouter);
  
  // Route per le sottoscrizioni
  app.use(`${baseRoute}/subscriptions`, subscriptionsRouter);
  
  // Route per i servizi
  app.use(`${baseRoute}/services`, servicesRouter);
  
  // Route legacy per compatibilità (solo quelle essenziali)
  app.use('/api/contracts', contractsRouter);
  app.use('/api/user-uploads', uploadsRouter);
  app.use('/api/ipfs', ipfsRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/notes', notesRouter);
  app.use('/api/debug', debugRouter);
  app.use('/api/subscriptions', subscriptionsRouter);
  app.use('/api/services', servicesRouter);
  app.use('/api/auth', authRouter);
  
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

  // Route legacy per autorizzazioni Gun
  app.post("/api/authorize-gun-key", async (req, res) => {
    try {
      const { pubKey, userAddress, expiresAt } = req.body;
      const gun = req.app.get('gunInstance');

      if (!pubKey) {
        return res.status(400).json({
          success: false,
          error: "Chiave pubblica Gun richiesta",
        });
      }

      // Verifica che l'utente abbia una sottoscrizione attiva
      if (userAddress) {
        try {
          const { ethers } = await import("ethers");
          const { DEPLOYMENTS } = await import("shogun-contracts/deployments.js");
          
          const chainId = process.env.CHAIN_ID || "11155111";
          const web3ProviderUrl = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
          
          if (process.env.ALCHEMY_API_KEY) {
            const provider = new ethers.JsonRpcProvider(web3ProviderUrl);
            const chainDeployments = DEPLOYMENTS[chainId];
            const relayContract = chainDeployments?.["Relay#RelayPaymentRouter"];
            
            if (relayContract) {
              const contract = new ethers.Contract(
                relayContract.address,
                relayContract.abi,
                provider
              );
              
              const isSubscribed = await contract.checkUserSubscription(userAddress);
              if (!isSubscribed) {
                return res.status(403).json({
                  success: false,
                  error: "Utente non ha una sottoscrizione attiva",
                });
              }
            }
          }
        } catch (e) {
          console.error("Errore verifica sottoscrizione:", e);
          return res.status(500).json({
            success: false,
            error: "Errore verifica sottoscrizione",
          });
        }
      }

      // Calcola la data di scadenza (default: 30 giorni)
      const expirationDate = expiresAt || Date.now() + 30 * 24 * 60 * 60 * 1000;

      // Registra la chiave autorizzata nel database Gun
      const authData = {
        pubKey,
        userAddress,
        authorized: true,
        authorizedAt: Date.now(),
        expiresAt: expirationDate,
        authMethod: userAddress ? "smart_contract" : "manual",
      };

      const authNode = gun.get("shogun").get("authorized_keys").get(pubKey);

      authNode.put(authData);

      console.log(
        `✅ Chiave Gun autorizzata: ${pubKey} (scade: ${new Date(
          expirationDate
        ).toISOString()})`
      );

      res.json({
        success: true,
        message: "Chiave Gun autorizzata con successo",
        pubKey,
        expiresAt: expirationDate,
        expiresAtFormatted: new Date(expirationDate).toISOString(),
      });
    } catch (error) {
      console.error("Errore autorizzazione chiave Gun:", error);
      res.status(500).json({
        success: false,
        error: "Errore autorizzazione chiave Gun",
      });
    }
  });

  app.delete("/api/authorize-gun-key/:pubKey", async (req, res) => {
    try {
      const { pubKey } = req.params;
      const gun = req.app.get('gunInstance');

      if (!pubKey) {
        return res.status(400).json({
          success: false,
          error: "Chiave pubblica Gun richiesta",
        });
      }

      // Revoca la chiave autorizzata
      const authNode = gun.get("shogun").get("authorized_keys").get(pubKey);

      authNode.put(null);

      console.log(`❌ Chiave Gun revocata: ${pubKey}`);

      res.json({
        success: true,
        message: "Chiave Gun revocata con successo",
        pubKey,
      });
    } catch (error) {
      console.error("Errore revoca chiave Gun:", error);
      res.status(500).json({
        success: false,
        error: "Errore revoca chiave Gun",
      });
    }
  });

  app.get("/api/authorize-gun-key/:pubKey", async (req, res) => {
    try {
      const { pubKey } = req.params;
      const gun = req.app.get('gunInstance');

      if (!pubKey) {
        return res.status(400).json({
          success: false,
          error: "Chiave pubblica Gun richiesta",
        });
      }

      // Verifica lo stato di autorizzazione
      const authNode = gun.get("shogun").get("authorized_keys").get(pubKey);

      authNode.once((authData) => {
        if (!authData) {
          return res.json({
            success: true,
            authorized: false,
            message: "Chiave non autorizzata",
          });
        }

        const now = Date.now();
        const isExpired = authData.expiresAt && authData.expiresAt < now;

        res.json({
          success: true,
          authorized: authData.authorized && !isExpired,
          authData: {
            pubKey: authData.pubKey,
            userAddress: authData.userAddress,
            authorizedAt: authData.authorizedAt,
            expiresAt: authData.expiresAt,
            authMethod: authData.authMethod,
            isExpired,
          },
        });
      });
    } catch (error) {
      console.error("Errore verifica autorizzazione chiave Gun:", error);
      res.status(500).json({
        success: false,
        error: "Errore verifica autorizzazione chiave Gun",
      });
    }
  });
  
  // --- ROUTE LEGACY ESSENZIALI DAL FILE ORIGINALE ---

  // IPFS API proxy legacy
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
      pathRewrite: { "^/api/v0": "/api/v0" },
      onProxyReq: (proxyReq, req, res) => {
        console.log(`🔗 IPFS Proxy: ${req.method} ${req.path}`);
      },
      onProxyRes: (proxyRes, req, res) => {
        console.log(`✅ IPFS Proxy: ${proxyRes.statusCode} for ${req.path}`);
      },
      onError: (err, req, res) => {
        console.error(`❌ IPFS Proxy Error:`, err.message);
        res.status(500).json({ success: false, error: "IPFS proxy error" });
      },
    })
  );

  // IPFS custom API legacy
  app.post("/ipfs-api/:endpoint(*)", async (req, res) => {
    try {
      const { endpoint } = req.params;
      const url = `${IPFS_API_URL}/api/v0/${endpoint}`;

      console.log(`🔗 IPFS Custom API: POST ${url}`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      });

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("❌ IPFS Custom API Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // IPFS upload legacy
  app.post("/ipfs-upload", async (req, res) => {
    try {
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const token = bearerToken || customToken;

      if (token !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      console.log("📤 IPFS Upload: Processing file upload");

      // Implementazione mock per ora
      res.json({
        success: true,
        hash: "QmMockHash123456789",
        size: 1024,
        message: "File uploaded successfully (mock)",
      });
    } catch (error) {
      console.error("❌ IPFS Upload Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // IPFS status legacy
  app.get("/ipfs-status", async (req, res) => {
    try {
      console.log("📊 IPFS Status: Checking IPFS node status");

      const response = await fetch(`${IPFS_API_URL}/api/v0/version`);

      if (response.ok) {
        const data = await response.json();
        res.json({
          success: true,
          status: "connected",
          version: data.Version,
          apiUrl: IPFS_API_URL,
        });
      } else {
        res.json({
          success: false,
          status: "disconnected",
          error: "IPFS node not responding",
        });
      }
    } catch (error) {
      console.error("❌ IPFS Status Error:", error);
      res.json({
        success: false,
        status: "error",
        error: error.message,
      });
    }
  });

  // Health check legacy
  app.get("/health", (req, res) => {
    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Relay info legacy
  app.get("/api/relay-info", (req, res) => {
    res.json({
      success: true,
      relay: {
        name: process.env.RELAY_NAME || "shogun-relay",
        version: process.env.npm_package_version || "1.0.0",
        host: process.env.RELAY_HOST || "localhost",
        port: process.env.RELAY_PORT || 8765,
        uptime: process.uptime(),
      },
      timestamp: Date.now(),
    });
  });

  // Contract config legacy
  app.get("/api/contract-config", async (req, res) => {
    try {
      const { DEPLOYMENTS } = await import("shogun-contracts/deployments.js");
      const chainId = process.env.CHAIN_ID || "11155111";

      if (!DEPLOYMENTS[chainId]) {
        return res.status(404).json({
          success: false,
          error: `No deployments found for chain ID: ${chainId}`,
        });
      }

      const chainDeployments = DEPLOYMENTS[chainId];
      const contracts = {
        relayPaymentRouter:
          chainDeployments["Relay#RelayPaymentRouter"] || null,
        stealthPool: chainDeployments["Stealth#StealthPool"] || null,
        pairRecovery: chainDeployments["Recovery#PairRecovery"] || null,
        integrity: chainDeployments["Security#Integrity"] || null,
        paymentForwarder: chainDeployments["Stealth#PayamentForwarder"] || null,
        stealthKeyRegistry:
          chainDeployments["Stealth#StealthKeyRegistry"] || null,
        bridgeDex: chainDeployments["Bridge#BridgeDex"] || null,
      };

      res.json({
        success: true,
        chainId: chainId,
        contracts: contracts,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("❌ Contract Config Error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to load contract configuration",
        details: error.message,
      });
    }
  });

  // Contract status legacy
  app.get("/api/contract-status", async (req, res) => {
    try {
      const { ethers } = await import("ethers");
      const { DEPLOYMENTS } = await import("shogun-contracts/deployments.js");

      const chainId = process.env.CHAIN_ID || "11155111";
      const web3ProviderUrl = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;

      if (!process.env.ALCHEMY_API_KEY) {
        return res.json({
          success: false,
          status: "not_configured",
          error: "ALCHEMY_API_KEY not configured",
        });
      }

      const provider = new ethers.JsonRpcProvider(web3ProviderUrl);
      const network = await provider.getNetwork();

      const chainDeployments = DEPLOYMENTS[chainId];
      const relayContract = chainDeployments?.["Relay#RelayPaymentRouter"];

      if (!relayContract) {
        return res.json({
          success: false,
          status: "contract_not_found",
          error: "Relay contract not found in deployments",
        });
      }

      const contract = new ethers.Contract(
        relayContract.address,
        relayContract.abi,
        provider
      );

      // Test basic contract interaction
      try {
        await contract.getFunction("owner")();
        
        res.json({
          success: true,
          status: "connected",
          network: {
            name: network.name,
            chainId: network.chainId.toString(),
          },
          contract: {
            address: relayContract.address,
            name: "RelayPaymentRouter",
            status: "accessible",
          },
        });
      } catch (contractError) {
        res.json({
          success: false,
          status: "contract_error",
          error: contractError.message,
          network: {
            name: network.name,
            chainId: network.chainId.toString(),
          },
          contract: {
            address: relayContract.address,
            name: "RelayPaymentRouter",
            status: "error",
          },
        });
      }
    } catch (error) {
      res.json({
        success: false,
        status: "error",
        error: error.message,
      });
    }
  });

  // --- FINE ROUTE LEGACY ---
  
  // Route di health check
  app.get(`${baseRoute}/health`, (req, res) => {
    res.json({
      success: true,
      message: 'Shogun Relay API is running',
      data: {
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime()
      }
    });
  });
  
  // Route di default per API non trovate
  app.use(`${baseRoute}/*`, (req, res) => {
    res.status(404).json({
      success: false,
      message: 'API endpoint non trovato',
      data: {
        path: req.path,
        method: req.method,
        availableEndpoints: [
          `${baseRoute}/auth/register`,
          `${baseRoute}/auth/login`,
          `${baseRoute}/auth/forgot`,
          `${baseRoute}/auth/reset`,
          `${baseRoute}/auth/change-password`,
          `${baseRoute}/users/profile`,
          `${baseRoute}/users/:pubkey`,
          `${baseRoute}/contracts`,
          `${baseRoute}/contracts/config`,
          `${baseRoute}/contracts/:contractName`,
          `${baseRoute}/user-uploads/:identifier`,
          `${baseRoute}/ipfs/upload`,
          `${baseRoute}/ipfs/status`,
          `${baseRoute}/ipfs/content/:cid`,
          `${baseRoute}/system/health`,
          `${baseRoute}/system/stats`,
          `${baseRoute}/notes`,
          `${baseRoute}/debug/mb-usage/:userAddress`,
          `${baseRoute}/subscriptions/subscription-status/:identifier`,
          `${baseRoute}/subscriptions/user-subscription-details/:userAddress`,
          `${baseRoute}/services/s3-stats`,
          `${baseRoute}/services/:service/restart`,
          `${baseRoute}/health`
        ]
      }
    });
  });

  // Endpoint per resettare l'utilizzo MB di un utente (solo per debug/admin)
  app.post("/api/user-mb-usage/:identifier/reset", async (req, res) => {
    try {
      const { identifier } = req.params;
      if (!identifier) {
        return res
          .status(400)
          .json({ success: false, error: "Identificatore richiesto" });
      }

      console.log(`🔄 MB usage reset request for user: ${identifier}`);

      // Verifica che sia una richiesta admin
      const adminToken = req.headers.authorization?.replace("Bearer ", "");
      if (!adminToken || adminToken !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({
          success: false,
          error: "Admin token required for MB reset",
        });
      }

      const gun = req.app.get('gunInstance');
      const getOffChainMBUsage = req.app.get('getOffChainMBUsage');

      // Ottieni l'utilizzo MB corrente prima del reset
      const previousMBUsed = getOffChainMBUsage ? await getOffChainMBUsage(identifier) : 0;

      // Reset dell'utilizzo MB
      const mbUsageNode = gun.get("shogun").get("mb_usage").get(identifier);

      const resetPromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("MB reset timeout"));
        }, 10000);

        const resetData = {
          mbUsed: 0,
          lastUpdated: Date.now(),
          updatedBy: "admin-reset",
          resetAt: Date.now(),
        };

        mbUsageNode.put(resetData, (ack) => {
          clearTimeout(timeoutId);
          if (ack.err) {
            reject(new Error(`MB reset error: ${ack.err}`));
          } else {
            console.log(`✅ MB usage reset for user: ${identifier}`);
            resolve(ack);
          }
        });
      });

      await resetPromise;

      res.json({
        success: true,
        message: "MB usage reset successfully",
        identifier,
        reset: {
          previousMBUsed,
          resetAt: Date.now(),
        },
      });
    } catch (error) {
      console.error("MB reset error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Fallback to index.html per tutte le altre route
  app.get("/*", (req, res) => {
    const publicPath = path.resolve(__dirname, '../public');
    const indexPath = path.resolve(publicPath, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send("Index file not found");
    }
  });
}; 