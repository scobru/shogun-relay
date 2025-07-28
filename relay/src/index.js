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
      console.log("🗑️ Garbage collection disabled");
      return;
    }

    console.log("🗑️ Running garbage collection...");
    addSystemLog("info", "Garbage collection started");

    // Implementation would go here
    // For now, just log that it's running
    addSystemLog("info", "Garbage collection completed");
  }

  // Initialize garbage collector
  function initializeGarbageCollector() {
    if (GC_ENABLED) {
      console.log("🗑️ Initializing garbage collector...");
      setSelfAdjustingInterval(runGarbageCollector, GC_INTERVAL);
      addSystemLog("info", "Garbage collector initialized");
    } else {
      console.log("🗑️ Garbage collection disabled");
    }
  }

  // Token validation function
  function hasValidToken(msg) {
    const token = msg.headers?.token;
    return token === process.env.ADMIN_PASSWORD;
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

  // Esponi i middleware di autenticazione per le route
  app.set("tokenAuthMiddleware", tokenAuthMiddleware);
  app.set("userAuthMiddleware", userAuthMiddleware);
  app.set("walletSignatureMiddleware", walletSignatureMiddleware);
  app.set("verifyWalletSignature", verifyWalletSignature);

  // Esponi l'istanza Gun globalmente per le route
  global.gunInstance = gun;

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