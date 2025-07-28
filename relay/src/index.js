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
import { ethers } from "ethers";

dotenv.config();

import Gun from "gun";
import SEA from "gun/sea.js";

import "gun/lib/stats.js";
import "gun/lib/webrtc.js";
import "gun/lib/rfs.js";

import ShogunCoreModule from "shogun-core";
const { derive } = ShogunCoreModule;
import http from "http";
import { createProxyMiddleware } from "http-proxy-middleware";
import multer from "multer";

// Importa i contratti dal pacchetto shogun-contracts
import { DEPLOYMENTS } from "shogun-contracts/deployments.js";

const namespace = "shogun";

// --- IPFS Configuration ---
const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN;
const IPFS_GATEWAY_URL = process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";

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
const RELAY_CONTRACT_ADDRESS =
  DEPLOYMENTS.sepolia["Relay#RelayPaymentRouter"].address;
let relayContract;
let provider;

// Utilizza l'ABI dal pacchetto shogun-contracts
const RELAY_ABI = DEPLOYMENTS.sepolia["Relay#RelayPaymentRouter"].abi;

// Initialize contract with network verification
async function initializeRelayContract() {
  if (!RELAY_CONTRACT_ADDRESS) {
    console.log("⚠️ RELAY_CONTRACT_ADDRESS not configured");
    return false;
  }

  if (!process.env.ALCHEMY_API_KEY) {
    console.log("⚠️ ALCHEMY_API_KEY not configured");
    return false;
  }

  try {
    provider = new ethers.JsonRpcProvider(WEB3_PROVIDER_URL);

    // Verify we're connected to Sepolia
    const network = await provider.getNetwork();
    console.log(
      `🔗 Connected to network: ${network.name} (chainId: ${network.chainId})`
    );

    if (network.chainId !== 11155111n) {
      console.warn(
        `⚠️ Expected Sepolia (11155111), but connected to ${network.name} (${network.chainId})`
      );
    }

    relayContract = new ethers.Contract(
      RELAY_CONTRACT_ADDRESS,
      RELAY_ABI,
      provider
    );

    console.log(
      `✅ Relay contract initialized at: ${RELAY_CONTRACT_ADDRESS}`
    );
    return true;
  } catch (error) {
    console.error("❌ Failed to initialize relay contract:", error);
    return false;
  }
}

// Main server initialization function
async function initializeServer() {
  console.log("🚀 Initializing Shogun Relay Server...");

  // Initialize relay contract
  await initializeRelayContract();

  // System logging function
  function addSystemLog(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data,
    };

    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
    
    // Store in Gun database for persistence
    if (gun) {
      gun.get("shogun").get("logs").get(timestamp).put(logEntry);
    }
  }

  // Time series data function
  function addTimeSeriesPoint(key, value) {
    const timestamp = Date.now();
    const dataPoint = {
      timestamp,
      key,
      value,
    };

    if (gun) {
      gun.get("shogun").get("timeseries").get(key).get(timestamp).put(dataPoint);
    }
  }

  // Garbage collection function
  function runGarbageCollector() {
    if (!GC_ENABLED) {
      console.log("🗑️ Garbage Collector is disabled.");
      return;
    }
    console.log("🗑️ Running Garbage Collector...");
    addSystemLog("info", "Garbage collection started");
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
      addSystemLog("info", `Garbage collection completed. Cleaned ${cleanedCount} nodes`);
    } else {
      console.log(
        "🗑️ Garbage Collector finished. No unprotected nodes found to clean."
      );
      addSystemLog("info", "Garbage collection completed. No nodes to clean");
    }
  }

  // Store GC interval reference for cleanup
  let gcInterval = null;

  // Initialize garbage collector
  function initializeGarbageCollector() {
    if (GC_ENABLED) {
      console.log("🗑️ Initializing garbage collector...");
      gcInterval = setInterval(runGarbageCollector, GC_INTERVAL);
      console.log(
        `✅ Garbage Collector scheduled to run every ${
          GC_INTERVAL / 1000 / 60
        } minutes.`
      );
      addSystemLog("info", "Garbage collector initialized");
      // Run once on startup after a delay
      setTimeout(runGarbageCollector, 30 * 1000); // Run 30s after start
    } else {
      console.log("🗑️ Garbage collection disabled");
    }
  }

  // Flag per permettere operazioni interne durante REST API
  let allowInternalOperations = false;

  // Funzione helper per trovare il relay corrente basandosi sull'URL
  async function getCurrentRelayAddress() {
    try {
      if (!relayContract) {
        console.error("Relay contract not initialized");
        return null;
      }

      // Ottieni l'URL corrente del server
      const serverURL = process.env.SERVER_URL || `http://${host}:${port}`;
      const relayURL = serverURL + "/gun";
      console.log("🔍 Looking for relay with URL:", relayURL);

      // Prova prima a trovare il relay specifico per questo URL
      try {
        const specificRelayAddress = await relayContract.findRelayByURL(
          relayURL
        );
        if (
          specificRelayAddress &&
          specificRelayAddress !== "0x0000000000000000000000000000000000000000"
        ) {
          console.log(
            "✅ Found specific relay for this URL:",
            specificRelayAddress
          );
          return specificRelayAddress;
        }
      } catch (error) {
        console.log(
          "⚠️ Could not find specific relay by URL, trying fallback..."
        );
      }

      // Fallback: ottieni tutti i relay e usa il primo
      console.log("🔄 Using fallback: getting all relays");
      const allRelays = await relayContract.getAllRelays();
      console.log("getAllRelays() result:", allRelays);

      if (allRelays.length > 0) {
        const fallbackRelayAddress = allRelays[0];
        console.log("📋 Using first available relay:", fallbackRelayAddress);

        // Ottieni i dettagli del relay per logging
        try {
          const relayDetails = await relayContract.getRelayDetails(
            fallbackRelayAddress
          );
          console.log("📊 Relay details:", relayDetails);

          // Log un avviso se non è il relay specifico
          if (relayDetails.url !== relayURL) {
            console.warn(
              `⚠️ Using relay: ${relayDetails.url} (not the current relay)`
            );
          }
        } catch (detailsError) {
          console.log("Could not get relay details:", detailsError);
        }

        return fallbackRelayAddress;
      } else {
        console.warn("No relay registered in the contract");
        return null;
      }
    } catch (error) {
      console.error("Failed to get current relay address:", error);
      return null;
    }
  }

  // Token validation function
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
        firstSoul.startsWith("shogun/uploads") || // User uploads (permette salvataggio upload user)
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
      const hasValidAuth = msg.headers.token === process.env.ADMIN_PASSWORD;
      if (hasValidAuth) {
        console.log(`🔍 PUT allowed - valid token: ${firstSoul}`);
        return true;
      }
    }

    console.log(`❌ PUT denied - no valid auth: ${firstSoul}`);
    return false;
  }

  // Create Express app
  const app = express();
  const publicPath = path.resolve(__dirname, path_public);
  const indexPath = path.resolve(publicPath, "index.html");

  // Middleware
  app.use(cors());
  app.use(Gun.serve);

  // Route statiche (DEFINITE DOPO LE API)
  app.use(express.static(publicPath));

  // IPFS File Upload Endpoint
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

  // Middleware per endpoint user che verifica l'header x-user-address
  const userAuthMiddleware = (req, res, next) => {
    const pubKey = req.headers["x-pubkey"];
    if (!pubKey) {
      return res.status(401).json({
        success: false,
        error: "x-pubkey header richiesto",
      });
    }
    req.userPubKey = pubKey;
    next();
  };

  // Funzione per verificare la firma del wallet
  function verifyWalletSignature(message, signature, expectedAddress) {
    try {
      // Verifica che l'address sia valido
      if (
        !expectedAddress ||
        !expectedAddress.startsWith("0x") ||
        expectedAddress.length !== 42
      ) {
        return false;
      }

      // Verifica che la firma sia valida
      if (
        !signature ||
        !signature.startsWith("0x") ||
        signature.length !== 132
      ) {
        return false;
      }

      // Per ora restituiamo true se i formati sono corretti
      // In futuro potremmo implementare la verifica crittografica completa
      console.log(`🔐 Verifying signature for address: ${expectedAddress}`);
      console.log(`🔐 Message: ${message}`);
      console.log(`🔐 Signature: ${signature.substring(0, 20)}...`);

      return true;
    } catch (error) {
      console.error("❌ Error verifying wallet signature:", error);
      return false;
    }
  }

  // Middleware per autenticare le richieste con firma del wallet
  const walletSignatureMiddleware = (req, res, next) => {
    try {
      const userAddress = req.headers["x-user-address"];
      const signature = req.headers["x-wallet-signature"];
      const message = req.headers["x-signature-message"] || "I Love Shogun";

      if (!userAddress) {
        return res.status(401).json({
          success: false,
          error: "x-user-address header richiesto",
        });
      }

      if (!signature) {
        return res.status(401).json({
          success: false,
          error: "x-wallet-signature header richiesto per autenticazione",
        });
      }

      // Verifica la firma
      if (!verifyWalletSignature(message, signature, userAddress)) {
        return res.status(401).json({
          success: false,
          error: "Firma del wallet non valida",
        });
      }

      console.log(`✅ Wallet signature verified for: ${userAddress}`);
      next();
    } catch (error) {
      console.error("❌ Wallet signature middleware error:", error);
      res.status(500).json({
        success: false,
        error: "Errore di autenticazione",
      });
    }
  };

  // --- Start Server Function ---
  async function startServer() {
    const server = app.listen(port, (error) => {
      if (error) {
        return console.log("Error during app startup", error);
      }
      console.log(`Server listening on port ${port}...`);
    });

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
    localStorage: true, // Abilita localStorage per persistenza
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
      let to = this.to;
      // Adds headers for put
      msg.headers = {
        token: process.env.ADMIN_PASSWORD,
      };
      to.next(msg); // pass to next middleware
    });
  });

  const gun = Gun(gunConfig);

  // Configura l'istanza Gun per le route di autenticazione
  app.set("gunInstance", gun);

  // Esponi le funzioni helper per le route
  app.set("addSystemLog", addSystemLog);
  app.set("addTimeSeriesPoint", addTimeSeriesPoint);
  app.set("runGarbageCollector", runGarbageCollector);
  app.set("getCurrentRelayAddress", getCurrentRelayAddress);

  // Esponi i middleware di autenticazione per le route
  app.set("tokenAuthMiddleware", tokenAuthMiddleware);
  app.set("userAuthMiddleware", userAuthMiddleware);
  app.set("walletSignatureMiddleware", walletSignatureMiddleware);
  app.set("verifyWalletSignature", verifyWalletSignature);

  // Esponi la variabile per operazioni interne
  app.set("allowInternalOperations", () => allowInternalOperations);
  app.set("setAllowInternalOperations", (value) => { allowInternalOperations = value; });

  // Funzione per calcolare l'utilizzo MB off-chain
  async function getOffChainMBUsage(userAddress) {
    try {
      const mbUsageNode = gun.get("shogun").get("mb_usage").get(userAddress);
      const offChainUsage = await new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
          console.warn(
            `⚠️ GunDB mb_usage read timeout for ${userAddress}, will recalculate from files`
          );
          resolve({ mbUsed: 0, lastUpdated: Date.now(), timeout: true });
        }, 1500); // Timeout ridotto a 1.5 secondi

        mbUsageNode.once((data) => {
          clearTimeout(timeoutId);
          resolve(data || { mbUsed: 0, lastUpdated: Date.now() });
        });
      });

      // Se i dati off-chain non sono affidabili (timeout o 0), ricalcola dai file esistenti
      if (offChainUsage.timeout || offChainUsage.mbUsed === 0) {
        console.log(
          `🔄 Recalculating MB usage from existing files for ${userAddress}`
        );

        try {
          // Ottieni tutti i file dell'utente
          const uploadsNode = gun.get("shogun").get("uploads").get(userAddress);
          const userFiles = await new Promise((resolve) => {
            const timeoutId = setTimeout(() => {
              console.warn(
                `⚠️ GunDB uploads read timeout for ${userAddress}, using fallback calculation`
              );
              resolve([]);
            }, 2500); // Timeout ridotto a 2.5 secondi

            uploadsNode.once((parentData) => {
              clearTimeout(timeoutId);

              if (!parentData || typeof parentData !== "object") {
                resolve([]);
                return;
              }

              const hashKeys = Object.keys(parentData).filter(
                (key) => key !== "_"
              );
              let uploadsArray = [];
              let completedReads = 0;
              const totalReads = hashKeys.length;

              if (totalReads === 0) {
                resolve([]);
                return;
              }

              // Timeout per ogni singola lettura di file
              const fileReadTimeout = setTimeout(() => {
                console.warn(`⚠️ File read timeout, using partial data`);
                resolve(uploadsArray);
              }, 3000);

              hashKeys.forEach((hash) => {
                uploadsNode.get(hash).once((uploadData) => {
                  completedReads++;
                  if (uploadData && uploadData.sizeMB) {
                    uploadsArray.push(uploadData);
                  }
                  if (completedReads === totalReads) {
                    clearTimeout(fileReadTimeout);
                    resolve(uploadsArray);
                  }
                });
              });
            });
          });

          // Calcola il totale dei MB dai file
          const calculatedMbUsed = userFiles.reduce(
            (sum, file) => sum + (file.sizeMB || 0),
            0
          );
          console.log(
            `📊 Calculated MB usage from files: ${calculatedMbUsed} MB (${userFiles.length} files)`
          );

          // Usa il valore calcolato se è maggiore di 0
          if (calculatedMbUsed > 0) {
            // Aggiorna anche i dati off-chain per futuri utilizzi (in background)
            const updatedUsage = {
              mbUsed: calculatedMbUsed,
              lastUpdated: Date.now(),
              updatedBy: "recalculation-from-files",
            };

            mbUsageNode.put(updatedUsage, (ack) => {
              if (ack.err) {
                console.error("Error updating recalculated MB usage:", ack.err);
              } else {
                console.log(
                  `✅ Updated off-chain MB usage with recalculated value: ${calculatedMbUsed} MB`
                );
              }
            });

            return {
              mbUsed: calculatedMbUsed,
              lastUpdated: Date.now(),
              recalculated: true,
            };
          }
        } catch (recalcError) {
          console.error("Error recalculating MB usage:", recalcError);
        }
      }

      return offChainUsage;
    } catch (error) {
      console.error("Error getting off-chain MB usage:", error);
      return { mbUsed: 0, lastUpdated: Date.now(), error: error.message };
    }
  }

  // Esponi la funzione getOffChainMBUsage
  app.set("getOffChainMBUsage", getOffChainMBUsage);

  // Esponi le configurazioni IPFS
  app.set("IPFS_API_URL", IPFS_API_URL);
  app.set("IPFS_API_TOKEN", IPFS_API_TOKEN);
  app.set("IPFS_GATEWAY_URL", IPFS_GATEWAY_URL);

  // Esponi l'istanza Gun globalmente per le route
  global.gunInstance = gun;

  // Route legacy per compatibilità (definite prima delle route modulari)
  
  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      activeConnections: activeWires || 0,
      totalConnections: totalConnections || 0,
      memoryUsage: process.memoryUsage(),
    });
  });

  // IPFS status endpoint
  app.get("/ipfs-status", async (req, res) => {
    try {
      console.log("📊 IPFS Status: Checking IPFS node status");

      const requestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/version",
        method: "POST",
        headers: {
          "Content-Length": "0",
        },
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const http = await import('http');
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
              apiUrl: IPFS_API_URL,
            });
          } catch (parseError) {
            console.error("IPFS status parse error:", parseError);
            res.json({
              success: false,
              status: "error",
              error: "Failed to parse IPFS response",
            });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        console.error("❌ IPFS Status Error:", err);
        res.json({
          success: false,
          status: "disconnected",
          error: "IPFS node not responding",
        });
      });

      ipfsReq.end();
    } catch (error) {
      console.error("❌ IPFS Status Error:", error);
      res.json({
        success: false,
        status: "error",
        error: error.message,
      });
    }
  });

  // IPFS upload endpoint (admin)
  app.post("/ipfs-upload", tokenAuthMiddleware, upload.single("file"), async (req, res) => {
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

      const http = await import('http');
      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        let data = "";
        ipfsRes.on("data", (chunk) => (data += chunk));
        ipfsRes.on("end", () => {
          try {
            const lines = data.trim().split("\n");
            const results = lines.map((line) => JSON.parse(line));
            const fileResult = results.find((r) => r.Name === req.file.originalname) || results[0];

            res.json({
              success: true,
              file: {
                name: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype,
                hash: fileResult.Hash,
                sizeBytes: fileResult.Size,
              },
            });
          } catch (parseError) {
            console.error("❌ IPFS Upload parse error:", parseError);
            res.status(500).json({
              success: false,
              error: "Failed to parse IPFS response",
              rawResponse: data,
            });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        console.error("❌ IPFS Upload error:", err);
        res.status(500).json({
          success: false,
          error: err.message,
        });
      });

      formData.pipe(ipfsReq);
    } catch (error) {
      console.error("❌ IPFS Upload error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // IPFS upload endpoint (user)
  app.post("/ipfs-upload-user", walletSignatureMiddleware, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No file provided",
        });
      }

      const userAddress = req.headers["x-user-address"];
      const fileSizeMB = req.file.size / (1024 * 1024);

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

      const http = await import('http');
      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        let data = "";
        ipfsRes.on("data", (chunk) => (data += chunk));
        ipfsRes.on("end", () => {
          try {
            const lines = data.trim().split("\n");
            const results = lines.map((line) => JSON.parse(line));
            const fileResult = results.find((r) => r.Name === req.file.originalname) || results[0];

            // Save upload to Gun database and update MB usage
            const uploadData = {
              name: req.file.originalname,
              size: req.file.size,
              sizeMB: fileSizeMB,
              mimetype: req.file.mimetype,
              hash: fileResult.Hash,
              uploadedAt: Date.now(),
              userAddress: userAddress,
            };

            const uploadsNode = gun.get("shogun").get("uploads").get(userAddress);
            uploadsNode.get(fileResult.Hash).put(uploadData);

            // Update MB usage
            const mbUsageNode = gun.get("shogun").get("mb_usage").get(userAddress);
            mbUsageNode.once((currentUsage) => {
              const newUsage = {
                mbUsed: (currentUsage?.mbUsed || 0) + fileSizeMB,
                lastUpdated: Date.now(),
                updatedBy: "file-upload",
              };
              mbUsageNode.put(newUsage);
            });

            res.json({
              success: true,
              file: uploadData,
            });
          } catch (parseError) {
            console.error("❌ IPFS Upload parse error:", parseError);
            res.status(500).json({
              success: false,
              error: "Failed to parse IPFS response",
              rawResponse: data,
            });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        console.error("❌ IPFS Upload error:", err);
        res.status(500).json({
          success: false,
          error: err.message,
        });
      });

      formData.pipe(ipfsReq);
    } catch (error) {
      console.error("❌ IPFS Upload error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Importa e configura le route modulari
  try {
    const routes = await import("./routes/index.js");
    routes.default(app);
    console.log("✅ Route modulari configurate con successo");
  } catch (error) {
    console.error(
      "❌ Errore nel caricamento delle route modulari:",
      error
    );
  }

  // Initialize garbage collector now that gun is ready
  initializeGarbageCollector();

  // Set up relay stats database
  const db = gun.get(namespace).get("relays").get(host);

  let totalConnections = 0;
  let activeWires = 0;

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
    const pulse = {
      timestamp: Date.now(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      connections: {
        total: totalConnections,
        active: activeWires,
      },
      relay: {
        host,
        port,
        namespace,
      },
    };

    db?.get("pulse").put(pulse);
    addTimeSeriesPoint("connections.active", activeWires);
    addTimeSeriesPoint("memory.heapUsed", process.memoryUsage().heapUsed);
  }, 30000); // 30 seconds

  // Shutdown function
  async function shutdown() {
    console.log("🛑 Shutting down Shogun Relay...");
    addSystemLog("info", "Server shutdown initiated");

    // Clean up garbage collector interval
    if (gcInterval) {
      clearInterval(gcInterval);
      console.log("✅ Garbage collector interval cleared");
    }

    // Close server
    if (server) {
      server.close(() => {
        console.log("✅ Server closed");
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }

  // Handle shutdown signals
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Show QR code if enabled
  if (showQr) {
    const url = `http://${host}:${port}`;
    console.log(`📱 QR Code for: ${url}`);
    try {
      const qrCode = qr.image(url, { type: 'terminal', small: true });
      console.log(qrCode);
    } catch (qrError) {
      console.log(`📱 QR Code generation failed: ${qrError.message}`);
      console.log(`📱 URL: ${url}`);
    }
  }

  console.log(`🚀 Shogun Relay Server running on http://${host}:${port}`);
  addSystemLog("info", "Server started successfully", {
    host,
    port,
    namespace,
    peers: peers.length,
  });

  return {
    server,
    gun,
    db,
    addSystemLog,
    addTimeSeriesPoint,
    runGarbageCollector,
    shutdown,
  };
}

// Avvia il server
initializeServer().catch(console.error); 