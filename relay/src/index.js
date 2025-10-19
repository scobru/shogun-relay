// Enhanced Gun relay server with Shogun improvements
// MUST be required after Gun to work

import express from "express";

// Helper function to sanitize data for GunDB storage
function sanitizeForGunDB(data) {
  if (data === null || data === undefined) {
    return null;
  }

  // Handle primitive types directly
  if (
    typeof data === "string" ||
    typeof data === "number" ||
    typeof data === "boolean"
  ) {
    return data;
  }

  // Handle Date objects
  if (data instanceof Date) {
    return data.toISOString();
  }

  // Handle Buffer objects
  if (Buffer.isBuffer(data)) {
    return data.toString("base64");
  }

  // Handle arrays
  if (Array.isArray(data)) {
    try {
      return data.map((item) => sanitizeForGunDB(item));
    } catch (error) {
      console.warn("⚠️ Error sanitizing array:", error);
      return [];
    }
  }

  // Handle objects
  if (typeof data === "object") {
    try {
      // First, try to serialize to test if it's valid JSON
      JSON.stringify(data);

      // If successful, recursively sanitize all properties
      const sanitized = {};
      for (const [key, value] of Object.entries(data)) {
        // Skip functions and symbols
        if (typeof value === "function" || typeof value === "symbol") {
          continue;
        }
        sanitized[key] = sanitizeForGunDB(value);
      }
      return sanitized;
    } catch (error) {
      // If JSON serialization fails, create a safe representation
      console.warn(
        "⚠️ Object could not be serialized, creating safe representation:",
        error
      );
      return {
        _error: "Object could not be serialized",
        _type: typeof data,
        _constructor: data.constructor?.name || "Unknown",
        _stringified: String(data),
        _timestamp: Date.now(),
      };
    }
  }

  // For any other type, convert to string
  try {
    return String(data);
  } catch (error) {
    console.warn("⚠️ Error converting data to string:", error);
    return "[Unserializable Data]";
  }
}
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import ip from "ip";

import setSelfAdjustingInterval from "self-adjusting-interval";

import "./utils/bullet-catcher.js";

dotenv.config();

import Gun from "gun";

import "gun/sea.js";
import "gun/lib/stats.js";
import "gun/lib/webrtc.js";
import "gun/lib/yson.js";
import "gun/lib/evict.js";
import "gun/lib/rfs.js";
import "gun/lib/radix.js";
import "gun/lib/radisk.js";
import "gun/lib/ws.js";
import "gun/lib/wire.js";
import "gun/lib/axe.js";

import multer from "multer";
import QuickLRU from "quick-lru";
import { WebSocketServer } from "ws";
import createNoMemAdapter from "./utils/nomem.js";

const namespace = "shogun";

const CLEANUP_CORRUPTED_DATA = process.env.CLEANUP_CORRUPTED_DATA || true;

// --- IPFS Configuration ---
const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN;
const IPFS_GATEWAY_URL =
  process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";

// ES Module equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
let host = process.env.RELAY_HOST || ip.address();
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

// Main server initialization function
async function initializeServer() {
  console.log("🚀 Initializing Shogun Relay Server...");

  // System logging function (console only, no GunDB storage)
  function addSystemLog(level, message, data = null) {
    const timestamp = new Date().toISOString();

    // Log to console only (file logs are managed by the system)
    console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);

    // Optionally log data if provided and not null
    if (data !== null && data !== undefined) {
      try {
        console.log(
          `[${timestamp}] ${level.toUpperCase()}: Data:`,
          JSON.stringify(data, null, 2)
        );
      } catch (jsonError) {
        console.log(
          `[${timestamp}] ${level.toUpperCase()}: Data (non-serializable):`,
          String(data)
        );
      }
    }
  }

  // Funzione per i dati di serie temporale (console only)
  function addTimeSeriesPoint(key, value) {
    // Log to console only to prevent JSON serialization errors
    console.log(`📊 TimeSeries: ${key} = ${value}`);
  }

  // Funzione di validazione del token
  function hasValidToken(msg) {
    if (process.env.RELAY_PROTECTED === "false") {
      return true;
    }

    // Se ha headers, verifica il token
    if (msg && msg.headers && msg.headers.token) {
      const hasValidAuth = msg.headers.token === process.env.ADMIN_PASSWORD;
      if (hasValidAuth) {
        console.log(`🔍 PUT allowed - valid token: ${msg.headers}`);
        return true;
      }
    }

    console.log(`❌ PUT denied - no valid auth: ${msg.headers}`);
    return false;
  }

  // Crea l'app Express
  const app = express();
  const publicPath = path.resolve(__dirname, path_public);
  const indexPath = path.resolve(publicPath, "index.html");

  // Middleware
  app.use(cors());
  app.use(express.json()); // Aggiungi supporto per il parsing del body JSON
  app.use(express.urlencoded({ extended: true })); // Aggiungi supporto per i dati del form

  // Fix per rate limiting con proxy
  app.set("trust proxy", 1);

  

  // Route specifica per /admin (DEFINITA PRIMA DEL MIDDLEWARE DI AUTENTICAZIONE)
  app.get("/admin", (req, res) => {
    const adminPath = path.resolve(publicPath, "admin.html");
    if (fs.existsSync(adminPath)) {
      // Aggiungi header per prevenire il caching
      res.set({
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.sendFile(adminPath);
    } else {
      res.status(404).json({
        success: false,
        error: "Admin panel not found",
        message: "Admin panel file not available",
      });
    }
  });

  // Route specifica per /oauth-callback (DEFINITA PRIMA DEL MIDDLEWARE DI AUTENTICAZIONE)
  app.get("/oauth-callback", (req, res) => {
    const callbackPath = path.resolve(publicPath, "oauth-callback.html");
    if (fs.existsSync(callbackPath)) {
      // Aggiungi header per prevenire il caching
      res.set({
        "Cache-Control": "no-cache, no-store, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      });
      res.sendFile(callbackPath);
    } else {
      res.status(404).json({
        success: false,
        error: "OAuth callback page not found",
        message: "OAuth callback page not available",
      });
    }
  });

  // Middleware di protezione per le route statiche che richiedono autenticazione admin
  const protectedStaticRoutes = [
    "/services-dashboard",
    "/stats",
    "/charts",
    "/upload",
    "/pin-manager",
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
      const token = bearerToken || customToken || formToken;

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

  app.use(Gun.serve);

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

  // Multi-Socket Support: LRU cache for ephemeral Gun instances
  const ephemeralGuns = new QuickLRU({ 
    maxSize: parseInt(process.env.MAX_EPHEMERAL_SOCKETS) || 50,
    onEviction: (pathname, gunInstance) => {
      console.log(`🗑️ Evicting ephemeral Gun instance: ${pathname}`);
      // Cleanup Gun instance if needed
      if (gunInstance?.gun?._.opt?.ws?.server) {
        try {
          gunInstance.gun._.opt.ws.server.close();
        } catch (e) {
          console.warn("Warning during Gun instance cleanup:", e.message);
        }
      }
    }
  });

  // Multi-Socket WebSocket Upgrade Handler
  server.on("upgrade", async function(request, socket, head) {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname || "/gun";
    
    const debug = process.env.DEBUG === "true";
    if (debug) console.log("🔌 WebSocket upgrade request:", pathname);

    // Main persistent Gun instance on /gun
    if (pathname === "/gun") {
      // Let the main Gun instance handle this
      return;
    }

    // Ephemeral Gun instances on other paths
    let gunData = null;

    if (ephemeralGuns.has(pathname)) {
      // Reuse existing ephemeral instance
      if (debug) console.log("♻️ Recycling ephemeral Gun:", pathname);
      gunData = ephemeralGuns.get(pathname);
    } else {
      // Create new ephemeral Gun instance
      if (debug) console.log("🆕 Creating ephemeral Gun:", pathname);
      
      const noMem = createNoMemAdapter();
      const ephemeralGun = new Gun({
        peers: [], // Isolated, no peering
        localStorage: false,
        radisk: false,
        file: false, // No file storage
        store: noMem(),
        multicast: false,
        axe: false
      });

      // Create dedicated WebSocket server for this instance
      const wss = new WebSocketServer({ noServer: true });
      
      // Wire up Gun's WebSocket handling
      wss.on("connection", function(ws, req) {
        if (debug) console.log("✅ Ephemeral Gun connected:", pathname);
        
        // Attach Gun's wire protocol
        ephemeralGun.wsp(ws);
        
        ws.on("close", () => {
          if (debug) console.log("❌ Ephemeral Gun disconnected:", pathname);
        });
      });

      gunData = {
        gun: ephemeralGun,
        wss: wss,
        pathname: pathname,
        created: Date.now()
      };

      ephemeralGuns.set(pathname, gunData);
    }

    if (gunData && gunData.wss) {
      // Handle WebSocket upgrade for this ephemeral instance
      gunData.wss.handleUpgrade(request, socket, head, function(ws) {
        gunData.wss.emit("connection", ws, request);
      });
    } else {
      if (debug) console.log("⚠️ No WebSocket server for path:", pathname);
      socket.destroy();
    }
  });

  // Initialize Gun with conditional support
  const gunConfig = {
    super: true,
    file: "radata",
    radisk: process.env.DISABLE_RADISK !== "true", // Allow disabling radisk via env var
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
    chunk: 1000,
    pack: 1000,
    jsonify: true, // Disable automatic JSON parsing to prevent errors
    ws: {
      server: server,
      port: port,
      path: "/gun",
      web: null,
      noServer: false,
      drain: null,
      wait: 500,
    },
  };

  if (process.env.DISABLE_RADISK === "true") {
    console.log("📁 Radisk disabled via environment variable");
  } else {
    console.log("📁 Using local file storage with radisk");
  }

  Gun.serve(app);

  const gun = Gun(gunConfig);

  // Configura l'istanza Gun per le route di autenticazione
  app.set("gunInstance", gun);

  // Esponi le funzioni helper per le route
  app.set("addSystemLog", addSystemLog);
  app.set("addTimeSeriesPoint", addTimeSeriesPoint);

  // Esponi la mappatura per le route
  // app.set("originalNamesMap", originalNamesMap); // Removed as per edit hint
  // app.set("addHashMapping", addHashMapping); // Removed as per edit hint
  // app.set("calculateKeccak256Hash", calculateKeccak256Hash); // Removed as per edit hint

  // Esponi i middleware di autenticazione per le route
  app.set("tokenAuthMiddleware", tokenAuthMiddleware);

  // Esponi le configurazioni IPFS
  app.set("IPFS_API_URL", IPFS_API_URL);
  app.set("IPFS_API_TOKEN", IPFS_API_TOKEN);
  app.set("IPFS_GATEWAY_URL", IPFS_GATEWAY_URL);

  // Esponi l'istanza Gun globalmente per le route
  global.gunInstance = gun;

  // Route legacy per compatibilità (definite prima delle route modulari)

  // Health check endpoint
  app.get("/health", (req, res) => {
    const healthData = {
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      activeConnections: activeWires || 0,
      totalConnections: totalConnections || 0,
      memoryUsage: process.memoryUsage(),
      ephemeralSockets: {
        count: ephemeralGuns.size,
        maxSize: ephemeralGuns.maxSize
      }
    };

    res.json(healthData);
  });

  // Ephemeral sockets status endpoint
  app.get("/ephemeral-sockets", (req, res) => {
    const sockets = [];
    for (const [pathname, data] of ephemeralGuns.entries()) {
      sockets.push({
        path: pathname,
        created: new Date(data.created).toISOString(),
        uptime: Date.now() - data.created
      });
    }

    res.json({
      success: true,
      count: ephemeralGuns.size,
      maxSize: ephemeralGuns.maxSize,
      sockets: sockets
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

      const http = await import("http");
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

  // Importa e configura le route modulari
  try {
    const routes = await import("./routes/index.js");
    routes.default(app);
    console.log("✅ Route modulari configurate con successo");
  } catch (error) {
    console.error("❌ Errore nel caricamento delle route modulari:", error);
  }

  // Route statiche (DEFINITE DOPO LE API)

  app.use(express.static(publicPath));

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


  console.log(`🚀 Shogun Relay Server running on http://${host}:${port}`);

  // Function to clean up corrupted GunDB data
  function cleanupCorruptedData() {
    console.log("🧹 Starting GunDB data cleanup...");

    try {
      // Clean up any corrupted logs
      gun
        .get("shogun")
        .get("logs")
        .map()
        .once((data, key) => {
          if (data && typeof data === "object") {
            try {
              // Test if the data is valid JSON
              JSON.stringify(data);
            } catch (error) {
              console.log(`🧹 Removing corrupted log entry: ${key}`);
              gun.get("shogun").get("logs").get(key).put(null);
            }
          }
        });

      console.log("✅ GunDB data cleanup completed");
    } catch (error) {
      console.error("❌ Error during GunDB data cleanup:", error);
    }
  }

  // Run cleanup on startup if enabled
  if (CLEANUP_CORRUPTED_DATA) {
    console.log("🧹 Cleanup of corrupted data enabled");
    setTimeout(cleanupCorruptedData, 5000); // Run after 5 seconds to allow GunDB to initialize
  }

  return {
    server,
    gun,
    db,
    addSystemLog,
    addTimeSeriesPoint,
    shutdown,
  };
}

// Avvia il server
initializeServer().catch(console.error);
