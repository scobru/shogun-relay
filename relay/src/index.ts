import express from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import dotenv from "dotenv";
import setSelfAdjustingInterval from "self-adjusting-interval";
import { fileURLToPath } from "url";
import Gun from "gun";
import "gun/sea";
import "gun/lib/stats";
import "gun/lib/webrtc";
// import "gun/axe"; // Disabled: causes infinite event-loop blocks / 504 Gateway Timeouts on writes in cyclic nets
import "./utils/bullet-catcher";

import multer from "multer";
import { initRelayUser, getRelayUser } from "./utils/relay-user";
import SQLiteStore from "./utils/sqlite-store";
import S3Store from "./utils/s3-store";
import { loggers } from "./utils/logger";
import {
  config,
  ipfsConfig,
  relayConfig,
  serverConfig,
  authConfig,
  storageConfig,
  relayKeysConfig,
  wormholeConfig,
  replicationConfig,
  loggingConfig,
  packageConfig,
} from "./config/env-config";

import { startWormholeCleanup } from "./utils/wormhole-cleanup";
import { tokenAuthMiddleware } from "./middleware/token-auth";
import { secureCompare, hashToken, createProductionErrorHandler } from "./utils/security";

import { GUN_PATHS, getGunNode } from "./utils/gun-paths";
// Chat service removed

import { gunAliasGuard } from "./middleware/gun-alias-guard";

// Route Imports

// Middleware

dotenv.config();

// --- Console Interceptor to Silence GunDB Spam ---
const originalConsoleLog = console.log;
const originalConsoleDir = console.dir;

function isGunSpam(args: any[]) {
  if (args.length === 0) return false;
  const firstArg = args[0];
  // Gun unverified data spam usually looks like an object with 'err': 'Unverified data.' or similar raw Gun graph nodes
  if (typeof firstArg === "object" && firstArg !== null) {
    if (firstArg.err === "Unverified data." || firstArg.err === "Signature did not match.") {
      return true;
    }
    // Also ignore raw object dumps that look like Gun graph nodes with '#' and '><'
    if (firstArg["#"] && (firstArg["><"] || firstArg["@"])) {
      return true;
    }
  }
  return false;
}

console.log = function (...args) {
  if (isGunSpam(args)) return;
  originalConsoleLog.apply(console, args);
};

console.dir = function (...args) {
  if (isGunSpam(args)) return;
  originalConsoleDir.apply(console, args);
};
// -------------------------------------------------

// --- IPFS Configuration ---
const IPFS_API_URL = ipfsConfig.apiUrl;
const IPFS_API_TOKEN = ipfsConfig.apiToken;
const IPFS_GATEWAY_URL = ipfsConfig.gatewayUrl;
const IPFS_API_HOST = ipfsConfig.apiHost;
const IPFS_API_PORT = ipfsConfig.apiPort;

// Cache for processed pin requests to prevent infinite retries
// Map of requestId -> { processedAt: timestamp, status: 'completed'|'failed' }
const processedPinRequests = new Map();
const PIN_REQUEST_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour - don't reprocess within this time

const isProtectedRelay = relayConfig.protected;
loggers.server.info({ isProtectedRelay }, "Relay protection enabled");

// ES Module equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
let host = serverConfig.host;
// Remove protocol from host if present (http:// or https://)
// Also remove trailing slashes
host = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
let port = serverConfig.port;
let path_public = serverConfig.publicPath;

/**
 * Main server initialization function
 * Sets up Express, GunDB, Holster, and all routes
 * @returns {Promise<void>}
 */
async function initializeServer() {
  // Welcome message with ASCII art logo
  const welcomeMessage = serverConfig.welcomeMessage;
  console.log(welcomeMessage);
  loggers.server.info("🚀 Initializing Shogun Relay Server...");
  loggers.server.info("🚀 Shogun Relay v1.0.1 - FORCE UPDATE");

  /**
   * System logging function (console only, no GunDB storage)
   * @param {string} level - Log level (info, warn, error, etc.)
   * @param {string} message - Log message
   * @param {any} [data=null] - Optional data to log
   */
  function addSystemLog(level: string, message: string, data: any = null) {
    const timestamp = new Date().toISOString();

    // Log using logger
    const logMethod =
      level === "error"
        ? loggers.server.error
        : level === "warn"
          ? loggers.server.warn
          : loggers.server.info;

    if (data !== null && data !== undefined) {
      try {
        logMethod({ message, data: JSON.stringify(data, null, 2), timestamp });
      } catch (jsonError) {
        logMethod({ message, data: String(data), timestamp });
      }
    } else {
      logMethod({ message, timestamp });
    }
  }

  // Funzione per i dati di serie temporale
  function addTimeSeriesPoint(key: string, value: any) {
    // Log using logger
    loggers.server.debug({
      message: `📊 TimeSeries: ${key} = ${value}`,
      key,
      value,
    });
  }

  // Funzione di validazione del token
  function hasValidToken(msg: any) {
    if (isProtectedRelay === false) {
      return true;
    }

    // Se ha headers, verifica il token
    if (msg && msg.headers && msg.headers.token) {
      const hasValidAuth = msg.headers.token === authConfig.adminPassword;
      if (hasValidAuth) {
        loggers.server.info(`🔍 PUT allowed - valid token: ${msg.headers}`);
        return true;
      }
    }

    loggers.server.warn(`❌ Operation denied - no valid auth: ${JSON.stringify(msg.headers)}`);
    return false;
  }

  // Crea l'app Express
  const app = express();
  const publicPath = path.resolve(__dirname, path_public);
  const indexPath = path.resolve(publicPath, "index.html");

  // Normalize double slashes in the path to avoid 404s (e.g. //api/v1/health)
  app.use((req, res, next) => {
    const [pathPart, queryPart] = req.url.split("?", 2);
    if (pathPart.includes("//")) {
      const normalizedPath = pathPart.replace(/\/{2,}/g, "/");
      req.url = queryPart ? `${normalizedPath}?${queryPart}` : normalizedPath;
    }
    next();
  });

  // ===== SECURITY: CORS Configuration =====
  const corsOptions = {
    origin: authConfig.corsOrigins.includes("*")
      ? true // Allow all origins if '*' is configured
      : (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (
          authConfig.corsOrigins.some(
            (allowed: string) => allowed === origin || origin.endsWith(allowed.replace("*.", "."))
          )
        ) {
          callback(null, true);
        } else {
          loggers.server.warn({ origin }, "CORS blocked request from origin");
          callback(new Error("Not allowed by CORS"));
        }
      },
    credentials: authConfig.corsCredentials,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "token",
      "X-Requested-With",
      "X-Session-Token",
      "X-User-Address",
    ],
    exposedHeaders: ["X-Session-Token"],
    maxAge: 86400, // 24 hours
  };
  app.use(cors(corsOptions));
  loggers.server.info(
    {
      origins: authConfig.corsOrigins.includes("*") ? "ALL" : authConfig.corsOrigins,
      credentials: authConfig.corsCredentials,
    },
    "🔒 CORS configured"
  );

  // ===== SECURITY: Security Headers =====
  app.use((req, res, next) => {
    // Prevent clickjacking
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    // Prevent MIME type sniffing
    res.setHeader("X-Content-Type-Options", "nosniff");
    // XSS Protection
    res.setHeader("X-XSS-Protection", "1; mode=block");
    // Referrer Policy
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    next();
  });

  app.use(express.json()); // Aggiungi supporto per il parsing del body JSON
  app.use(express.urlencoded({ extended: true })); // Aggiungi supporto per i dati del form

  // Fix per rate limiting con proxy
  app.set("trust proxy", 1);

  // ===== ROOT HEALTH CHECK ENDPOINTS (for load balancers, k8s probes) =====
  // Note: /health endpoint with full details is registered later after initialization
  // Use /healthz for minimal health checks during startup

  // Liveness probe (minimal check)
  app.get("/health", (req, res) => {
    res.status(200).send("OK");
  });

  // Readiness probe (checks dependencies)
  app.get("/ready", async (req, res) => {
    try {
      // Check if essential services are ready
      const checks = {
        gun: !!app.get("gunInstance"),
      };

      const allReady = Object.values(checks).every(Boolean);

      res.status(allReady ? 200 : 503).json({
        status: allReady ? "ready" : "not_ready",
        checks,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(503).json({
        status: "error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Root route - redirect to dashboard (registered early to avoid conflicts)
  app.get("/", (req, res) => {
    res.redirect("/dashboard/");
  });

  // Route specifica per /admin - redirect to new dashboard
  app.get("/admin", (req, res) => {
    res.redirect("/dashboard/");
  });

  // Serve React Dashboard SPA (built files from public/dashboard/dist)
  const dashboardPath = path.resolve(publicPath, "dashboard", "dist");
  app.use(
    "/dashboard",
    express.static(dashboardPath, {
      setHeaders: (res) => {
        res.set({
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        });
      },
    })
  );

  // SPA fallback for React Router - serve index.html for non-asset routes
  app.get("/dashboard/*", (req, res) => {
    const indexPath = path.resolve(dashboardPath, "index.html");
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).json({
        success: false,
        error: "Dashboard not found",
        message:
          "Dashboard has not been built yet. Run 'npm run build' in the dashboard directory.",
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
    "/api-keys",
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

      if (token === authConfig.adminPassword) {
        next();
      } else {
        loggers.server.warn(`❌ Accesso negato a ${path} - Token mancante o non valido`);
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

  app.use((Gun as any).serve);

  // IPFS File Upload Endpoint
  const upload = multer({ storage: multer.memoryStorage() });

  /**
   * Start the Express server
   * @returns {Promise<import('http').Server>} The HTTP server instance
   */
  async function startServer() {
    const server = app.listen(port, (error) => {
      if (error) {
        return loggers.server.error({ err: error }, "Error during app startup");
      }
      loggers.server.info({ port }, `Server listening on port`);
    });

    return server;
  }

  // Avvia il server
  const server = await startServer();

  // Initialize Holster Relay with built-in WebSocket server and connection management

  const peers = relayConfig.peers;
  loggers.server.info({ peers }, "🔍 Peers");

  // Initialize Gun with storage (SQLite, radisk, or S3)
  const dataDir = storageConfig.dataDir;
  loggers.server.info({ dataDir }, "📁 Data directory");

  // Choose storage type from environment variable
  // Options: "sqlite" (default), "radisk", or "s3"
  const storageType = storageConfig.storageType;
  let store: any = null;

  if (storageType === "sqlite") {
    const dbPath = path.join(dataDir, "gun.db");
    store = new SQLiteStore({
      dbPath: dbPath,
      file: "radata",
    });
    loggers.server.info("📁 Using SQLite storage for Gun");
  } else if (storageType === "s3") {
    const s3Conf = storageConfig.s3;
    if (!s3Conf?.endpoint || !s3Conf?.accessKeyId || !s3Conf?.secretAccessKey) {
      loggers.server.warn(
        "⚠️ S3 storage configured but credentials missing. Falling back to radisk."
      );
    } else {
      store = new S3Store({
        endpoint: s3Conf.endpoint,
        accessKeyId: s3Conf.accessKeyId,
        secretAccessKey: s3Conf.secretAccessKey,
        bucket: s3Conf.bucket,
        region: s3Conf.region,
      });
      loggers.server.info(
        {
          endpoint: s3Conf.endpoint,
          bucket: s3Conf.bucket,
        },
        "🪣 Using S3/MinIO storage for Gun"
      );
    }
  }

  // Configure Gun options based on storage selection
  const gunConfig: any = {
    super: true,
    web: server,
    isValid: hasValidToken,
    uuid: relayConfig.name,
    localStorage: false,
    wire: true,
    axe: false,
    rfs: true,
    wait: 500,
    webrtc: true,
    peers: peers,
    chunk: 1000,
    pack: 1000,
    jsonify: true,
  };

  // Logic to ensure storage consistency
  if (store) {
    // When using a custom store (SQLite or S3), we bind it and enable radisk
    gunConfig.store = store;
    gunConfig.radisk = true; // Custom stores hook into radisk
    // We do NOT set 'file' here to avoid Gun checking/creating default files unnecessarily

    if (storageConfig.disableRadisk) {
      loggers.server.warn(
        "⚠️ DISABLE_RADISK setting ignored because a custom storage adapter (SQLite/S3) is active."
      );
    }
  } else {
    // Fallback to default Gun file storage (Radisk default) or memory-only
    gunConfig.radisk = !storageConfig.disableRadisk;

    if (gunConfig.radisk) {
      gunConfig.file = dataDir; // Only set 'file' when using default file storage
      loggers.server.info("📁 Using file-based radisk storage (default)");
    } else {
      loggers.server.warn(
        "⚠️ Persistent storage DISABLED (radisk=false). Data will be in-memory only."
      );
    }
  }

  (Gun as any).serve(app);

  const gun = (Gun as any)(gunConfig);

  // Initialize Gun Alias Guard to prevent duplicate usernames
  gunAliasGuard(gun);
  // Store gun instance in express app for access from routes
  app.set("gunInstance", gun);
  // Store the gun storage adapter for stats access
  app.set("gunStore", store);
  // Start wormhole cleanup scheduler for orphaned transfer cleanup
  if (wormholeConfig.enabled) {
    startWormholeCleanup(gun);
    loggers.server.info(`✅ Wormhole cleanup started`);
  } else {
    loggers.server.info(`⏭️ Wormhole cleanup disabled (WORMHOLE_ENABLED=false)`);
  }

  // Note: "Data hash not same as hash!" warnings from GunDB are benign
  // They occur when using content-addressed storage with # namespace
  // The data is still saved correctly - this is just GunDB's internal verification
  // These warnings don't affect functionality and can be safely ignored

  // Initialize Relay User for x402 subscriptions
  // This user owns the subscription data in GunDB
  // REQUIRED: Must use direct SEA keypair (prevents "Signature did not match" errors)

  let relayKeyPair = null;
  let relayPub = null;

  // Load SEA keypair from environment variable or file
  if (relayKeysConfig.seaKeypair) {
    try {
      relayKeyPair = JSON.parse(relayKeysConfig.seaKeypair);
      loggers.server.info("🔑 Using SEA keypair from RELAY_SEA_KEYPAIR env var");
    } catch (error: any) {
      loggers.server.error({ err: error }, "❌ Failed to parse RELAY_SEA_KEYPAIR");
      loggers.server.error("   Make sure the JSON is valid and properly escaped in your env file");
      throw new Error("Invalid RELAY_SEA_KEYPAIR configuration");
    }
  } else if (relayKeysConfig.seaKeypairPath) {
    try {
      // Determine the actual keypair file path
      let keypairFilePath = relayKeysConfig.seaKeypairPath;

      // Check if the path is a directory - if so, append default filename
      if (fs.existsSync(keypairFilePath) && fs.statSync(keypairFilePath).isDirectory()) {
        loggers.server.info(`📁 RELAY_SEA_KEYPAIR_PATH is a directory, using default filename`);
        keypairFilePath = path.join(keypairFilePath, "relay-keypair.json");
      }

      // Also handle case where path ends with / (directory notation) but doesn't exist
      if (keypairFilePath.endsWith("/") || keypairFilePath.endsWith("\\")) {
        keypairFilePath = path.join(keypairFilePath, "relay-keypair.json");
      }

      // Check if file exists
      if (!fs.existsSync(keypairFilePath)) {
        loggers.server.warn({ path: keypairFilePath }, `⚠️ Keypair file not found`);
        loggers.server.info(`🔑 Generating new keypair automatically...`);

        // Generate new keypair
        const Gun = (await import("gun")).default;
        await import("gun/sea");
        const newKeyPair = await Gun.SEA.pair();

        // Ensure directory exists
        const keyPairDir = path.dirname(keypairFilePath);
        if (keyPairDir && keyPairDir !== ".") {
          if (!fs.existsSync(keyPairDir)) {
            fs.mkdirSync(keyPairDir, { recursive: true });
          }
        }

        // Save to file
        fs.writeFileSync(keypairFilePath, JSON.stringify(newKeyPair, null, 2), "utf8");
        relayKeyPair = newKeyPair;

        loggers.server.info(`✅ Generated and saved new keypair to ${keypairFilePath}`);
        loggers.server.info(
          { pub: newKeyPair.pub, pubLength: newKeyPair.pub.length },
          `🔑 Public key (generated)`
        );
        loggers.server.warn(`⚠️ IMPORTANT: Save this keypair file securely!`);
      } else {
        // File exists, load it
        const keyPairContent = fs.readFileSync(keypairFilePath, "utf8");
        relayKeyPair = JSON.parse(keyPairContent);
        loggers.server.info(`🔑 Loaded SEA keypair from ${keypairFilePath}`);
      }
    } catch (error: any) {
      loggers.server.error(
        { err: error, path: relayKeysConfig.seaKeypairPath },
        `❌ Failed to load/generate keypair`
      );
      throw new Error(`Failed to load/generate keypair: ${error.message}`);
    }
  } else {
    // No keypair configured - try to auto-generate in default location
    loggers.server.warn(`⚠️ No keypair configured. Attempting to auto-generate...`);

    try {
      // Try default locations
      const defaultPaths = [
        "/app/keys/relay-keypair.json",
        path.join(process.cwd(), "relay-keypair.json"),
        path.join(process.cwd(), "keys", "relay-keypair.json"),
      ];

      let keyPairPath = null;
      for (const defaultPath of defaultPaths) {
        if (fs.existsSync(defaultPath)) {
          keyPairPath = defaultPath;
          loggers.server.info(`📁 Found existing keypair at ${defaultPath}`);
          break;
        }
      }

      // If no existing keypair found, generate new one in first default location
      if (!keyPairPath) {
        keyPairPath = defaultPaths[0]; // Use /app/keys/relay-keypair.json as default

        loggers.server.info(`🔑 Generating new keypair at ${keyPairPath}...`);

        // Generate new keypair
        const Gun = (await import("gun")).default;
        await import("gun/sea");
        const newKeyPair = await Gun.SEA.pair();

        // Ensure directory exists
        const keyPairDir = path.dirname(keyPairPath);
        if (keyPairDir && keyPairDir !== ".") {
          if (!fs.existsSync(keyPairDir)) {
            fs.mkdirSync(keyPairDir, { recursive: true });
          }
        }

        // Save to file
        fs.writeFileSync(keyPairPath, JSON.stringify(newKeyPair, null, 2), "utf8");
        relayKeyPair = newKeyPair;

        loggers.server.info(`✅ Generated new keypair at ${keyPairPath}`);
        loggers.server.info(
          { pub: newKeyPair.pub, pubLength: newKeyPair.pub.length },
          `🔑 Public key (auto-generated)`
        );
        loggers.server.warn(
          `⚠️ IMPORTANT: Save this keypair file securely or set RELAY_SEA_KEYPAIR_PATH!`
        );
      } else {
        // Load existing keypair
        const keyPairContent = fs.readFileSync(keyPairPath, "utf8");
        relayKeyPair = JSON.parse(keyPairContent);
        loggers.server.info(`🔑 Loaded existing keypair from ${keyPairPath}`);
      }
    } catch (autoGenError: any) {
      // Auto-generation failed - provide helpful error
      const errorMsg = `
❌ Failed to auto-generate keypair: ${autoGenError.message}

To configure a keypair manually:
  1. Run: node scripts/generate-relay-keys
  2. Copy the JSON output
  3. Add to your .env file as: RELAY_SEA_KEYPAIR='{"pub":"...","priv":"...","epub":"...","epriv":"..."}'
  OR save to a file and set: RELAY_SEA_KEYPAIR_PATH=/path/to/relay-keypair.json

See docs/RELAY_KEYS.md for more information.
      `.trim();
      loggers.server.error({ err: autoGenError }, errorMsg);
      throw new Error(`Keypair auto-generation failed: ${autoGenError.message}`);
    }
  }

  // Validate and initialize with keypair
  if (!relayKeyPair || !relayKeyPair.pub || !relayKeyPair.priv) {
    loggers.server.error("❌ Invalid keypair: missing pub or priv fields");
    throw new Error(
      "Invalid keypair configuration. Please generate a new keypair using: node scripts/generate-relay-keys"
    );
  }

  try {
    const result = await initRelayUser(gun, relayKeyPair);
    relayPub = result.pub;
    app.set("relayUserPub", relayPub);
    app.set("relayKeyPair", relayKeyPair);
    loggers.server.info(`✅ Relay GunDB user initialized with SEA keypair`);
    loggers.server.info({ pub: relayPub, pubLength: relayPub?.length }, `🔑 Relay public key`);
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Failed to initialize relay with keypair");
    throw new Error(`Failed to initialize relay user: ${error.message}`);
  }

  // Get relay host identifier
  // Extract hostname from endpoint if it's a URL
  let host = serverConfig.host || relayConfig.endpoint || "localhost";
  try {
    // If it's a URL, extract just the hostname
    if (host.includes("://") || host.includes(".")) {
      const url = new URL(host.startsWith("http") ? host : `https://${host}`);
      host = url.hostname;
    }
  } catch (e) {
    // Not a valid URL, use as-is
  }

  // Initialize Network Pin Request Listener (auto-replication)
  const autoReplication = replicationConfig.autoReplication;

  if (autoReplication) {
    loggers.server.info("🔄 Auto-replication enabled - listening for pin requests");

    // Cleanup old processed requests periodically
    setInterval(
      () => {
        const now = Date.now();
        for (const [reqId, info] of processedPinRequests.entries()) {
          if (now - info.processedAt > PIN_REQUEST_CACHE_TTL_MS) {
            processedPinRequests.delete(reqId);
          }
        }
      },
      10 * 60 * 1000
    ); // Cleanup every 10 minutes

    gun
      .get(GUN_PATHS.PIN_REQUESTS)
      .map()
      .on(async (data: any, requestId: any) => {
        if (!data || typeof data !== "object" || !data.cid) return;
        if (data.status !== "pending") return;

        // Don't process old requests (older than 1 hour)
        if (data.timestamp && Date.now() - data.timestamp > 3600000) return;

        // Check if we already processed this request recently
        const cached = processedPinRequests.get(requestId);
        if (cached && Date.now() - cached.processedAt < PIN_REQUEST_CACHE_TTL_MS) {
          // Skip - already processed
          return;
        }

        // Don't process own requests
        const relayPub = app.get("relayUserPub");
        if (data.requester === relayPub) return;

        // Mark as being processed to prevent duplicate processing
        processedPinRequests.set(requestId, {
          processedAt: Date.now(),
          status: "processing",
        });

        if (loggingConfig.debug) {
          loggers.server.debug(
            { cid: data.cid, requester: data.requester?.substring(0, 20) },
            `📥 Received pin request`
          );
        }

        try {
          // Check if we already have this pinned
          const http = await import("http");
          const alreadyPinned = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(false), 5000);
            const options: any = {
              hostname: IPFS_API_HOST,
              port: IPFS_API_PORT,
              path: `/api/v0/pin/ls?arg=${data.cid}&type=all`,
              method: "POST",
              headers: { "Content-Length": "0" },
            };
            if (IPFS_API_TOKEN) {
              options.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
            }
            const req = http.request(options, (res) => {
              let body = "";
              res.on("data", (chunk) => (body += chunk));
              res.on("end", () => {
                clearTimeout(timeout);
                try {
                  const result = JSON.parse(body);
                  resolve(result.Keys && Object.keys(result.Keys).length > 0);
                } catch {
                  resolve(false);
                }
              });
            });
            req.on("error", () => {
              clearTimeout(timeout);
              resolve(false);
            });
            req.end();
          });

          if (alreadyPinned) {
            if (loggingConfig.debug) {
              loggers.server.debug({ cid: data.cid }, `✅ CID already pinned locally`);
            }
            processedPinRequests.set(requestId, {
              processedAt: Date.now(),
              status: "completed",
            });
            return;
          }

          // Pin the content
          if (loggingConfig.debug) {
            loggers.server.debug({ cid: data.cid }, `📌 Pinning`);
          }
          const pinResult: any = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Pin timeout")), 60000);
            const options: any = {
              hostname: IPFS_API_HOST,
              port: IPFS_API_PORT,
              path: `/api/v0/pin/add?arg=${data.cid}`,
              method: "POST",
              headers: { "Content-Length": "0" },
            };
            if (IPFS_API_TOKEN) {
              options.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
            }
            const req = http.request(options, (res) => {
              let body = "";
              res.on("data", (chunk) => (body += chunk));
              res.on("end", () => {
                clearTimeout(timeout);
                try {
                  resolve(JSON.parse(body));
                } catch {
                  resolve({ raw: body });
                }
              });
            });
            req.on("error", (e) => {
              clearTimeout(timeout);
              reject(e);
            });
            req.end();
          });

          if (pinResult.Pins || pinResult.raw?.includes("Pins")) {
            if (loggingConfig.debug) {
              loggers.server.debug({ cid: data.cid }, `✅ Successfully pinned`);
            }
            processedPinRequests.set(requestId, {
              processedAt: Date.now(),
              status: "completed",
            });

            // Publish response
            const crypto = await import("crypto");
            const responseId = crypto.randomBytes(8).toString("hex");
            gun.get(GUN_PATHS.PIN_RESPONSES).get(responseId).put({
              id: responseId,
              requestId,
              responder: relayPub,
              status: "completed",
              timestamp: Date.now(),
            });
          } else {
            if (loggingConfig.debug) {
              loggers.server.debug({ cid: data.cid, pinResult }, `⚠️ Pin result unclear`);
            }
            processedPinRequests.set(requestId, {
              processedAt: Date.now(),
              status: "failed",
            });

          }
        } catch (error: any) {
          if (loggingConfig.debug) {
            loggers.server.error(
              { cid: data.cid, err: error.message },
              `Failed to pin ${data.cid}`
            );
          }
          processedPinRequests.set(requestId, {
            processedAt: Date.now(),
            status: "failed",
          });

        }
      });
  } else {
    loggers.server.info("🔄 Auto-replication disabled");
  }

  // Initialize Generic Services (Linda functionality)
  // DISABLED: Services removed as client migrated to pure GunDB
  /*
    try {
      const { initServices } = await import("./services/manager");
      await initServices(app, server, gun);
    } catch (error) {
      loggers.server.error({ err: error }, "Failed to load Generic Services");
    }
    */

  // Configura l'istanza Gun per le route di autenticazione
  app.set("gunInstance", gun);
  app.set("relayKeyPair", relayKeyPair); // Make relay keypair available to routes

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
  (global as any).gunInstance = gun;

  // Initialize connection counters (before health endpoint)
  let totalConnections = 0;
  let activeWires = 0;
  app.set("totalConnections", 0);
  app.set("activeWires", 0);

  // --- Modular Routes ---
  try {
    const { default: registerRoutes } = await import("./routes/index");
    registerRoutes(app);
    loggers.server.info("✅ Route modulari configurate con successo");
  } catch (error) {
    loggers.server.error({ err: error }, "❌ Errore nel caricamento delle route modulari");
  }

  // ===== SECURITY: Production Error Handler =====
  // This must be added AFTER all routes to catch any unhandled errors
  // In production, it sanitizes error messages to prevent information disclosure
  const isProduction = serverConfig.nodeEnv === "production";
  app.use(createProductionErrorHandler(isProduction));
  if (isProduction) {
    loggers.server.info("🔒 Production error handler enabled - errors will be sanitized");
  }

  // Route statiche (DEFINITE DOPO LE API)

  app.use(express.static(publicPath));

  // Set up relay stats database
  const db = getGunNode(gun, GUN_PATHS.RELAYS).get(host);

  let activeWiresUpdateTimer: NodeJS.Timeout | null = null;
  const updateActiveWires = (total: number, active: number) => {
    if (activeWiresUpdateTimer) clearTimeout(activeWiresUpdateTimer);
    activeWiresUpdateTimer = setTimeout(() => {
      db?.get("totalConnections").put(total);
      db?.get("activeWires").put(active);
    }, 2000);
  };

  gun.on("hi", () => {
    totalConnections += 1;
    activeWires += 1;
    app.set("totalConnections", totalConnections);
    app.set("activeWires", activeWires);
    updateActiveWires(totalConnections, activeWires);
    loggers.server.debug({ activeWires }, `Connection opened`);
  });

  gun.on("bye", () => {
    // Prevent negative counter (can happen on startup cleanup)
    if (activeWires > 0) {
      activeWires -= 1;
    }
    app.set("activeWires", activeWires);
    updateActiveWires(totalConnections, activeWires);
    loggers.server.debug({ activeWires }, `Connection closed`);
  });

  // Set up pulse interval for health monitoring (extended with IPFS stats)
  setSelfAdjustingInterval(async () => {
    const pulse: any = {
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
        name: relayConfig.name,
        version: packageConfig.version,
      },
    };

    // Extend pulse with IPFS stats (non-blocking)
    try {
      const http = await import("http");
      const ipfsStats: any = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 3000);
        const options: any = {
          hostname: "127.0.0.1",
          port: 5001,
          path: "/api/v0/repo/stat?size-only=true&human=false",
          method: "POST",
          headers: { "Content-Length": "0" },
        };
        if (IPFS_API_TOKEN) {
          options.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
        }
        const req = http.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            clearTimeout(timeout);
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve(null);
            }
          });
        });
        req.on("error", () => {
          clearTimeout(timeout);
          resolve(null);
        });
        req.end();
      });

      if (ipfsStats) {
        // Try multiple field names for RepoSize
        let repoSize = 0;
        if (ipfsStats.RepoSize !== undefined) {
          repoSize =
            typeof ipfsStats.RepoSize === "string"
              ? parseInt(ipfsStats.RepoSize, 10) || 0
              : ipfsStats.RepoSize || 0;
        } else if (ipfsStats.repoSize !== undefined) {
          repoSize =
            typeof ipfsStats.repoSize === "string"
              ? parseInt(ipfsStats.repoSize, 10) || 0
              : ipfsStats.repoSize || 0;
        }

        if (repoSize !== undefined) {
          pulse.ipfs = {
            connected: true,
            repoSize: repoSize,
            repoSizeMB: Math.round(repoSize / (1024 * 1024)),
            numObjects: ipfsStats.NumObjects || ipfsStats.numberObjects || 0,
          };

          // Also get pin count (quick query) - changed to O(1) repo stat instead of recursive pins
          const pinCount = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(0), 2000);
            const options: any = {
              hostname: "127.0.0.1",
              port: 5001,
              path: "/api/v0/repo/stat",
              method: "POST",
              headers: { "Content-Length": "0" },
            };
            if (IPFS_API_TOKEN) {
              options.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
            }
            const req = http.request(options, (res) => {
              let data = "";
              res.on("data", (chunk) => (data += chunk));
              res.on("end", () => {
                clearTimeout(timeout);
                try {
                  const stats = JSON.parse(data);
                  resolve(stats.NumObjects ? parseInt(stats.NumObjects, 10) : 0);
                } catch {
                  resolve(0);
                }
              });
            });
            req.on("error", () => {
              clearTimeout(timeout);
              resolve(0);
            });
            req.end();
          });

          pulse.ipfs.numPins = pinCount;
        }
      } else {
        pulse.ipfs = { connected: false };
      }
    } catch (e: any) {
      pulse.ipfs = { connected: false, error: e.message };
    }

    // Legacy pulse (for backward compatibility)
    db?.get("pulse").put(pulse);

    // CRITICAL: Save pulse to GunDB relays namespace for network discovery
    // This is what /api/v1/network/stats reads from
    try {
      // Save pulse with timestamp for filtering
      const relayData = {
        pulse: {
          ...pulse,
          timestamp: pulse.timestamp || Date.now(), // Ensure timestamp is set
        },
        lastUpdated: Date.now(),
      };

      // Warn if host is localhost (common discovery issue)
      if (host.includes("localhost") || host.includes("127.0.0.1")) {
        // Only warn once every ~100 pulses to avoid spam, or warn at startup (but this is a loop)
        // Check random chance or just debug log
        if (Math.random() < 0.05) {
          loggers.server.warn(
            { host },
            "⚠️  Relay host is configured as localhost. External relays will not be able to connect to you. Set RELAY_HOST in .env"
          );
        }
      }

      getGunNode(gun, GUN_PATHS.RELAYS).get(host).put(relayData);

      // Also save to a separate pulse namespace for easier querying
      getGunNode(gun, GUN_PATHS.RELAYS).get(host).get("pulse").put(pulse);

      if (loggingConfig.debug) {
        loggers.server.info(
          {
            host,
            connections: activeWires,
            ipfsConnected: pulse.ipfs?.connected,
            numPins: pulse.ipfs?.numPins || 0,
          },
          `📡 Pulse saved to relays`
        );
      }
    } catch (e: any) {
      loggers.server.warn({ err: e.message }, "Failed to save pulse to GunDB relays namespace");
      if (loggingConfig.debug) {
        loggers.server.debug(
          {
            host,
            connections: activeWires,
            ipfsConnected: pulse.ipfs?.connected,
            numPins: pulse.ipfs?.numPins || 0,
          },
          `📡 Pulse saved to relays`
        );
      }
    }

    addTimeSeriesPoint("connections.active", activeWires);
    addTimeSeriesPoint("memory.heapUsed", process.memoryUsage().heapUsed);

  }, 30000); // 30 seconds

  // Shutdown function
  async function shutdown() {
    loggers.server.info("🛑 Shutting down Shogun Relay...");

    // Give a grace period for in-flight operations to complete
    // GunDB may still have pending operations, so we wait a bit longer
    loggers.server.info("⏳ Waiting for in-flight operations to complete...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Close storage store if it exists (SQLite or S3)
    // The store will gracefully handle any remaining GunDB operations
    if (store) {
      try {
        store.close();
        loggers.server.info("✅ Storage store closed");
      } catch (err: any) {
        loggers.server.error({ err }, "Error closing storage store");
      }
    }

    // Close server
    if (server) {
      server.close(() => {
        loggers.server.info("✅ Server closed");
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  }

  // Handle shutdown signals
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  loggers.server.info({ host, port }, `🚀 Shogun Relay Server running`);

  loggers.server.info({ host, port }, `🚀 Shogun Relay Server running`);

  return {
    server,
    gun,
    addSystemLog,
    addTimeSeriesPoint,
    shutdown,
  };
}

// Add process-level error handlers to catch GUN JSON parse errors
process.on("uncaughtException", (error: Error) => {
  // Handle JSON parse errors from GUN's yson.js gracefully
  if (error.message && error.message.includes("Bad control character in string literal")) {
    loggers.server.warn(
      { err: error },
      "⚠️  Corrupted data file detected in GUN storage. This is usually harmless - GUN will skip the corrupted file."
    );
    // Don't exit - let GUN continue with other files
    return;
  }

  // Handle other uncaught exceptions
  loggers.server.error({ err: error }, "Uncaught exception");
  // Only exit for critical errors
  if (error.message && !error.message.includes("JSON")) {
    process.exit(1);
  }
});

process.on("unhandledRejection", (reason: any, promise: Promise<any>) => {
  // Handle JSON parse errors in promises
  if (
    reason &&
    reason.message &&
    reason.message.includes("Bad control character in string literal")
  ) {
    loggers.server.warn(
      { err: reason },
      "⚠️  Corrupted data file detected in GUN storage (promise rejection). This is usually harmless."
    );
    return;
  }

  loggers.server.error({ err: reason, promise }, "Unhandled promise rejection");
});

// Avvia il server
initializeServer().catch((error) => {
  loggers.server.error({ err: error }, "Failed to initialize server");
  process.exit(1);
});
