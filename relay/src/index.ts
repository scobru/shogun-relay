import express from "express";
import path from "path";
import fs from "fs";
import cors from "cors";
import dotenv from "dotenv";
import setSelfAdjustingInterval from "self-adjusting-interval";
import crypto from "crypto";
import { fileURLToPath } from "url";
import Gun from "gun";
import "gun/sea";
import "gun/lib/stats";
import "gun/lib/webrtc";
import "gun/axe";
import "gun/lib/wire";
import "./utils/bullet-catcher";
import Holster from "@mblaney/holster/src/holster.js";
import multer from "multer";
import { initRelayUser, getRelayUser } from "./utils/relay-user";
import * as Reputation from "./utils/relay-reputation";
import * as FrozenData from "./utils/frozen-data";
import SQLiteStore from "./utils/sqlite-store";
import { loggers } from "./utils/logger";
import {
  config,
  ipfsConfig,
  relayConfig,
  serverConfig,
  holsterConfig,
  authConfig,
  storageConfig,
  relayKeysConfig,
  registryConfig,
  x402Config,
  dealSyncConfig,
  bridgeConfig,
  wormholeConfig,
  replicationConfig,
  loggingConfig,
  packageConfig,
} from "./config/env-config";
import { startBatchScheduler } from "./utils/batch-scheduler";
import { startWormholeCleanup } from "./utils/wormhole-cleanup";
import {
  secureCompare,
  hashToken,
  isValidChainId,
  getChainName,
  createProductionErrorHandler,
} from "./utils/security";
import { startPeriodicPeerSync } from "./utils/peer-discovery";
import { annasArchiveManager } from "./utils/annas-archive";

dotenv.config();

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

// Note: holsterConfig is now imported directly from env-config

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

    loggers.server.warn(`❌ PUT denied - no valid auth: ${msg.headers}`);
    return false;
  }

  // Crea l'app Express
  const app = express();
  const publicPath = path.resolve(__dirname, path_public);
  const indexPath = path.resolve(publicPath, "index.html");

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
      "X-Wallet-Signature",
      "X-Deal-Upload",
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

  // ===== ROOT HEALTH CHECK ENDPOINT (for load balancers, k8s probes) =====
  app.get("/health", (req, res) => {
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: packageConfig.version || "1.0.0",
    });
  });

  // Liveness probe (minimal check)
  app.get("/healthz", (req, res) => {
    res.status(200).send("OK");
  });

  // Readiness probe (checks dependencies)
  app.get("/ready", async (req, res) => {
    try {
      // Check if essential services are ready
      const holsterInstance = app.get("holsterInstance");
      const gunInstance = app.get("gunInstance");

      const checks = {
        gun: !!gunInstance,
        holster: !!holsterInstance,
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

  // Enhanced authentication with rate limiting and token hashing
  const failedAuthAttempts = new Map(); // Track failed attempts per IP
  const AUTH_RATE_LIMIT = 5; // Max failed attempts
  const AUTH_RATE_WINDOW = 15 * 60 * 1000; // 15 minutes
  const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  const activeSessions = new Map(); // Simple in-memory session store

  /**
   * Hash token for secure comparison (prevents timing attacks)
   * @param {string} token - The token to hash
   * @returns {string} SHA-256 hash of the token
   */
  /* function hashToken(token: string) {
    return crypto
      .createHash("sha256")
      .update(token || "")
      .digest("hex");
  } */

  // Get stored admin password hash (or compute on first use)
  let adminPasswordHash: string | null = null;
  /**
   * Get stored admin password hash (or compute on first use)
   * @returns {string|null} The admin password hash, or null if not configured
   */
  function getAdminPasswordHash() {
    if (!adminPasswordHash && authConfig.adminPassword) {
      adminPasswordHash = hashToken(authConfig.adminPassword);
    }
    return adminPasswordHash;
  }

  /**
   * Check if IP is rate limited based on failed authentication attempts
   * @param {string} ip - The IP address to check
   * @returns {boolean} True if the IP is rate limited
   */
  function isRateLimited(ip: string) {
    const attempts = failedAuthAttempts.get(ip);
    if (!attempts) return false;

    const now = Date.now();
    // Remove old attempts outside the window
    const recentAttempts = attempts.filter(
      (timestamp: number) => now - timestamp < AUTH_RATE_WINDOW
    );

    if (recentAttempts.length >= AUTH_RATE_LIMIT) {
      failedAuthAttempts.set(ip, recentAttempts);
      return true;
    }

    failedAuthAttempts.set(ip, recentAttempts);
    return false;
  }

  /**
   * Record failed authentication attempt for an IP address
   * @param {string} ip - The IP address that failed authentication
   */
  function recordFailedAttempt(ip: string) {
    const now = Date.now();
    const attempts = failedAuthAttempts.get(ip) || [];
    attempts.push(now);
    failedAuthAttempts.set(ip, attempts);
  }

  /**
   * Create a new session token for an authenticated IP
   * @param {string} ip - The IP address to create a session for
   * @returns {string} The session ID
   */
  function createSession(ip: string) {
    const sessionId = crypto.randomBytes(32).toString("hex");
    const expiresAt = Date.now() + SESSION_DURATION;
    activeSessions.set(sessionId, { ip, expiresAt });
    return sessionId;
  }

  /**
   * Validate a session token
   * @param {string} sessionId - The session ID to validate
   * @param {string} ip - The IP address making the request
   * @returns {boolean} True if the session is valid
   */
  function isValidSession(sessionId: string, ip: string) {
    const session = activeSessions.get(sessionId);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      activeSessions.delete(sessionId);
      return false;
    }
    // Optional: verify IP matches (can be disabled for proxy scenarios)
    if (authConfig.strictSessionIp && session.ip !== ip) {
      return false;
    }
    return true;
  }

  // Cleanup expired sessions periodically
  setInterval(
    () => {
      const now = Date.now();
      for (const [sessionId, session] of activeSessions.entries()) {
        if (now > session.expiresAt) {
          activeSessions.delete(sessionId);
        }
      }
    },
    60 * 60 * 1000
  ); // Cleanup every hour

  /**
   * Enhanced authentication middleware with rate limiting and session management
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   * @param {import('express').NextFunction} next - Express next function
   */
  const tokenAuthMiddleware = (req: any, res: any, next: any) => {
    const clientIp = req.ip || req.connection.remoteAddress || "unknown";

    // Check if IP is rate limited
    if (isRateLimited(clientIp)) {
      loggers.server.warn(`Rate limited IP: ${clientIp}`);
      return res.status(429).json({
        success: false,
        error: "Too many failed authentication attempts. Please try again later.",
      });
    }

    // Check for session token first (more efficient)
    const sessionToken = req.headers["x-session-token"] || req.cookies?.sessionToken;
    if (sessionToken && isValidSession(sessionToken, clientIp)) {
      return next();
    }

    // Fallback to password authentication
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (!token) {
      recordFailedAttempt(clientIp);
      return res.status(401).json({ success: false, error: "Unauthorized - Token required" });
    }

    // Secure token comparison using hash and timing-safe comparison
    const tokenHash = hashToken(token);
    const adminHash = getAdminPasswordHash();

    if (adminHash && secureCompare(tokenHash, adminHash)) {
      // Create session for future requests
      const sessionId = createSession(clientIp);
      res.setHeader("X-Session-Token", sessionId);
      // Optionally set cookie
      if (req.headers["accept"]?.includes("text/html")) {
        res.cookie("sessionToken", sessionId, {
          httpOnly: true,
          secure: serverConfig.nodeEnv === "production",
          maxAge: SESSION_DURATION,
          sameSite: "strict",
        });
      }
      next();
    } else {
      recordFailedAttempt(clientIp);
      loggers.server.warn(`Auth failed for IP: ${clientIp}`);
      res.status(401).json({ success: false, error: "Unauthorized - Invalid token" });
    }
  };

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
  let holster: any = null;
  if (holsterConfig.enabled) {
    try {
      holster = Holster({
        port: holsterConfig.port,
        secure: true,
        peers: [], // No peers by default
        maxConnections: holsterConfig.maxConnections,
        file: holsterConfig.storageEnabled ? holsterConfig.storagePath : undefined,
      });
      loggers.server.info(`✅ Holster Relay initialized on port ${holsterConfig.port}`);
      loggers.server.info(
        `📁 Holster storage: ${holsterConfig.storageEnabled ? holsterConfig.storagePath : "disabled"}`
      );
      // Store holster instance in app settings for health check
      app.set("holsterInstance", holster);
    } catch (error) {
      loggers.server.error({ err: error }, "❌ Error initializing Holster");
      app.set("holsterInstance", null);
    }
  } else {
    loggers.server.info(`⏭️ Holster disabled (HOLSTER_ENABLED=false)`);
    app.set("holsterInstance", null);
  }

  const peers = relayConfig.peers;
  loggers.server.info({ peers }, "🔍 Peers");

  // Initialize Gun with storage (SQLite or radisk)
  const dataDir = storageConfig.dataDir;
  loggers.server.info({ dataDir }, "📁 Data directory");

  // Choose storage type from environment variable
  // Options: "sqlite" (default) or "radisk"
  const storageType = storageConfig.storageType;
  let sqliteStore: any = null;

  if (storageType === "sqlite") {
    const dbPath = path.join(dataDir, "gun.db");
    sqliteStore = new SQLiteStore({
      dbPath: dbPath,
      file: "radata",
    });
    loggers.server.info("📁 Using SQLite storage for Gun");
  } else {
    loggers.server.info("📁 Using file-based radisk storage");
  }

  const gunConfig = {
    super: true,
    file: dataDir,
    radisk: !storageConfig.disableRadisk, // Allow disabling radisk via env var
    store: sqliteStore, // Use SQLite store if available
    web: server,
    isValid: hasValidToken,
    uuid: relayConfig.name,
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

  if (storageConfig.disableRadisk) {
    loggers.server.info("📁 Radisk disabled via environment variable");
  } else if (storageType === "sqlite") {
    loggers.server.info("📁 Using SQLite storage with radisk");
  } else {
    loggers.server.info("📁 Using local file storage with radisk");
  }

  (Gun as any).serve(app);

  const gun = (Gun as any)(gunConfig);

  // Start batch scheduler for automated L2 -> L1 submission (requires Bridge)
  if (bridgeConfig.enabled) {
    startBatchScheduler(gun);
    loggers.server.info(`✅ Batch scheduler started (Bridge enabled)`);
  } else {
    loggers.server.info(`⏭️ Batch scheduler disabled (BRIDGE_ENABLED=false)`);
  }

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
      const fs = await import("fs");
      const path = await import("path");

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
        fs.writeFileSync(
          keypairFilePath,
          JSON.stringify(newKeyPair, null, 2),
          "utf8"
        );
        relayKeyPair = newKeyPair;

        loggers.server.info(
          `✅ Generated and saved new keypair to ${keypairFilePath}`
        );
        loggers.server.info({ pub: newKeyPair.pub, pubLength: newKeyPair.pub.length }, `🔑 Public key (generated)`);
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
      const fs = await import("fs");
      const path = await import("path");

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
        loggers.server.info({ pub: newKeyPair.pub, pubLength: newKeyPair.pub.length }, `🔑 Public key (auto-generated)`);
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

  // Initialize reputation tracking for this relay
  try {
    Reputation.initReputationTracking(gun, host);
    loggers.server.info({ host }, `📊 Reputation tracking initialized`);
  } catch (e: any) {
    loggers.server.warn({ err: e }, "⚠️ Failed to initialize reputation tracking");
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
      .get("shogun-network")
      .get("pin-requests")
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

            // Record pin fulfillment for reputation tracking
            try {
              await Reputation.recordPinFulfillment(gun, host, true);
            } catch (e: any) {
              loggers.server.warn({ err: e }, "Failed to record pin fulfillment for reputation");
            }

            // Publish response
            const crypto = await import("crypto");
            const responseId = crypto.randomBytes(8).toString("hex");
            gun.get("shogun-network").get("pin-responses").get(responseId).put({
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

            // Record failed pin fulfillment
            try {
              await Reputation.recordPinFulfillment(gun, host, false);
            } catch (e: any) {
              // Silent in production
              if (loggingConfig.debug) {
                loggers.server.warn("Failed to record pin fulfillment for reputation:", e.message);
              }
            }
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

          // Record failed pin fulfillment for reputation tracking
          try {
            await Reputation.recordPinFulfillment(gun, host, false);
          } catch (e: any) {
            // Silent in production
          }
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

  // Route legacy per compatibilità (definite prima delle route modulari)

  // Enhanced health check endpoint with detailed metrics
  app.get("/health", (req, res) => {
    try {
      // Always return 200 OK for basic health check (Docker needs this)
      // Even if services aren't fully initialized yet, the server is running
      const relayPub = app.get("relayUserPub");
      const memUsage = process.memoryUsage();

      // Calculate health status
      const memUsageMB = memUsage.heapUsed / 1024 / 1024;
      const memLimitMB = memUsage.heapTotal / 1024 / 1024;
      const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

      let status = "healthy";
      const warnings = [];

      // Check memory usage (only warn, don't fail health check)
      if (memPercent > 90) {
        status = "degraded";
        warnings.push("High memory usage");
      }

      // Check uptime (warn if very low, might indicate recent restart)
      // But don't fail health check during startup
      const uptimeSeconds = process.uptime();
      const uptimeHours = uptimeSeconds / 3600;
      if (uptimeSeconds < 30) {
        warnings.push("Recently started (still initializing)");
      }

      // Get connection stats from app settings
      const activeWires = app.get("activeWires") || 0;
      const totalConnections = app.get("totalConnections") || 0;

      // Get service instances from app settings (may not be initialized yet)
      const gunInstance = app.get("gunInstance");
      const holsterInstance = app.get("holsterInstance");

      const healthData = {
        success: true,
        status,
        timestamp: new Date().toISOString(),
        uptime: {
          seconds: Math.floor(uptimeSeconds),
          hours: Math.floor(uptimeHours * 10) / 10,
          formatted: `${Math.floor(uptimeHours)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`,
        },
        connections: {
          active: activeWires,
          total: totalConnections,
        },
        memory: {
          heapUsedMB: Math.round(memUsageMB * 10) / 10,
          heapTotalMB: Math.round(memLimitMB * 10) / 10,
          percent: Math.round(memPercent * 10) / 10,
          rssMB: Math.round((memUsage.rss / 1024 / 1024) * 10) / 10,
        },
        relay: {
          pub: relayPub || null,
          epub: (app.get("relayKeyPair") as any)?.epub || null,
          pubLength: relayPub?.length || 0,
          name: relayConfig.name,
          host,
          port,
        },
        services: {
          gun: gunInstance ? "active" : "inactive",
          holster: holsterInstance ? "active" : "inactive",
          ipfs: "unknown", // Will be updated by IPFS status check
        },
        warnings: warnings.length > 0 ? warnings : undefined,
      };

      // Always return 200 for Docker health check
      // Docker/Kubernetes will kill the container if we return non-200
      // The 'status' field in the response indicates health without killing the container
      res.status(200).json(healthData);
    } catch (error: any) {
      loggers.server.error({ err: error }, "Error in /health endpoint");
      // Even on error, return 200 so Docker doesn't kill the container
      // The error in the response will indicate the issue
      res.status(200).json({
        success: false,
        status: "error",
        error: error.message,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    }
  });

  // Helper function to format uptime
  function formatUptime(seconds: number) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  }

  // Metrics endpoint for monitoring
  app.get("/metrics", tokenAuthMiddleware, (req, res) => {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Get connection stats from app settings
    const activeWires = app.get("activeWires") || 0;
    const totalConnections = app.get("totalConnections") || 0;

    const metrics = {
      timestamp: Date.now(),
      uptime: process.uptime(),
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
        external: memUsage.external,
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system,
      },
      connections: {
        active: activeWires,
        total: totalConnections,
      },
      sessions: {
        active: activeSessions.size,
        failedAuthAttempts: failedAuthAttempts.size,
      },
      relay: {
        name: relayConfig.name,
        host,
        port,
      },
    };

    res.json(metrics);
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

  // Contracts configuration endpoint
  app.get("/api/v1/contracts", async (req, res) => {
    try {
      const { CONTRACTS_CONFIG, getConfigByChainId } = await import("shogun-contracts-sdk");
      const chainIdParam = req.query.chainId;

      if (chainIdParam) {
        // Get config for specific chain
        const chainIdNum =
          typeof chainIdParam === "string"
            ? parseInt(chainIdParam)
            : parseInt(String(chainIdParam));
        if (isNaN(chainIdNum)) {
          return res.status(400).json({
            success: false,
            error: "Invalid chainId parameter",
          });
        }
        const config = getConfigByChainId(chainIdNum);

        if (!config) {
          return res.status(404).json({
            success: false,
            error: `No contracts configured for chain ID ${chainIdNum}`,
          });
        }

        return res.json({
          success: true,
          chainId: chainIdNum,
          network: Object.keys(CONTRACTS_CONFIG).find(
            (key: string) => (CONTRACTS_CONFIG as any)[key].chainId === chainIdNum
          ),
          contracts: {
            relayRegistry: config.relayRegistry,
            storageDealRegistry: config.storageDealRegistry,
            dataPostRegistry: config.dataPostRegistry,
            dataSaleEscrowFactory: config.dataSaleEscrowFactory,
            usdc: config.usdc,
          },
          rpc: config.rpc,
          explorer: config.explorer,
        });
      }

      // Return all configured networks
      const networks: any = {};
      for (const [networkName, config] of Object.entries(CONTRACTS_CONFIG)) {
        networks[networkName] = {
          chainId: config.chainId,
          contracts: {
            relayRegistry: config.relayRegistry,
            storageDealRegistry: config.storageDealRegistry,
            dataPostRegistry: config.dataPostRegistry,
            dataSaleEscrowFactory: config.dataSaleEscrowFactory,
            usdc: config.usdc,
          },
          rpc: config.rpc,
          explorer: config.explorer,
        };
      }

      res.json({
        success: true,
        networks,
        availableChains: Object.values(CONTRACTS_CONFIG).map((c) => c.chainId),
      });
    } catch (error: any) {
      loggers.server.error({ err: error }, "Error fetching contracts config");
      res.status(500).json({
        success: false,
        error: "Failed to fetch contracts configuration",
        message: error.message,
      });
    }
  });

  // IPFS status endpoint
  app.get("/ipfs-status", async (req, res) => {
    try {
      loggers.server.debug("📊 IPFS Status: Checking IPFS node status");

      const requestOptions: any = {
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
            loggers.server.error({ err: parseError }, "IPFS status parse error");
            res.json({
              success: false,
              status: "error",
              error: "Failed to parse IPFS response",
            });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        loggers.server.error({ err }, "❌ IPFS Status Error");
        res.json({
          success: false,
          status: "disconnected",
          error: "IPFS node not responding",
        });
      });

      ipfsReq.end();
    } catch (error: any) {
      loggers.server.error({ err: error }, "❌ IPFS Status Error");
      res.json({
        success: false,
        status: "error",
        error: error.message,
      });
    }
  });

  // Blockchain RPC status endpoint
  app.get("/rpc-status", async (req, res) => {
    try {
      const { CONTRACTS_CONFIG, getConfigByChainId } = await import("shogun-contracts-sdk");
      const { ethers } = await import("ethers");
      const { RPC_URLS } = await import("./utils/registry-client");

      const REGISTRY_CHAIN_ID = registryConfig.chainId;
      const X402_NETWORK = x402Config.defaultNetwork;
      const X402_RPC_URL = x402Config.getRpcUrl();

      const rpcStatuses = [];

      // Check registry chain RPC
      const registryChainConfig = getConfigByChainId(REGISTRY_CHAIN_ID);
      if (registryChainConfig && registryChainConfig.rpc) {
        try {
          const provider = new ethers.JsonRpcProvider(registryChainConfig.rpc);
          const startTime = Date.now();
          const blockNumber: any = await Promise.race([
            provider.getBlockNumber(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000)),
          ]);
          const latency = Date.now() - startTime;

          rpcStatuses.push({
            name: `Registry Chain (${REGISTRY_CHAIN_ID})`,
            chainId: REGISTRY_CHAIN_ID,
            rpc: registryChainConfig.rpc,
            status: "online",
            latency: `${latency}ms`,
            blockNumber: blockNumber.toString(),
            network: (registryChainConfig as any).network || "unknown",
          });
        } catch (error: any) {
          rpcStatuses.push({
            name: `Registry Chain (${REGISTRY_CHAIN_ID})`,
            chainId: REGISTRY_CHAIN_ID,
            rpc: registryChainConfig.rpc,
            status: "offline",
            error: error.message,
            network: (registryChainConfig as any).network || "unknown",
          });
        }
      }

      // Check X402 payment RPC
      if (X402_RPC_URL) {
        try {
          const provider = new ethers.JsonRpcProvider(X402_RPC_URL);
          const startTime = Date.now();
          const blockNumber: any = await Promise.race([
            provider.getBlockNumber(),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000)),
          ]);
          const latency = Date.now() - startTime;

          rpcStatuses.push({
            name: `X402 Payment (${X402_NETWORK})`,
            chainId: "custom",
            rpc: X402_RPC_URL,
            status: "online",
            latency: `${latency}ms`,
            blockNumber: blockNumber.toString(),
            network: X402_NETWORK,
          });
        } catch (error: any) {
          rpcStatuses.push({
            name: `X402 Payment (${X402_NETWORK})`,
            chainId: "custom",
            rpc: X402_RPC_URL,
            status: "offline",
            error: error.message,
            network: X402_NETWORK,
          });
        }
      }

      // Check all configured chains
      for (const [key, config] of Object.entries(CONTRACTS_CONFIG)) {
        if (config && (config as any).chainId && (config as any).rpc) {
          const conf = config as any;
          // Skip if already checked
          if (conf.chainId === REGISTRY_CHAIN_ID) continue;

          try {
            const provider = new ethers.JsonRpcProvider(conf.rpc);
            const startTime = Date.now();
            const blockNumber: any = await Promise.race([
              provider.getBlockNumber(),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 5000)),
            ]);
            const latency = Date.now() - startTime;

            rpcStatuses.push({
              name: `${key} (${conf.chainId})`,
              chainId: conf.chainId,
              rpc: conf.rpc,
              status: "online",
              latency: `${latency}ms`,
              blockNumber: blockNumber.toString(),
              network: conf.network || key,
            });
          } catch (error: any) {
            rpcStatuses.push({
              name: `${key} (${conf.chainId})`,
              chainId: conf.chainId,
              rpc: conf.rpc,
              status: "offline",
              error: error.message,
              network: conf.network || key,
            });
          }
        }
      }

      const onlineCount = rpcStatuses.filter((r: any) => r.status === "online").length;
      const totalCount = rpcStatuses.length;

      res.json({
        success: true,
        rpcs: rpcStatuses,
        summary: {
          total: totalCount,
          online: onlineCount,
          offline: totalCount - onlineCount,
        },
      });
    } catch (error: any) {
      loggers.server.error({ err: error }, "❌ RPC Status Error");
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
  const db = gun.get("relays").get(host);

  gun.on("hi", () => {
    totalConnections += 1;
    activeWires += 1;
    app.set("totalConnections", totalConnections);
    app.set("activeWires", activeWires);
    db?.get("totalConnections").put(totalConnections);
    db?.get("activeWires").put(activeWires);
    loggers.server.debug({ activeWires }, `Connection opened`);
  });

  gun.on("bye", () => {
    // Prevent negative counter (can happen on startup cleanup)
    if (activeWires > 0) {
      activeWires -= 1;
    }
    app.set("activeWires", activeWires);
    db?.get("activeWires").put(activeWires);
    loggers.server.debug({ activeWires }, `Connection closed`);
  });

  gun.on("out", { get: { "#": { "*": "" } } } as any);

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

          // Also get pin count (quick query)
          const pinCount = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(0), 2000);
            const options: any = {
              hostname: "127.0.0.1",
              port: 5001,
              path: "/api/v0/pin/ls?type=recursive",
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
                  const pins = JSON.parse(data);
                  resolve(pins.Keys ? Object.keys(pins.Keys).length : 0);
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

      gun.get("relays").get(host).put(relayData);

      // Also save to a separate pulse namespace for easier querying
      gun.get("relays").get(host).get("pulse").put(pulse);

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

    // Record pulse for reputation tracking (own uptime)
    try {
      await Reputation.recordPulse(gun, host);
      // Periodically update stored score (every 10 minutes = 20 pulses)
      if (Math.random() < 0.05) {
        // ~5% chance each pulse
        await Reputation.updateStoredScore(gun, host);
      }
    } catch (e: any) {
      // Non-critical, don't log every time
    }

    // Create frozen (immutable, signed) announcement every ~5 minutes
    // Only if relay user is initialized (has keypair for signing)
    try {
      const relayUser = getRelayUser();
      if (relayUser && relayUser.is && Math.random() < 0.1) {
        // ~10% chance = every ~5 min
        const announcement = {
          type: "relay-announcement",
          host,
          port,
          name: relayConfig.name,
          version: packageConfig.version,
          uptime: process.uptime(),
          connections: pulse.connections,
          ipfs: pulse.ipfs,
          // Use object instead of array for GunDB compatibility
          capabilities: {
            "ipfs-pin": true,
            "storage-proof": true,
            "x402-subscription": true,
            "storage-deals": true,
          },
        };

        await FrozenData.createFrozenEntry(
          gun,
          announcement,
          (relayUser as any)?._?.sea, // SEA keypair
          "relay-announcements",
          host
        );
      }
    } catch (e: any) {
      // Non-critical, frozen announcements are optional
      if (loggingConfig.debug) loggers.server.debug({ err: e }, "Frozen announcement skipped");
    }
  }, 30000); // 30 seconds

  // Real-time deal synchronization with IPFS pins
  // Syncs active on-chain deals to ensure their CIDs are pinned
  // Uses two-tier sync: fast sync (every 2 min) + full sync (every 5 min)
  const DEAL_SYNC_ENABLED = dealSyncConfig.enabled;
  const DEAL_SYNC_INTERVAL_MS = dealSyncConfig.intervalMs;
  const DEAL_SYNC_FAST_INTERVAL_MS = dealSyncConfig.fastIntervalMs;
  const DEAL_SYNC_INITIAL_DELAY_MS = dealSyncConfig.initialDelayMs;
  const RELAY_PRIVATE_KEY = registryConfig.relayPrivateKey;
  const REGISTRY_CHAIN_ID = registryConfig.chainId?.toString();

  // Store interval/timeout references for cleanup
  let dealSyncInitialTimeout: any = null;
  let dealSyncFastInterval: any = null; // Fast sync for near real-time updates
  let dealSyncFullInterval: any = null; // Full sync for complete synchronization

  if (DEAL_SYNC_ENABLED && RELAY_PRIVATE_KEY && REGISTRY_CHAIN_ID) {
    loggers.server.info(
      {
        fastSyncInterval: DEAL_SYNC_FAST_INTERVAL_MS / 1000,
        fullSyncInterval: DEAL_SYNC_INTERVAL_MS / 1000 / 60,
      },
      `🔄 Real-time deal sync enabled`
    );

    // Initial sync after short delay (give IPFS time to start)
    dealSyncInitialTimeout = setTimeout(async () => {
      try {
        const { createRegistryClientWithSigner } = await import("./utils/registry-client");
        const DealSync = await import("./utils/deal-sync");
        const { getRelayUser } = await import("./utils/relay-user");

        const registryClient = createRegistryClientWithSigner(
          RELAY_PRIVATE_KEY!,
          registryConfig.chainId
        );
        const relayAddress = registryClient.wallet.address;

        // Get relay user for GunDB sync
        const relayUser = getRelayUser();
        const relayKeyPair = (relayUser as any)?._?.sea || null;

        loggers.server.info({ relayAddress }, `🔄 Starting initial deal sync`);
        await DealSync.syncDealsWithIPFS(relayAddress, registryConfig.chainId, {
          onlyActive: true,
          dryRun: false,
          gun: gun,
          relayKeyPair: relayKeyPair,
        });
        loggers.server.info(`✅ Initial deal sync completed`);
      } catch (error: any) {
        loggers.server.warn({ err: error }, `⚠️ Initial deal sync failed`);
      }
    }, DEAL_SYNC_INITIAL_DELAY_MS);

    // Fast sync: frequent lightweight sync for near real-time updates
    // This checks for new deals and syncs them quickly
    dealSyncFastInterval = setInterval(async () => {
      try {
        const { createRegistryClientWithSigner } = await import("./utils/registry-client");
        const DealSync = await import("./utils/deal-sync");
        const { getRelayUser } = await import("./utils/relay-user");

        const registryClient = createRegistryClientWithSigner(
          RELAY_PRIVATE_KEY!,
          registryConfig.chainId
        );
        const relayAddress = registryClient.wallet.address;

        // Get relay user for GunDB sync
        const relayUser = getRelayUser();
        const relayKeyPair = (relayUser as any)?._?.sea || null;

        // Fast sync: only sync new/active deals (lightweight)
        await DealSync.syncDealsWithIPFS(relayAddress, registryConfig.chainId, {
          onlyActive: true,
          dryRun: false,
          gun: gun,
          relayKeyPair: relayKeyPair,
          fastSync: true, // Enable fast sync mode (skip expensive operations)
        });
      } catch (error: any) {
        // Don't log fast sync errors as warnings (too noisy)
        // Only log if it's a critical error
        if (
          error.message &&
          !error.message.includes("timeout") &&
          !error.message.includes("ECONNREFUSED")
        ) {
          loggers.server.warn({ err: error }, `⚠️ Fast deal sync error: ${error.message}`);
        }
      }
    }, DEAL_SYNC_FAST_INTERVAL_MS);

    // Full sync: complete synchronization with all checks
    // This runs less frequently but does a thorough sync
    dealSyncFullInterval = setInterval(async () => {
      try {
        const { createRegistryClientWithSigner } = await import("./utils/registry-client");
        const DealSync = await import("./utils/deal-sync");
        const { getRelayUser } = await import("./utils/relay-user");

        const registryClient = createRegistryClientWithSigner(
          RELAY_PRIVATE_KEY!,
          registryConfig.chainId
        );
        const relayAddress = registryClient.wallet.address;

        // Get relay user for GunDB sync
        const relayUser = getRelayUser();
        const relayKeyPair = (relayUser as any)?._?.sea || null;

        loggers.server.info({ relayAddress }, `🔄 Full deal sync`);
        await DealSync.syncDealsWithIPFS(relayAddress, registryConfig.chainId, {
          onlyActive: true,
          dryRun: false,
          gun: gun,
          relayKeyPair: relayKeyPair,
          fastSync: false, // Full sync mode
        });
        loggers.server.info(`✅ Full deal sync completed`);
      } catch (error: any) {
        loggers.server.warn({ err: error }, `⚠️ Full deal sync failed`);
      }
    }, DEAL_SYNC_INTERVAL_MS);
  } else {
    if (!DEAL_SYNC_ENABLED) {
      loggers.server.info(`⏭️  Deal sync disabled (set DEAL_SYNC_ENABLED=true to enable)`);
    } else if (!RELAY_PRIVATE_KEY) {
      loggers.server.info(`⏭️  Deal sync disabled (RELAY_PRIVATE_KEY not configured)`);
    } else if (!REGISTRY_CHAIN_ID) {
      loggers.server.info(`⏭️  Deal sync disabled (REGISTRY_CHAIN_ID not configured)`);
    }
  }

  // ============================================================================
  // BRIDGE LISTENER & AUTO BATCH SUBMISSION
  // ============================================================================

  const BRIDGE_ENABLED = bridgeConfig.enabled;
  const BRIDGE_RPC_URL = bridgeConfig.getRpcUrl();
  const BRIDGE_CHAIN_ID = bridgeConfig.getChainId();
  const BRIDGE_AUTO_BATCH_ENABLED = bridgeConfig.autoBatchEnabled;
  const BRIDGE_AUTO_BATCH_INTERVAL_MS = bridgeConfig.autoBatchIntervalMs;
  const BRIDGE_AUTO_BATCH_MIN_WITHDRAWALS = bridgeConfig.autoBatchMinWithdrawals;

  let bridgeBatchInterval: any = null;

  // Initialize Bridge Listener (listens to Deposit events)
  if (BRIDGE_ENABLED && BRIDGE_RPC_URL) {
    // ===== SECURITY: Validate ChainId before starting bridge =====
    const chainIdValidation = isValidChainId(BRIDGE_CHAIN_ID, bridgeConfig.validChainIds);
    if (!chainIdValidation.valid) {
      loggers.server.error(
        {
          chainId: BRIDGE_CHAIN_ID,
          error: chainIdValidation.error,
          validChainIds: bridgeConfig.validChainIds,
        },
        "❌ Invalid Bridge Chain ID - Bridge disabled for security"
      );
      // Don't start bridge with invalid chain
    } else {
      loggers.server.info(
        {
          chainId: BRIDGE_CHAIN_ID,
          chainName: getChainName(BRIDGE_CHAIN_ID),
        },
        "✅ Bridge Chain ID validated"
      );

      try {
        const { startBridgeListener } = await import("./utils/bridge-listener");
        const { initNoncePersistence, loadPersistedNonces } = await import("./utils/bridge-state");

        // Initialize nonce persistence with GunDB instance
        initNoncePersistence(gun);

        // Load persisted nonces from GunDB (survives relay restarts)
        const loadedNonces = await loadPersistedNonces(gun);
        if (loadedNonces > 0) {
          loggers.server.info({ count: loadedNonces }, "🔢 Loaded persisted nonces from GunDB");
        }

        await startBridgeListener(gun, {
          rpcUrl: BRIDGE_RPC_URL,
          chainId: BRIDGE_CHAIN_ID,
          startBlock: bridgeConfig.startBlock,
          minConfirmations: bridgeConfig.minConfirmations,
          relayKeyPair: relayKeyPair, // Pass relay keypair for signing balance data
          enabled: true,
        });

        // Get contract address from SDK for logging
        const { createBridgeClient } = await import("./utils/bridge-client");
        const tempClient = createBridgeClient({
          rpcUrl: BRIDGE_RPC_URL,
          chainId: BRIDGE_CHAIN_ID,
        });

        loggers.server.info(
          {
            contractAddress: tempClient.contractAddress,
            chainId: BRIDGE_CHAIN_ID,
          },
          "🌉 Bridge deposit listener started"
        );
      } catch (error: any) {
        loggers.server.error({ err: error }, "❌ Failed to start bridge listener");
      }
    } // End of chainId validation else block

    // Auto batch submission (if enabled and relay can act as sequencer)
    if (BRIDGE_AUTO_BATCH_ENABLED && BRIDGE_RPC_URL) {
      try {
        const { createBridgeClient } = await import("./utils/bridge-client");
        const { getPendingWithdrawals, removePendingWithdrawals, saveBatch } =
          await import("./utils/bridge-state");
        const { buildMerkleTreeFromWithdrawals } = await import("./utils/merkle-tree");

        const bridgeClient = createBridgeClient({
          rpcUrl: BRIDGE_RPC_URL,
          chainId: BRIDGE_CHAIN_ID,
          privateKey: bridgeConfig.sequencerPrivateKey,
        });

        // Check if this relay can submit batches
        const sequencer = await bridgeClient.getSequencer();
        const relayAddress = bridgeClient.wallet?.address;

        if (
          sequencer === "0x0000000000000000000000000000000000000000" ||
          (relayAddress && relayAddress.toLowerCase() === sequencer.toLowerCase())
        ) {
          loggers.server.info(
            {
              interval: BRIDGE_AUTO_BATCH_INTERVAL_MS / 1000,
              minWithdrawals: BRIDGE_AUTO_BATCH_MIN_WITHDRAWALS,
            },
            "🔄 Auto batch submission enabled"
          );

          bridgeBatchInterval = setInterval(async () => {
            try {
              const pending = await getPendingWithdrawals(gun);

              if (pending.length < BRIDGE_AUTO_BATCH_MIN_WITHDRAWALS) {
                return; // Not enough withdrawals to batch
              }

              // Convert to withdrawal leaves
              const withdrawals = pending.map((w) => ({
                user: w.user,
                amount: BigInt(w.amount),
                nonce: BigInt(w.nonce),
              }));

              // Build Merkle tree
              const { root } = buildMerkleTreeFromWithdrawals(withdrawals);

              // Submit batch
              const result = await bridgeClient.submitBatch(root);
              const batchId = await bridgeClient.getCurrentBatchId();

              // Save batch to GunDB
              await saveBatch(gun, {
                batchId: batchId.toString(),
                root,
                withdrawals: pending,
                timestamp: Date.now(),
                blockNumber: result.blockNumber,
                txHash: result.txHash,
              });

              // Remove processed withdrawals
              await removePendingWithdrawals(gun, pending);

              loggers.server.info(
                {
                  batchId: batchId.toString(),
                  root,
                  withdrawalCount: pending.length,
                  txHash: result.txHash,
                },
                "✅ Auto batch submitted"
              );
            } catch (error: any) {
              // Don't log every error (too noisy)
              if (
                error.message &&
                !error.message.includes("timeout") &&
                !error.message.includes("ECONNREFUSED") &&
                !error.message.includes("insufficient funds")
              ) {
                loggers.server.warn({ err: error }, "⚠️ Auto batch submission error");
              }
            }
          }, BRIDGE_AUTO_BATCH_INTERVAL_MS);
        } else {
          loggers.server.info(
            {
              sequencer,
              relayAddress,
            },
            "⏭️  Auto batch disabled (relay is not sequencer)"
          );
        }
      } catch (error: any) {
        loggers.server.warn({ err: error }, "⚠️ Failed to initialize auto batch submission");
      }
    } else {
      if (!BRIDGE_AUTO_BATCH_ENABLED) {
        loggers.server.info(
          "⏭️  Auto batch submission disabled (set BRIDGE_AUTO_BATCH_ENABLED=true to enable)"
        );
      }
    }
  } else {
    if (!BRIDGE_ENABLED) {
      loggers.server.info("⏭️  Bridge disabled (set BRIDGE_ENABLED=true to enable)");
    } else if (!BRIDGE_RPC_URL) {
      loggers.server.info("⏭️  Bridge disabled (BRIDGE_RPC_URL not configured)");
    }
  }

  // Start on-chain relay peer discovery
  // Syncs registered relays from ShogunRelayRegistry as Gun peers
  try {
    const chainId = parseInt(process.env.REGISTRY_CHAIN_ID || "84532");
    const ownEndpoint = process.env.RELAY_HOST
      ? `https://${process.env.RELAY_HOST}`
      : `http://localhost:${port}`;

    startPeriodicPeerSync(gun, chainId, ownEndpoint, 5 * 60 * 1000); // Every 5 minutes
    loggers.server.info(
      { chainId, excludeEndpoint: ownEndpoint },
      "🔗 Started on-chain relay peer discovery"
    );
  } catch (error: any) {
    loggers.server.warn({ err: error }, "⚠️ Failed to start peer discovery");
  }

  // Shutdown function
  async function shutdown() {
    loggers.server.info("🛑 Shutting down Shogun Relay...");

    // Stop bridge listener
    try {
      const { stopBridgeListener } = await import("./utils/bridge-listener");
      stopBridgeListener();
    } catch (err: any) {
      // Ignore if module not loaded
    }

    // Cancel bridge batch interval
    if (bridgeBatchInterval) {
      clearInterval(bridgeBatchInterval);
      bridgeBatchInterval = null;
    }

    // Mark shutdown in progress to stop deal sync operations
    try {
      const DealSync = await import("./utils/deal-sync");
      if (DealSync.markShutdownInProgress) {
        DealSync.markShutdownInProgress();
      }
    } catch (err: any) {
      // Ignore if module not loaded
    }

    // Cancel deal sync timers
    if (dealSyncInitialTimeout) {
      clearTimeout(dealSyncInitialTimeout);
      dealSyncInitialTimeout = null;
    }
    if (dealSyncFastInterval) {
      clearInterval(dealSyncFastInterval);
      dealSyncFastInterval = null;
    }
    if (dealSyncFullInterval) {
      clearInterval(dealSyncFullInterval);
      dealSyncFullInterval = null;
    }

    // Give a grace period for in-flight operations to complete
    // GunDB may still have pending operations, so we wait a bit longer
    loggers.server.info("⏳ Waiting for in-flight operations to complete...");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Close SQLite store if it exists
    // The SQLiteStore will now gracefully handle any remaining GunDB operations
    if (sqliteStore) {
      try {
        sqliteStore.close();
        loggers.server.info("✅ SQLite store closed");
      } catch (err: any) {
        loggers.server.error({ err }, "Error closing SQLite store");
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

  // Initialize Anna's Archive integration
  try {
    await annasArchiveManager.start(relayPub, gun);
  } catch (error) {
    loggers.server.error({ err: error }, "❌ Failed to initialize Anna's Archive integration");
  }

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
