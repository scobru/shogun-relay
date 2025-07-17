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

// --- Sistema di Logging Migliorato ---
// (logger rimosso, usa solo console.log/error/warn)

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
  "function PRICE_PER_GB() view returns (uint256)",
  "function MB_PER_GB() view returns (uint256)",
  "function MIN_SUBSCRIPTION_AMOUNT() view returns (uint256)",
  "function SUBSCRIPTION_DURATION() view returns (uint256)",
  "function calculateMBFromAmount(uint256 _amount) public pure returns (uint256)",
  "function calculateAmountFromMB(uint256 _mb) public pure returns (uint256)",
  "function subscribeToRelay(address _relayAddress, string memory _gunPubKey) payable",
  "function addMBToSubscription(address _relayAddress, string memory _gunPubKey) payable",
  "function recordMBUsage(string memory _gunPubKey, uint256 _mbUsed) external",
  "function checkUserSubscription(address _user) external view returns (bool)",
  "function checkGunKeySubscription(string memory _gunPubKey) external view returns (bool)",
  "function checkGunKeyMB(string memory _gunPubKey, uint256 _mbRequired) external view returns (bool)",
  "function isSubscriptionActive(address _user, address _relayAddress) external view returns (bool)",
  "function isSubscriptionActiveByGunKey(string memory _gunPubKey, address _relayAddress) external view returns (bool)",
  "function hasAvailableMB(string memory _gunPubKey, address _relayAddress, uint256 _mbRequired) public view returns (bool)",
  "function getRemainingMB(string memory _gunPubKey, address _relayAddress) public view returns (uint256)",
  "function getSubscriptionDetails(address _user, address _relayAddress) external view returns (uint256 startTime, uint256 endTime, uint256 amountPaid, uint256 mbAllocated, uint256 mbUsed, uint256 mbRemaining, bool isActive, string memory gunPubKey)",
  "function getSubscriptionDetailsByGunKey(string memory _gunPubKey, address _relayAddress) external view returns (uint256 startTime, uint256 endTime, uint256 amountPaid, uint256 mbAllocated, uint256 mbUsed, uint256 mbRemaining, bool isActive, address userAddress)",
  "function getRelayDetails(address _relayAddress) external view returns (string memory url, address relayAddress, bool isActive, uint256 registeredAt)",
  "function getAllRelays() external view returns (address[] memory)",
  "function registerRelay(string memory _url) external",
  "function deactivateRelay() external",
];

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
      relayAbi,
      provider
    );

    // Test contract accessibility
    const pricePerGB = await relayContract.PRICE_PER_GB();
    console.log(
      `✅ Contract initialized successfully. Price per GB: ${ethers.formatEther(
        pricePerGB
      )} ETH`
    );

    return true;
  } catch (error) {
    console.error("❌ Failed to initialize relay contract:", error.message);
    return false;
  }
}

// Middleware per autorizzazione smart contract
const relayContractAuthMiddleware = async (req, res, next) => {
  try {
    const userAddress = req.headers["x-user-address"];
    const pubKey = req.headers["x-pubkey"];
    const fileSizeMB = req.headers["x-file-size-mb"]
      ? parseFloat(req.headers["x-file-size-mb"])
      : 0;

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
    let hasEnoughMB = true;

    // Se abbiamo una pubKey, verifica la sottoscrizione tramite chiave Gun
    if (pubKey) {
      try {
        isAuth = await relayContract.checkGunKeySubscription(pubKey);

        // Se c'è una sottoscrizione attiva e abbiamo specificato la dimensione del file, verifica i MB
        if (isAuth && fileSizeMB > 0) {
          try {
            hasEnoughMB = await relayContract.checkGunKeyMB(
              pubKey,
              Math.ceil(fileSizeMB)
            );
          } catch (mbError) {
            console.error("Errore verifica MB disponibili:", mbError);
            // Fallback: prova con hasAvailableMB
            try {
              hasEnoughMB = await relayContract.hasAvailableMB(
                pubKey,
                await relayContract.getAllRelays().then((relays) => relays[0]),
                Math.ceil(fileSizeMB)
              );
            } catch (fallbackError) {
              console.error("Errore fallback verifica MB:", fallbackError);
              hasEnoughMB = false;
            }
          }
        }

        authMethod = "smart_contract_gun_key";
        console.log(
          `🔐 Autorizzazione smart contract per chiave Gun: ${pubKey} - ${
            isAuth ? "AUTORIZZATO" : "NON AUTORIZZATO"
          }${fileSizeMB > 0 ? ` - MB sufficienti: ${hasEnoughMB}` : ""}`
        );
      } catch (e) {
        console.error("Errore verifica sottoscrizione chiave Gun:", e);
        // Fallback: prova con isSubscriptionActiveByGunKey
        try {
          const allRelays = await relayContract.getAllRelays();
          if (allRelays.length > 0) {
            isAuth = await relayContract.isSubscriptionActiveByGunKey(
              pubKey,
              allRelays[0]
            );

            // Verifica MB se necessario
            if (isAuth && fileSizeMB > 0) {
              hasEnoughMB = await relayContract.hasAvailableMB(
                pubKey,
                allRelays[0],
                Math.ceil(fileSizeMB)
              );
            }

            authMethod = "smart_contract_gun_key_fallback";
            console.log(
              `🔐 Autorizzazione fallback per chiave Gun: ${pubKey} - ${
                isAuth ? "AUTORIZZATO" : "NON AUTORIZZATO"
              }${fileSizeMB > 0 ? ` - MB sufficienti: ${hasEnoughMB}` : ""}`
            );
          }
        } catch (fallbackError) {
          console.error("Errore fallback verifica chiave Gun:", fallbackError);
        }
      }
    }

    // Se abbiamo un indirizzo utente e non abbiamo ancora autorizzato, verifica la sottoscrizione tramite indirizzo
    if (userAddress && !isAuth) {
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

    if (isAuth && hasEnoughMB) {
      req.authorized = true;
      req.authMethod = authMethod;
      req.userAddress = userAddress;
      req.pubKey = pubKey;
      req.fileSizeMB = fileSizeMB;
      next();
    } else if (isAuth && !hasEnoughMB) {
      return res.status(403).json({
        success: false,
        error: "Insufficient storage space",
        details: `File size (${fileSizeMB} MB) exceeds available storage`,
        authMethod: authMethod,
      });
    } else {
      return res.status(403).json({
        success: false,
        error: "Utente non autorizzato",
        details: "Nessuna sottoscrizione attiva trovata per questo utente",
        authMethod: authMethod,
      });
    }
  } catch (error) {
    console.error("Errore middleware autorizzazione:", error);
    return res.status(500).json({
      success: false,
      error: "Errore interno del server",
      details: error.message,
    });
  }
};

// Main async function to initialize the server
async function initializeServer() {
  console.clear();
  console.log("=== GUN-VUE RELAY SERVER ===\n");

  // Initialize relay contract
  console.log("🔧 Initializing relay contract...");
  let contractInitialized = false;

  try {
    // Add timeout for contract initialization
    const contractPromise = initializeRelayContract();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error("Contract initialization timeout")),
        10000
      )
    );

    contractInitialized = await Promise.race([contractPromise, timeoutPromise]);
  } catch (error) {
    console.warn(
      "⚠️ Contract initialization failed or timed out:",
      error.message
    );
    contractInitialized = false;
  }

  if (contractInitialized) {
    console.log("✅ Relay contract ready");
  } else {
    console.log(
      "⚠️ Relay contract not available - smart contract features disabled"
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

              // Calcola la dimensione del file in MB
              const fileSizeMB = +(req.file.size / 1024 / 1024).toFixed(2);

              // Registra l'uso dei MB nel contratto se abbiamo una pubKey
              if (req.pubKey && relayContract) {
                try {
                  const mbUsed = Math.ceil(fileSizeMB);
                  await relayContract.recordMBUsage(req.pubKey, mbUsed);
                  console.log(
                    `📊 MB usage recorded: ${req.pubKey.slice(
                      0,
                      10
                    )}... used ${mbUsed} MB`
                  );
                } catch (mbError) {
                  console.error("Errore registrazione uso MB:", mbError);
                  // Non blocchiamo l'upload se la registrazione MB fallisce
                }
              }

              // Salva l'upload nel database Gun
              const uploadData = {
                hash: fileResult?.Hash,
                name: req.file.originalname,
                size: req.file.size,
                sizeMB: fileSizeMB,
                mimetype: req.file.mimetype,
                uploadedAt: Date.now(),
                userAddress: req.userAddress,
                pubKey: req.pubKey,
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
                .get(req.userAddress || req.pubKey)
                .get(fileResult?.Hash);
              uploadNode.put(uploadData);

              // Salva il mapping pubKey -> userAddress se disponibili entrambi
              if (req.userAddress && req.pubKey) {
                const mappingData = {
                  userAddress: req.userAddress,
                  pubKey: req.pubKey,
                  mappedAt: Date.now(),
                  lastUpload: Date.now(),
                };

                const mappingNode = gun
                  .get("shogun")
                  .get("pubkey_mapping")
                  .get(req.pubKey);
                mappingNode.put(mappingData);

                console.log(
                  `✅ Mapping salvato: ${req.pubKey.slice(
                    0,
                    10
                  )}... -> ${req.userAddress.slice(0, 6)}...`
                );
              }

              res.json({
                success: true,
                file: {
                  name: req.file.originalname,
                  size: req.file.size,
                  sizeMB: fileSizeMB,
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
                  pubKey: req.pubKey,
                },
                mbUsed: Math.ceil(fileSizeMB),
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
      if (relayContract) {
        try {
          let isSubscribed = false;

          // Prova prima con la chiave Gun
          try {
            isSubscribed = await relayContract.checkGunKeySubscription(pubKey);
          } catch (gunKeyError) {
            console.log("Fallback per chiave Gun in authorize:", gunKeyError);
            // Fallback: prova con isSubscriptionActiveByGunKey
            try {
              const allRelays = await relayContract.getAllRelays();
              if (allRelays.length > 0) {
                isSubscribed = await relayContract.isSubscriptionActiveByGunKey(
                  pubKey,
                  allRelays[0]
                );
              }
            } catch (fallbackError) {
              console.error(
                "Errore fallback chiave Gun in authorize:",
                fallbackError
              );
            }
          }

          // Se non abbiamo trovato una sottoscrizione con pubKey e abbiamo un userAddress, prova con l'indirizzo
          if (!isSubscribed && userAddress) {
            try {
              isSubscribed = await relayContract.checkUserSubscription(
                userAddress
              );
            } catch (addressError) {
              console.log("Fallback per indirizzo in authorize:", addressError);
              // Fallback: prova con isSubscriptionActive
              try {
                const allRelays = await relayContract.getAllRelays();
                if (allRelays.length > 0) {
                  isSubscribed = await relayContract.isSubscriptionActive(
                    userAddress,
                    allRelays[0]
                  );
                }
              } catch (fallbackError) {
                console.error(
                  "Errore fallback indirizzo in authorize:",
                  fallbackError
                );
              }
            }
          }

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
      console.error("Errore endpoint authorize-gun-key:", error);
      res.status(500).json({
        success: false,
        error: "Errore interno del server",
        details: error.message,
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

  // Test IPFS connectivity (optional - don't block server startup)
  try {
    await testIPFSConnection();
  } catch (error) {
    console.warn(
      "⚠️ IPFS connectivity test failed, continuing anyway:",
      error.message
    );
  }

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

  // Display server information
  console.log(`Internal URL: ${link}/`);
  console.log(`External URL: ${extLink}/`);
  console.log(`Gun peer: ${link}/gun`);
  console.log(`Storage: ${store ? "enabled" : "disabled"}`);
  console.log(
    `Admin password: ${process.env.ADMIN_PASSWORD ? "configured" : "not set"}`
  );

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

      // Test contract accessibility
      let contractTest = null;
      try {
        const pricePerGB = await relayContract.PRICE_PER_GB();
        contractTest = {
          accessible: true,
          pricePerGB: ethers.formatEther(pricePerGB),
        };
      } catch (testError) {
        contractTest = {
          accessible: false,
          error: testError.message,
        };
      }

      res.json({
        success: true,
        contract: {
          address: RELAY_CONTRACT_ADDRESS,
          configured: true,
          provider: "configured",
          initialized: true,
          network: {
            name: network.name,
            chainId: network.chainId.toString(),
            isSepolia,
          },
          test: contractTest,
        },
      });
    } catch (error) {
      console.error("Contract status check failed", error);
      res.status(500).json({
        success: false,
        error: "Failed to check contract status",
        details: error.message,
      });
    }
  });

  // Endpoint per il monitoraggio delle prestazioni
  app.get("/api/performance", (req, res) => {
    try {
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();

      res.json({
        success: true,
        performance: {
          uptime: {
            seconds: uptime,
            formatted: formatUptime(uptime),
          },
          memory: {
            rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
            heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
            heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
            external: Math.round(memoryUsage.external / 1024 / 1024), // MB
          },
          connections: {
            active: activeWires,
            total: totalConnections,
          },
          stats: customStats,
          timeSeries: customStats.timeSeries,
        },
      });
    } catch (error) {
      console.error("Performance monitoring failed", error);
      res.status(500).json({
        success: false,
        error: "Failed to get performance data",
        details: error.message,
      });
    }
  });

  // Endpoint per i log del sistema
  app.get("/api/logs", tokenAuthMiddleware, (req, res) => {
    try {
      const { level, limit = 100 } = req.query;
      const logs = [];

      res.json({
        success: true,
        logs,
        count: logs.length,
        filters: {
          level: level || "all",
          limit: parseInt(limit),
        },
      });
    } catch (error) {
      console.error("Log retrieval failed", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve logs",
        details: error.message,
      });
    }
  });

  // Endpoint per pulire i log
  app.delete("/api/logs", tokenAuthMiddleware, (req, res) => {
    try {
      // (nessuna azione, logs non più gestiti)
    } catch (error) {
      console.error("Log clearing failed", error);
      res.status(500).json({
        success: false,
        error: "Failed to clear logs",
        details: error.message,
      });
    }
  });

  // Endpoint per verificare lo stato della sottoscrizione (ibrido)
  app.get("/api/subscription-status/:identifier", async (req, res) => {
    try {
      const { identifier } = req.params;

      if (!identifier) {
        return res.status(400).json({
          success: false,
          error: "Identificatore richiesto",
        });
      }

      if (!relayContract) {
        return res.status(500).json({
          success: false,
          error: "Relay contract non configurato",
        });
      }

      // Determina se l'identificatore è un indirizzo Ethereum o una chiave Gun
      const isEthereumAddress = /^0x[a-fA-F0-9]{40}$/.test(identifier);

      let subscription = null;
      let isActive = false;
      let reason = null;

      try {
        if (isEthereumAddress) {
          // Verifica per indirizzo Ethereum
          const allRelays = await relayContract.getAllRelays();
          if (allRelays.length > 0) {
            const details = await relayContract.getSubscriptionDetails(
              identifier,
              allRelays[0]
            );

            subscription = {
              userAddress: identifier,
              relayAddress: allRelays[0],
              startDate: new Date(Number(details.startTime) * 1000),
              endDate: new Date(Number(details.endTime) * 1000),
              amountPaid: ethers.formatEther(details.amountPaid),
              mbAllocated: Number(details.mbAllocated),
              mbUsed: Number(details.mbUsed),
              mbRemaining: Number(details.mbRemaining),
              isActive: details.isActive,
              gunPubKey: details.gunPubKey,
              daysRemaining: Math.ceil(
                (Number(details.endTime) * 1000 - Date.now()) /
                  (1000 * 60 * 60 * 24)
              ),
            };

            isActive = details.isActive;
          } else {
            reason = "Nessun relay registrato nel contratto";
          }
        } else {
          // Verifica per chiave Gun
          const allRelays = await relayContract.getAllRelays();
          if (allRelays.length > 0) {
            const details = await relayContract.getSubscriptionDetailsByGunKey(
              identifier,
              allRelays[0]
            );

            subscription = {
              userAddress: details.userAddress,
              relayAddress: allRelays[0],
              gunPubKey: identifier,
              startDate: new Date(Number(details.startTime) * 1000),
              endDate: new Date(Number(details.endTime) * 1000),
              amountPaid: ethers.formatEther(details.amountPaid),
              mbAllocated: Number(details.mbAllocated),
              mbUsed: Number(details.mbUsed),
              mbRemaining: Number(details.mbRemaining),
              isActive: details.isActive,
              daysRemaining: Math.ceil(
                (Number(details.endTime) * 1000 - Date.now()) /
                  (1000 * 60 * 60 * 24)
              ),
            };

            isActive = details.isActive;
          } else {
            reason = "Nessun relay registrato nel contratto";
          }
        }

        if (!subscription) {
          reason = reason || "Nessuna sottoscrizione trovata";
        }

        res.json({
          success: true,
          subscription: subscription || {
            isActive: false,
            reason,
          },
          identifier,
          type: isEthereumAddress ? "ethereum_address" : "gun_key",
        });
      } catch (contractError) {
        console.error("Contract subscription check failed", contractError);

        // Fallback: prova con metodi alternativi
        try {
          if (isEthereumAddress) {
            isActive = await relayContract.checkUserSubscription(identifier);
          } else {
            isActive = await relayContract.checkGunKeySubscription(identifier);
          }

          res.json({
            success: true,
            subscription: {
              isActive,
              reason: isActive ? null : "Sottoscrizione non attiva",
            },
            identifier,
            type: isEthereumAddress ? "ethereum_address" : "gun_key",
            fallback: true,
          });
        } catch (fallbackError) {
          console.error("Fallback subscription check failed", fallbackError);
          res.status(500).json({
            success: false,
            error: "Errore verifica sottoscrizione",
            details: fallbackError.message,
          });
        }
      }
    } catch (error) {
      console.error("Subscription status check failed", error);
      res.status(500).json({
        success: false,
        error: "Errore interno del server",
        details: error.message,
      });
    }
  });

  // Funzione helper per formattare l'uptime
  function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m ${secs}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
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

  // Fallback endpoint for root requests
  app.get("/", (req, res) => {
    res.json({
      success: true,
      message: "Shogun Relay Server is running",
      version: "1.0.0",
      endpoints: {
        health: "/health",
        relayInfo: "/api/relay-info",
        contractStatus: "/api/contract-status",
        performance: "/api/performance",
        logs: "/api/logs",
        ipfsStatus: "/ipfs-status",
      },
      timestamp: Date.now(),
    });
  });

  // Catch-all endpoint for unknown routes
  app.get("*", (req, res) => {
    res.status(404).json({
      success: false,
      error: "Endpoint not found",
      path: req.path,
      availableEndpoints: [
        "/",
        "/health",
        "/api/relay-info",
        "/api/contract-status",
        "/api/performance",
        "/api/logs",
        "/ipfs-status",
      ],
    });
  });

  // Global error handler
  app.use((error, req, res, next) => {
    console.error("Global error handler:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
      timestamp: Date.now(),
    });
  });

  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
    console.error("Uncaught Exception:", error);
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    console.error("Unhandled Rejection", { reason, promise });
  });
} // End of initializeServer function

// Start the server
initializeServer().catch(console.error);
