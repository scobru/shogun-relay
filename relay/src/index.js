// Enhanced Gun relay server with Shogun improvements
// MUST be required after Gun to work

import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import ip from "ip";
import setSelfAdjustingInterval from "self-adjusting-interval";

import Gun from "gun";

import "gun/sea.js";
import "gun/lib/stats.js";
import "gun/lib/webrtc.js";
import "gun/lib/yson.js";
import "gun/lib/evict.js";
import "gun/lib/rfs.js";
import "gun/lib/radix.js";
import "gun/lib/radisk.js";
import "gun/lib/wire.js";
import "gun/lib/axe.js";
import "./utils/bullet-catcher.js";

import Holster from "@mblaney/holster/src/holster.js";

import multer from "multer";
import { initRelayUser, isRelayUserInitialized, getRelayPub, getRelayUser } from "./utils/relay-user.js";
import * as Reputation from "./utils/relay-reputation.js";
import * as FrozenData from "./utils/frozen-data.js";

dotenv.config();

const CLEANUP_CORRUPTED_DATA = process.env.CLEANUP_CORRUPTED_DATA || true;

// --- IPFS Configuration ---
const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN;
const IPFS_GATEWAY_URL =
  process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";

const isProtectedRelay = process.env.RELAY_PROTECTED === "true" ? true : false;

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

// --- Holster Configuration ---
const holsterConfig = {
  host: process.env.HOLSTER_RELAY_HOST || "0.0.0.0",
  port: parseInt(process.env.HOLSTER_RELAY_PORT) || port + 1, // Default to main port + 1
  storageEnabled: process.env.HOLSTER_RELAY_STORAGE === "true" || true,
  storagePath: process.env.HOLSTER_RELAY_STORAGE_PATH || path.join(process.cwd(), "holster-data"),
  maxConnections: parseInt(process.env.HOLSTER_MAX_CONNECTIONS) || 100,
};


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
    if (isProtectedRelay === false) {
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

  // Avvia il server
  const server = await startServer();

  // Initialize Holster Relay with built-in WebSocket server and connection management
  let holster;
  try {
    holster = Holster({
      port: holsterConfig.port,
      secure: true,
      peers: [], // No peers by default
      maxConnections: holsterConfig.maxConnections,
      file: holsterConfig.storageEnabled ? holsterConfig.storagePath : undefined,
    });
    console.log(`✅ Holster Relay initialized on port ${holsterConfig.port}`);
    console.log(`📁 Holster storage: ${holsterConfig.storageEnabled ? holsterConfig.storagePath : "disabled"}`);
  } catch (error) {
    console.error("❌ Error initializing Holster:", error);
  }

  const peersString = process.env.RELAY_PEERS;
  const peers = peersString ? peersString.split(",") : [];
  console.log("🔍 Peers:", peers);

  // Initialize Gun with conditional support
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  console.log("📁 Data directory:", dataDir);
  
  const gunConfig = {
    super: true,
    file: dataDir,
    radisk: process.env.DISABLE_RADISK !== "true", // Allow disabling radisk via env var
    web: server,
    isValid: hasValidToken,
    uuid: process.env.RELAY_NAME,
    localStorage: false, // Abilita localStorage per persistenza
    wire: true,
    axe: false,
    rfs: true,
    wait: 500,
    webrtc: true,
    peers: peers,
    chunk: 1000,
    pack: 1000,
    jsonify: true, // Disable automatic JSON parsing to prevent errors
  };

  if (process.env.DISABLE_RADISK === "true") {
    console.log("📁 Radisk disabled via environment variable");
  } else {
    console.log("📁 Using local file storage with radisk");
  }

  Gun.serve(app);

  const gun = Gun(gunConfig);

  // Initialize Relay User for x402 subscriptions
  // This user owns the subscription data in GunDB
  const relayUsername = process.env.RELAY_GUN_USERNAME || process.env.RELAY_NAME || 'shogun-relay';
  const relayPassword = process.env.RELAY_GUN_PASSWORD || process.env.ADMIN_PASSWORD;
  
  if (relayPassword) {
    try {
      const { pub } = await initRelayUser(gun, relayUsername, relayPassword);
      app.set('relayUserPub', pub);
      console.log(`🔐 Relay GunDB user initialized: ${relayUsername}`);
      console.log(`🔑 Relay public key: ${pub?.substring(0, 30)}...`);
    } catch (error) {
      console.error('❌ Failed to initialize relay GunDB user:', error.message);
      console.warn('⚠️ x402 subscriptions will not work without relay user');
    }
  } else {
    console.warn('⚠️ RELAY_GUN_PASSWORD not set, x402 subscriptions disabled');
  }

  // Initialize reputation tracking for this relay
  try {
    Reputation.initReputationTracking(gun, host);
    console.log(`📊 Reputation tracking initialized for ${host}`);
  } catch (e) {
    console.warn('⚠️ Failed to initialize reputation tracking:', e.message);
  }

  // Initialize Network Pin Request Listener (auto-replication)
  const autoReplication = process.env.AUTO_REPLICATION !== 'false';
  if (autoReplication) {
    console.log('🔄 Auto-replication enabled - listening for pin requests');
    
    gun.get('shogun-network').get('pin-requests').map().on(async (data, requestId) => {
      if (!data || typeof data !== 'object' || !data.cid) return;
      if (data.status !== 'pending') return;
      
      // Don't process old requests (older than 1 hour)
      if (data.timestamp && Date.now() - data.timestamp > 3600000) return;
      
      // Don't process own requests
      const relayPub = app.get('relayUserPub');
      if (data.requester === relayPub) return;
      
      console.log(`📥 Received pin request: ${data.cid} from ${data.requester?.substring(0, 20)}...`);
      
      try {
        // Check if we already have this pinned
        const http = await import('http');
        const alreadyPinned = await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(false), 5000);
          const options = {
            hostname: '127.0.0.1',
            port: 5001,
            path: `/api/v0/pin/ls?arg=${data.cid}&type=all`,
            method: 'POST',
            headers: { 'Content-Length': '0' },
          };
          if (IPFS_API_TOKEN) {
            options.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
          }
          const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
              clearTimeout(timeout);
              try {
                const result = JSON.parse(body);
                resolve(result.Keys && Object.keys(result.Keys).length > 0);
              } catch { resolve(false); }
            });
          });
          req.on('error', () => { clearTimeout(timeout); resolve(false); });
          req.end();
        });
        
        if (alreadyPinned) {
          console.log(`✅ CID ${data.cid} already pinned locally`);
          return;
        }
        
        // Pin the content
        console.log(`📌 Pinning ${data.cid}...`);
        const pinResult = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Pin timeout')), 60000);
          const options = {
            hostname: '127.0.0.1',
            port: 5001,
            path: `/api/v0/pin/add?arg=${data.cid}`,
            method: 'POST',
            headers: { 'Content-Length': '0' },
          };
          if (IPFS_API_TOKEN) {
            options.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
          }
          const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
              clearTimeout(timeout);
              try { resolve(JSON.parse(body)); } catch { resolve({ raw: body }); }
            });
          });
          req.on('error', (e) => { clearTimeout(timeout); reject(e); });
          req.end();
        });
        
        if (pinResult.Pins || pinResult.raw?.includes('Pins')) {
          console.log(`✅ Successfully pinned ${data.cid}`);
          
          // Publish response
          const crypto = await import('crypto');
          const responseId = crypto.randomBytes(8).toString('hex');
          gun.get('shogun-network').get('pin-responses').get(responseId).put({
            id: responseId,
            requestId,
            responder: relayPub,
            status: 'completed',
            timestamp: Date.now(),
          });
        } else {
          console.log(`⚠️ Pin result unclear for ${data.cid}:`, pinResult);
        }
      } catch (error) {
        console.error(`❌ Failed to pin ${data.cid}:`, error.message);
      }
    });
  } else {
    console.log('🔄 Auto-replication disabled');
  }

  // Initialize Generic Services (Linda functionality)
  // DISABLED: Services removed as client migrated to pure GunDB
  /*
  try {
    const { initServices } = await import("./services/manager.js");
    await initServices(app, server, gun);
  } catch (error) {
    console.error("❌ Failed to load Generic Services:", error);
  }
  */

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
    const relayPub = app.get('relayUserPub');
    const healthData = {
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      activeConnections: activeWires || 0,
      totalConnections: totalConnections || 0,
      memoryUsage: process.memoryUsage(),
      relayPub: relayPub || null,
      relayName: process.env.RELAY_NAME || 'shogun-relay',
    };

    res.json(healthData);
  });

  // Holster status endpoint
  app.get("/holster-status", (req, res) => {
    res.json({
      success: true,
      status: holster ? "active" : "inactive",
      service: "holster-relay",
      config: {
        port: holsterConfig.port,
        host: holsterConfig.host,
        storageEnabled: holsterConfig.storageEnabled,
        storagePath: holsterConfig.storagePath,
        maxConnections: holsterConfig.maxConnections,
      },
      timestamp: Date.now(),
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
  const db = gun.get("relays").get(host);

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
    // Prevent negative counter (can happen on startup cleanup)
    if (activeWires > 0) {
      activeWires -= 1;
    }
    db?.get("activeWires").put(activeWires);
    console.log(`Connection closed (active: ${activeWires})`);
  });

  gun.on("out", { get: { "#": { "*": "" } } });

  // Set up pulse interval for health monitoring (extended with IPFS stats)
  setSelfAdjustingInterval(async () => {
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
        name: process.env.RELAY_NAME || 'shogun-relay',
        version: process.env.npm_package_version || '1.0.0',
      },
    };

    // Extend pulse with IPFS stats (non-blocking)
    try {
      const http = await import('http');
      const ipfsStats = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 3000);
        const options = {
          hostname: '127.0.0.1',
          port: 5001,
          path: '/api/v0/repo/stat?size-only=true',
          method: 'POST',
          headers: { 'Content-Length': '0' },
        };
        if (IPFS_API_TOKEN) {
          options.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
        }
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            clearTimeout(timeout);
            try { resolve(JSON.parse(data)); } catch { resolve(null); }
          });
        });
        req.on('error', () => { clearTimeout(timeout); resolve(null); });
        req.end();
      });

      if (ipfsStats && ipfsStats.RepoSize !== undefined) {
        pulse.ipfs = {
          connected: true,
          repoSize: ipfsStats.RepoSize,
          repoSizeMB: Math.round(ipfsStats.RepoSize / (1024 * 1024)),
          numObjects: ipfsStats.NumObjects || 0,
        };
        
        // Also get pin count (quick query)
        const pinCount = await new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(0), 2000);
          const options = {
            hostname: '127.0.0.1',
            port: 5001,
            path: '/api/v0/pin/ls?type=recursive',
            method: 'POST',
            headers: { 'Content-Length': '0' },
          };
          if (IPFS_API_TOKEN) {
            options.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
          }
          const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              clearTimeout(timeout);
              try {
                const pins = JSON.parse(data);
                resolve(pins.Keys ? Object.keys(pins.Keys).length : 0);
              } catch { resolve(0); }
            });
          });
          req.on('error', () => { clearTimeout(timeout); resolve(0); });
          req.end();
        });
        
        pulse.ipfs.numPins = pinCount;
      } else {
        pulse.ipfs = { connected: false };
      }
    } catch (e) {
      pulse.ipfs = { connected: false, error: e.message };
    }

    // Legacy pulse (for backward compatibility)
    db?.get("pulse").put(pulse);
    addTimeSeriesPoint("connections.active", activeWires);
    addTimeSeriesPoint("memory.heapUsed", process.memoryUsage().heapUsed);

    // Record pulse for reputation tracking (own uptime)
    try {
      await Reputation.recordPulse(gun, host);
      // Periodically update stored score (every 10 minutes = 20 pulses)
      if (Math.random() < 0.05) { // ~5% chance each pulse
        await Reputation.updateStoredScore(gun, host);
      }
    } catch (e) {
      // Non-critical, don't log every time
    }

    // Create frozen (immutable, signed) announcement every ~5 minutes
    // Only if relay user is initialized (has keypair for signing)
    try {
      const relayUser = getRelayUser();
      if (relayUser && relayUser.is && Math.random() < 0.1) { // ~10% chance = every ~5 min
        const announcement = {
          type: 'relay-announcement',
          host,
          port,
          name: process.env.RELAY_NAME || 'shogun-relay',
          version: process.env.npm_package_version || '1.0.0',
          uptime: process.uptime(),
          connections: pulse.connections,
          ipfs: pulse.ipfs,
          // Use object instead of array for GunDB compatibility
          capabilities: {
            'ipfs-pin': true,
            'storage-proof': true,
            'x402-subscription': true,
            'storage-deals': true,
          },
        };

        await FrozenData.createFrozenEntry(
          gun,
          announcement,
          relayUser._.sea, // SEA keypair
          'relay-announcements',
          host
        );
      }
    } catch (e) {
      // Non-critical, frozen announcements are optional
      if (process.env.DEBUG) console.log('Frozen announcement skipped:', e.message);
    }
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


  return {
    server,
    gun,
    holster,
    db,
    addSystemLog,
    addTimeSeriesPoint,
    shutdown,
  };
}

// Avvia il server
initializeServer().catch(console.error);
