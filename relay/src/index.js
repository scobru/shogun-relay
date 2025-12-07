import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import ip from "ip";
import setSelfAdjustingInterval from "self-adjusting-interval";
import crypto from "crypto";
import Gun from "gun";
import "gun/sea.js";
import "gun-authd"; // Import the extension
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
import { initRelayUser, getRelayUser } from "./utils/relay-user.js";
import * as Reputation from "./utils/relay-reputation.js";
import * as FrozenData from "./utils/frozen-data.js";
import SQLiteStore from "./utils/sqlite-store.js";

dotenv.config();

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
// Remove protocol from host if present (http:// or https://)
// Also remove trailing slashes
host = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
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


/**
 * Main server initialization function
 * Sets up Express, GunDB, Holster, and all routes
 * @returns {Promise<void>}
 */
async function initializeServer() {
  // Welcome message with ASCII art logo
  const welcomeMessage = process.env.WELCOME_MESSAGE || `
*** WELCOME TO SHOGUN RELAY ***
`;
  console.log(welcomeMessage);
  console.log("🚀 Initializing Shogun Relay Server...");

  /**
   * System logging function (console only, no GunDB storage)
   * @param {string} level - Log level (info, warn, error, etc.)
   * @param {string} message - Log message
   * @param {any} [data=null] - Optional data to log
   */
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
  function hashToken(token) {
    return crypto.createHash('sha256').update(token || '').digest('hex');
  }

  // Get stored admin password hash (or compute on first use)
  let adminPasswordHash = null;
  /**
   * Get stored admin password hash (or compute on first use)
   * @returns {string|null} The admin password hash, or null if not configured
   */
  function getAdminPasswordHash() {
    if (!adminPasswordHash && process.env.ADMIN_PASSWORD) {
      adminPasswordHash = hashToken(process.env.ADMIN_PASSWORD);
    }
    return adminPasswordHash;
  }

  /**
   * Check if IP is rate limited based on failed authentication attempts
   * @param {string} ip - The IP address to check
   * @returns {boolean} True if the IP is rate limited
   */
  function isRateLimited(ip) {
    const attempts = failedAuthAttempts.get(ip);
    if (!attempts) return false;
    
    const now = Date.now();
    // Remove old attempts outside the window
    const recentAttempts = attempts.filter(timestamp => now - timestamp < AUTH_RATE_WINDOW);
    
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
  function recordFailedAttempt(ip) {
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
  function createSession(ip) {
    const sessionId = crypto.randomBytes(32).toString('hex');
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
  function isValidSession(sessionId, ip) {
    const session = activeSessions.get(sessionId);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
      activeSessions.delete(sessionId);
      return false;
    }
    // Optional: verify IP matches (can be disabled for proxy scenarios)
    if (process.env.STRICT_SESSION_IP !== 'false' && session.ip !== ip) {
      return false;
    }
    return true;
  }

  // Cleanup expired sessions periodically
  setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of activeSessions.entries()) {
      if (now > session.expiresAt) {
        activeSessions.delete(sessionId);
      }
    }
  }, 60 * 60 * 1000); // Cleanup every hour

  /**
   * Enhanced authentication middleware with rate limiting and session management
   * @param {import('express').Request} req - Express request object
   * @param {import('express').Response} res - Express response object
   * @param {import('express').NextFunction} next - Express next function
   */
  const tokenAuthMiddleware = (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';

    // Check if IP is rate limited
    if (isRateLimited(clientIp)) {
      console.log(`Rate limited IP: ${clientIp}`);
      return res.status(429).json({ 
        success: false, 
        error: "Too many failed authentication attempts. Please try again later." 
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

    // Secure token comparison using hash
    const tokenHash = hashToken(token);
    const adminHash = getAdminPasswordHash();

    if (adminHash && tokenHash === adminHash) {
      // Create session for future requests
      const sessionId = createSession(clientIp);
      res.setHeader('X-Session-Token', sessionId);
      // Optionally set cookie
      if (req.headers['accept']?.includes('text/html')) {
        res.cookie('sessionToken', sessionId, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          maxAge: SESSION_DURATION,
          sameSite: 'strict'
        });
      }
      next();
    } else {
      recordFailedAttempt(clientIp);
      console.log(`Auth failed for IP: ${clientIp}`);
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
    // Store holster instance in app settings for health check
    app.set("holsterInstance", holster);
  } catch (error) {
    console.error("❌ Error initializing Holster:", error);
    app.set("holsterInstance", null);
  }

  const peersString = process.env.RELAY_PEERS;
  const peers = peersString ? peersString.split(",") : [];
  console.log("🔍 Peers:", peers);

  // Initialize Gun with storage (SQLite or radisk)
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  console.log("📁 Data directory:", dataDir);
  
  // Choose storage type from environment variable
  // Options: "sqlite" (default) or "radisk"
  const storageType = (process.env.STORAGE_TYPE || "sqlite").toLowerCase();
  let sqliteStore = null;
  
  if (storageType === "sqlite") {
    const dbPath = path.join(dataDir, "gun.db");
    sqliteStore = new SQLiteStore({
      dbPath: dbPath,
      file: "radata"
    });
    console.log("📁 Using SQLite storage for Gun");
  } else {
    console.log("📁 Using file-based radisk storage");
  }
  
  const gunConfig = {
    super: true,
    file: dataDir,
    radisk: process.env.DISABLE_RADISK !== "true", // Allow disabling radisk via env var
    store: sqliteStore, // Use SQLite store if available
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
  } else if (storageType === "sqlite") {
    console.log("📁 Using SQLite storage with radisk");
  } else {
    console.log("📁 Using local file storage with radisk");
  }

  Gun.serve(app);

  const gun = Gun(gunConfig);
  
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
  if (process.env.RELAY_SEA_KEYPAIR) {
    try {
      relayKeyPair = JSON.parse(process.env.RELAY_SEA_KEYPAIR);
      console.log('🔑 Using SEA keypair from RELAY_SEA_KEYPAIR env var');
    } catch (error) {
      console.error('❌ Failed to parse RELAY_SEA_KEYPAIR:', error.message);
      console.error('   Make sure the JSON is valid and properly escaped in your env file');
      throw new Error('Invalid RELAY_SEA_KEYPAIR configuration');
    }
  } else if (process.env.RELAY_SEA_KEYPAIR_PATH) {
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Check if file exists
      if (!fs.existsSync(process.env.RELAY_SEA_KEYPAIR_PATH)) {
        console.log(`⚠️ Keypair file not found at ${process.env.RELAY_SEA_KEYPAIR_PATH}`);
        console.log(`🔑 Generating new keypair automatically...`);
        
        // Generate new keypair
        const Gun = (await import('gun')).default;
        await import('gun/sea.js');
        const newKeyPair = await Gun.SEA.pair();
        
        // Ensure directory exists
        const keyPairDir = path.dirname(process.env.RELAY_SEA_KEYPAIR_PATH);
        if (keyPairDir && keyPairDir !== '.') {
          if (!fs.existsSync(keyPairDir)) {
            fs.mkdirSync(keyPairDir, { recursive: true });
          }
        }
        
        // Save to file
        fs.writeFileSync(process.env.RELAY_SEA_KEYPAIR_PATH, JSON.stringify(newKeyPair, null, 2), 'utf8');
        relayKeyPair = newKeyPair;
        
        console.log(`✅ Generated and saved new keypair to ${process.env.RELAY_SEA_KEYPAIR_PATH}`);
        console.log(`🔑 Public key: ${newKeyPair.pub.substring(0, 30)}...`);
        console.log(`⚠️ IMPORTANT: Save this keypair file securely!`);
      } else {
        // File exists, load it
        const keyPairContent = fs.readFileSync(process.env.RELAY_SEA_KEYPAIR_PATH, 'utf8');
        relayKeyPair = JSON.parse(keyPairContent);
        console.log(`🔑 Loaded SEA keypair from ${process.env.RELAY_SEA_KEYPAIR_PATH}`);
      }
    } catch (error) {
      console.error(`❌ Failed to load/generate keypair from ${process.env.RELAY_SEA_KEYPAIR_PATH}:`, error.message);
      throw new Error(`Failed to load/generate keypair: ${error.message}`);
    }
  } else {
    // No keypair configured - try to auto-generate in default location
    console.log(`⚠️ No keypair configured. Attempting to auto-generate...`);
    
    try {
      const fs = await import('fs');
      const path = await import('path');
      
      // Try default locations
      const defaultPaths = [
        '/app/keys/relay-keypair.json',
        path.join(process.cwd(), 'relay-keypair.json'),
        path.join(process.cwd(), 'keys', 'relay-keypair.json'),
      ];
      
      let keyPairPath = null;
      for (const defaultPath of defaultPaths) {
        if (fs.existsSync(defaultPath)) {
          keyPairPath = defaultPath;
          console.log(`📁 Found existing keypair at ${defaultPath}`);
          break;
        }
      }
      
      // If no existing keypair found, generate new one in first default location
      if (!keyPairPath) {
        keyPairPath = defaultPaths[0]; // Use /app/keys/relay-keypair.json as default
        
        console.log(`🔑 Generating new keypair at ${keyPairPath}...`);
        
        // Generate new keypair
        const Gun = (await import('gun')).default;
        await import('gun/sea.js');
        const newKeyPair = await Gun.SEA.pair();
        
        // Ensure directory exists
        const keyPairDir = path.dirname(keyPairPath);
        if (keyPairDir && keyPairDir !== '.') {
          if (!fs.existsSync(keyPairDir)) {
            fs.mkdirSync(keyPairDir, { recursive: true });
          }
        }
        
        // Save to file
        fs.writeFileSync(keyPairPath, JSON.stringify(newKeyPair, null, 2), 'utf8');
        relayKeyPair = newKeyPair;
        
        console.log(`✅ Generated new keypair at ${keyPairPath}`);
        console.log(`🔑 Public key: ${newKeyPair.pub.substring(0, 30)}...`);
        console.log(`⚠️ IMPORTANT: Save this keypair file securely or set RELAY_SEA_KEYPAIR_PATH!`);
      } else {
        // Load existing keypair
        const keyPairContent = fs.readFileSync(keyPairPath, 'utf8');
        relayKeyPair = JSON.parse(keyPairContent);
        console.log(`🔑 Loaded existing keypair from ${keyPairPath}`);
      }
    } catch (autoGenError) {
      // Auto-generation failed - provide helpful error
      const errorMsg = `
❌ Failed to auto-generate keypair: ${autoGenError.message}

To configure a keypair manually:
  1. Run: node scripts/generate-relay-keys.js
  2. Copy the JSON output
  3. Add to your .env file as: RELAY_SEA_KEYPAIR='{"pub":"...","priv":"...","epub":"...","epriv":"..."}'
  OR save to a file and set: RELAY_SEA_KEYPAIR_PATH=/path/to/relay-keypair.json

See docs/RELAY_KEYS.md for more information.
      `.trim();
      console.error(errorMsg);
      throw new Error(`Keypair auto-generation failed: ${autoGenError.message}`);
    }
  }
  
  // Validate and initialize with keypair
  if (!relayKeyPair || !relayKeyPair.pub || !relayKeyPair.priv) {
    console.error('❌ Invalid keypair: missing pub or priv fields');
    throw new Error('Invalid keypair configuration. Please generate a new keypair using: node scripts/generate-relay-keys.js');
  }
  
  try {
    const result = await initRelayUser(gun, relayKeyPair);
    relayPub = result.pub;
    app.set('relayUserPub', relayPub);
    app.set('relayKeyPair', relayKeyPair);
    console.log(`✅ Relay GunDB user initialized with SEA keypair`);
    console.log(`🔑 Relay public key: ${relayPub?.substring(0, 30)}...`);
  } catch (error) {
    console.error('❌ Failed to initialize relay with keypair:', error.message);
    throw new Error(`Failed to initialize relay user: ${error.message}`);
  }

  // Get relay host identifier
  // Extract hostname from endpoint if it's a URL
  let host = process.env.RELAY_HOST || process.env.RELAY_ENDPOINT || 'localhost';
  try {
    // If it's a URL, extract just the hostname
    if (host.includes('://') || host.includes('.')) {
      const url = new URL(host.startsWith('http') ? host : `https://${host}`);
      host = url.hostname;
    }
  } catch (e) {
    // Not a valid URL, use as-is
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
          
          // Record pin fulfillment for reputation tracking
          try {
            await Reputation.recordPinFulfillment(gun, host, true);
          } catch (e) {
            console.warn('Failed to record pin fulfillment for reputation:', e.message);
          }
          
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
          
          // Record failed pin fulfillment
          try {
            await Reputation.recordPinFulfillment(gun, host, false);
          } catch (e) {
            console.warn('Failed to record pin fulfillment for reputation:', e.message);
          }
        }
      } catch (error) {
        console.error(`❌ Failed to pin ${data.cid}:`, error.message);
        
        // Record failed pin fulfillment for reputation tracking
        try {
          await Reputation.recordPinFulfillment(gun, host, false);
        } catch (e) {
          console.warn('Failed to record pin failure for reputation:', e.message);
        }
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

  // Initialize connection counters (before health endpoint)
  let totalConnections = 0;
  let activeWires = 0;
  app.set('totalConnections', 0);
  app.set('activeWires', 0);

  // Route legacy per compatibilità (definite prima delle route modulari)

  // Enhanced health check endpoint with detailed metrics
  app.get("/health", (req, res) => {
    try {
      // Always return 200 OK for basic health check (Docker needs this)
      // Even if services aren't fully initialized yet, the server is running
      const relayPub = app.get('relayUserPub');
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
      const activeWires = app.get('activeWires') || 0;
      const totalConnections = app.get('totalConnections') || 0;
      
      // Get service instances from app settings (may not be initialized yet)
      const gunInstance = app.get('gunInstance');
      const holsterInstance = app.get('holsterInstance');
      
      const healthData = {
        success: true,
        status,
        timestamp: new Date().toISOString(),
        uptime: {
          seconds: Math.floor(uptimeSeconds),
          hours: Math.floor(uptimeHours * 10) / 10,
          formatted: `${Math.floor(uptimeHours)}h ${Math.floor((uptimeSeconds % 3600) / 60)}m`
        },
        connections: {
          active: activeWires,
          total: totalConnections
        },
        memory: {
          heapUsedMB: Math.round(memUsageMB * 10) / 10,
          heapTotalMB: Math.round(memLimitMB * 10) / 10,
          percent: Math.round(memPercent * 10) / 10,
          rssMB: Math.round(memUsage.rss / 1024 / 1024 * 10) / 10
        },
        relay: {
          pub: relayPub || null,
          name: process.env.RELAY_NAME || 'shogun-relay',
          host,
          port
        },
        services: {
          gun: gunInstance ? "active" : "inactive",
          holster: holsterInstance ? "active" : "inactive",
          ipfs: "unknown" // Will be updated by IPFS status check
        },
        warnings: warnings.length > 0 ? warnings : undefined
      };

      // Always return 200 for Docker health check
      // Docker/Kubernetes will kill the container if we return non-200
      // The 'status' field in the response indicates health without killing the container
      res.status(200).json(healthData);
    } catch (error) {
      console.error("Error in /health endpoint:", error);
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
  function formatUptime(seconds) {
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
    const activeWires = app.get('activeWires') || 0;
    const totalConnections = app.get('totalConnections') || 0;
    
    const metrics = {
      timestamp: Date.now(),
      uptime: process.uptime(),
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        rss: memUsage.rss,
        external: memUsage.external
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      connections: {
        active: activeWires,
        total: totalConnections
      },
      sessions: {
        active: activeSessions.size,
        failedAuthAttempts: failedAuthAttempts.size
      },
      relay: {
        name: process.env.RELAY_NAME || 'shogun-relay',
        host,
        port
      }
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
      const { CONTRACTS_CONFIG, getConfigByChainId } = await import('shogun-contracts');
      const chainIdParam = req.query.chainId;
      
      if (chainIdParam) {
        // Get config for specific chain
        const chainIdNum = typeof chainIdParam === 'string' ? parseInt(chainIdParam) : parseInt(String(chainIdParam));
        if (isNaN(chainIdNum)) {
          return res.status(400).json({
            success: false,
            error: 'Invalid chainId parameter'
          });
        }
        const config = getConfigByChainId(chainIdNum);
        
        if (!config) {
          return res.status(404).json({
            success: false,
            error: `No contracts configured for chain ID ${chainId}`
          });
        }
        
        return res.json({
          success: true,
          chainId: chainIdNum,
          network: Object.keys(CONTRACTS_CONFIG).find(
            key => CONTRACTS_CONFIG[key].chainId === chainIdNum
          ),
          contracts: {
            relayRegistry: config.relayRegistry,
            storageDealRegistry: config.storageDealRegistry,
            dataPostRegistry: config.dataPostRegistry,
            dataSaleEscrowFactory: config.dataSaleEscrowFactory,
            usdc: config.usdc
          },
          rpc: config.rpc,
          explorer: config.explorer
        });
      }
      
      // Return all configured networks
      const networks = {};
      for (const [networkName, config] of Object.entries(CONTRACTS_CONFIG)) {
        networks[networkName] = {
          chainId: config.chainId,
          contracts: {
            relayRegistry: config.relayRegistry,
            storageDealRegistry: config.storageDealRegistry,
            dataPostRegistry: config.dataPostRegistry,
            dataSaleEscrowFactory: config.dataSaleEscrowFactory,
            usdc: config.usdc
          },
          rpc: config.rpc,
          explorer: config.explorer
        };
      }
      
      res.json({
        success: true,
        networks,
        availableChains: Object.values(CONTRACTS_CONFIG).map(c => c.chainId)
      });
    } catch (error) {
      console.error('Error fetching contracts config:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch contracts configuration',
        message: error.message
      });
    }
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

  // Blockchain RPC status endpoint
  app.get("/rpc-status", async (req, res) => {
    try {
      const { CONTRACTS_CONFIG, getConfigByChainId } = await import('shogun-contracts');
      const { ethers } = await import('ethers');
      const { RPC_URLS } = await import('./utils/registry-client.js');
      
      const REGISTRY_CHAIN_ID = parseInt(process.env.REGISTRY_CHAIN_ID) || 84532;
      const X402_NETWORK = process.env.X402_NETWORK || 'base-sepolia';
      const X402_RPC_URL = process.env.X402_RPC_URL;
      
      const rpcStatuses = [];
      
      // Check registry chain RPC
      const registryConfig = getConfigByChainId(REGISTRY_CHAIN_ID);
      if (registryConfig && registryConfig.rpc) {
        try {
          const provider = new ethers.JsonRpcProvider(registryConfig.rpc);
          const startTime = Date.now();
          const blockNumber = await Promise.race([
            provider.getBlockNumber(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
          ]);
          const latency = Date.now() - startTime;
          
          rpcStatuses.push({
            name: `Registry Chain (${REGISTRY_CHAIN_ID})`,
            chainId: REGISTRY_CHAIN_ID,
            rpc: registryConfig.rpc,
            status: 'online',
            latency: `${latency}ms`,
            blockNumber: blockNumber.toString(),
            network: registryConfig.network || 'unknown'
          });
        } catch (error) {
          rpcStatuses.push({
            name: `Registry Chain (${REGISTRY_CHAIN_ID})`,
            chainId: REGISTRY_CHAIN_ID,
            rpc: registryConfig.rpc,
            status: 'offline',
            error: error.message,
            network: registryConfig.network || 'unknown'
          });
        }
      }
      
      // Check X402 payment RPC
      if (X402_RPC_URL) {
        try {
          const provider = new ethers.JsonRpcProvider(X402_RPC_URL);
          const startTime = Date.now();
          const blockNumber = await Promise.race([
            provider.getBlockNumber(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
          ]);
          const latency = Date.now() - startTime;
          
          rpcStatuses.push({
            name: `X402 Payment (${X402_NETWORK})`,
            chainId: 'custom',
            rpc: X402_RPC_URL,
            status: 'online',
            latency: `${latency}ms`,
            blockNumber: blockNumber.toString(),
            network: X402_NETWORK
          });
        } catch (error) {
          rpcStatuses.push({
            name: `X402 Payment (${X402_NETWORK})`,
            chainId: 'custom',
            rpc: X402_RPC_URL,
            status: 'offline',
            error: error.message,
            network: X402_NETWORK
          });
        }
      }
      
      // Check all configured chains
      for (const [key, config] of Object.entries(CONTRACTS_CONFIG)) {
        if (config && config.chainId && config.rpc) {
          // Skip if already checked
          if (config.chainId === REGISTRY_CHAIN_ID) continue;
          
          try {
            const provider = new ethers.JsonRpcProvider(config.rpc);
            const startTime = Date.now();
            const blockNumber = await Promise.race([
              provider.getBlockNumber(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
            ]);
            const latency = Date.now() - startTime;
            
            rpcStatuses.push({
              name: `${key} (${config.chainId})`,
              chainId: config.chainId,
              rpc: config.rpc,
              status: 'online',
              latency: `${latency}ms`,
              blockNumber: blockNumber.toString(),
              network: config.network || key
            });
          } catch (error) {
            rpcStatuses.push({
              name: `${key} (${config.chainId})`,
              chainId: config.chainId,
              rpc: config.rpc,
              status: 'offline',
              error: error.message,
              network: config.network || key
            });
          }
        }
      }
      
      const onlineCount = rpcStatuses.filter(r => r.status === 'online').length;
      const totalCount = rpcStatuses.length;
      
      res.json({
        success: true,
        rpcs: rpcStatuses,
        summary: {
          total: totalCount,
          online: onlineCount,
          offline: totalCount - onlineCount
        }
      });
    } catch (error) {
      console.error("❌ RPC Status Error:", error);
      res.status(500).json({
        success: false,
        error: error.message
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

  gun.on("hi", () => {
    totalConnections += 1;
    activeWires += 1;
    app.set('totalConnections', totalConnections);
    app.set('activeWires', activeWires);
    db?.get("totalConnections").put(totalConnections);
    db?.get("activeWires").put(activeWires);
    console.log(`Connection opened (active: ${activeWires})`);
  });

  gun.on("bye", () => {
    // Prevent negative counter (can happen on startup cleanup)
    if (activeWires > 0) {
      activeWires -= 1;
    }
    app.set('activeWires', activeWires);
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
      
      gun.get('relays').get(host).put(relayData);
      
      // Also save to a separate pulse namespace for easier querying
      gun.get('relays').get(host).get('pulse').put(pulse);
      
      if (process.env.DEBUG) {
        console.log(`📡 Pulse saved to relays/${host} (connections: ${activeWires}, IPFS: ${pulse.ipfs?.connected ? 'connected' : 'disconnected'}, pins: ${pulse.ipfs?.numPins || 0})`);
      }
    } catch (e) {
      console.warn('⚠️ Failed to save pulse to GunDB relays namespace:', e.message);
    }
    
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

  // Real-time deal synchronization with IPFS pins
  // Syncs active on-chain deals to ensure their CIDs are pinned
  // Uses two-tier sync: fast sync (every 2 min) + full sync (every 5 min)
  const DEAL_SYNC_ENABLED = process.env.DEAL_SYNC_ENABLED !== 'false';
  const DEAL_SYNC_INTERVAL_MS = parseInt(process.env.DEAL_SYNC_INTERVAL_MS) || 5 * 60 * 1000; // Default: 5 minutes (reduced from 6 hours)
  const DEAL_SYNC_FAST_INTERVAL_MS = parseInt(process.env.DEAL_SYNC_FAST_INTERVAL_MS) || 2 * 60 * 1000; // Default: 2 minutes for fast sync
  const DEAL_SYNC_INITIAL_DELAY_MS = parseInt(process.env.DEAL_SYNC_INITIAL_DELAY_MS) || 30 * 1000; // Default: 30 seconds (reduced from 5 minutes)
  const RELAY_PRIVATE_KEY = process.env.RELAY_PRIVATE_KEY;
  const REGISTRY_CHAIN_ID = process.env.REGISTRY_CHAIN_ID;

  // Store interval/timeout references for cleanup
  let dealSyncInitialTimeout = null;
  let dealSyncFastInterval = null; // Fast sync for near real-time updates
  let dealSyncFullInterval = null; // Full sync for complete synchronization

  if (DEAL_SYNC_ENABLED && RELAY_PRIVATE_KEY && REGISTRY_CHAIN_ID) {
    console.log(`🔄 Real-time deal sync enabled:`);
    console.log(`   - Fast sync: every ${DEAL_SYNC_FAST_INTERVAL_MS / 1000} seconds (near real-time)`);
    console.log(`   - Full sync: every ${DEAL_SYNC_INTERVAL_MS / 1000 / 60} minutes (complete sync)`);
    
    // Initial sync after short delay (give IPFS time to start)
    dealSyncInitialTimeout = setTimeout(async () => {
      try {
        const { createRegistryClientWithSigner } = await import('./utils/registry-client.js');
        const DealSync = await import('./utils/deal-sync.js');
        const { getRelayUser } = await import('./utils/relay-user.js');
        
        const registryClient = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, parseInt(REGISTRY_CHAIN_ID));
        const relayAddress = registryClient.wallet.address;
        
        // Get relay user for GunDB sync
        const relayUser = getRelayUser();
        const relayKeyPair = relayUser?._?.sea || null;
        
        console.log(`🔄 Starting initial deal sync for relay ${relayAddress}...`);
        await DealSync.syncDealsWithIPFS(relayAddress, parseInt(REGISTRY_CHAIN_ID), {
          onlyActive: true,
          dryRun: false,
          gun: gun,
          relayKeyPair: relayKeyPair,
        });
        console.log(`✅ Initial deal sync completed`);
      } catch (error) {
        console.warn(`⚠️ Initial deal sync failed: ${error.message}`);
      }
    }, DEAL_SYNC_INITIAL_DELAY_MS);

    // Fast sync: frequent lightweight sync for near real-time updates
    // This checks for new deals and syncs them quickly
    dealSyncFastInterval = setInterval(async () => {
      try {
        const { createRegistryClientWithSigner } = await import('./utils/registry-client.js');
        const DealSync = await import('./utils/deal-sync.js');
        const { getRelayUser } = await import('./utils/relay-user.js');
        
        const registryClient = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, parseInt(REGISTRY_CHAIN_ID));
        const relayAddress = registryClient.wallet.address;
        
        // Get relay user for GunDB sync
        const relayUser = getRelayUser();
        const relayKeyPair = relayUser?._?.sea || null;
        
        // Fast sync: only sync new/active deals (lightweight)
        await DealSync.syncDealsWithIPFS(relayAddress, parseInt(REGISTRY_CHAIN_ID), {
          onlyActive: true,
          dryRun: false,
          gun: gun,
          relayKeyPair: relayKeyPair,
          fastSync: true, // Enable fast sync mode (skip expensive operations)
        });
      } catch (error) {
        // Don't log fast sync errors as warnings (too noisy)
        // Only log if it's a critical error
        if (error.message && !error.message.includes('timeout') && !error.message.includes('ECONNREFUSED')) {
          console.warn(`⚠️ Fast deal sync error: ${error.message}`);
        }
      }
    }, DEAL_SYNC_FAST_INTERVAL_MS);

    // Full sync: complete synchronization with all checks
    // This runs less frequently but does a thorough sync
    dealSyncFullInterval = setInterval(async () => {
      try {
        const { createRegistryClientWithSigner } = await import('./utils/registry-client.js');
        const DealSync = await import('./utils/deal-sync.js');
        const { getRelayUser } = await import('./utils/relay-user.js');
        
        const registryClient = createRegistryClientWithSigner(RELAY_PRIVATE_KEY, parseInt(REGISTRY_CHAIN_ID));
        const relayAddress = registryClient.wallet.address;
        
        // Get relay user for GunDB sync
        const relayUser = getRelayUser();
        const relayKeyPair = relayUser?._?.sea || null;
        
        console.log(`🔄 Full deal sync for relay ${relayAddress}...`);
        await DealSync.syncDealsWithIPFS(relayAddress, parseInt(REGISTRY_CHAIN_ID), {
          onlyActive: true,
          dryRun: false,
          gun: gun,
          relayKeyPair: relayKeyPair,
          fastSync: false, // Full sync mode
        });
        console.log(`✅ Full deal sync completed`);
      } catch (error) {
        console.warn(`⚠️ Full deal sync failed: ${error.message}`);
      }
    }, DEAL_SYNC_INTERVAL_MS);
  } else {
    if (!DEAL_SYNC_ENABLED) {
      console.log(`⏭️  Deal sync disabled (set DEAL_SYNC_ENABLED=true to enable)`);
    } else if (!RELAY_PRIVATE_KEY) {
      console.log(`⏭️  Deal sync disabled (RELAY_PRIVATE_KEY not configured)`);
    } else if (!REGISTRY_CHAIN_ID) {
      console.log(`⏭️  Deal sync disabled (REGISTRY_CHAIN_ID not configured)`);
    }
  }

  // Shutdown function
  async function shutdown() {
    console.log("🛑 Shutting down Shogun Relay...");

    // Mark shutdown in progress to stop deal sync operations
    try {
      const DealSync = await import('./utils/deal-sync.js');
      if (DealSync.markShutdownInProgress) {
        DealSync.markShutdownInProgress();
      }
    } catch (err) {
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
    console.log("⏳ Waiting for in-flight operations to complete...");
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Close SQLite store if it exists
    // The SQLiteStore will now gracefully handle any remaining GunDB operations
    if (sqliteStore) {
      try {
        sqliteStore.close();
        console.log("✅ SQLite store closed");
      } catch (err) {
        console.error("Error closing SQLite store:", err);
      }
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
