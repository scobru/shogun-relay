// Enhanced Gun relay server with Shogun improvements
// MUST be required after Gun to work

import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import ip from "ip";
import qr from "qr";
import setSelfAdjustingInterval from "self-adjusting-interval";
import FormData from "form-data";
import "./utils/bullet-catcher.js";
import Docker from "dockerode";
import { ethers } from "ethers";

dotenv.config();

import Gun from "gun";
import "gun/sea.js";
import "gun/lib/stats.js";
import "gun/lib/webrtc.js";
import "gun/lib/rfs.js";

import ShogunCoreModule from "shogun-core";
const { derive, SEA } = ShogunCoreModule;
import http from "http";
import { createProxyMiddleware } from "http-proxy-middleware";
import multer from "multer";

const namespace = "shogun";

// --- IPFS Configuration ---
const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";

// --- Garbage Collection Configuration ---
const GC_ENABLED = process.env.GC_ENABLED === "true";
// Namespaces to protect from garbage collection.
const GC_EXCLUDED_NAMESPACES = [
  // --- CRITICAL GUN METADATA ---
  "~", // Protects all user spaces, including user data and aliases (~@username).
  "!", // Protects the root node, often used for system-level pointers.
  "relays", // Protects relay server health-check data.
  "shogun",
];
// How often to run the garbage collector (milliseconds).
const GC_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ES Module equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Port testing function
const testPort = (port) => {
  return new Promise((resolve, reject) => {
    const server = express()
      .listen(port, () => {
        server.close(() => resolve(true));
      })
      .on("error", () => resolve(false));
  });
};

// Configuration
let host = process.env.RELAY_HOST || ip.address();
let store = process.env.RELAY_STORE !== "false";
// Ensure port is always a valid integer, fallback to 8765 if NaN
let port = parseInt(process.env.RELAY_PORT || process.env.PORT || 8765);
if (isNaN(port) || port <= 0 || port >= 65536) {
  console.warn(
    `⚠️ Invalid port detected: ${
      process.env.RELAY_PORT || process.env.PORT
    }, falling back to 8765`
  );
  port = 8765;
}
let path_public = process.env.RELAY_PATH || "public";
let showQr = process.env.RELAY_QR !== "false";

// --- Config per smart contract ---
const WEB3_PROVIDER_URL = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`; // Sepolia
const RELAY_CONTRACT_ADDRESS = process.env.RELAY_CONTRACT_ADDRESS;
let relayContract;
let provider;
let relayAbi = [
  "function checkUserSubscription(address _user) external view returns (bool)",
  "function isSubscriptionActive(address _user, address _relayAddress) external view returns (bool)",
  "function getSubscriptionDetails(address _user, address _relayAddress) external view returns (uint256 startTime, uint256 endTime, uint256 amountPaid, bool isActive)",
  "function getRelayDetails(address _relayAddress) external view returns (string memory url, address relayAddress, bool isActive, uint256 registeredAt)",
  "function registerRelay(string memory _url) external",
  "function deactivateRelay() external",
];
if (RELAY_CONTRACT_ADDRESS) {
  provider = new ethers.JsonRpcProvider(WEB3_PROVIDER_URL);
  relayContract = new ethers.Contract(
    RELAY_CONTRACT_ADDRESS,
    relayAbi,
    provider
  );
}

// Middleware per autorizzazione smart contract
const relayContractAuthMiddleware = async (req, res, next) => {
  try {
    const userAddress = req.headers["x-user-address"];
    const pubKey = req.headers["x-pubkey"];

    if (!userAddress && !pubKey) {
      return res.status(401).json({
        success: false,
        error: "x-user-address o x-pubkey header richiesto",
      });
    }

    if (!relayContract) {
      return res
        .status(500)
        .json({ success: false, error: "Relay contract non configurato" });
    }

    let isAuth = false;
    let authMethod = null;

    // Se abbiamo un indirizzo utente, verifica la sottoscrizione tramite smart contract
    if (userAddress) {
      try {
        isAuth = await relayContract.checkUserSubscription(userAddress);
        authMethod = "smart_contract_address";
        console.log(
          `🔐 Autorizzazione smart contract per indirizzo: ${userAddress} - ${
            isAuth ? "AUTORIZZATO" : "NON AUTORIZZATO"
          }`
        );
      } catch (e) {
        console.error("Errore verifica sottoscrizione smart contract:", e);
        return res
          .status(500)
          .json({ success: false, error: "Errore chiamata contratto" });
      }
    }

    // Se abbiamo solo una pubkey, per ora non autorizziamo
    // (in futuro potrebbe essere implementato un mapping pubkey -> address)
    if (pubKey && !userAddress) {
      return res.status(401).json({
        success: false,
        error: "Indirizzo Ethereum richiesto per autorizzazione smart contract",
        details:
          "La chiave Gun viene usata solo per identificazione, ma serve l'indirizzo Ethereum per verificare la sottoscrizione",
      });
    }

    if (!isAuth) {
      return res.status(403).json({
        success: false,
        error: "Utente non autorizzato - sottoscrizione non attiva",
        details: {
          userAddress: userAddress
            ? `${userAddress.slice(0, 6)}...${userAddress.slice(-4)}`
            : null,
          pubKey: pubKey ? `${pubKey.slice(0, 10)}...` : null,
          authMethod: authMethod,
        },
      });
    }

    req.userAddress = userAddress;
    req.userPubKey = pubKey;
    req.authMethod = authMethod;
    next();
  } catch (err) {
    console.error("Errore middleware smart contract:", err);
    return res
      .status(500)
      .json({ success: false, error: "Errore middleware smart contract" });
  }
};

// Main async function to initialize the server
async function initializeServer() {
  console.clear();
  console.log("=== GUN-VUE RELAY SERVER ===\n");

  // Enhanced stats tracking with time-series data
  let customStats = {
    getRequests: 0,
    putRequests: 0,
    startTime: Date.now(),
    timeSeries: {
      // Store last 100 data points for each metric
      maxPoints: 100,
      data: {
        "peers#": [],
        memory: [],
        "gets/s": [],
        "puts/s": [],
        "cpu%": [],
      },
    },
  };

  // Function to add time-series data point
  function addTimeSeriesPoint(key, value) {
    const timestamp = Date.now();
    const series = customStats.timeSeries.data[key];
    if (!series) {
      customStats.timeSeries.data[key] = [];
    }

    customStats.timeSeries.data[key].push([timestamp, value]);

    // Keep only the last maxPoints
    if (
      customStats.timeSeries.data[key].length > customStats.timeSeries.maxPoints
    ) {
      customStats.timeSeries.data[key].shift();
    }
  }

  // Track rates per second
  let lastGetCount = 0;
  let lastPutCount = 0;
  let lastTimestamp = Date.now();

  // --- Garbage Collection Service ---
  function runGarbageCollector() {
    if (!GC_ENABLED) {
      console.log("🗑️ Garbage Collector is disabled.");
      return;
    }
    console.log("🗑️ Running Garbage Collector...");
    let cleanedCount = 0;

    // Ensure gun is initialized before accessing its properties
    if (!gun || !gun._ || !gun._.graph) {
      console.warn("⚠️ Gun not initialized yet, skipping garbage collection");
      return;
    }

    const graph = gun._.graph;

    for (const soul in graph) {
      if (Object.prototype.hasOwnProperty.call(graph, soul)) {
        const isProtected = GC_EXCLUDED_NAMESPACES.some((ns) =>
          soul.startsWith(ns)
        );

        if (!isProtected) {
          gun.get(soul).put(null);
          cleanedCount++;
          console.log(`🗑️ Cleaned up unprotected node: ${soul}`);
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(
        `🗑️ Garbage Collector finished. Cleaned ${cleanedCount} unprotected nodes.`
      );
    } else {
      console.log(
        "🗑️ Garbage Collector finished. No unprotected nodes found to clean."
      );
    }
  }

  // Store GC interval reference for cleanup
  let gcInterval = null;

  // Schedule the garbage collector to run periodically (after gun is initialized)
  function initializeGarbageCollector() {
    if (GC_ENABLED) {
      gcInterval = setInterval(runGarbageCollector, GC_INTERVAL);
      console.log(
        `✅ Garbage Collector scheduled to run every ${
          GC_INTERVAL / 1000 / 60
        } minutes.`
      );
      // Run once on startup after a delay
      setTimeout(runGarbageCollector, 30 * 1000); // Run 30s after start
    }
  }

  // Flag per permettere operazioni interne durante REST API
  let allowInternalOperations = false;

  function hasValidToken(msg) {
    if (process.env.RELAY_PROTECTED === "false") {
      console.log("🔍 PUT allowed - protected disabled");
      return true;
    }

    // Analizza le anime (souls) che sta cercando di modificare
    const souls = Object.keys(msg.put || {});
    const firstSoul = souls[0];

    // Permetti operazioni temporanee durante REST API
    if (allowInternalOperations) {
      console.log(`🔍 PUT allowed - internal operation flag: ${firstSoul}`);
      return true;
    }

    // Permetti operazioni interne di Gun senza autenticazione
    const isInternalNamespace =
      firstSoul &&
      (firstSoul.startsWith("~") || // User namespace
        firstSoul.startsWith("!") || // Root namespace
        firstSoul === "shogun" || // Shogun internal operations
        firstSoul.startsWith("shogun/relays") || // Relay health data
        !firstSoul.includes("/") || // Single level keys (internal Gun operations)
        firstSoul.match(
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/
        )); // UUID souls

    if (isInternalNamespace) {
      console.log(`🔍 PUT allowed - internal namespace: ${firstSoul}`);
      return true;
    }

    // Se ha headers, verifica il token
    if (msg && msg.headers && msg.headers.token) {
      const hasValidAuth =
        msg.headers.token === process.env.ADMIN_PASSWORD ||
        msg.headers.Authorization === `Bearer ${process.env.ADMIN_PASSWORD}`;

      if (hasValidAuth) {
        console.log(`✅ PUT allowed - valid auth for: ${firstSoul}`);
        return true;
      } else {
        console.log(`🚫 PUT blocked - invalid token: ${firstSoul}`);
        return false;
      }
    } else {
      console.log(`🚫 PUT blocked - No headers: ${firstSoul}`);
      return false;
    }
  }

  const app = express();
  const publicPath = path.resolve(__dirname, path_public);
  const indexPath = path.resolve(publicPath, "index.html");

  // Middleware
  app.use(cors());
  app.use(Gun.serve);
  app.use(express.static(publicPath));

  // IPFS File Upload Endpoint
  const upload = multer({ storage: multer.memoryStorage() });
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

  // IPFS File Upload Endpoint (Consolidated and Fixed)
  app.post(
    "/ipfs-upload",
    tokenAuthMiddleware,
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: "No file provided",
          });
        }

        const formData = new FormData();
        formData.append("file", req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype,
        });

        const requestOptions = {
          hostname: "127.0.0.1",
          port: 5001,
          path: "/api/v0/add?wrap-with-directory=false",
          method: "POST",
          headers: {
            ...formData.getHeaders(),
          },
        };

        const IPFS_API_TOKEN =
          process.env.IPFS_API_TOKEN || process.env.IPFS_API_KEY;
        if (IPFS_API_TOKEN) {
          requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
        }

        const ipfsReq = http.request(requestOptions, (ipfsRes) => {
          let data = "";
          ipfsRes.on("data", (chunk) => (data += chunk));
          ipfsRes.on("end", () => {
            console.log("📤 IPFS Upload raw response:", data);

            try {
              const lines = data.trim().split("\n");
              const results = lines.map((line) => JSON.parse(line));
              const fileResult =
                results.find((r) => r.Name === req.file.originalname) ||
                results[0];

              res.json({
                success: true,
                file: {
                  name: req.file.originalname,
                  customName: req.body.customName || undefined, // Add customName here
                  size: req.file.size,
                  mimetype: req.file.mimetype,
                  hash: fileResult?.Hash,
                  ipfsUrl: `${req.protocol}://${req.get("host")}/ipfs-content/${
                    fileResult?.Hash
                  }`,
                  gatewayUrl: `${IPFS_GATEWAY_URL}/ipfs/${fileResult?.Hash}`,
                  publicGateway: `https://ipfs.io/ipfs/${fileResult?.Hash}`,
                },
                ipfsResponse: results,
              });
            } catch (parseError) {
              console.error("Upload parse error:", parseError);
              res.status(500).json({
                success: false,
                error: "Failed to parse IPFS response",
                rawResponse: data,
                parseError: parseError.message,
              });
            }
          });
        });

        ipfsReq.on("error", (err) => {
          console.error("❌ IPFS Upload error:", err);
          res.status(500).json({ success: false, error: err.message });
        });

        ipfsReq.setTimeout(30000, () => {
          ipfsReq.destroy();
          if (!res.headersSent) {
            res.status(408).json({ success: false, error: "Upload timeout" });
          }
        });

        formData.pipe(ipfsReq);
      } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Endpoint upload IPFS per utenti smart contract
  app.post(
    "/ipfs-upload-user",
    relayContractAuthMiddleware,
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res
            .status(400)
            .json({ success: false, error: "No file provided" });
        }
        const formData = new FormData();
        formData.append("file", req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype,
        });
        const requestOptions = {
          hostname: "127.0.0.1",
          port: 5001,
          path: "/api/v0/add?wrap-with-directory=false",
          method: "POST",
          headers: {
            ...formData.getHeaders(),
          },
        };
        if (IPFS_API_TOKEN) {
          requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
        }
        const ipfsReq = http.request(requestOptions, (ipfsRes) => {
          let data = "";
          ipfsRes.on("data", (chunk) => (data += chunk));
          ipfsRes.on("end", async () => {
            try {
              const lines = data.trim().split("\n");
              const results = lines.map((line) => JSON.parse(line));
              const fileResult =
                results.find((r) => r.Name === req.file.originalname) ||
                results[0];

              // Salva l'upload nel database Gun
              const uploadData = {
                hash: fileResult?.Hash,
                name: req.file.originalname,
                size: req.file.size,
                sizeMB: +(req.file.size / 1024 / 1024).toFixed(2),
                mimetype: req.file.mimetype,
                uploadedAt: Date.now(),
                userAddress: req.userAddress,
                pubKey: req.userPubKey,
                ipfsUrl: `${req.protocol}://${req.get("host")}/ipfs-content/${
                  fileResult?.Hash
                }`,
                gatewayUrl: `${IPFS_GATEWAY_URL}/ipfs/${fileResult?.Hash}`,
                publicGateway: `https://ipfs.io/ipfs/${fileResult?.Hash}`,
              };

              // Salva nel database Gun sotto shogun/uploads/{userAddress}/{hash}
              const uploadNode = gun
                .get("shogun")
                .get("uploads")
                .get(req.userAddress || req.userPubKey)
                .get(fileResult?.Hash);
              uploadNode.put(uploadData);

              res.json({
                success: true,
                file: {
                  name: req.file.originalname,
                  size: req.file.size,
                  sizeMB: +(req.file.size / 1024 / 1024).toFixed(2),
                  mimetype: req.file.mimetype,
                  hash: fileResult?.Hash,
                  ipfsUrl: `${req.protocol}://${req.get("host")}/ipfs-content/${
                    fileResult?.Hash
                  }`,
                  gatewayUrl: `${IPFS_GATEWAY_URL}/ipfs/${fileResult?.Hash}`,
                  publicGateway: `https://ipfs.io/ipfs/${fileResult?.Hash}`,
                },
                user: {
                  address: req.userAddress,
                  pubKey: req.userPubKey,
                },
                ipfsResponse: results,
              });
            } catch (parseError) {
              res.status(500).json({
                success: false,
                error: "Failed to parse IPFS response",
                rawResponse: data,
              });
            }
          });
        });
        ipfsReq.on("error", (err) => {
          res.status(500).json({ success: false, error: err.message });
        });
        ipfsReq.setTimeout(30000, () => {
          ipfsReq.destroy();
          if (!res.headersSent) {
            res.status(408).json({ success: false, error: "Upload timeout" });
          }
        });
        formData.pipe(ipfsReq);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Endpoint per recuperare gli upload di un utente
  app.get("/api/user-uploads/:identifier", async (req, res) => {
    try {
      const { identifier } = req.params;
      if (!identifier) {
        return res
          .status(400)
          .json({ success: false, error: "Identificatore richiesto" });
      }

      // Recupera gli upload dal database Gun
      const uploadsNode = gun.get("shogun").get("uploads").get(identifier);

      // Usa once per ottenere i dati una volta
      uploadsNode.once((uploads) => {
        if (!uploads) {
          return res.json({ success: true, uploads: [], identifier });
        }

        // Converte l'oggetto uploads in array
        const uploadsArray = Object.keys(uploads)
          .filter((key) => key !== "_") // Esclude i metadati Gun
          .map((hash) => uploads[hash])
          .filter((upload) => upload && upload.hash) // Filtra upload validi
          .sort((a, b) => b.uploadedAt - a.uploadedAt); // Ordina per data

        res.json({
          success: true,
          uploads: uploadsArray,
          identifier,
          count: uploadsArray.length,
          totalSizeMB: uploadsArray.reduce(
            (sum, upload) => sum + (upload.sizeMB || 0),
            0
          ),
        });
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Endpoint per eliminare un upload specifico
  app.delete("/api/user-uploads/:identifier/:hash", async (req, res) => {
    try {
      const { identifier, hash } = req.params;
      if (!identifier || !hash) {
        return res
          .status(400)
          .json({ success: false, error: "Identificatore e hash richiesti" });
      }

      // Elimina l'upload dal database Gun
      const uploadNode = gun
        .get("shogun")
        .get("uploads")
        .get(identifier)
        .get(hash);
      uploadNode.put(null);

      res.json({
        success: true,
        message: "Upload eliminato con successo",
        identifier,
        hash,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Endpoint per registrare una chiave Gun autorizzata
  app.post("/api/authorize-gun-key", tokenAuthMiddleware, async (req, res) => {
    try {
      const { pubKey, userAddress, expiresAt } = req.body;

      if (!pubKey) {
        return res.status(400).json({
          success: false,
          error: "Chiave pubblica Gun richiesta",
        });
      }

      // Verifica che l'utente abbia una sottoscrizione attiva
      if (userAddress && relayContract) {
        try {
          const isSubscribed = await relayContract.checkUserSubscription(
            userAddress
          );
          if (!isSubscribed) {
            return res.status(403).json({
              success: false,
              error: "Utente non ha una sottoscrizione attiva",
            });
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

  // Endpoint per revocare una chiave Gun autorizzata
  app.delete(
    "/api/authorize-gun-key/:pubKey",
    tokenAuthMiddleware,
    async (req, res) => {
      try {
        const { pubKey } = req.params;

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
    }
  );

  // Endpoint per verificare lo stato di autorizzazione di una chiave Gun
  app.get("/api/authorize-gun-key/:pubKey", async (req, res) => {
    try {
      const { pubKey } = req.params;

      if (!pubKey) {
        return res.status(400).json({
          success: false,
          error: "Chiave pubblica Gun richiesta",
        });
      }

      // Verifica lo stato della chiave
      const authNode = gun.get("shogun").get("authorized_keys").get(pubKey);

      authNode.once((authData) => {
        if (!authData) {
          return res.json({
            success: true,
            authorized: false,
            message: "Chiave non trovata",
          });
        }

        const isExpired = authData.expiresAt < Date.now();
        const isAuthorized = authData.authorized && !isExpired;

        res.json({
          success: true,
          authorized: isAuthorized,
          data: {
            pubKey: authData.pubKey,
            userAddress: authData.userAddress,
            authorizedAt: authData.authorizedAt,
            expiresAt: authData.expiresAt,
            expiresAtFormatted: new Date(authData.expiresAt).toISOString(),
            authMethod: authData.authMethod,
            isExpired,
          },
          message: isAuthorized
            ? "Chiave autorizzata"
            : isExpired
            ? "Chiave scaduta"
            : "Chiave non autorizzata",
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

  // Connection tracking
  let totalConnections = 0;
  let activeWires = 0;

  // --- Middleware ---
  app.use(cors()); // Allow all cross-origin requests
  app.use(express.json());

  console.log("ADMIN_PASSWORD", process.env.ADMIN_PASSWORD);

  // --- IPFS Desktop Proxy Configuration ---
  const IPFS_GATEWAY_URL =
    process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";
  const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN || process.env.IPFS_API_KEY;

  console.log(`🌐 IPFS API Proxy: ${IPFS_API_URL}`);
  console.log(`🌐 IPFS Gateway Proxy: ${IPFS_GATEWAY_URL}`);
  console.log(`🔐 IPFS Auth: ${IPFS_API_TOKEN ? "configured" : "not set"}`);

  // Test IPFS connectivity on startup
  console.log("🧪 Testing IPFS connectivity...");
  const testIPFSConnection = () => {
    return new Promise((resolve) => {
      const testReq = http
        .get(`${IPFS_API_URL}/api/v0/version`, (response) => {
          if (response.statusCode === 200 || response.statusCode === 405) {
            console.log("✅ IPFS node is responsive");
            resolve(true);
          } else {
            console.log(
              `⚠️ IPFS node responded with status ${response.statusCode}`
            );
            resolve(false);
          }
        })
        .on("error", (err) => {
          console.log(`❌ IPFS node unreachable: ${err.message}`);
          console.log(
            "💡 Make sure IPFS Desktop is running or IPFS daemon is started"
          );
          resolve(false);
        });

      testReq.setTimeout(3000, () => {
        testReq.destroy();
        console.log("⏰ IPFS connection test timed out");
        resolve(false);
      });

      testReq.end();
    });
  };

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

  // --- Start Server Function ---
  async function startServer() {
    // Test and find available port
    let currentPort = parseInt(port);
    while (!(await testPort(currentPort))) {
      console.log(`Port ${currentPort} in use, trying next...`);
      currentPort++;
    }

    const server = app.listen(currentPort, (error) => {
      if (error) {
        return console.log("Error during app startup", error);
      }
      console.log(`Server listening on port ${currentPort}...`);
    });

    port = currentPort; // Update port for later use
    return server;
  }

  const server = await startServer();

  const peersString = process.env.RELAY_PEERS;
  const peers = peersString ? peersString.split(",") : [];
  console.log("🔍 Peers:", peers);

  // Initialize Gun with conditional support
  const gunConfig = {
    super: false,
    file: "radata",
    radisk: true,
    web: server,
    isValid: hasValidToken,
    uuid: process.env.RELAY_NAME,
    localStorage: false,
    wire: true,
    axe: true,
    rfs: true,
    wait: 500,
    webrtc: true,
    peers: peers,
  };

  console.log("📁 Using local file storage only");

  Gun.on("opt", function (ctx) {
    if (ctx.once) {
      return;
    }
    ctx.on("out", function (msg) {
      var to = this.to;
      // Adds headers for put
      msg.headers = {
        token: process.env.ADMIN_PASSWORD,
      };
      to.next(msg); // pass to next middleware
    });
  });

  const gun = Gun(gunConfig);

  // Initialize garbage collector now that gun is ready
  initializeGarbageCollector();

  // Set up relay stats database
  const db = gun.get(namespace).get("relays").get(host);

  gun.on("hi", () => {
    totalConnections += 1;
    activeWires += 1;
    db?.get("totalConnections").put(totalConnections);
    db?.get("activeWires").put(activeWires);
    console.log(`Connection opened (active: ${activeWires})`);
  });

  gun.on("bye", () => {
    activeWires -= 1;
    db?.get("activeWires").put(activeWires);
    console.log(`Connection closed (active: ${activeWires})`);
  });

  gun.on("out", { get: { "#": { "*": "" } } });

  // Set up pulse interval for health monitoring
  setSelfAdjustingInterval(() => {
    db?.get("pulse").put(Date.now());
  }, 10000);

  // Collect time-series data every 5 seconds
  setSelfAdjustingInterval(() => {
    const now = Date.now();
    const timeDiff = (now - lastTimestamp) / 1000; // seconds

    // Calculate rates per second
    const getRate = Math.max(
      0,
      (customStats.getRequests - lastGetCount) / timeDiff
    );
    const putRate = Math.max(
      0,
      (customStats.putRequests - lastPutCount) / timeDiff
    );

    // Update time-series data
    addTimeSeriesPoint("peers#", activeWires);
    addTimeSeriesPoint("memory", process.memoryUsage().heapUsed / 1024 / 1024); // MB
    addTimeSeriesPoint("gets/s", getRate);
    addTimeSeriesPoint("puts/s", putRate);

    // Update counters
    lastGetCount = customStats.getRequests;
    lastPutCount = customStats.putRequests;
    lastTimestamp = now;
  }, 5000);

  // Store relay information
  const link = "http://" + host + (port ? ":" + port : "");
  const extLink = "https://" + host;

  db?.get("host").put(host);
  db?.get("port").put(port);
  db?.get("link").put(link);
  db?.get("ext-link").put(extLink);
  db?.get("store").put(store);
  db?.get("status").put("running");
  db?.get("started").put(Date.now());

  // IPFS API Proxy - for API calls to the IPFS node
  // Example: /api/v0/add, /api/v0/cat, etc.
  // SECURED: This generic proxy requires the admin token for any access.
  app.use(
    "/api/v0",
    tokenAuthMiddleware,
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

  // Custom IPFS API endpoints with better error handling
  app.post("/ipfs-api/:endpoint(*)", async (req, res) => {
    try {
      const endpoint = req.params.endpoint;
      const requestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: `/api/v0/${endpoint}`,
        method: "POST",
        headers: {
          "Content-Length": "0",
        },
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        let data = "";
        ipfsRes.on("data", (chunk) => (data += chunk));
        ipfsRes.on("end", () => {
          console.log(`📡 IPFS API ${endpoint} raw response:`, data);

          try {
            // Try to parse as JSON
            const jsonData = JSON.parse(data);
            res.json({
              success: true,
              endpoint: endpoint,
              data: jsonData,
            });
          } catch (parseError) {
            // If not JSON, check if it's a structured response
            if (data.trim()) {
              // Try to clean the response
              const cleanData = data.replace(/^\uFEFF/, ""); // Remove BOM
              try {
                const jsonData = JSON.parse(cleanData);
                res.json({
                  success: true,
                  endpoint: endpoint,
                  data: jsonData,
                });
              } catch (cleanParseError) {
                res.json({
                  success: false,
                  endpoint: endpoint,
                  error: "Invalid JSON response",
                  rawResponse: data,
                  parseError: cleanParseError.message,
                });
              }
            } else {
              res.json({
                success: false,
                endpoint: endpoint,
                error: "Empty response",
                rawResponse: data,
              });
            }
          }
        });
      });

      ipfsReq.on("error", (err) => {
        console.error(`❌ IPFS API ${endpoint} error:`, err);
        res.status(500).json({
          success: false,
          endpoint: endpoint,
          error: err.message,
        });
      });

      ipfsReq.setTimeout(10000, () => {
        ipfsReq.destroy();
        if (!res.headersSent) {
          res.status(408).json({
            success: false,
            endpoint: endpoint,
            error: "Request timeout",
          });
        }
      });

      ipfsReq.end();
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // IPFS File Upload endpoint
  app.post(
    "/ipfs-upload",
    tokenAuthMiddleware,
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({
            success: false,
            error: "No file provided",
          });
        }

        const formData = new FormData();
        formData.append("file", req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype,
        });

        const requestOptions = {
          hostname: "127.0.0.1",
          port: 5001,
          path: "/api/v0/add?wrap-with-directory=false",
          method: "POST",
          headers: {
            ...formData.getHeaders(),
          },
        };

        if (IPFS_API_TOKEN) {
          requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
        }

        const ipfsReq = http.request(requestOptions, (ipfsRes) => {
          let data = "";
          ipfsRes.on("data", (chunk) => (data += chunk));
          ipfsRes.on("end", () => {
            console.log("📤 IPFS Upload raw response:", data);

            try {
              const lines = data.trim().split("\n");
              const results = lines.map((line) => JSON.parse(line));
              const fileResult =
                results.find((r) => r.Name === req.file.originalname) ||
                results[0];

              res.json({
                success: true,
                file: {
                  name: req.file.originalname,
                  size: req.file.size,
                  mimetype: req.file.mimetype,
                  hash: fileResult?.Hash,
                  ipfsUrl: `${req.protocol}://${req.get("host")}/ipfs-content/${
                    fileResult?.Hash
                  }`,
                  gatewayUrl: `${IPFS_GATEWAY_URL}/ipfs/${fileResult?.Hash}`,
                  publicGateway: `https://ipfs.io/ipfs/${fileResult?.Hash}`,
                },
                ipfsResponse: results,
              });
            } catch (parseError) {
              console.error("Upload parse error:", parseError);
              res.status(500).json({
                success: false,
                error: "Failed to parse IPFS response",
                rawResponse: data,
                parseError: parseError.message,
              });
            }
          });
        });

        ipfsReq.on("error", (err) => {
          console.error("❌ IPFS Upload error:", err);
          res.status(500).json({ success: false, error: err.message });
        });

        ipfsReq.setTimeout(30000, () => {
          ipfsReq.destroy();
          if (!res.headersSent) {
            res.status(408).json({ success: false, error: "Upload timeout" });
          }
        });

        formData.pipe(ipfsReq);
      } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Custom IPFS status endpoint
  app.get("/ipfs-status", async (req, res) => {
    try {
      // Create request options with authentication
      const requestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/version",
        method: "POST", // IPFS API requires POST method
        headers: {
          "Content-Length": "0",
        },
      };

      // Add authentication if available
      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const testReq = http
        .request(requestOptions, (ipfsRes) => {
          let data = "";
          ipfsRes.on("data", (chunk) => (data += chunk));
          ipfsRes.on("end", () => {
            console.log("IPFS Raw Response:", data);

            try {
              // Try to parse as JSON first
              const versionInfo = JSON.parse(data);
              res.json({
                success: true,
                status: "connected",
                ipfs: {
                  version: versionInfo.Version,
                  commit: versionInfo.Commit,
                  repo: versionInfo.Repo,
                  system: versionInfo.System,
                  golang: versionInfo.Golang,
                },
                endpoints: {
                  api: IPFS_API_URL,
                  gateway: IPFS_GATEWAY_URL,
                },
              });
            } catch (parseError) {
              // If not JSON, check if it's Kubo text response
              if (data.includes("Kubo RPC")) {
                // Parse Kubo text response
                const lines = data.split("\n");
                let version = "unknown";

                for (const line of lines) {
                  if (line.includes("Kubo version:")) {
                    version = line.replace("Kubo version:", "").trim();
                    break;
                  }
                }

                res.json({
                  success: true,
                  status: "connected",
                  ipfs: {
                    version: version,
                    type: "Kubo",
                    rawResponse: data,
                  },
                  endpoints: {
                    api: IPFS_API_URL,
                    gateway: IPFS_GATEWAY_URL,
                  },
                });
              } else {
                res.json({
                  success: false,
                  status: "connected_but_invalid_response",
                  error: parseError.message,
                  rawResponse: data,
                  endpoints: {
                    api: IPFS_API_URL,
                    gateway: IPFS_GATEWAY_URL,
                  },
                });
              }
            }
          });
        })
        .on("error", (err) => {
          console.error("IPFS Connection Error:", err);
          res.json({
            success: false,
            status: "disconnected",
            error: err.message,
            endpoints: {
              api: IPFS_API_URL,
              gateway: IPFS_GATEWAY_URL,
            },
          });
        });

      testReq.setTimeout(5000, () => {
        testReq.destroy();
        if (!res.headersSent) {
          res.json({
            success: false,
            status: "timeout",
            error: "IPFS node did not respond within 5 seconds",
          });
        }
      });

      testReq.end();
    } catch (error) {
      res.status(500).json({
        success: false,
        status: "error",
        error: error.message,
      });
    }
  });

  // --- API Routes ---

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({
      status: "healthy",
      uptime: process.uptime() * 1000,
      activeConnections: activeWires,
      totalConnections: totalConnections,
      memoryUsage: process.memoryUsage(),
      timestamp: Date.now(),
    });
  });

  // API endpoint to provide relay configuration details
  app.get("/api/relay-info", (req, res) => {
    res.json({
      success: true,
      name: process.env.RELAY_NAME || "Shogun Relay Control Panel",
    });
  });

  // All data endpoint - reads directly from the live in-memory graph.
  app.get("/api/alldata", tokenAuthMiddleware, (req, res) => {
    try {
      // Access the live, in-memory graph from the Gun instance
      let graphData = gun._.graph;

      // If the graph contains a `!` node, which typically holds the root,
      // use its contents as the main graph.
      if (graphData && graphData["!"]) {
        console.log("Found '!' node in live graph, using it as the root.");
        graphData = graphData["!"];
      }

      // Clean the graph data for serialization (remove circular `_` metadata)
      const cleanGraph = {};
      for (const soul in graphData) {
        if (Object.prototype.hasOwnProperty.call(graphData, soul)) {
          const node = graphData[soul];
          const cleanNode = {};
          for (const key in node) {
            if (key !== "_") {
              cleanNode[key] = node[key];
            }
          }
          cleanGraph[soul] = cleanNode;
        }
      }

      res.json({
        success: true,
        data: cleanGraph,
        rawSize: JSON.stringify(cleanGraph).length,
        nodeCount: Object.keys(cleanGraph).length,
      });
    } catch (error) {
      console.error("Error reading live graph data:", error);
      res.status(500).json({
        success: false,
        error: "Failed to read data from live graph: " + error.message,
      });
    }
  });

  // Enhanced stats endpoint with time-series data
  app.get("/api/stats", (req, res) => {
    try {
      const now = Date.now();
      const uptime = now - customStats.startTime;
      const memUsage = process.memoryUsage();

      // Calculate current rates
      const timeDiff = Math.max(1, (now - lastTimestamp) / 1000);
      const currentGetRate =
        (customStats.getRequests - lastGetCount) / timeDiff;
      const currentPutRate =
        (customStats.putRequests - lastPutCount) / timeDiff;

      const cleanStats = {
        peers: {
          count: activeWires,
          time: uptime / 1000 / 60, // minutes
        },
        node: {
          count: Object.keys(customStats.timeSeries.data).length,
          memory: {
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external,
          },
        },
        up: {
          time: uptime,
        },
        memory: memUsage.heapUsed,
        dam: {
          in: {
            count: customStats.getRequests,
            rate: currentGetRate,
          },
          out: {
            count: customStats.putRequests,
            rate: currentPutRate,
          },
        },
        rad: {
          get: { count: customStats.getRequests },
          put: { count: customStats.putRequests },
        },
        // Time-series data for charts
        all: customStats.timeSeries.data,
        over: 5, // Update interval in seconds
      };

      res.json({ success: true, ...cleanStats });
    } catch (error) {
      console.error("Error in /api/stats:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to retrieve stats." });
    }
  });

  // New endpoint to trigger garbage collection manually
  app.post("/api/gc/trigger", tokenAuthMiddleware, (req, res) => {
    try {
      if (!GC_ENABLED) {
        return res.status(400).json({
          success: false,
          error: "Garbage collector is disabled in configuration",
        });
      }

      console.log("🗑️ Manual garbage collection triggered via API");
      runGarbageCollector();

      res.json({
        success: true,
        message: "Garbage collection triggered successfully",
      });
    } catch (error) {
      console.error("Error triggering garbage collection:", error);
      res.status(500).json({
        success: false,
        error: "Failed to trigger garbage collection: " + error.message,
      });
    }
  });

  // New endpoint to update stats values
  app.post("/api/stats/update", tokenAuthMiddleware, (req, res) => {
    try {
      const { key, value } = req.body;

      if (!key || value === undefined) {
        return res.status(400).json({
          success: false,
          error: "Both key and value are required",
        });
      }

      // Add validation for allowed keys
      const allowedKeys = ["getRequests", "putRequests"];
      if (!allowedKeys.includes(key)) {
        return res.status(400).json({
          success: false,
          error: `Invalid key. Allowed keys are: ${allowedKeys.join(", ")}`,
        });
      }

      // Update the stat value
      customStats[key] = parseInt(value, 10);

      res.json({
        success: true,
        message: `Stat ${key} updated to ${value}`,
        newValue: customStats[key],
      });
    } catch (error) {
      console.error("Error updating stats:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update stats: " + error.message,
      });
    }
  });

  // Stats endpoint compatible with the advanced HTML dashboard
  app.get("/stats.json", (req, res) => {
    try {
      const now = Date.now();
      const uptime = now - customStats.startTime;
      const memUsage = process.memoryUsage();

      // Calculate current rates
      const timeDiff = Math.max(1, (now - lastTimestamp) / 1000);
      const currentGetRate =
        (customStats.getRequests - lastGetCount) / timeDiff;
      const currentPutRate =
        (customStats.putRequests - lastPutCount) / timeDiff;

      const statsResponse = {
        peers: {
          count: activeWires,
          time: uptime,
        },
        node: {
          count: Object.keys(customStats.timeSeries.data).length,
        },
        up: {
          time: uptime,
        },
        memory: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external,
        },
        dam: {
          in: {
            count: customStats.getRequests,
            done: customStats.getRequests * 1024, // Estimate bytes
          },
          out: {
            count: customStats.putRequests,
            done: customStats.putRequests * 1024, // Estimate bytes
          },
        },
        // Time-series data for charts - each entry is [timestamp, value]
        all: customStats.timeSeries.data,
        over: 5000, // Update interval in milliseconds
      };

      res.json(statsResponse);
    } catch (error) {
      console.error("Error in /stats.json:", error);
      res.status(500).json({ error: "Failed to retrieve stats." });
    }
  });

  app.post("/api/derive", async (req, res) => {
    try {
      const { password, extra, options } = req.body;
      if (!password) {
        return res
          .status(400)
          .json({ success: false, error: "Password is required" });
      }
      const derivedKeys = await derive(password, extra, options);
      return res.json({ success: true, derivedKeys });
    } catch (error) {
      console.error("Error in derive API:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Failed to derive keys",
      });
    }
  });

  const getGunNodeFromPath = (pathString) => {
    const pathSegments = pathString.split("/").filter(Boolean);
    let node = gun;

    pathSegments.forEach((segment) => {
      node = node.get(segment);
    });
    return node;
  };

  app.get("/node/*", tokenAuthMiddleware, async (req, res) => {
    const path = req.params[0];
    if (!path || path.trim() === "") {
      return res
        .status(400)
        .json({ success: false, error: "Node path cannot be empty." });
    }

    console.log(`🔍 Reading node at path: "${path}"`);

    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        console.log(`⏰ GET timeout for path: "${path}"`);
        res.status(408).json({ success: false, error: "Request timed out." });
      }
    }, 5000); // 5-second timeout

    try {
      const node = getGunNodeFromPath(path);

      // Properly promisify the Gun get operation
      const data = await new Promise((resolve, reject) => {
        let resolved = false;

        const onceTimeout = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            console.log(`⏰ Gun get timeout for path: "${path}"`);
            resolve(null); // Resolve with null for timeout
          }
        }, 4000);

        node.once((nodeData) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(onceTimeout);
            console.log(
              `📖 Gun get result for path "${path}":`,
              nodeData ? "found" : "not found"
            );
            resolve(nodeData);
          }
        });
      });

      clearTimeout(timeout);

      if (!res.headersSent) {
        // Clean the GunDB metadata (`_`) before sending
        let cleanData = data;
        if (data && data._) {
          cleanData = { ...data };
          delete cleanData._;
        }

        console.log(`✅ Successfully read node at path: "${path}"`);
        res.json({
          success: true,
          path,
          data: cleanData === undefined ? null : cleanData,
        });
      }
    } catch (error) {
      clearTimeout(timeout);
      if (!res.headersSent) {
        console.error(`❌ Error in GET /node/* for path "${path}":`, error);
        res.status(500).json({
          success: false,
          error: "Failed to retrieve node data.",
          details: error.message,
          path,
        });
      }
    }
  });

  app.post("/node/*", tokenAuthMiddleware, async (req, res) => {
    try {
      let path = req.params[0];
      if (!path || path.trim() === "") {
        return res
          .status(400)
          .json({ success: false, error: "Node path cannot be empty." });
      }
      let data = req.body;
      if (data && typeof data === "object" && Object.keys(data).length === 0) {
        const originalPath = req.params[0];
        const lastSlashIndex = originalPath.lastIndexOf("/");
        if (lastSlashIndex !== -1 && lastSlashIndex < originalPath.length - 1) {
          path = originalPath.substring(0, lastSlashIndex);
          const dataFromPath = decodeURIComponent(
            originalPath.substring(lastSlashIndex + 1)
          );
          try {
            data = JSON.parse(dataFromPath);
          } catch (e) {
            data = dataFromPath;
          }
        }
      }
      if (typeof data === "undefined") {
        return res
          .status(400)
          .json({ success: false, error: "No data provided in body or path." });
      }

      console.log(`📝 Creating node at path: "${path}" with data:`, data);

      const node = getGunNodeFromPath(path);

      // Temporarily allow internal operations during this REST API call
      allowInternalOperations = true;

      try {
        // Properly promisify the Gun put operation
        const putResult = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Put operation timed out after 10 seconds"));
          }, 10000);

          try {
            node.put(data, (ack) => {
              clearTimeout(timeout);
              if (ack.err) {
                console.error(`❌ Gun put error for path "${path}":`, ack.err);
                reject(new Error(ack.err));
              } else {
                console.log(`✅ Gun put success for path "${path}":`, ack);
                resolve(ack);
              }
            });
          } catch (syncError) {
            clearTimeout(timeout);
            console.error(
              `❌ Synchronous error in put for path "${path}":`,
              syncError
            );
            reject(syncError);
          }
        });
      } finally {
        // Reset flag
        allowInternalOperations = false;
      }

      console.log(`✅ Node successfully created/updated at path: "${path}"`);
      return res.json({ success: true, path, data });
    } catch (error) {
      console.error(
        `❌ Error in POST /node/* for path "${req.params[0]}":`,
        error
      );
      return res.status(500).json({
        success: false,
        error: error.message,
        path: req.params[0],
      });
    }
  });

  app.delete("/node/*", tokenAuthMiddleware, async (req, res) => {
    try {
      const path = req.params[0];
      if (!path || path.trim() === "") {
        return res
          .status(400)
          .json({ success: false, error: "Node path cannot be empty." });
      }

      console.log(`🗑️ Deleting node at path: "${path}"`);

      const node = getGunNodeFromPath(path);

      // Temporarily allow internal operations during this REST API call
      allowInternalOperations = true;

      try {
        // Properly promisify the Gun delete operation
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Delete operation timed out after 10 seconds"));
          }, 10000);

          try {
            node.put(null, (ack) => {
              clearTimeout(timeout);
              if (ack.err) {
                console.error(
                  `❌ Gun delete error for path "${path}":`,
                  ack.err
                );
                reject(new Error(ack.err));
              } else {
                console.log(`✅ Gun delete success for path "${path}":`, ack);
                resolve(ack);
              }
            });
          } catch (syncError) {
            clearTimeout(timeout);
            console.error(
              `❌ Synchronous error in delete for path "${path}":`,
              syncError
            );
            reject(syncError);
          }
        });
      } finally {
        // Reset flag
        allowInternalOperations = false;
      }

      console.log(`✅ Node successfully deleted at path: "${path}"`);
      res.json({ success: true, path, message: "Data deleted." });
    } catch (error) {
      console.error(
        `❌ Error in DELETE /node/* for path "${req.params[0]}":`,
        error
      );
      res.status(500).json({
        success: false,
        error: error.message,
        path: req.params[0],
      });
    }
  });

  // --- Peer Management API ---
  app.get("/api/peers", tokenAuthMiddleware, (req, res) => {
    try {
      const peers = gun._.opt.peers || {};
      const peerList = Object.keys(peers);
      res.json({ success: true, peers: peerList });
    } catch (error) {
      console.error("Error fetching peer list:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve peer list: " + error.message,
      });
    }
  });

  app.post("/api/peers/add", tokenAuthMiddleware, (req, res) => {
    try {
      const { peerUrl } = req.body;
      if (!peerUrl || typeof peerUrl !== "string") {
        return res
          .status(400)
          .json({ success: false, error: "Invalid 'peerUrl' provided." });
      }

      try {
        new URL(peerUrl);
      } catch (e) {
        return res
          .status(400)
          .json({ success: false, error: "Malformed 'peerUrl'." });
      }

      console.log(`🔌 Attempting to connect to new peer: ${peerUrl}`);
      gun.opt({ peers: [peerUrl] });

      res.json({
        success: true,
        message: `Connection to peer ${peerUrl} initiated.`,
      });
    } catch (error) {
      console.error(`❌ Error adding peer:`, error);
      res.status(500).json({
        success: false,
        error: "Failed to add peer: " + error.message,
      });
    }
  });

  // --- Static Files & Page Routes ---

  const cleanReturnString = (value) => {
    if (!value) return "";
    return value.replace(/"/g, `'`);
  };

  app.get("/blog/:id", (req, res) => {
    const htmlData = fs.readFileSync(indexPath, "utf8");
    let numberOfTries = 0;
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
                  <meta name="description" content="${cleanReturnString(
                    post.description || ""
                  )}" />
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

  app.get("/derive", (req, res) => {
    res.sendFile(path.resolve(publicPath, "derive.html"));
  });
  app.get("/view", (req, res) => {
    res.sendFile(path.resolve(publicPath, "view.html"));
  });
  app.get("/edit", (req, res) => {
    res.sendFile(path.resolve(publicPath, "edit.html"));
  });
  app.get("/stats", (req, res) => {
    res.sendFile(path.resolve(publicPath, "stats.html"));
  });
  app.get("/charts", (req, res) => {
    res.sendFile(path.resolve(publicPath, "charts.html"));
  });
  app.get("/create", (req, res) => {
    res.sendFile(path.resolve(publicPath, "create.html"));
  });
  app.get("/client", (req, res) => {
    res.sendFile(path.resolve(publicPath, "client.html"));
  });
  app.get("/server", (req, res) => {
    res.sendFile(path.resolve(publicPath, "server.html"));
  });
  app.get("/visualGraph", (req, res) => {
    res.sendFile(path.resolve(publicPath, "visualGraph/visualGraph.html"));
  });
  app.get("/graph", (req, res) => {
    res.sendFile(path.resolve(publicPath, "graph.html"));
  });
  app.get("/upload", (req, res) => {
    res.sendFile(path.resolve(publicPath, "upload.html"));
  });
  app.get("/pin-manager", (req, res) => {
    res.sendFile(path.resolve(publicPath, "pin-manager.html"));
  });
  app.get("/drive", (req, res) => {
    res.sendFile(path.resolve(publicPath, "drive.html"));
  });

  app.get("/chat", (req, res) => {
    res.sendFile(path.resolve(publicPath, "chat.html"));
  });

  app.get("/notes", (req, res) => {
    res.sendFile(path.resolve(publicPath, "notes.html"));
  });

  app.get("/subscribe", (req, res) => {
    res.sendFile(path.resolve(publicPath, "subscribe.html"));
  });

  app.get("/user-upload", (req, res) => {
    res.sendFile(path.resolve(publicPath, "user-upload.html"));
  });

  app.get("/services-dashboard", (req, res) => {
    res.sendFile(path.resolve(publicPath, "services-dashboard.html"));
  });

  // Add route to fetch and display IPFS content
  app.get("/ipfs-content/:cid", async (req, res) => {
    const { cid } = req.params;
    const { token } = req.query;

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

      const ipfsReq = http.get(requestOptions, (ipfsRes) => {
        // If no token, just stream the response
        if (!token) {
          res.setHeader(
            "Content-Type",
            ipfsRes.headers["content-type"] || "application/octet-stream"
          );
          ipfsRes.pipe(res);
          return;
        }

        // If token is provided, buffer the response to decrypt it
        let body = "";
        ipfsRes.on("data", (chunk) => (body += chunk));
        ipfsRes.on("end", async () => {
          try {
            const decrypted = await SEA.decrypt(body, token);

            if (decrypted) {
              // It's a Base64 data URL, e.g., "data:image/png;base64,iVBORw0KGgo..."
              const parts = decrypted.match(/^data:(.+);base64,(.+)$/);
              if (parts) {
                const mimeType = parts[1];
                const fileContents = Buffer.from(parts[2], "base64");
                res.setHeader("Content-Type", mimeType);
                res.send(fileContents);
              } else {
                // Not a data URL, just plain text
                res.setHeader("Content-Type", "text/plain");
                res.send(decrypted);
              }
            } else {
              // Decryption failed, send raw content
              res.setHeader(
                "Content-Type",
                ipfsRes.headers["content-type"] || "application/octet-stream"
              );
              res.send(body);
            }
          } catch (e) {
            console.error("Decryption error:", e);
            // Decryption failed, send raw content
            res.setHeader(
              "Content-Type",
              ipfsRes.headers["content-type"] || "application/octet-stream"
            );
            res.send(body);
          }
        });

        ipfsRes.on("error", (err) => {
          console.error(`❌ Error streaming IPFS content: ${err.message}`);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: "Failed to stream IPFS content",
              details: err.message,
            });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        console.error(`❌ Error fetching from IPFS gateway: ${err.message}`);
        if (!res.headersSent) {
          res.status(502).json({
            success: false,
            error: "Failed to fetch from IPFS gateway",
            details: err.message,
            fallback: {
              publicGateway: `https://ipfs.io/ipfs/${cid}`,
              cloudflareGateway: `https://cloudflare-ipfs.com/ipfs/${cid}`,
            },
          });
        }
      });

      // Set a timeout
      ipfsReq.setTimeout(30000, () => {
        ipfsReq.destroy();
        if (!res.headersSent) {
          res.status(504).json({
            success: false,
            error: "Gateway timeout",
            fallback: {
              publicGateway: `https://ipfs.io/ipfs/${cid}`,
              cloudflareGateway: `https://cloudflare-ipfs.com/ipfs/${cid}`,
            },
          });
        }
      });
    } catch (error) {
      console.error(`❌ Error handling IPFS content request: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  // --- Secure IPFS Management Endpoints ---
  const forwardToIpfsApi = (req, res, endpoint, method = "POST") => {
    try {
      let path = `/api/v0/${endpoint}`;

      const cid = req.body.cid || req.query.cid || req.params.cid || "";
      if (cid) {
        path += `?arg=${cid}`;
      } else if (req.query.type) {
        path += `?type=${req.query.type}`;
      }

      const requestOptions = {
        hostname: new URL(IPFS_API_URL).hostname,
        port: new URL(IPFS_API_URL).port,
        path: path,
        method: "POST",
        headers: {
          "Content-Length": "0",
          Accept: "application/json",
        },
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        let data = "";

        ipfsRes.on("data", (chunk) => {
          data += chunk;
        });

        ipfsRes.on("end", () => {
          try {
            // Clean the response data by removing any trailing newlines
            const cleanData = data.trim();
            // Try to parse the cleaned JSON
            const jsonData = JSON.parse(cleanData);

            res.json({
              success: true,
              data: jsonData,
            });
          } catch (parseError) {
            console.error("Error parsing IPFS API response:", parseError);
            res.status(500).json({
              success: false,
              error: "Invalid JSON response from IPFS API",
              details: parseError.message,
              rawResponse: data,
            });
          }
        });
      });

      ipfsReq.on("error", (error) => {
        console.error("Error in IPFS API request:", error);
        res.status(500).json({
          success: false,
          error: "IPFS API request failed",
          details: error.message,
        });
      });

      ipfsReq.end();
    } catch (error) {
      console.error("Error in forwardToIpfsApi:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        details: error.message,
      });
    }
  };

  app.post("/pins/add", tokenAuthMiddleware, (req, res) =>
    forwardToIpfsApi(req, res, "pin/add")
  );
  app.post("/pins/rm", tokenAuthMiddleware, (req, res) =>
    forwardToIpfsApi(req, res, "pin/rm")
  );
  app.post("/pins/ls", tokenAuthMiddleware, (req, res) =>
    forwardToIpfsApi(req, res, "pin/ls", "POST")
  );

  // Custom handler for repo/gc to correctly handle streaming responses
  app.post("/repo/gc", tokenAuthMiddleware, (req, res) => {
    try {
      const gcOptions = {
        hostname: new URL(IPFS_API_URL).hostname,
        port: new URL(IPFS_API_URL).port,
        path: "/api/v0/repo/gc",
        method: "POST",
        headers: {
          ...(IPFS_API_TOKEN && { Authorization: `Bearer ${IPFS_API_TOKEN}` }),
        },
      };

      const gcReq = http.request(gcOptions, (gcRes) => {
        let responseBody = "";
        gcRes.on("data", (chunk) => {
          responseBody += chunk; // Consume the stream
        });
        gcRes.on("end", () => {
          if (gcRes.statusCode === 200) {
            console.log("Garbage collection triggered successfully.");
            res.json({
              success: true,
              message: "Garbage collection completed.",
            });
          } else {
            console.error(
              `IPFS repo/gc failed with status ${gcRes.statusCode}:`,
              responseBody
            );
            res.status(gcRes.statusCode).json({
              success: false,
              error: "IPFS garbage collection failed.",
              details: responseBody,
            });
          }
        });
      });

      gcReq.on("error", (error) => {
        console.error("Error calling /repo/gc:", error);
        res.status(500).json({ success: false, error: error.message });
      });

      gcReq.end();
    } catch (error) {
      console.error("Error setting up /repo/gc request:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/notes", tokenAuthMiddleware, (req, res) => {
    const notesNode = gun.get("shogun").get("admin").get("notes");
    notesNode.once((data) => {
      res.json({ success: true, notes: data || "" });
    });
  });

  app.post("/api/notes", tokenAuthMiddleware, (req, res) => {
    const { notes } = req.body;
    if (typeof notes !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "Invalid notes format." });
    }
    gun
      .get("shogun")
      .get("admin")
      .get("notes")
      .put(notes, (ack) => {
        if (ack.err) {
          return res.status(500).json({ success: false, error: ack.err });
        }
        res.json({ success: true });
      });
  });

  app.delete("/api/notes", tokenAuthMiddleware, (req, res) => {
    gun
      .get("shogun")
      .get("admin")
      .get("notes")
      .put(null, (ack) => {
        if (ack.err) {
          return res.status(500).json({ success: false, error: ack.err });
        }
        res.json({ success: true, message: "Notes deleted." });
      });
  });

  // Fallback to index.html
  app.get("/*", (req, res) => {
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send("Index file not found");
    }
  });

  // Display server information
  console.log(`Internal URL: ${link}/`);
  console.log(`External URL: ${extLink}/`);
  console.log(`Gun peer: ${link}/gun`);
  console.log(`Storage: ${store ? "enabled" : "disabled"}`);
  console.log(
    `Admin password: ${process.env.ADMIN_PASSWORD ? "configured" : "not set"}`
  );

  // Display IPFS proxy information
  console.log("\n=== IPFS PROXY ENDPOINTS ===");
  console.log(`📁 IPFS Gateway: ${link}/ipfs/`);
  console.log(`📁 IPNS Gateway: ${link}/ipns/`);
  console.log(`🔧 IPFS API: ${link}/api/v0/`);
  console.log(`📊 IPFS Status: ${link}/ipfs-status`);

  console.log("==============================");

  // Show QR code if enabled
  if (showQr !== false) {
    console.log("\n=== QR CODE ===");
    try {
      console.log(qr(link, "ascii", { border: 1 }));
    } catch (error) {
      console.warn("QR code generation failed:", error.message);
    }
    console.log("===============\n");
  }

  // Graceful shutdown
  async function shutdown() {
    console.log("\nShutting down relay server...");

    // Clear garbage collector interval
    if (gcInterval) {
      clearInterval(gcInterval);
      console.log("🗑️ Garbage Collector stopped");
    }

    if (db) {
      db.get("status").put("stopping");
    }

    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }

    if (db) {
      db.get("status").put("stopped");
      db.get("stopped").put(Date.now());
    }

    console.log("Relay server shutdown complete.");
  }

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });

  // Enhanced system info endpoint
  app.get("/api/system-info", (req, res) => {
    try {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      res.json({
        success: true,
        system: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          uptime: process.uptime() * 1000,
          pid: process.pid,
          memory: {
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external,
            rss: memUsage.rss,
          },
          cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system,
          },
          loadAverage:
            process.platform !== "win32" ? require("os").loadavg() : [0, 0, 0],
          freeMemory: require("os").freemem(),
          totalMemory: require("os").totalmem(),
        },
        services: {
          gun: {
            activeConnections: activeWires,
            totalConnections: totalConnections,
            startTime: customStats.startTime,
          },
        },
      });
    } catch (error) {
      console.error("Error in /api/system-info:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve system info: " + error.message,
      });
    }
  });

  // Docker service management functions
  const docker = new Docker();

  async function getDockerContainer(containerName) {
    try {
      const containers = await docker.listContainers({ all: true });
      return containers.find((container) =>
        container.Names.some((name) => name.includes(containerName))
      );
    } catch (error) {
      console.error(`Error finding container ${containerName}:`, error);
      return null;
    }
  }

  async function restartDockerService(serviceName) {
    try {
      const containerMappings = {
        gun: "shogun-relay-stack",
        ipfs: "shogun-relay-stack", // IPFS runs within the main container
      };

      const containerName = containerMappings[serviceName];
      const supervisorService = supervisorServiceMappings[serviceName];

      if (!containerName || !supervisorService) {
        throw new Error(`Unknown service: ${serviceName}`);
      }

      const containerInfo = await getDockerContainer(containerName);
      if (!containerInfo) {
        throw new Error(`Container ${containerName} not found`);
      }

      const container = docker.getContainer(containerInfo.Id);

      // For services within the main container, we'll restart the whole container
      if (serviceName === "gun") {
        // For gun service, we can't restart just the Gun part, so we restart the container
        console.log(`🔄 Restarting Docker container: ${containerName}`);
        await container.restart();
        return `Container ${containerName} restarted successfully`;
      } else if (serviceName === "ipfs") {
        // For IPFS, we can try to restart the IPFS daemon within the container
        try {
          const exec = await container.exec({
            Cmd: ["supervisorctl", "restart", "ipfs"],
            AttachStdout: true,
            AttachStderr: true,
          });
          const stream = await exec.start();
          return `IPFS service restarted within container`;
        } catch (execError) {
          // Fallback to container restart
          console.log(
            `🔄 IPFS service restart failed, restarting container: ${containerName}`
          );
          await container.restart();
          return `Container ${containerName} restarted (IPFS service restart fallback)`;
        }
      }
    } catch (error) {
      throw new Error(`Docker restart failed: ${error.message}`);
    }
  }

  // Enhanced service restart endpoint with Docker integration
  app.post(
    "/api/services/:service/restart",
    tokenAuthMiddleware,
    async (req, res) => {
      try {
        const { service } = req.params;
        const allowedServices = ["gun", "ipfs"];

        if (!allowedServices.includes(service)) {
          return res.status(400).json({
            success: false,
            error: `Service '${service}' is not supported. Allowed services: ${allowedServices.join(
              ", "
            )}`,
          });
        }

        console.log(`🔄 Restart request received for service: ${service}`);

        let result;

        try {
          // First try Docker restart
          result = await restartDockerService(service);
          console.log(`✅ Docker restart successful: ${result}`);
        } catch (dockerError) {
          console.warn(`⚠️ Docker restart failed: ${dockerError.message}`);

          // Fallback to internal operations
          switch (service) {
            case "gun":
              await runGarbageCollector();
              result = `Gun relay cleanup triggered (Docker unavailable)`;
              break;

            case "ipfs":
              result = `IPFS restart attempted but Docker unavailable`;
              break;
          }
        }

        res.json({
          success: true,
          message: result,
          service: service,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error(`Error restarting service ${req.params.service}:`, error);
        res.status(500).json({
          success: false,
          error: `Failed to restart service: ${error.message}`,
        });
      }
    }
  );

  // Service status endpoint
  app.get("/api/services/status", async (req, res) => {
    try {
      const services = {};

      // Check Gun Relay
      services.gun = {
        status: "online",
        uptime: process.uptime() * 1000,
        connections: activeWires,
        totalConnections: totalConnections,
        memory: process.memoryUsage().heapUsed,
      };

      // Check IPFS
      try {
        const ipfsResponse = await fetch("/ipfs-status");
        const ipfsData = await ipfsResponse.json();
        services.ipfs = {
          status: ipfsData.success ? "online" : "offline",
          version: ipfsData.ipfs?.version || "unknown",
          type: ipfsData.ipfs?.type || "unknown",
        };
      } catch (error) {
        services.ipfs = {
          status: "offline",
          error: error.message,
        };
      }

      res.json({
        success: true,
        services: services,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Error in /api/services/status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to check services status: " + error.message,
      });
    }
  });
} // End of initializeServer function

// Start the server
initializeServer().catch(console.error);
