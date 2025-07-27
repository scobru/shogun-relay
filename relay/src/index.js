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
const RELAY_CONTRACT_ADDRESS = DEPLOYMENTS.sepolia["Relay#RelayPaymentRouter"].address;
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
      `🌐 Connected to network: ${network.name} (chainId: ${network.chainId})`
    );

    if (network.chainId !== 11155111n) {
      // Sepolia chain ID
      console.error(
        `❌ Wrong network! Expected Sepolia (11155111), got ${network.chainId}`
      );
      return false;
    }

    relayContract = new ethers.Contract(
      RELAY_CONTRACT_ADDRESS,
      RELAY_ABI,
      provider
    );

    // Test contract accessibility
    const subscriptionPrice = await relayContract.PRICE_PER_GB();
    console.log(
      `✅ Contract initialized successfully. Price per GB: ${ethers.formatEther(
        subscriptionPrice
      )} ETH`
    );

    return true;
  } catch (error) {
    console.error("❌ Failed to initialize relay contract:", error.message);
    return false;
  }
}

// Main async function to initialize the server
async function initializeServer() {
  console.clear();
  console.log("=== GUN-VUE RELAY SERVER ===\n");

  // Sistema di logging in memoria
  let systemLogs = [];
  const MAX_LOGS = 1000;

  // Funzione per aggiungere log
  function addSystemLog(level, message, data = null) {
    const logEntry = {
      timestamp: Date.now(),
      level: level,
      message: message,
      data: data,
    };

    systemLogs.push(logEntry);

    // Mantieni solo gli ultimi MAX_LOGS
    if (systemLogs.length > MAX_LOGS) {
      systemLogs = systemLogs.slice(-MAX_LOGS);
    }

    // Log anche su console
    const timestamp = new Date(logEntry.timestamp).toISOString();
    console.log(
      `[${timestamp}] [${level.toUpperCase()}] ${message}`,
      data || ""
    );
  }

  addSystemLog("info", "Server initialization started");

  // Initialize relay contract
  console.log("🔧 Initializing relay contract...");
  const contractInitialized = await initializeRelayContract();
  if (contractInitialized) {
    console.log("✅ Relay contract ready");
    addSystemLog("success", "Relay contract initialized successfully");
  } else {
    console.log(
      "⚠️ Relay contract not available - smart contract features disabled"
    );
    addSystemLog(
      "warning",
      "Relay contract not available - smart contract features disabled"
    );
  }
  console.log("");

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

        const authHeader = getIpfsAuthHeader();
        if (authHeader) {
          requestOptions.headers["Authorization"] = authHeader;
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

  // Endpoint upload IPFS per utenti smart contract (versione migliorata)
  app.post(
    "/ipfs-upload-user",
    walletSignatureMiddleware,
    upload.single("file"),
    async (req, res) => {
      try {
        if (!req.file) {
          return res
            .status(400)
            .json({ success: false, error: "Nessun file fornito" });
        }

        const userAddress = req.headers["x-user-address"];
        if (!userAddress) {
          return res.status(401).json({
            success: false,
            error: "Header 'x-user-address' richiesto",
          });
        }

        console.log(`📤 Richiesta di upload per utente: ${userAddress}`);

        const shouldEncrypt = req.body.encrypt === "true";
        const encryptionKey = req.body.encryptionKey;

        console.log(`🔒 Crittografia richiesta: ${shouldEncrypt}`);
        if (shouldEncrypt && !encryptionKey) {
          return res.status(400).json({
            success: false,
            error:
              "Chiave di crittografia richiesta quando la crittografia è abilitata",
          });
        }

        const fileSizeMB = Math.ceil(req.file.size / (1024 * 1024));

        if (!relayContract) {
          return res.status(500).json({
            success: false,
            error: "Contratto Relay non disponibile",
          });
        }

        let activeRelayAddress = null;
        let mbAllocatedNum = 0; // Inizializza a 0

        try {
          // Ottieni tutti i relay registrati
          const allRelays = await relayContract.getAllRelays();
          if (allRelays.length === 0) {
            return res.status(500).json({
              success: false,
              error: "Nessun relay registrato nel contratto",
            });
          }

          let isSubscribed = false;
          for (const rAddress of allRelays) {
            const subscribed = await relayContract.isSubscriptionActive(
              userAddress,
              rAddress
            );
            if (subscribed) {
              isSubscribed = true;
              activeRelayAddress = rAddress;
              break; // Trovata una sottoscrizione attiva, non serve controllare oltre
            }
          }

          if (!isSubscribed) {
            return res.status(403).json({
              success: false,
              error:
                "Utente non ha una sottoscrizione attiva con nessun relay registrato",
            });
          }

          // Ottieni i dettagli della sottoscrizione dal relay attivo trovato
          const subscriptionDetails =
            await relayContract.getSubscriptionDetails(
              userAddress,
              activeRelayAddress
            );
          const [, , , mbAllocated] = subscriptionDetails;
          mbAllocatedNum = Number(mbAllocated); // Assegna alla variabile con scope esterno
        } catch (e) {
          console.error("Errore verifica sottoscrizione o dettagli:", e);
          return res.status(500).json({
            success: false,
            error: "Errore verifica sottoscrizione o dettagli",
            details: e.message,
          });
        }

        // Ottieni i MB utilizzati off-chain
        const currentMBUsed = await getOffChainMBUsage(userAddress);

        // Verifica se ci sono MB sufficienti
        if (currentMBUsed + fileSizeMB > mbAllocatedNum) {
          return res.status(403).json({
            success: false,
            error: "MB insufficienti per questo file",
            details: {
              requiredMB: fileSizeMB,
              currentMBUsed: currentMBUsed,
              mbAllocated: mbAllocatedNum,
              mbRemaining: mbAllocatedNum - currentMBUsed,
              fileSize: req.file.size,
            },
          });
        }

        console.log(
          `✅ L'utente ${userAddress} ha MB sufficienti (${fileSizeMB} MB richiesti, ${currentMBUsed}/${mbAllocatedNum} MB usati) tramite relay ${activeRelayAddress}`
        );

        // Upload su IPFS
        const formData = new FormData();
        formData.append("file", req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype,
        });
        const requestOptions = {
          hostname: "127.0.0.1",
          port: 5001,
          path: "/api/v0/add?wrap-with-directory=false&pin=false",
          method: "POST",
          headers: {
            ...formData.getHeaders(),
          },
        };
        if (IPFS_API_TOKEN) {
          requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
        }

        const authHeader = getIpfsAuthHeader();
        if (authHeader) {
          requestOptions.headers["Authorization"] = authHeader;
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

              const originalFileName = shouldEncrypt
                ? req.file.originalname.replace(".enc", "")
                : req.file.originalname;

              const uploadData = {
                hash: fileResult?.Hash,
                name: req.file.originalname,
                originalName: originalFileName,
                size: req.file.size,
                sizeMB: +(req.file.size / 1024 / 1024).toFixed(2),
                mimetype: req.file.mimetype,
                uploadedAt: Date.now(),
                userAddress: userAddress,
                encrypted: shouldEncrypt,
                encryptionKey: shouldEncrypt ? encryptionKey : null,
                ipfsUrl: `${req.protocol}://${req.get("host")}/ipfs-content/${
                  fileResult?.Hash
                }`,
                gatewayUrl: `${IPFS_GATEWAY_URL}/ipfs/${fileResult?.Hash}`,
                publicGateway: `https://ipfs.io/ipfs/${fileResult?.Hash}`,
              };

              try {
                await saveUploadAndUpdateMB(
                  userAddress,
                  fileResult?.Hash,
                  uploadData,
                  fileSizeMB
                );

                res.json({
                  success: true,
                  file: {
                    hash: fileResult?.Hash,
                    name: req.file.originalname,
                    originalName: originalFileName,
                    size: req.file.size,
                    mimetype: req.file.mimetype,
                    encrypted: shouldEncrypt,
                    ipfsUrl: `${req.protocol}://${req.get(
                      "host"
                    )}/ipfs-content/${fileResult?.Hash}`,
                    gatewayUrl: `${IPFS_GATEWAY_URL}/ipfs/${fileResult?.Hash}`,
                    publicGateway: `https://ipfs.io/ipfs/${fileResult?.Hash}`,
                  },
                  user: {
                    address: userAddress,
                  },
                  mbUsage: {
                    actualSizeMB: +(req.file.size / 1024 / 1024).toFixed(2),
                    sizeMB: fileSizeMB,
                    verified: true,
                  },
                  encryption: {
                    enabled: shouldEncrypt,
                    method: shouldEncrypt
                      ? "wallet-signature-deterministic"
                      : "none",
                  },
                  ipfsResponse: results,
                });
              } catch (saveError) {
                console.error("Errore salvataggio upload:", saveError);
                res.status(500).json({
                  success: false,
                  error: "Errore salvataggio dati upload",
                  details: saveError.message,
                });
              }
            } catch (parseError) {
              res.status(500).json({
                success: false,
                error: "Impossibile parsare la risposta IPFS",
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
            res.status(408).json({ success: false, error: "Timeout upload" });
          }
        });

        formData.pipe(ipfsReq);
      } catch (error) {
        console.error("Errore upload:", error);
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Funzione helper per ottenere i MB utilizzati off-chain calcolandoli in tempo reale dai file
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

            return calculatedMbUsed;
          }
        } catch (recalcError) {
          console.error(
            "Error recalculating MB usage from files:",
            recalcError
          );
        }
      }

      return offChainUsage.mbUsed || 0;
    } catch (error) {
      console.error("Error getting off-chain MB usage:", error);
      return 0;
    }
  }

  // Funzione helper per trovare il relay corrente basandosi sull'URL
  async function getCurrentRelayAddress() {
    try {
      if (!relayContract) {
        console.error("Relay contract not initialized");
        return null;
      }

      // Ottieni l'URL corrente del server
      const serverURL = process.env.SERVER_URL || "http://localhost:3000";
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

  // Funzione helper per salvare upload (senza aggiornare MB counter, calcoliamo in tempo reale)
  async function saveUploadAndUpdateMB(
    userAddress,
    fileHash,
    uploadData,
    fileSizeMB
  ) {
    return new Promise(async (resolve, reject) => {
      try {
        console.log(
          `💾 Saving upload for user: ${userAddress}, file: ${fileHash} (${fileSizeMB} MB)`
        );

        // Salva l'upload nel database Gun
        const uploadNode = gun.get("shogun").get("uploads").get(userAddress);
        const dataToSave = {};
        dataToSave[fileHash] = uploadData;

        // Salva l'upload con timeout esteso
        const uploadPromise = new Promise((uploadResolve, uploadReject) => {
          const timeoutId = setTimeout(() => {
            uploadReject(new Error("Upload save timeout"));
          }, 15000); // 15 secondi

          uploadNode.put(dataToSave, (ack) => {
            clearTimeout(timeoutId);
            if (ack.err) {
              uploadReject(new Error(`Upload save error: ${ack.err}`));
            } else {
              console.log(`✅ Upload saved successfully`);
              uploadResolve();
            }
          });
        });

        await uploadPromise;

        // Calcola il nuovo totale MB in tempo reale per logging
        const newTotalMB = await getOffChainMBUsage(userAddress);
        console.log(`📊 New total MB usage after upload: ${newTotalMB} MB`);

        resolve();
      } catch (error) {
        console.error("Error in saveUploadAndUpdateMB:", error);
        reject(error);
      }
    });
  }

  // Funzione helper per eliminare upload (senza aggiornare MB counter, calcoliamo in tempo reale)
  async function deleteUploadAndUpdateMB(userAddress, fileHash, fileSizeMB) {
    return new Promise(async (resolve, reject) => {
      try {
        console.log(
          `🗑️ Deleting upload for user: ${userAddress}, file: ${fileHash} (${fileSizeMB} MB)`
        );

        // Elimina l'upload dal database Gun
        const uploadNode = gun
          .get("shogun")
          .get("uploads")
          .get(userAddress)
          .get(fileHash);

        const deletePromise = new Promise((deleteResolve, deleteReject) => {
          const timeoutId = setTimeout(() => {
            deleteReject(new Error("Upload delete timeout"));
          }, 15000); // 15 secondi

          uploadNode.put(null, (ack) => {
            clearTimeout(timeoutId);
            if (ack.err) {
              deleteReject(new Error(`Upload delete error: ${ack.err}`));
            } else {
              console.log(`✅ Upload deleted successfully`);
              deleteResolve();
            }
          });
        });

        await deletePromise;

        // Calcola il nuovo totale MB in tempo reale per logging
        const newTotalMB = await getOffChainMBUsage(userAddress);
        console.log(`📊 New total MB usage after deletion: ${newTotalMB} MB`);

        resolve();
      } catch (error) {
        console.error("Error in deleteUploadAndUpdateMB:", error);
        reject(error);
      }
    });
  }

  // Endpoint per recuperare gli upload di un utente
  app.get("/api/user-uploads/:identifier", async (req, res) => {
    try {
      const { identifier } = req.params;
      if (!identifier) {
        return res
          .status(400)
          .json({ success: false, error: "Identificatore richiesto" });
      }

      console.log(`📂 Caricando upload per identificatore: ${identifier}`);

      // Recupera gli upload dal database Gun
      const uploadsNode = gun.get("shogun").get("uploads").get(identifier);

      // Usa una Promise per gestire l'asincronia di Gun
      const getUploads = () => {
        return new Promise((resolve, reject) => {
          let timeoutId;
          let dataReceived = false;

          // Timeout di 15 secondi (aumentato per dare più tempo)
          timeoutId = setTimeout(() => {
            if (!dataReceived) {
              console.log(
                `⏰ Timeout raggiunto per ${identifier}, restituendo array vuoto`
              );
              resolve([]);
            }
          }, 15000);

          // Prima leggi il nodo padre per vedere se ci sono dati
          uploadsNode.once((parentData) => {
            dataReceived = true;
            clearTimeout(timeoutId);

            console.log(`📋 Parent node data:`, parentData);
            console.log(`📋 Parent data type:`, typeof parentData);
            console.log(
              `📋 Parent data keys:`,
              parentData ? Object.keys(parentData) : "N/A"
            );

            if (!parentData || typeof parentData !== "object") {
              console.log(`❌ Nessun dato nel nodo padre per: ${identifier}`);
              resolve([]);
              return;
            }

            // Ottieni tutte le chiavi (escludendo i metadati Gun)
            const hashKeys = Object.keys(parentData).filter(
              (key) => key !== "_"
            );
            console.log(`📋 Hash keys found:`, hashKeys);

            if (hashKeys.length === 0) {
              console.log(`❌ Nessun hash trovato per: ${identifier}`);
              resolve([]);
              return;
            }

            // Leggi ogni hash individualmente dalla struttura nidificata
            let uploadsArray = [];
            let completedReads = 0;
            const totalReads = hashKeys.length;

            hashKeys.forEach((hash) => {
              console.log(`📋 Reading hash: ${hash}`);
              uploadsNode.get(hash).once((uploadData) => {
                completedReads++;
                console.log(`📋 Upload data for ${hash}:`, uploadData);

                if (uploadData && uploadData.hash) {
                  uploadsArray.push(uploadData);
                  console.log(`✅ Added upload for hash: ${hash}`);
                } else {
                  console.warn(
                    `⚠️ Invalid upload data for hash: ${hash}`,
                    uploadData
                  );
                }

                // Se abbiamo letto tutti gli hash, risolvi
                if (completedReads === totalReads) {
                  // Ordina per data di upload
                  uploadsArray.sort((a, b) => b.uploadedAt - a.uploadedAt);

                  console.log(`📋 Final uploads array:`, uploadsArray);
                  console.log(
                    `✅ Found ${uploadsArray.length} uploads for: ${identifier}`
                  );

                  resolve(uploadsArray);
                }
              });
            });
          });
        });
      };

      // Attendi i dati con timeout
      const uploadsArray = await getUploads();

      const response = {
        success: true,
        uploads: uploadsArray,
        identifier,
        count: uploadsArray.length,
        totalSizeMB: uploadsArray.reduce(
          (sum, upload) => sum + (upload.sizeMB || 0),
          0
        ),
      };

      console.log(`📋 Response finale:`, response);
      res.json(response);
    } catch (error) {
      console.error(`💥 Errore caricamento upload per ${identifier}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Endpoint per eliminare un upload specifico
  app.delete(
    "/api/user-uploads/:identifier/:hash",
    walletSignatureMiddleware,
    async (req, res) => {
      try {
        const { identifier, hash } = req.params;
        if (!identifier || !hash) {
          return res
            .status(400)
            .json({ success: false, error: "Identificatore e hash richiesti" });
        }

        console.log(`🗑️ Delete request for user: ${identifier}, file: ${hash}`);

        // 1. Prima recupera i dati del file per ottenere la dimensione
        const uploadNode = gun
          .get("shogun")
          .get("uploads")
          .get(identifier)
          .get(hash);

        const fileData = await new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error("File data read timeout"));
          }, 10000);

          uploadNode.once((data) => {
            clearTimeout(timeoutId);
            if (!data) {
              reject(new Error("File not found"));
            } else {
              resolve(data);
            }
          });
        });

        // 2. Calcola la dimensione in MB del file
        const fileSizeMB = Math.ceil(fileData.size / (1024 * 1024));
        console.log(`📊 File size: ${fileData.size} bytes (${fileSizeMB} MB)`);

        // 3. Ottieni l'utilizzo MB corrente prima dell'eliminazione
        const previousMBUsed = await getOffChainMBUsage(identifier);

        // 4. Elimina il file
        await deleteUploadAndUpdateMB(identifier, hash, fileSizeMB);

        // 5. Ottieni il nuovo utilizzo MB dopo l'eliminazione
        const newMBUsed = await getOffChainMBUsage(identifier);

        res.json({
          success: true,
          message: "Upload eliminato con successo",
          identifier,
          hash,
          deletedFile: {
            name: fileData.name,
            size: fileData.size,
            sizeMB: fileData.sizeMB,
          },
          mbUsage: {
            previousMB: previousMBUsed,
            currentMB: newMBUsed,
            freedMB: previousMBUsed - newMBUsed,
          },
        });
      } catch (error) {
        console.error("Delete error:", error);
        res.status(500).json({ success: false, error: error.message });
      }
    }
  );

  // Endpoint di debug per verificare il contenuto Gun di un utente
  app.get("/api/debug/user-uploads/:identifier", async (req, res) => {
    try {
      const { identifier } = req.params;
      if (!identifier) {
        return res
          .status(400)
          .json({ success: false, error: "Identificatore richiesto" });
      }

      console.log(`🔍 Debug: Caricando contenuto Gun per: ${identifier}`);

      const uploadsNode = gun.get("shogun").get("uploads").get(identifier);

      // Usa una Promise per gestire l'asincronia di Gun
      const getDebugData = () => {
        return new Promise((resolve, reject) => {
          let timeoutId;
          let dataReceived = false;

          // Timeout di 20 secondi per debug
          timeoutId = setTimeout(() => {
            if (!dataReceived) {
              console.log(`⏰ Debug timeout per ${identifier}`);
              resolve({ rawData: null, detailedData: {}, error: "Timeout" });
            }
          }, 20000);

          // Listener per i dati del nodo padre
          uploadsNode.once((parentData) => {
            dataReceived = true;
            clearTimeout(timeoutId);

            console.log(`🔍 Debug parent data:`, parentData);
            console.log(`🔍 Debug parent data type:`, typeof parentData);
            console.log(
              `🔍 Debug parent data keys:`,
              parentData ? Object.keys(parentData) : "N/A"
            );

            if (!parentData || typeof parentData !== "object") {
              console.log(`🔍 Debug: No parent data for ${identifier}`);
              resolve({
                rawData: parentData,
                detailedData: {},
                error: "No parent data",
              });
              return;
            }

            // Ottieni tutte le chiavi (escludendo i metadati Gun)
            const hashKeys = Object.keys(parentData).filter(
              (key) => key !== "_"
            );
            console.log(
              `🔍 Debug: Found ${hashKeys.length} hash keys:`,
              hashKeys
            );

            // Leggi ogni hash individualmente per il debug dettagliato
            let detailedData = {};
            let completedReads = 0;
            const totalReads = hashKeys.length;

            if (totalReads === 0) {
              console.log(`🔍 Debug: No hash keys found`);
              resolve({
                rawData: parentData,
                detailedData: {},
                error: "No hash keys",
              });
              return;
            }

            hashKeys.forEach((hash) => {
              console.log(`🔍 Debug: Reading hash ${hash}`);
              uploadsNode.get(hash).once((hashData) => {
                completedReads++;
                console.log(`🔍 Debug: Hash ${hash} data:`, hashData);
                detailedData[hash] = hashData;

                // Se abbiamo letto tutti gli hash, risolvi
                if (completedReads === totalReads) {
                  console.log(
                    `🔍 Debug: All hashes read, detailed data:`,
                    detailedData
                  );
                  resolve({ rawData: parentData, detailedData, error: null });
                }
              });
            });
          });
        });
      };

      const { rawData, detailedData, error } = await getDebugData();

      const response = {
        success: true,
        identifier,
        debug: {
          rawData,
          detailedData,
          dataType: typeof rawData,
          dataKeys: rawData ? Object.keys(rawData) : [],
          error,
          timestamp: Date.now(),
        },
      };

      console.log(`🔍 Debug response:`, response);
      res.json(response);
    } catch (error) {
      console.error(`💥 Debug error per ${identifier}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Endpoint di test per verificare se Gun sta funzionando
  app.get("/api/test-gun", async (req, res) => {
    try {
      console.log(`🧪 Test: Verificando funzionamento Gun DB`);

      const testNode = gun.get("shogun").get("test");
      const testData = {
        message: "Test Gun DB",
        timestamp: Date.now(),
        random: Math.random(),
      };

      // Test di scrittura
      const writeTest = () => {
        return new Promise((resolve, reject) => {
          testNode.put(testData, (ack) => {
            if (ack.err) {
              reject(new Error(`Write test failed: ${ack.err}`));
            } else {
              resolve("Write test passed");
            }
          });
        });
      };

      // Test di lettura
      const readTest = () => {
        return new Promise((resolve, reject) => {
          let timeoutId = setTimeout(() => {
            reject(new Error("Read test timeout"));
          }, 5000);

          testNode.once((data) => {
            clearTimeout(timeoutId);
            if (data && data.message === testData.message) {
              resolve("Read test passed");
            } else {
              reject(new Error("Read test failed - data mismatch"));
            }
          });
        });
      };

      // Esegui i test
      const writeResult = await writeTest();
      console.log(`🧪 ${writeResult}`);

      // Aspetta un po' prima di leggere
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const readResult = await readTest();
      console.log(`🧪 ${readResult}`);

      // Verifica lo stato dei peer
      const peerInfo = {
        activeWires,
        totalConnections,
        peers: peers,
        gunConfig: {
          file: gunConfig.file,
          radisk: gunConfig.radisk,
          localStorage: gunConfig.localStorage,
          wire: gunConfig.wire,
          webrtc: gunConfig.webrtc,
        },
      };

      res.json({
        success: true,
        message: "Gun DB test completed successfully",
        writeTest: writeResult,
        readTest: readResult,
        peerInfo,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(`💥 Gun test error:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Gun DB test failed",
      });
    }
  });

  // Endpoint di test per verificare il salvataggio di un file specifico
  app.get("/api/test-gun-save/:identifier/:hash", async (req, res) => {
    try {
      const { identifier, hash } = req.params;
      console.log(`🧪 Test: Verificando salvataggio per ${identifier}/${hash}`);

      const uploadNode = gun.get("shogun").get("uploads").get(identifier);

      // Test di scrittura
      const testData = {
        hash: hash,
        name: "test-file.jpg",
        size: 1024,
        sizeMB: 0.001,
        mimetype: "image/jpeg",
        uploadedAt: Date.now(),
        userAddress: identifier,
        test: true,
      };

      const writeTest = () => {
        return new Promise((resolve, reject) => {
          uploadNode.get(hash).put(testData, (ack) => {
            if (ack.err) {
              reject(new Error(`Write test failed: ${ack.err}`));
            } else {
              resolve("Write test passed");
            }
          });
        });
      };

      // Test di lettura
      const readTest = () => {
        return new Promise((resolve, reject) => {
          let timeoutId = setTimeout(() => {
            reject(new Error("Read test timeout"));
          }, 5000);

          uploadNode.get(hash).once((data) => {
            clearTimeout(timeoutId);
            if (data && data.hash === hash) {
              resolve("Read test passed");
            } else {
              reject(new Error("Read test failed - data mismatch"));
            }
          });
        });
      };

      // Test di persistenza (verifica dopo riavvio)
      const persistenceTest = () => {
        return new Promise((resolve, reject) => {
          let timeoutId = setTimeout(() => {
            reject(new Error("Persistence test timeout"));
          }, 3000);

          // Prova a leggere i dati dopo un breve delay
          setTimeout(() => {
            uploadNode.get(hash).once((data) => {
              clearTimeout(timeoutId);
              if (data && data.hash === hash) {
                resolve("Persistence test passed");
              } else {
                reject(new Error("Persistence test failed - data not found"));
              }
            });
          }, 1000);
        });
      };

      // Esegui i test
      const writeResult = await writeTest();
      console.log(`🧪 ${writeResult}`);

      // Aspetta un po' prima di leggere
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const readResult = await readTest();
      console.log(`🧪 ${readResult}`);

      // Test di persistenza
      const persistenceResult = await persistenceTest();
      console.log(`🧪 ${persistenceResult}`);

      res.json({
        success: true,
        message: "Gun save test completed successfully",
        identifier,
        hash,
        writeTest: writeResult,
        readTest: readResult,
        persistenceTest: persistenceResult,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(`💥 Gun save test error:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Gun save test failed",
      });
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
  app.set('gunInstance', gun);
  
  // Esponi l'istanza Gun globalmente per le route
  global.gunInstance = gun;

  // Importa e configura le route di autenticazione
  try {
    const routes = require('./routes/index.js');
    routes(app);
    console.log('✅ Route di autenticazione configurate con successo');
  } catch (error) {
    console.error('❌ Errore nel caricamento delle route di autenticazione:', error);
  }

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

        const authHeader = getIpfsAuthHeader();
        if (authHeader) {
          requestOptions.headers["Authorization"] = authHeader;
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

  // Endpoint per esporre la configurazione del contratto
  app.get("/api/contract-config", (req, res) => {
    res.json({
      success: true,
      contract: {
        address: RELAY_CONTRACT_ADDRESS,
        network: "sepolia",
        provider: WEB3_PROVIDER_URL ? "configured" : "not configured",
      },
      relay: {
        address: process.env.RELAY_HOST || ip.address(),
        port: port,
        url: `http://${process.env.RELAY_HOST || ip.address()}:${port}`,
      },
    });
  });

  // Endpoint per verificare lo stato del contratto
  app.get("/api/contract-status", async (req, res) => {
    try {
      if (!RELAY_CONTRACT_ADDRESS) {
        return res.json({
          success: false,
          error: "RELAY_CONTRACT_ADDRESS not configured",
          contract: {
            address: null,
            configured: false,
          },
        });
      }

      if (!process.env.ALCHEMY_API_KEY) {
        return res.json({
          success: false,
          error: "ALCHEMY_API_KEY not configured",
          contract: {
            address: RELAY_CONTRACT_ADDRESS,
            configured: true,
            provider: "not configured",
          },
        });
      }

      if (!relayContract) {
        return res.json({
          success: false,
          error: "Contract not initialized",
          contract: {
            address: RELAY_CONTRACT_ADDRESS,
            configured: true,
            provider: "configured",
            initialized: false,
          },
        });
      }

      // Get network information
      const network = await provider.getNetwork();
      const isSepolia = network.chainId === 11155111n;

      // Verifica se il contratto è accessibile
      const pricePerGB = await relayContract.PRICE_PER_GB();
      const allRelays = await relayContract.getAllRelays();

      res.json({
        success: true,
        contract: {
          address: RELAY_CONTRACT_ADDRESS,
          configured: true,
          accessible: true,
          pricePerGB: ethers.formatEther(pricePerGB),
          registeredRelays: allRelays.length,
          relays: allRelays,
        },
        network: {
          name: network.name,
          chainId: Number(network.chainId),
          isSepolia: isSepolia,
          provider: "Alchemy Sepolia",
        },
        relay: {
          address: process.env.RELAY_HOST || ip.address(),
          port: port,
          url: `http://${process.env.RELAY_HOST || ip.address()}:${port}`,
        },
      });
    } catch (error) {
      console.error("Contract status error:", error);

      // Try to get network info even if contract fails
      let networkInfo = null;
      try {
        if (provider) {
          const network = await provider.getNetwork();
          networkInfo = {
            name: network.name,
            chainId: Number(network.chainId),
            isSepolia: network.chainId === 11155111n,
            provider: "Alchemy Sepolia",
          };
        }
      } catch (networkError) {
        console.error("Network info error:", networkError);
      }

      res.json({
        success: false,
        error: error.message,
        contract: {
          address: RELAY_CONTRACT_ADDRESS,
          configured: !!RELAY_CONTRACT_ADDRESS,
          provider: process.env.ALCHEMY_API_KEY
            ? "configured"
            : "not configured",
          accessible: false,
        },
        network: networkInfo,
      });
    }
  });

  // Endpoint per verificare lo stato della sottoscrizione di un utente specifico
  app.get("/api/user-subscription/:userAddress", async (req, res) => {
    try {
      const { userAddress } = req.params;

      if (!userAddress) {
        return res.status(400).json({
          success: false,
          error: "Indirizzo utente richiesto",
        });
      }

      if (!relayContract) {
        return res.status(500).json({
          success: false,
          error: "Contratto relay non configurato",
        });
      }

      // Ottieni tutti i relay registrati
      const allRelays = await relayContract.getAllRelays();
      if (allRelays.length === 0) {
        return res.json({
          success: true,
          userAddress,
          subscription: {
            isActive: false,
            reason: "Nessun relay registrato nel contratto",
          },
        });
      }

      // Trova il relay corrente basandosi sull'URL
      const relayAddress = await getCurrentRelayAddress();
      if (!relayAddress) {
        return res.json({
          success: true,
          userAddress,
          subscription: {
            isActive: false,
            reason: "Impossibile trovare il relay corrente",
          },
        });
      }

      try {
        // Prova prima con checkUserSubscription
        const isSubscribed = await relayContract.checkUserSubscription(
          userAddress
        );

        if (isSubscribed) {
          // Ottieni i dettagli della sottoscrizione dal contratto
          const subscriptionDetails =
            await relayContract.getSubscriptionDetails(
              userAddress,
              relayAddress
            );

          const [
            startTime,
            endTime,
            amountPaid,
            mbAllocated,
            isActiveStatus,
          ] = subscriptionDetails;

          // Ottieni l'uso MB off-chain dal database Gun
          const mbUsedNum = await getOffChainMBUsage(userAddress);
          const mbAllocatedNum = Number(mbAllocated);
          const mbRemainingNum = Math.max(0, mbAllocatedNum - mbUsedNum);

          const usagePercentage =
            mbAllocatedNum > 0 ? (mbUsedNum / mbAllocatedNum) * 100 : 0;

          res.json({
            success: true,
            identifier,
            relayAddress,
            subscription: {
              isActive: isActiveStatus,
              startTime: Number(startTime),
              endTime: Number(endTime),
              amountPaid: ethers.formatEther(amountPaid),
              mbAllocated: mbAllocatedNum,
              mbUsed: mbUsedNum,
              mbRemaining: mbRemainingNum,
              startDate: new Date(Number(startTime) * 1000).toISOString(),
              endDate: new Date(Number(endTime) * 1000).toISOString(),
              daysRemaining: Math.max(
                0,
                Math.ceil(
                  (Number(endTime) * 1000 - Date.now()) / (1000 * 60 * 60 * 24)
                )
              ),
            },
          });
        } else {
          res.json({
            success: true,
            userAddress,
            relayAddress,
            subscription: {
              isActive: false,
              reason: "Nessuna sottoscrizione attiva trovata",
            },
          });
        }
      } catch (contractError) {
        console.error("Errore verifica sottoscrizione:", contractError);

        // Fallback: prova con isSubscriptionActive
        try {
          const isActive = await relayContract.isSubscriptionActive(
            userAddress,
            relayAddress
          );

          res.json({
            success: true,
            userAddress,
            relayAddress,
            subscription: {
              isActive: isActive,
              reason: isActive
                ? "Sottoscrizione attiva"
                : "Sottoscrizione non attiva",
              fallback: true,
            },
          });
        } catch (fallbackError) {
          console.error(
            "Errore fallback verifica sottoscrizione:",
            fallbackError
          );
          res.status(500).json({
            success: false,
            error: "Errore verifica sottoscrizione",
            details: fallbackError.message,
          });
        }
      }
    } catch (error) {
      console.error("Errore endpoint user-subscription:", error);
      res.status(500).json({
        success: false,
        error: "Errore interno del server",
        details: error.message,
      });
    }
  });

  // Endpoint ibrido per verificare lo stato della sottoscrizione (usa solo userAddress)
  app.get("/api/subscription-status/:identifier", async (req, res) => {
    try {
      const { identifier } = req.params;

      if (!identifier) {
        return res.status(400).json({
          success: false,
          error: "Identificatore richiesto (userAddress)",
        });
      }

      if (!relayContract) {
        return res.status(500).json({
          success: false,
          error: "Contratto relay non configurato",
        });
      }

      // Ottieni tutti i relay registrati
      const allRelays = await relayContract.getAllRelays();

      if (allRelays.length === 0) {
        return res.json({
          success: true,
          identifier,
          subscription: {
            isActive: false,
            reason: "Nessun relay registrato nel contratto",
          },
        });
      }

      // Verifica la sottoscrizione per il primo relay
      const relayAddress = allRelays[0];

      try {
        let isSubscribed = false;
        let subscriptionDetails = null;

        // Verifica se l'identificatore è un indirizzo Ethereum
        if (identifier.startsWith("0x") && identifier.length === 42) {
          // È un indirizzo Ethereum
          console.log(
            `Verificando sottoscrizione per indirizzo: ${identifier}`
          );

          // IMPORTANTE: Usa isSubscriptionActive per verificare lo stato della sottoscrizione
          // perché questa funzione verifica correttamente lo stato tra utente e relay
          isSubscribed = await relayContract.isSubscriptionActive(
            identifier,
            relayAddress
          );

          if (isSubscribed) {
            subscriptionDetails = await relayContract.getSubscriptionDetails(
              identifier,
              relayAddress
            );
          }
        } else {
          // Non è un indirizzo valido
          return res.json({
            success: true,
            identifier,
            subscription: {
              isActive: false,
              reason:
                "Identificatore non valido - deve essere un indirizzo Ethereum",
            },
          });
        }

        if (isSubscribed && subscriptionDetails) {
          const [
            startTime,
            endTime,
            amountPaid,
            mbAllocated,
            isActive,
          ] = subscriptionDetails;

          res.json({
            success: true,
            identifier,
            relayAddress,
            subscription: {
              isActive: isActive,
              startTime: Number(startTime),
              endTime: Number(endTime),
              amountPaid: ethers.formatEther(amountPaid),
              mbAllocated: Number(mbAllocated),
              mbUsed: 0, // Non disponibile dal contratto
              mbRemaining: Number(mbAllocated), // Assumiamo che non sia stato usato
              startDate: new Date(Number(startTime) * 1000).toISOString(),
              endDate: new Date(Number(endTime) * 1000).toISOString(),
              daysRemaining: Math.max(
                0,
                Math.ceil(
                  (Number(endTime) * 1000 - Date.now()) / (1000 * 60 * 60 * 24)
                )
              ),
            },
          });
        } else {
          res.json({
            success: true,
            identifier,
            relayAddress,
            subscription: {
              isActive: false,
              reason: "Nessuna sottoscrizione attiva trovata",
            },
          });
        }
      } catch (contractError) {
        console.error("Errore verifica sottoscrizione:", contractError);

        // Fallback: prova con isSubscriptionActive
        try {
          let isActive = false;

          if (identifier.startsWith("0x") && identifier.length === 42) {
            isActive = await relayContract.isSubscriptionActive(
              identifier,
              relayAddress
            );
          }

          res.json({
            success: true,
            identifier,
            relayAddress,
            subscription: {
              isActive: isActive,
              reason: isActive
                ? "Sottoscrizione attiva"
                : "Sottoscrizione non attiva",
              fallback: true,
            },
          });
        } catch (fallbackError) {
          console.error(
            "Errore fallback verifica sottoscrizione:",
            fallbackError
          );
          res.status(500).json({
            success: false,
            error: "Errore verifica sottoscrizione",
            details: fallbackError.message,
          });
        }
      }
    } catch (error) {
      console.error("Errore endpoint subscription-status:", error);
      res.status(500).json({
        success: false,
        error: "Errore interno del server",
        details: error.message,
      });
    }
  });

  // Endpoint centralizzato per ottenere i dettagli completi della sottoscrizione
  app.get("/api/user-subscription-details/:userAddress", async (req, res) => {
    try {
      const { userAddress } = req.params;

      if (!userAddress) {
        return res.status(400).json({
          success: false,
          error: "Indirizzo utente richiesto",
        });
      }

      if (!relayContract) {
        return res.status(500).json({
          success: false,
          error: "Contratto relay non configurato",
        });
      }

      // Ottieni tutti i relay registrati
      const allRelays = await relayContract.getAllRelays();
      if (allRelays.length === 0) {
        return res.json({
          success: true,
          userAddress,
          subscription: {
            isActive: false,
            reason: "Nessun relay registrato nel contratto",
          },
        });
      }

      const relayAddress = allRelays[0];

      try {
        // Verifica se l'utente ha una sottoscrizione attiva
        const isActive = await relayContract.isSubscriptionActive(
          userAddress,
          relayAddress
        );

        if (isActive) {
          // Ottieni i dettagli completi della sottoscrizione dal contratto
          const subscriptionDetails =
            await relayContract.getSubscriptionDetails(
              userAddress,
              relayAddress
            );

          const [
            startTime,
            endTime,
            amountPaid,
            mbAllocated,
            contractMbUsed,
            contractMbRemaining,
            isActiveStatus,
          ] = subscriptionDetails;

          // Ottieni l'uso MB off-chain dal database Gun
          const mbUsedNum = await getOffChainMBUsage(userAddress);
          const mbAllocatedNum = Number(mbAllocated);
          const mbRemainingNum = Math.max(0, mbAllocatedNum - mbUsedNum);

          const usagePercentage =
            mbAllocatedNum > 0 ? (mbUsedNum / mbAllocatedNum) * 100 : 0;

          console.log(
            `📊 user-subscription-details: Final calculation for ${userAddress}:`
          );
          console.log(
            `📊 user-subscription-details: - MB Allocated: ${mbAllocatedNum}`
          );
          console.log(
            `📊 user-subscription-details: - MB Used (off-chain): ${mbUsedNum}`
          );
          console.log(
            `📊 user-subscription-details: - MB Remaining: ${mbRemainingNum}`
          );
          console.log(
            `📊 user-subscription-details: - Usage: ${usagePercentage.toFixed(
              2
            )}%`
          );

          res.json({
            success: true,
            userAddress,
            relayAddress,
            subscription: {
              isActive: isActiveStatus,
              startTime: Number(startTime),
              endTime: Number(endTime),
              amountPaid: ethers.formatEther(amountPaid),
              mbAllocated: mbAllocatedNum,
              mbUsed: mbUsedNum,
              mbRemaining: mbRemainingNum,
              usagePercentage: Math.round(usagePercentage * 100) / 100,
              startDate: new Date(Number(startTime) * 1000).toISOString(),
              endDate: new Date(Number(endTime) * 1000).toISOString(),
              daysRemaining: Math.max(
                0,
                Math.ceil(
                  (Number(endTime) * 1000 - Date.now()) / (1000 * 60 * 60 * 24)
                )
              ),
              storage: "off-chain",
              lastUpdated: new Date().toISOString(),
            },
          });
        } else {
          res.json({
            success: true,
            userAddress,
            relayAddress,
            subscription: {
              isActive: false,
              reason: "Nessuna sottoscrizione attiva trovata",
            },
          });
        }
      } catch (contractError) {
        console.error(
          "Errore verifica dettagli sottoscrizione:",
          contractError
        );
        res.status(500).json({
          success: false,
          error: "Errore verifica dettagli sottoscrizione",
          details: contractError.message,
        });
      }
    } catch (error) {
      console.error("Errore endpoint user-subscription-details:", error);
      res.status(500).json({
        success: false,
        error: "Errore interno del server",
        details: error.message,
      });
    }
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

    console.log(
      `🔍 IPFS Content Request - CID: ${cid}, Token: ${
        token ? "present" : "missing"
      }`
    );
    if (token) {
      console.log(
        `🔑 Token length: ${token.length}, Token preview: ${token.substring(
          0,
          10
        )}...`
      );
      console.log(`🔑 Raw token from query: ${token}`);
      console.log(`🔑 Decoded token: ${decodeURIComponent(token)}`);
    }

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
            console.log(`🧪 Received content length: ${body.length}`);
            console.log(`🧪 Content preview: ${body.substring(0, 100)}...`);
            console.log(`🧪 Token being used: ${token.substring(0, 20)}...`);
            console.log(`🧪 Token length: ${token.length}`);

            const decrypted = await SEA.decrypt(body, token);

            if (decrypted) {
              console.log(`🧪 Decryption successful!`);
              console.log(
                `🧪 Decrypted preview: ${decrypted.substring(0, 100)}...`
              );

              // Controlla se i dati decrittati sono un data URL (es. data:image/jpeg;base64,...)
              if (decrypted.startsWith("data:")) {
                console.log(
                  `📁 Detected data URL, extracting content type and data`
                );

                // Estrai il content type e i dati dal data URL
                const matches = decrypted.match(/^data:([^;]+);base64,(.+)$/);
                if (matches) {
                  const contentType = matches[1];
                  const base64Data = matches[2];

                  console.log(`📁 Content type: ${contentType}`);
                  console.log(`📁 Base64 data length: ${base64Data.length}`);

                  // Decodifica il base64 e restituisci direttamente
                  const buffer = Buffer.from(base64Data, "base64");

                  res.setHeader("Content-Type", contentType);
                  res.setHeader("Content-Length", buffer.length);
                  res.setHeader("Cache-Control", "public, max-age=3600");
                  res.send(buffer);
                } else {
                  // Fallback: restituisci come JSON se non riesci a parsare il data URL
                  res.json({
                    success: true,
                    message:
                      "Decryption successful but could not parse data URL",
                    decryptedData: decrypted,
                    originalLength: body.length,
                    decryptedLength: decrypted.length,
                    extractedCid: cid,
                  });
                }
              } else {
                // Se non è un data URL, potrebbe essere testo o altri dati
                // Prova a determinare il content type basandosi sui primi byte
                let contentType = "text/plain";

                if (decrypted.startsWith("\xff\xd8\xff")) {
                  contentType = "image/jpeg";
                } else if (decrypted.startsWith("\x89PNG\r\n\x1a\n")) {
                  contentType = "image/png";
                } else if (
                  decrypted.startsWith("GIF87a") ||
                  decrypted.startsWith("GIF89a")
                ) {
                  contentType = "image/gif";
                } else if (
                  decrypted.startsWith("RIFF") &&
                  decrypted.includes("WEBP")
                ) {
                  contentType = "image/webp";
                } else if (decrypted.startsWith("PK")) {
                  contentType = "application/zip";
                } else if (
                  decrypted.startsWith("{") ||
                  decrypted.startsWith("[")
                ) {
                  contentType = "application/json";
                }

                console.log(`📁 Detected content type: ${contentType}`);

                const buffer = Buffer.from(decrypted, "utf8");
                res.setHeader("Content-Type", contentType);
                res.setHeader("Content-Length", buffer.length);
                res.setHeader("Cache-Control", "public, max-age=3600");
                res.send(buffer);
              }
            } else {
              console.log(
                `🧪 Decryption returned null - token might be wrong or content not encrypted`
              );
              res.json({
                success: false,
                error:
                  "Decryption returned null - token might be wrong or content not encrypted",
                contentPreview: body.substring(0, 100) + "...",
                tokenLength: token.length,
                tokenPreview: token.substring(0, 20) + "...",
                extractedCid: cid,
              });
            }
          } catch (e) {
            console.error(`🧪 Decryption error:`, e);
            console.error(`🧪 Error name:`, e.name);
            console.error(`🧪 Error message:`, e.message);
            console.error(`🧪 Error stack:`, e.stack);
            res.json({
              success: false,
              error: "Decryption error",
              details: e.message,
              errorName: e.name,
              contentPreview: body.substring(0, 100) + "...",
              tokenLength: token.length,
              tokenPreview: token.substring(0, 20) + "...",
              extractedCid: cid,
            });
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
              dweb: `https://dweb.link/ipfs/${cid}`,
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
              dweb: `https://dweb.link/ipfs/${cid}`,
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

  // Endpoint alternativo che restituisce sempre JSON per la decrittazione
  app.get("/ipfs-content-json/:cid", async (req, res) => {
    const { cid } = req.params;
    const { token } = req.query;

    console.log(
      `🔍 IPFS Content JSON Request - CID: ${cid}, Token: ${
        token ? "present" : "missing"
      }`
    );

    if (!cid) {
      return res.status(400).json({
        success: false,
        error: "CID is required",
      });
    }

    if (!token) {
      return res.status(400).json({
        success: false,
        error: "Token is required for decryption",
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
        console.log(`🔓 Attempting decryption for CID: ${cid}`);
        let body = "";
        ipfsRes.on("data", (chunk) => (body += chunk));
        ipfsRes.on("end", async () => {
          try {
            console.log(`🧪 Received content length: ${body.length}`);
            console.log(`🧪 Content preview: ${body.substring(0, 100)}...`);

            const decrypted = await SEA.decrypt(body, token);

            if (decrypted) {
              console.log(`🧪 Decryption successful!`);
              console.log(
                `🧪 Decrypted preview: ${decrypted.substring(0, 100)}...`
              );

              res.json({
                success: true,
                message: "Decryption successful",
                decryptedData: decrypted,
                originalLength: body.length,
                decryptedLength: decrypted.length,
                extractedCid: cid,
                contentType: decrypted.startsWith("data:")
                  ? decrypted.match(/^data:([^;]+);/)?.[1] || "unknown"
                  : "raw-data",
              });
            } else {
              console.log(
                `🧪 Decryption returned null - token might be wrong or content not encrypted`
              );
              res.json({
                success: false,
                error:
                  "Decryption returned null - token might be wrong or content not encrypted",
                contentPreview: body.substring(0, 100) + "...",
                tokenLength: token.length,
                tokenPreview: token.substring(0, 20) + "...",
                extractedCid: cid,
              });
            }
          } catch (e) {
            console.error(`🧪 Decryption error:`, e);
            res.json({
              success: false,
              error: "Decryption error",
              details: e.message,
              errorName: e.name,
              contentPreview: body.substring(0, 100) + "...",
              tokenLength: token.length,
              tokenPreview: token.substring(0, 20) + "...",
              extractedCid: cid,
            });
          }
        });

        ipfsReq.on("error", (err) => {
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
          });
        }
      });
    } catch (error) {
      console.error(
        `❌ Error handling IPFS content JSON request: ${error.message}`
      );
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

  // Endpoint per sincronizzare i MB utilizzati calcolandoli dai file effettivamente caricati
  app.post(
    "/api/sync-mb-usage/:userAddress",
    walletSignatureMiddleware,
    async (req, res) => {
      try {
        const { userAddress } = req.params;

        if (!userAddress) {
          return res.status(400).json({
            success: false,
            error: "Indirizzo utente richiesto",
          });
        }

        console.log(`🔄 Syncing MB usage for user: ${userAddress}`);

        // Usa la funzione getOffChainMBUsage che ora calcola in tempo reale
        const totalSizeMB = await getOffChainMBUsage(userAddress);

        // Ottieni anche il numero di file per completezza
        const uploadsNode = gun.get("shogun").get("uploads").get(userAddress);
        const fileCount = await new Promise((resolve) => {
          const timeoutId = setTimeout(() => {
            resolve(0);
          }, 5000);

          uploadsNode.once((parentData) => {
            clearTimeout(timeoutId);
            if (!parentData || typeof parentData !== "object") {
              resolve(0);
              return;
            }
            const hashKeys = Object.keys(parentData).filter(
              (key) => key !== "_"
            );
            resolve(hashKeys.length);
          });
        });

        console.log(
          `✅ MB usage synced: ${totalSizeMB} MB (${fileCount} files)`
        );

        res.json({
          success: true,
          message: "MB usage synchronized successfully",
          userAddress,
          mbUsed: totalSizeMB,
          fileCount: fileCount,
          lastUpdated: new Date().toISOString(),
          storage: "real-time-calculation",
        });
      } catch (error) {
        console.error("Sync MB usage error:", error);
        res.status(500).json({
          success: false,
          error: "Errore interno del server",
          details: error.message,
        });
      }
    }
  );

  // Debug endpoint per verificare i dati MB usage
  app.get("/api/debug/mb-usage/:userAddress", async (req, res) => {
    try {
      const { userAddress } = req.params;

      if (!userAddress) {
        return res.status(400).json({
          success: false,
          error: "Indirizzo utente richiesto",
        });
      }

      console.log(`🔍 debug: Checking MB usage for ${userAddress}`);

      // Ottieni i dati dal database Gun
      const mbUsedNum = await getOffChainMBUsage(userAddress);

      // Ottieni anche i dati dal contratto per confronto
      let contractData = null;
      try {
        if (relayContract) {
          const allRelays = await relayContract.getAllRelays();
          if (allRelays.length > 0) {
            const relayAddress = allRelays[0];
            const subscriptionDetails =
              await relayContract.getSubscriptionDetails(
                userAddress,
                relayAddress
              );
            const [
              startTime,
              endTime,
              amountPaid,
              mbAllocated,
              contractMbUsed,
              contractMbRemaining,
              isActiveStatus,
            ] = subscriptionDetails;

            contractData = {
              isActive: isActiveStatus,
              mbAllocated: Number(mbAllocated),
              mbUsed: Number(contractMbUsed),
              mbRemaining: Number(contractMbRemaining),
              relayAddress,
            };
          }
        }
      } catch (contractError) {
        console.error("Error getting contract data:", contractError);
      }

      res.json({
        success: true,
        userAddress,
        offChainUsage: {
          mbUsed: mbUsedNum,
          lastUpdated: new Date().toISOString(),
        },
        contractData,
        calculated: {
          mbUsed: mbUsedNum,
          mbAllocated: contractData?.mbAllocated || 0,
          mbRemaining: contractData
            ? Math.max(0, contractData.mbAllocated - mbUsedNum)
            : 0,
        },
      });
    } catch (error) {
      console.error("Debug MB usage error:", error);
      res.status(500).json({
        success: false,
        error: "Errore interno del server",
        details: error.message,
      });
    }
  });

  // Endpoint per verificare l'utilizzo MB di un utente
  app.get("/api/user-mb-usage/:identifier", async (req, res) => {
    try {
      const { identifier } = req.params;
      if (!identifier) {
        return res
          .status(400)
          .json({ success: false, error: "Identificatore richiesto" });
      }

      console.log(`📊 MB usage request for user: ${identifier}`);

      // Ottieni l'utilizzo MB corrente
      const currentMBUsed = await getOffChainMBUsage(identifier);

      // Se l'utente ha un contratto, ottieni anche i dettagli della sottoscrizione
      let subscriptionDetails = null;
      if (relayContract) {
        try {
          const allRelays = await relayContract.getAllRelays();
          if (allRelays.length > 0) {
            const relayAddress = allRelays[0];
            const isSubscribed = await relayContract.isSubscriptionActive(
              identifier,
              relayAddress
            );

            if (isSubscribed) {
              const details = await relayContract.getSubscriptionDetails(
                identifier,
                relayAddress
              );
              const [, , , mbAllocated] = details;
              subscriptionDetails = {
                isActive: true,
                mbAllocated: Number(mbAllocated),
                mbRemaining: Number(mbAllocated) - currentMBUsed,
                relayAddress,
              };
            } else {
              subscriptionDetails = {
                isActive: false,
                mbAllocated: 0,
                mbRemaining: 0,
                relayAddress,
              };
            }
          }
        } catch (contractError) {
          console.warn(
            `⚠️ Contract error for ${identifier}:`,
            contractError.message
          );
          subscriptionDetails = {
            isActive: false,
            error: contractError.message,
          };
        }
      }

      res.json({
        success: true,
        user: {
          identifier,
        },
        mbUsage: {
          currentMB: currentMBUsed,
          lastUpdated: Date.now(),
        },
        subscription: subscriptionDetails,
      });
    } catch (error) {
      console.error("MB usage check error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Endpoint di debug per verificare il contenuto Gun di un utente
  app.get("/api/debug/user-uploads/:identifier", async (req, res) => {
    try {
      const { identifier } = req.params;
      if (!identifier) {
        return res
          .status(400)
          .json({ success: false, error: "Identificatore richiesto" });
      }

      console.log(`🔍 Debug: Caricando contenuto Gun per: ${identifier}`);

      const uploadsNode = gun.get("shogun").get("uploads").get(identifier);

      // Usa una Promise per gestire l'asincronia di Gun
      const getDebugData = () => {
        return new Promise((resolve, reject) => {
          let timeoutId;
          let dataReceived = false;

          // Timeout di 20 secondi per debug
          timeoutId = setTimeout(() => {
            if (!dataReceived) {
              console.log(`⏰ Debug timeout per ${identifier}`);
              resolve({ rawData: null, detailedData: {}, error: "Timeout" });
            }
          }, 20000);

          // Listener per i dati del nodo padre
          uploadsNode.once((parentData) => {
            dataReceived = true;
            clearTimeout(timeoutId);

            console.log(`🔍 Debug parent data:`, parentData);
            console.log(`🔍 Debug parent data type:`, typeof parentData);
            console.log(
              `🔍 Debug parent data keys:`,
              parentData ? Object.keys(parentData) : "N/A"
            );

            if (!parentData || typeof parentData !== "object") {
              console.log(`🔍 Debug: No parent data for ${identifier}`);
              resolve({
                rawData: parentData,
                detailedData: {},
                error: "No parent data",
              });
              return;
            }

            // Ottieni tutte le chiavi (escludendo i metadati Gun)
            const hashKeys = Object.keys(parentData).filter(
              (key) => key !== "_"
            );
            console.log(
              `🔍 Debug: Found ${hashKeys.length} hash keys:`,
              hashKeys
            );

            // Leggi ogni hash individualmente per il debug dettagliato
            let detailedData = {};
            let completedReads = 0;
            const totalReads = hashKeys.length;

            if (totalReads === 0) {
              console.log(`🔍 Debug: No hash keys found`);
              resolve({
                rawData: parentData,
                detailedData: {},
                error: "No hash keys",
              });
              return;
            }

            hashKeys.forEach((hash) => {
              console.log(`🔍 Debug: Reading hash ${hash}`);
              uploadsNode.get(hash).once((hashData) => {
                completedReads++;
                console.log(`🔍 Debug: Hash ${hash} data:`, hashData);
                detailedData[hash] = hashData;

                // Se abbiamo letto tutti gli hash, risolvi
                if (completedReads === totalReads) {
                  console.log(
                    `🔍 Debug: All hashes read, detailed data:`,
                    detailedData
                  );
                  resolve({ rawData: parentData, detailedData, error: null });
                }
              });
            });
          });
        });
      };

      const { rawData, detailedData, error } = await getDebugData();

      const response = {
        success: true,
        identifier,
        debug: {
          rawData,
          detailedData,
          dataType: typeof rawData,
          dataKeys: rawData ? Object.keys(rawData) : [],
          error,
          timestamp: Date.now(),
        },
      };

      console.log(`🔍 Debug response:`, response);
      res.json(response);
    } catch (error) {
      console.error(`💥 Debug error per ${identifier}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
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
  process.on("SIGINT", async () => {
    await shutdown();
  });

  process.on("SIGTERM", async () => {
    await shutdown();
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

      // Verifica che sia una richiesta admin (puoi aggiungere autenticazione se necessario)
      const adminToken = req.headers.authorization?.replace("Bearer ", "");
      if (!adminToken || adminToken !== process.env.ADMIN_TOKEN) {
        return res.status(401).json({
          success: false,
          error: "Admin token required for MB reset",
        });
      }

      // Ottieni l'utilizzo MB corrente prima del reset
      const previousMBUsed = await getOffChainMBUsage(identifier);

      // Reset dell'utilizzo MB
      const mbUsageNode = gun.get("shogun").get("mb_usage").get(identifier);

      const resetPromise = new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("MB reset timeout"));
        }, 15000);

        const resetData = {
          mbUsed: 0,
          lastUpdated: Date.now(),
          updatedBy: "admin-reset",
          fileCount: 0,
          resetAt: Date.now(),
          previousMB: previousMBUsed,
        };

        mbUsageNode.put(resetData, (ack) => {
          clearTimeout(timeoutId);
          if (ack.err) {
            reject(new Error(`MB reset error: ${ack.err}`));
          } else {
            console.log(`✅ MB usage reset for user: ${identifier}`);
            resolve();
          }
        });
      });

      await resetPromise;

      res.json({
        success: true,
        message: "MB usage reset successfully",
        user: {
          identifier,
        },
        reset: {
          previousMB: previousMBUsed,
          currentMB: 0,
          resetAt: Date.now(),
        },
      });
    } catch (error) {
      console.error("MB reset error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Funzione helper per ottenere i MB utilizzati off-chain calcolandoli in tempo reale dai file
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

            return calculatedMbUsed;
          }
        } catch (recalcError) {
          console.error(
            "Error recalculating MB usage from files:",
            recalcError
          );
        }
      }

      return offChainUsage.mbUsed || 0;
    } catch (error) {
      console.error("Error getting off-chain MB usage:", error);
      return 0;
    }
  }

  // Funzione helper per trovare il relay corrente basandosi sull'URL
  async function getCurrentRelayAddress() {
    try {
      if (!relayContract) {
        console.error("Relay contract not initialized");
        return null;
      }

      // Ottieni l'URL corrente del server
      const serverURL = process.env.SERVER_URL || "http://localhost:3000";
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

  // Function to read IPFS JWT token
  function getIpfsJwtToken() {
    try {
      const fs = require('fs');
      if (fs.existsSync('/tmp/ipfs-jwt-token')) {
        return fs.readFileSync('/tmp/ipfs-jwt-token', 'utf8').trim();
      }
    } catch (error) {
      console.log('⚠️ Could not read IPFS JWT token:', error.message);
    }
    return null;
  }

  // Function to get IPFS authentication header
  function getIpfsAuthHeader() {
    const jwtToken = getIpfsJwtToken();
    if (jwtToken) {
      return `Bearer ${jwtToken}`;
    }
    
    // Fallback to environment variable if JWT not available
    const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN || process.env.IPFS_API_KEY;
    if (IPFS_API_TOKEN) {
      return `Bearer ${IPFS_API_TOKEN}`;
    }
    
    return null;
  }

  // *********************************************************************************************************
  // 🔗 CONTRACT CONFIGURATION API ROUTES
  // *********************************************************************************************************

  // Route per ottenere la configurazione completa dei contratti
  app.get('/api/contracts/config', async (req, res) => {
    try {
      console.log('📋 contracts/config: Requesting contract configuration');
      
      // Importa le configurazioni dal pacchetto shogun-contracts
      const deployments = require('shogun-contracts/deployments.json');
      const chainId = process.env.CHAIN_ID || '11155111'; // Sepolia di default
      
      if (!deployments[chainId]) {
        return res.status(404).json({
          success: false,
          error: `No deployments found for chain ID: ${chainId}`
        });
      }

      const chainDeployments = deployments[chainId];
      
      // Estrai solo i contratti che ci interessano
      const contracts = {
        relayPaymentRouter: chainDeployments['Relay#RelayPaymentRouter'] || null,
        stealthPool: chainDeployments['Stealth#StealthPool'] || null,
        pairRecovery: chainDeployments['Recovery#PairRecovery'] || null,
        integrity: chainDeployments['Security#Integrity'] || null,
        paymentForwarder: chainDeployments['Stealth#PayamentForwarder'] || null,
        stealthKeyRegistry: chainDeployments['Stealth#StealthKeyRegistry'] || null,
        bridgeDex: chainDeployments['Bridge#BridgeDex'] || null
      };

      console.log('📋 contracts/config: Returning contract configuration for chain:', chainId);
      
      res.json({
        success: true,
        chainId: chainId,
        contracts: contracts,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('❌ contracts/config: Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load contract configuration',
        details: error.message
      });
    }
  });

  // Route per ottenere un contratto specifico
  app.get('/api/contracts/:contractName', async (req, res) => {
    try {
      const { contractName } = req.params;
      console.log(`📋 contracts/${contractName}: Requesting contract details`);
      
      const deployments = require('shogun-contracts/deployments.json');
      const chainId = process.env.CHAIN_ID || '11155111';
      
      if (!deployments[chainId]) {
        return res.status(404).json({
          success: false,
          error: `No deployments found for chain ID: ${chainId}`
        });
      }

      const chainDeployments = deployments[chainId];
      
      // Mappa dei nomi dei contratti
      const contractMapping = {
        'relay-payment-router': 'Relay#RelayPaymentRouter',
        'stealth-pool': 'Stealth#StealthPool',
        'pair-recovery': 'Recovery#PairRecovery',
        'integrity': 'Security#Integrity',
        'payment-forwarder': 'Stealth#PayamentForwarder',
        'stealth-key-registry': 'Stealth#StealthKeyRegistry',
        'bridge-dex': 'Bridge#BridgeDex'
      };

      const fullContractName = contractMapping[contractName];
      if (!fullContractName || !chainDeployments[fullContractName]) {
        return res.status(404).json({
          success: false,
          error: `Contract not found: ${contractName}`
        });
      }

      const contract = chainDeployments[fullContractName];
      
      console.log(`📋 contracts/${contractName}: Returning contract details`);
      
      res.json({
        success: true,
        chainId: chainId,
        contractName: contractName,
        contract: contract,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`❌ contracts/${req.params.contractName}: Error:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to load contract details',
        details: error.message
      });
    }
  });

  // Route per ottenere solo l'ABI di un contratto
  app.get('/api/contracts/:contractName/abi', async (req, res) => {
    try {
      const { contractName } = req.params;
      console.log(`📋 contracts/${contractName}/abi: Requesting contract ABI`);
      
      const deployments = require('shogun-contracts/deployments.json');
      const chainId = process.env.CHAIN_ID || '11155111';
      
      if (!deployments[chainId]) {
        return res.status(404).json({
          success: false,
          error: `No deployments found for chain ID: ${chainId}`
        });
      }

      const chainDeployments = deployments[chainId];
      
      const contractMapping = {
        'relay-payment-router': 'Relay#RelayPaymentRouter',
        'stealth-pool': 'Stealth#StealthPool',
        'pair-recovery': 'Recovery#PairRecovery',
        'integrity': 'Security#Integrity',
        'payment-forwarder': 'Stealth#PayamentForwarder',
        'stealth-key-registry': 'Stealth#StealthKeyRegistry',
        'bridge-dex': 'Bridge#BridgeDex'
      };

      const fullContractName = contractMapping[contractName];
      if (!fullContractName || !chainDeployments[fullContractName]) {
        return res.status(404).json({
          success: false,
          error: `Contract not found: ${contractName}`
        });
      }

      const contract = chainDeployments[fullContractName];
      
      console.log(`📋 contracts/${contractName}/abi: Returning contract ABI`);
      
      res.json({
        success: true,
        chainId: chainId,
        contractName: contractName,
        abi: contract.abi,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`❌ contracts/${req.params.contractName}/abi: Error:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to load contract ABI',
        details: error.message
      });
    }
  });

  // Route per ottenere solo l'indirizzo di un contratto
  app.get('/api/contracts/:contractName/address', async (req, res) => {
    try {
      const { contractName } = req.params;
      console.log(`📋 contracts/${contractName}/address: Requesting contract address`);
      
      const deployments = require('shogun-contracts/deployments.json');
      const chainId = process.env.CHAIN_ID || '11155111';
      
      if (!deployments[chainId]) {
        return res.status(404).json({
          success: false,
          error: `No deployments found for chain ID: ${chainId}`
        });
      }

      const chainDeployments = deployments[chainId];
      
      const contractMapping = {
        'relay-payment-router': 'Relay#RelayPaymentRouter',
        'stealth-pool': 'Stealth#StealthPool',
        'pair-recovery': 'Recovery#PairRecovery',
        'integrity': 'Security#Integrity',
        'payment-forwarder': 'Stealth#PayamentForwarder',
        'stealth-key-registry': 'Stealth#StealthKeyRegistry',
        'bridge-dex': 'Bridge#BridgeDex'
      };

      const fullContractName = contractMapping[contractName];
      if (!fullContractName || !chainDeployments[fullContractName]) {
        return res.status(404).json({
          success: false,
          error: `Contract not found: ${contractName}`
        });
      }

      const contract = chainDeployments[fullContractName];
      
      console.log(`📋 contracts/${contractName}/address: Returning contract address`);
      
      res.json({
        success: true,
        chainId: chainId,
        contractName: contractName,
        address: contract.address,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`❌ contracts/${req.params.contractName}/address: Error:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to load contract address',
        details: error.message
      });
    }
  });

  // Route per ottenere la lista di tutti i contratti disponibili
  app.get('/api/contracts', async (req, res) => {
    try {
      console.log('📋 contracts: Requesting available contracts list');
      
      const deployments = require('shogun-contracts/deployments.json');
      const chainId = process.env.CHAIN_ID || '11155111';
      
      if (!deployments[chainId]) {
        return res.status(404).json({
          success: false,
          error: `No deployments found for chain ID: ${chainId}`
        });
      }

      const chainDeployments = deployments[chainId];
      const availableContracts = Object.keys(chainDeployments).map(name => ({
        name: name,
        address: chainDeployments[name].address,
        shortName: name.split('#')[1]?.toLowerCase().replace(/([a-z])([A-Z])/g, '$1-$2') || name.toLowerCase()
      }));
      
      console.log('📋 contracts: Returning available contracts list');
      
      res.json({
        success: true,
        chainId: chainId,
        contracts: availableContracts,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error('❌ contracts: Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load contracts list',
        details: error.message
      });
    }
  });

  // *********************************************************************************************************

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
