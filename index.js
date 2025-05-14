import dotenv from "dotenv";
dotenv.config();

import cors from "cors";
import multer from "multer";
import fs from "fs";
import express from "express";
import { ShogunCore, RelayVerifier, DIDVerifier } from "shogun-core";
import Gun from "gun";
import path from "path";
import http from "http";
import "bullet-catcher";
import { 
  AuthenticationManager, 
  isKeyPreAuthorized, 
  authorizeKey, 
  verifyJWT, 
  configure 
} from "./AuthenticationManager.js";
import ShogunIpfsManager from "./IpfsManager.js";
import ShogunFileManager from "./FileManager.js";
import setupAuthRoutes from "./authRoutes.js"; // Import the new auth router setup function
import setupIpfsApiRoutes from "./ipfsApiRoutes.js"; // Import the new IPFS router setup function
import setupRelayApiRoutes from "./relayApiRoutes.js"; // Import the new relay router setup function

// create __dirname
const __dirname = path.resolve();

// Import the utility functions
import { gunPubKeyToHex } from "./utils.js";

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8765;
const HOST = process.env.HOST || "localhost";
const STORAGE_DIR = path.resolve("./uploads");
const SECRET_TOKEN = process.env.API_SECRET_TOKEN || "thisIsTheTokenForReals";
const JWT_SECRET =
  process.env.JWT_SECRET ||
  process.env.API_SECRET_TOKEN ||
  "thisIsTheTokenForReals";
const LOGS_DIR = path.resolve("./logs");

// Initial configuration of RELAY_CONFIG - set once at the start
const RELAY_CONFIG = {
  relay: {
    registryAddress: process.env.RELAY_REGISTRY_CONTRACT,
    providerUrl: process.env.ETHEREUM_PROVIDER_URL,
    // Convert string 'true'/'false' to actual boolean
    onchainMembership: process.env.ONCHAIN_MEMBERSHIP_ENABLED === 'true',
  },
  didVerifier: {
    // Convert string 'true'/'false' to actual boolean
    enabled: process.env.DID_VERIFIER_ENABLED === 'true',
    contractAddress: process.env.DID_REGISTRY_CONTRACT,
    providerUrl: process.env.ETHEREUM_PROVIDER_URL,
  },
  keyPair: process.env.APP_KEY_PAIR,
};

// This map will store temporarily authorized keys
const authorizedKeys = new Map();
// Expire authorized keys after 5 minutes
const AUTH_KEY_EXPIRY = 5 * 60 * 1000;

const getDefaultAllowedOrigins = () => {
  return [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:8080",
    "http://localhost:8081",
    "http://localhost:8765",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:8765",
    "http://localhost:8765",
  ];
};

// Define allowedOrigins once
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : getDefaultAllowedOrigins();

// Configure the AuthenticationManager with our variables
configure({
  SECRET_TOKEN,
  JWT_SECRET,
  authorizedKeys,
  AUTH_KEY_EXPIRY,
  RELAY_CONFIG,
  relayVerifier: null, // Will be set later after initialization
  allowedOrigins,
});

// Fix the isValid function to properly handle authorization
const gunOptions = {
  web: server,
  peers: ["http://localhost:8765/gun"],
  file: "radata",
  radisk: true,
  localStorage: false,
  isValid: AuthenticationManager.isValidGunMessage.bind(AuthenticationManager) // Corrected: Use .bind()
};

// Relay component instances
let relayVerifier = null;
let didVerifier = null;

// Initialize ShogunCore with the same Gun instance
let shogunCore = null;

// CORS Configuration
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests without origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      // Enable all origins in development mode
      if (process.env.NODE_ENV === "development") {
        return callback(null, true);
      }

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.warn(`Origin blocked by CORS: ${origin}`);
        callback(null, false);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Initialize IpfsManager
const ipfsManager = new ShogunIpfsManager({
  enabled: process.env.IPFS_ENABLED === "true" || false,
  service: process.env.IPFS_SERVICE || "IPFS-CLIENT",
  nodeUrl: process.env.IPFS_NODE_URL || "http://127.0.0.1:5001",
  gateway: process.env.IPFS_GATEWAY || "http://127.0.0.1:8080/ipfs",
  pinataGateway: process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud",
  pinataJwt: process.env.PINATA_JWT || "",
  encryptionEnabled: process.env.ENCRYPTION_ENABLED === "true" || false,
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  encryptionAlgorithm: process.env.ENCRYPTION_ALGORITHM || "aes-256-gcm",
  apiKey: SECRET_TOKEN,
});

// Declare FileManager at module scope
let fileManager; 

// For backward compatibility
let IPFS_CONFIG = ipfsManager.getConfig();
let shogunIpfs = ipfsManager.getInstance();

// Create upload directory if it doesn't exist
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// Middlewares
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use("/uploads", express.static(STORAGE_DIR));
app.use(Gun.serve);

// Multer for file uploads
let upload; // upload variable is managed by FileManager now

/**
 * Configure Multer based on IPFS availability
 */
function configureMulter() {
  console.log(
    `Configuring Multer - IPFS ${ipfsManager.isEnabled() ? "enabled" : "disabled"}`
  );

  if (ipfsManager.isEnabled()) {
    // When IPFS is enabled, use memoryStorage to keep buffer in memory
    const memoryStorage = multer.memoryStorage();
    upload = multer({
      storage: memoryStorage,
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
      },
    });
    console.log("Multer configured with memoryStorage for IPFS");
  } else {
    // When IPFS is disabled, use diskStorage to save directly to disk
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        // Ensure directory exists
        if (!fs.existsSync(STORAGE_DIR)) {
          fs.mkdirSync(STORAGE_DIR, { recursive: true });
        }
        cb(null, STORAGE_DIR);
      },
      filename: (req, file, cb) => {
        // Generate unique filename
        const uniqueFilename = `${Date.now()}-${file.originalname.replace(
          /[^a-zA-Z0-9.-]/g,
          "_"
        )}`;
        cb(null, uniqueFilename);
      },
    });

    upload = multer({
      storage: storage,
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
      },
    });
    console.log("Multer configured with diskStorage for local storage");
  }
}

// Initial configuration
configureMulter();

let gun;

// User Token Management System
// This stores user tokens in GunDB with proper indexing

/**
 * Generates a secure random token
 * @param {number} length - Length of the token
 * @returns {string} The generated token
 */
// function generateSecureToken(length = 32) { // <<< REMOVED
// return crypto.randomBytes(length).toString("hex");
// }

/**
 * Creates a new API token for a user
 * @param {string} userId - The user ID
 * @param {string} tokenName - A name/label for the token
 * @param {Date|null} expiresAt - Optional expiration date
 * @returns {Promise<object>} The created token information
 */
// async function createUserToken(userId, tokenName, expiresAt = null) { // <<< REMOVED
// return new Promise((resolve, reject) => {
// console.log(
// `[CREATE-TOKEN] Creating token for user ${userId}, name: ${
// tokenName || "API Token"
// }`
// );
// if (!userId) {
// console.error("[CREATE-TOKEN] Error: User ID is required");
// reject(new Error("User ID is required"));
// return;
// }
// const tokenId = generateSecureToken(16);
// const expiryDate =
// expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
// const tokenPayload = {
// userId: userId,
// tokenId: tokenId,
// name: tokenName || "API Token",
// iat: Math.floor(Date.now() / 1000),
// exp: Math.floor(expiryDate.getTime() / 1000),
// };
// const tokenValue = jwt.sign(tokenPayload, JWT_SECRET);
// console.log(
// `[CREATE-TOKEN] Generated tokenId: ${tokenId.substring(0, 6)}...`
// );
// const tokenData = {
// id: tokenId,
// token: tokenValue,
// name: tokenName || "API Token",
// userId: userId,
// createdAt: Date.now(),
// expiresAt: expiryDate.getTime(),
// lastUsed: null,
// revoked: false,
// };
// console.log(`[CREATE-TOKEN] Token data created, storing in Gun DB...`);
// if (!gun) {
// console.error("[CREATE-TOKEN] Error: Gun instance is not available");
// reject(new Error("Gun database not available"));
// return;
// }
// gun
// .get("users")
// .get(userId)
// .get("tokens")
// .get(tokenId)
// .put(tokenData, (ack) => {
// if (ack.err) {
// console.error(`[CREATE-TOKEN] Failed to store token: ${ack.err}`);
// reject(new Error("Failed to store token: " + ack.err));
// } else {
// console.log(`[CREATE-TOKEN] Token stored for user ${userId}`);
// gun
// .get("tokenIndex")
// .get(tokenId)
// .put(
// {
// userId: userId,
// tokenId: tokenId,
// },
// (indexAck) => {
// if (indexAck.err) {
// console.warn(
// `[CREATE-TOKEN] Failed to index token: ${indexAck.err}`
// );
// } else {
// console.log(`[CREATE-TOKEN] Token indexed for quick lookup`);
// }
// resolve(tokenData);
// }
// );
// }
// });
// });
// }

/**
 * Validates a user token
 * @param {string} token - The token to validate
 * @returns {Promise<object|null>} User info if token is valid, null otherwise
 */
// async function validateUserToken(token) { // <<< KEPT FOR NOW, but should be reviewed if it's still needed or if AuthenticationManager.validateToken is sufficient everywhere
// return new Promise((resolve) => {
// AuthenticationManager.validateToken(token)
// .then(auth => {
// if (!auth) {
// resolve(null);
// return;
// }
// const tokenData = {
// valid: true,
// isSystemToken: auth.isSystemToken,
// userId: auth.userId,
// permissions: auth.permissions || ["user"],
// source: auth.source,
// };
// resolve(tokenData);
// })
// .catch(err => {
// console.error("Error in token validation:", err);
// resolve(null);
// });
// setTimeout(() => {
// resolve(null);
// }, 3000);
// });
// }

/**
 * Revokes a user token
 * @param {string} userId - The user ID
 * @param {string} tokenId - The token ID
 * @returns {Promise<boolean>} True if revoked successfully
 */
// async function revokeUserToken(userId, tokenId) { // <<< REMOVED
// return new Promise((resolve) => {
// gun
// .get("users")
// .get(userId)
// .get("tokens")
// .get(tokenId)
// .get("revoked")
// .put(true, (ack) => {
// resolve(!ack.err);
// });
// setTimeout(() => {
// resolve(false);
// }, 3000);
// });
// }

/**
 * Lists all tokens for a user
 * @param {string} userId - The user ID
 * @returns {Promise<Array>} List of tokens
 */
// async function listUserTokens(userId) { // <<< REMOVED
// return new Promise((resolve) => {
// const tokens = [];
// gun
// .get("users")
// .get(userId)
// .get("tokens")
// .map()
// .once((token, tokenId) => {
// if (tokenId !== "_" && token) {
// const safeToken = { ...token };
// if (safeToken.token) {
// safeToken.token =
// safeToken.token.substring(0, 4) +
// "..." +
// safeToken.token.substring(safeToken.token.length - 4);
// }
// tokens.push(safeToken);
// }
// });
// setTimeout(() => {
// resolve(tokens);
// }, 2000);
// });
// }

/**
 * Enhanced token validation middleware that supports both system and user tokens
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const authenticateRequest = async (req, res, next) => {
  return AuthenticationManager.authenticateRequest(req, res, next);
};

// Queste sono le route che non richiedono autenticazione
// E devono essere definite PRIMA del middleware authenticateRequest

// User registration endpoint
// app.post("/api/auth/register", async (req, res) => { // <<< REMOVED
// try {
// const { username, password, email } = req.body;
// if (!username || !password) {
// return res.status(400).json({
// success: false,
// error: "Username and password are required",
// });
// }
// const core = ensureShogunCore();
// if (!core) {
// return res.status(500).json({
// success: false,
// error: "ShogunCore not available",
// });
// }
// const signUpResult = await core.signUp(username, password, password);
// if (!signUpResult.success) {
// return res.status(400).json({
// success: false,
// error: signUpResult.error || "User registration failed via ShogunCore",
// });
// }
// const user = gun.user();
// const authUserPromise = new Promise((resolve, reject) => {
// user.auth(username, password, (ack) => {
// if (ack.err) {
// reject(new Error(ack.err || "Gun authentication failed after ShogunCore signup"));
// } else {
// resolve(ack);
// }
// });
// });
// await authUserPromise;
// if (email) {
// user.get("profile").get("email").put(email);
// }
// user.get("profile").get("permissions").put("user");
// const tokenPayload = {
// userId: username,
// permissions: ["user"],
// iat: Math.floor(Date.now() / 1000),
// exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
// };
// const jwtToken = jwt.sign(tokenPayload, JWT_SECRET);
// res.json({
// success: true,
// message: "User registered successfully via ShogunCore",
// userId: username,
// token: jwtToken,
// gunCert: user._.sea,
// shogunResult: signUpResult,
// });
// } catch (error) {
// console.error("Registration error:", error);
// res.status(500).json({
// success: false,
// error: error.message,
// });
// }
// });

// Login endpoint
// app.post("/api/auth/login", async (req, res) => { // <<< REMOVED
// try {
// const { username, password } = req.body;
// if (!username || !password) {
// return res.status(400).json({
// success: false,
// error: "Username and password are required",
// });
// }
// const core = ensureShogunCore();
// if (!core) {
// return res.status(500).json({
// success: false,
// error: "ShogunCore not available",
// });
// }
// const loginResult = await core.login(username, password);
// if (!loginResult.success) {
// return res.status(401).json({
// success: false,
// error: loginResult.error || "Login failed via ShogunCore",
// });
// }
// const user = gun.user();
// const authUserPromise = new Promise((resolve, reject) => {
// user.auth(username, password, (ack) => {
// if (ack.err) {
// reject(new Error(ack.err || "Gun authentication failed after ShogunCore login"));
// } else {
// resolve(ack);
// }
// });
// });
// await authUserPromise;
// const tokenPayload = {
// userId: username,
// permissions: ["user"],
// iat: Math.floor(Date.now() / 1000),
// exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
// };
// const jwtToken = jwt.sign(tokenPayload, JWT_SECRET);
// res.json({
// success: true,
// message: "Login successful via ShogunCore",
// userId: username,
// token: jwtToken,
// gunCert: user._.sea,
// shogunResult: loginResult,
// });
// } catch (error) {
// console.error("Login error:", error);
// if (error.message.includes("ShogunCore") || error.message.includes("Gun authentication")) {
// res.status(401).json({
// success: false,
// error: "Invalid username or password",
// });
// } else {
// res.status(500).json({
// success: false,
// error: error.message,
// });
// }
// }
// });

// Verify a token (for testing)
// app.post("/api/auth/verify-token", async (req, res) => { // <<< REMOVED
// try {
// const { token } = req.body;
// if (!token) {
// return res.status(400).json({
// success: false,
// error: "Token is required",
// });
// }
// const auth = await AuthenticationManager.validateToken(token);
// if (auth) {
// const safeData = {
// valid: true,
// userId: auth.userId,
// permissions: auth.permissions,
// source: auth.source,
// };
// res.json({
// success: true,
// tokenInfo: safeData,
// });
// } else {
// res.json({
// success: false,
// valid: false,
// error: "Invalid token",
// });
// }
// } catch (error) {
// console.error("Error verifying token:", error);
// res.status(500).json({
// success: false,
// error: error.message,
// });
// }
// });

// DOPO le eccezioni, proteggiamo tutte le altre route /api
// Ora possiamo proteggere le route che richiedono autenticazione
// app.use("/api", authenticateRequest); // This is now inside startServer
// app.use("/upload", authenticateRequest); // This should be handled within startServer or a dedicated router
// app.use("/files", authenticateRequest);  // This should be handled within startServer or a dedicated router

// API - FILES LIST (must be defined before app.use("/files", authenticateRequest))
// app.get("/files/all", authenticateRequest, async (req, res) => { // MOVED TO startServer
// ... existing code ...
// }); // MOVED TO startServer

// API - UPLOAD FILE
// app.post("/upload", fileManager.getUploadMiddleware().single("file"), async (req, res) => { // MOVED TO startServer
// ... existing code ...
// }); // MOVED TO startServer

// API - FILES LIST
// app.get("/files", authenticateRequest, async (req, res) => { // MOVED TO startServer // Added authenticateRequest middleware
// ... existing code ...
// }); // MOVED TO startServer

// API - FILE DETAILS
// app.get("/files/:id", authenticateRequest, async (req, res) => { // MOVED TO startServer // Added authenticateRequest middleware
// ... existing code ...
// }); // MOVED TO startServer

// API - DELETE FILE
// app.delete("/files/:id", authenticateRequest, async (req, res) => { // MOVED TO startServer
// ... existing code ...
// }); // MOVED TO startServer

// Endpoint per testare la connessione websocket
app.get("/websocket-test", (req, res) => {
  console.log("Test WebSocket richiesto");
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Test WebSocket</title>
    </head>
    <body>
      <h1>Test WebSocket</h1>
      <div id="status">Verifica in corso...</div>
      <script>
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = wsProtocol + '//' + window.location.host + '/gun';
        const status = document.getElementById('status');

        status.textContent = 'Tentativo di connessione a: ' + wsUrl;

        try {
          const ws = new WebSocket(wsUrl);

          ws.onopen = function() {
            status.textContent = 'WebSocket connesso con successo!';
            status.style.color = 'green';
          };

          ws.onclose = function() {
            status.textContent = 'WebSocket disconnesso';
            status.style.color = 'red';
          };

          ws.onerror = function(error) {
            status.textContent = 'Errore WebSocket: ' + error;
            status.style.color = 'red';
            console.error('WebSocket Error:', error);
          };
        } catch(e) {
          status.textContent = 'Errore nella creazione del WebSocket: ' + e.message;
          status.style.color = 'red';
        }
      </script>
    </body>
    </html>
  `);
});

// API - STATUS CORS
app.get("/api/status", (req, res) => {
  res.json({
    status: "online",
    timestamp: Date.now(),
    server: {
      version: "1.0.0",
      cors: corsOptions.origin,
    },
    ipfs: {
      enabled: ipfsManager.isEnabled(),
      service: ipfsManager.getService(),
      gateway: ipfsManager.getGateway(),
    },
  });
});

// Endpoint per verificare la configurazione WebSocket
app.get("/check-websocket", (req, res) => {
  res.json({
    serverInfo: {
      port: PORT,
      websocketUrl: `ws://${req.headers.host}/gun`,
    },
  });
});

// Serve l'interfaccia web di base
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Serve la pagina di login html
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "login.html"));
});

// Serve la pagina per generare key pair
app.get("/keypair", (req, res) => {
  res.sendFile(path.join(__dirname, "keypair.html"));
});

// API - VERIFY CERTIFICATE
// app.post("/api/auth/verify-cert", async (req, res) => { // <<< REMOVED
// try {
// const { certificate } = req.body;
// if (!certificate || !certificate.pub) {
// return res.status(400).json({
// success: false,
// error:
// "Invalid certificate format. Certificate must contain a pub key.",
// });
// }
// const userPub = certificate.pub;
// const userExists = await new Promise((resolve) => {
// gun.user(userPub).once((data) => {
// resolve(!!data);
// });
// setTimeout(() => resolve(false), 3000);
// });
// if (!userExists) {
// return res.json({
// success: false,
// valid: false,
// error: "User with this certificate does not exist",
// });
// }
// const token = await createUserToken(userPub, "Certificate Auth Token");
// res.json({
// success: true,
// valid: true,
// userId: userPub,
// token: token,
// });
// } catch (error) {
// console.error("Error verifying certificate:", error);
// res.status(500).json({
// success: false,
// error: error.message,
// });
// }
// });

// API - IPFS STATUS
// app.get("/api/ipfs/status", authenticateRequest, (req, res) => { // <<< Start of removal
// try {
// res.json({
// success: true,
// config: ipfsManager.getConfig(),
// });
// } catch (error) {
// console.error("Errore nell'ottenere lo stato IPFS:", error);
// res.status(500).json({
// success: false,
// error: error.message,
// });
// }
// }); // <<< End of removal

// API - IPFS TOGGLE
// app.post("/api/ipfs/toggle", authenticateRequest, async (req, res) => { // <<< Start of removal
// try {
// const newState = !ipfsManager.isEnabled();
// ipfsManager.updateConfig({
// enabled: newState
// });
// fileManager.setIpfsManager(ipfsManager); // This line is correctly in the new ipfsApiRoutes.js
// // IPFS_CONFIG = ipfsManager.getConfig(); // REMOVE - backward compatibility handled by direct calls
// // shogunIpfs = ipfsManager.getInstance(); // REMOVE - backward compatibility handled by direct calls
// console.log(`IPFS ${newState ? "abilitato" : "disabilitato"}`);
// return res.json({
// success: true,
// config: ipfsManager.getConfig(),
// });
// } catch (error) {
// console.error("Errore toggle IPFS:", error);
// return res.status(500).json({
// success: false,
// error: `Errore durante il toggle IPFS: ${error.message}`,
// });
// }
// }); // <<< End of removal

// API - IPFS CONFIG
app.post("/api/ipfs/config", authenticateRequest, async (req, res) => {
  try {
    console.log("Richiesta configurazione IPFS:", req.body);

    // Verify that configuration data is provided
    if (!req.body) {
      return res.status(400).json({
        success: false,
        error: "Nessun dato di configurazione fornito",
      });
    }

    // Update the configuration
    const result = ipfsManager.updateConfig(req.body);

    // Update FileManager's IPFS manager instance and reconfigure multer
    fileManager.setIpfsManager(ipfsManager);

    // Update global variables for backward compatibility
    IPFS_CONFIG = ipfsManager.getConfig();
    shogunIpfs = ipfsManager.getInstance();

    // Reconfigure multer if needed
    configureMulter();

    // Send response with updated configuration
    return res.json({
      success: true,
      config: ipfsManager.getConfig(),
    });
  } catch (error) {
    console.error("Errore configurazione IPFS:", error);
    return res.status(500).json({
      success: false,
      error: `Errore durante la configurazione IPFS: ${error.message}`,
    });
  }
});

// API - IPFS CHECK PIN STATUS
app.get("/api/ipfs/pin-status/:hash", authenticateRequest, async (req, res) => {
  try {
    const hash = req.params.hash;

    if (!hash) {
      return res.status(400).json({
        success: false,
        error: "IPFS hash missing",
      });
    }

    if (!ipfsManager.isEnabled()) {
      return res.status(400).json({
        success: false,
        error: "IPFS not active",
      });
    }

    console.log(`Verifica stato pin per hash IPFS: ${hash}`);
    const isPinned = await ipfsManager.isPinned(hash);

    return res.json({
      success: true,
      isPinned,
      hash,
    });
  } catch (error) {
    console.error("Errore verifica pin IPFS:", error);
    return res.status(500).json({
      success: false,
      error: `Errore durante la verifica del pin: ${error.message}`,
    });
  }
});

// API - IPFS PIN FILE
app.post("/api/ipfs/pin", authenticateRequest, async (req, res) => {
  try {
    const { hash } = req.body;

    if (!hash) {
      return res.status(400).json({
        success: false,
        error: "IPFS hash missing",
      });
    }

    if (!ipfsManager.isEnabled()) {
      return res.status(400).json({
        success: false,
        error: "IPFS not active",
      });
    }

    console.log(`Richiesta pin per hash IPFS: ${hash}`);

    // Check if the file is already pinned
    const isPinned = await ipfsManager.isPinned(hash);
    if (isPinned) {
      return res.json({
        success: true,
        message: "File già pinnato",
        hash,
        isPinned: true,
      });
    }

    // Execute pin
    const result = await ipfsManager.pin(hash);

    return res.json({
      success: true,
      message: "File pinnato con successo",
      hash,
      isPinned: true,
      result,
    });
  } catch (error) {
    console.error("Errore pin IPFS:", error);
    return res.status(500).json({
      success: false,
      error: `Errore durante il pin: ${error.message}`,
    });
  }
});

// API - IPFS UNPIN FILE
app.post("/api/ipfs/unpin", authenticateRequest, async (req, res) => {
  try {
    const { hash } = req.body;

    if (!hash) {
      return res.status(400).json({
        success: false,
        error: "IPFS hash missing",
      });
    }

    if (!ipfsManager.isEnabled()) {
      return res.status(400).json({
        success: false,
        error: "IPFS not active",
      });
    }

    console.log(`Richiesta unpin per hash IPFS: ${hash}`);

    // Check if the file is pinned
    const isPinned = await ipfsManager.isPinned(hash);
    if (!isPinned) {
      return res.json({
        success: true,
        message: "File già non pinnato",
        hash,
        isPinned: false,
      });
    }

    // Execute unpin
    const result = await ipfsManager.unpin(hash);

    return res.json({
      success: true,
      message: "File unpinnato con successo",
      hash,
      isPinned: false,
      result,
    });
  } catch (error) {
    console.error("Errore unpin IPFS:", error);
    return res.status(500).json({
      success: false,
      error: `Errore durante l'unpin: ${error.message}`,
    });
  }
});

// API - GUNDB EXPLORE
app.get("/api/gundb/explore", authenticateRequest, async (req, res) => {
  try {
    const path = req.query.path || "";
    console.log(`Richiesta esplorazione GunDB: ${path}`);

    let gunNode = gun;

    // Se è specificato un percorso, navigiamo fino al nodo richiesto
    if (path) {
      const pathParts = path.split(".");
      for (const part of pathParts) {
        gunNode = gunNode.get(part);
      }
    }

    // Ottieni i dati dal nodo corrente
    let nodeData = null;
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.log("Timeout esplorazione GunDB");
        resolve();
      }, 3000); // Timeout dopo 3 secondi

      gunNode.once((data) => {
        nodeData = data;
        clearTimeout(timeout);
        resolve();
      });
    });

    // Se nessun dato è trovato
    if (!nodeData) {
      return res.json({
        success: true,
        path,
        nodes: [],
      });
    }

    // Estrai ed elabora i nodi
    const nodes = [];
    Object.keys(nodeData).forEach((key) => {
      // Salta i campi speciali di GunDB che iniziano con "_"
      if (key.startsWith("_")) {
        return;
      }

      const value = nodeData[key];
      let type = typeof value;

      // Determina il tipo corretto
      if (value === null) {
        type = "null";
      } else if (Array.isArray(value)) {
        type = "array";
      } else if (typeof value === "object") {
        type = "object";
      }

      // Determina il percorso per navigazione
      const nodePath = path ? `${path}.${key}` : key;

      nodes.push({
        key,
        value,
        type,
        path: nodePath,
      });
    });

    res.json({
      success: true,
      path,
      nodes,
    });
  } catch (error) {
    console.error("Errore durante l'esplorazione di GunDB:", error);
    res.status(500).json({
      success: false,
      error: `Errore durante l'esplorazione: ${error.message}`,
    });
  }
});

// API - GUNDB CREATE NODE
app.post("/api/gundb/create-node", authenticateRequest, async (req, res) => {
  try {
    const { path, key, value } = req.body;

    if (!path) {
      return res.status(400).json({ error: "Path required" });
    }

    console.log(
      `Creazione nodo GunDB: ${path}${key ? "/" + key : ""} con valore:`,
      value
    );

    // Divide il percorso in parti
    const pathParts = path.split("/").filter(Boolean);

    // Naviga nel percorso e crea il nodo
    let currentNode = gun;

    // Naviga nel percorso
    for (const part of pathParts) {
      currentNode = currentNode.get(part);
    }

    // Se è fornita una chiave, imposta il valore per quella chiave
    if (key) {
      currentNode.get(key).put(value);
      res.json({
        success: true,
        message: `Nodo ${path}/${key} creato con successo`,
        path,
        key,
      });
    } else {
      // Altrimenti, imposta il valore per il nodo corrente
      currentNode.put(value);
      res.json({
        success: true,
        message: `Nodo ${path} creato con successo`,
        path,
      });
    }
  } catch (error) {
    console.error("Errore nella creazione del nodo GunDB:", error);
    res.status(500).json({ error: error.message });
  }
});

// Middleware per integrare IPFS con Gun
/**
 * Set up middleware to integrate GunDB with IPFS
 * This middleware simplifies IPFS data retrieval when GunDB references IPFS content
 */
function setupGunIpfsMiddleware() {
  if (!ipfsManager.isEnabled()) {
    console.log("IPFS not enabled, middleware not configured");
    return;
  }

  console.log("Configuring Gun-IPFS middleware...");

  // Simplified version: we don't intercept PUTs anymore
  // IPFS uploads will be handled client-side

  // We only intercept 'in' responses to retrieve IPFS data
  Gun.on("in", async function (replyMsg) {
    // If IPFS is not enabled, pass the original message
    if (!ipfsManager.isEnabled()) {
      this.to.next(replyMsg);
      return;
    }

    // Check if the response message contains data
    if (replyMsg.put && Object.keys(replyMsg.put).length > 0) {
      const entriesToFetch = [];

      // Look for IPFS references in the data
      for (const soul in replyMsg.put) {
        const node = replyMsg.put[soul];

        // Look for ipfsHash directly in the node or in the ':' property of the node
        let ipfsHash = null;

        if (node.ipfsHash) {
          // Case 1: ipfsHash is directly in the node
          ipfsHash = node.ipfsHash;
        } else if (
          node[":"] &&
          typeof node[":"] === "object" &&
          node[":"].ipfsHash
        ) {
          // Case 2: ipfsHash is in the ':' property of the node
          ipfsHash = node[":"].ipfsHash;
        }

        if (ipfsHash) {
          // Add to list of hashes to retrieve
          entriesToFetch.push({
            soul: soul,
            hash: ipfsHash,
          });
        }
      }

      // If we found IPFS references, retrieve them
      if (entriesToFetch.length > 0) {
        console.log(
          `IPFS-MIDDLEWARE: Retrieving ${entriesToFetch.length} IPFS references`
        );

        try {
          // Retrieve data from IPFS for each hash
          await Promise.all(
            entriesToFetch.map(async ({ soul, hash }) => {
              try {
                console.log(
                  `IPFS-MIDDLEWARE: Retrieving data from IPFS for hash: ${hash}`
                );
                const ipfsData = await ipfsManager.fetchJson(hash);

                if (ipfsData) {
                  // If they are complete GunDB data (format created by previous middleware)
                  if (ipfsData.gunData && ipfsData.gunData[soul]) {
                    // Replace with data retrieved from IPFS
                    replyMsg.put[soul] = ipfsData.gunData[soul];
                    console.log(
                      `IPFS-MIDDLEWARE: Replaced data for ${soul} with data from IPFS`
                    );
                  }
                  // If they are simple data (uploaded directly by the client)
                  else {
                    // Replace the value field (preserving GunDB metadata)
                    if (replyMsg.put[soul][":"]) {
                      replyMsg.put[soul][":"] = ipfsData;
                      console.log(
                        `IPFS-MIDDLEWARE: Replaced value for ${soul} with data from IPFS`
                      );
                    }
                  }
                } else {
                  console.warn(
                    `IPFS-MIDDLEWARE: No valid data from IPFS for hash ${hash}`
                  );
                }
              } catch (error) {
                console.error(
                  `IPFS-MIDDLEWARE: Error retrieving hash ${hash}:`,
                  error
                );
              }
            })
          );
        } catch (error) {
          console.error(
            "IPFS-MIDDLEWARE: Error during IPFS data retrieval:",
            error
          );
        }
      }
    }

    // Pass the message to Gun (original or with IPFS data)
    this.to.next(replyMsg);
  });

  console.log("Gun-IPFS middleware configured successfully (simplified mode)");
}

/**
 * Initialize shogun-core relay components
 * This function sets up the RelayVerifier and DIDVerifier instances
 */
async function initializeRelayComponents() {
  try {
    const shogunCoreInstance = getShogunCore();

    // Create a wallet if Ethereum private key is provided
    let signer = null;
    if (process.env.ETHEREUM_PRIVATE_KEY) {
      try {
        const { ethers } = await import("ethers");
        // Remove '0x' prefix if present
        const privateKey = process.env.ETHEREUM_PRIVATE_KEY.startsWith("0x")
          ? process.env.ETHEREUM_PRIVATE_KEY
          : `0x${process.env.ETHEREUM_PRIVATE_KEY}`;

        // Create provider
        const provider = new ethers.JsonRpcProvider(
          RELAY_CONFIG.relay.providerUrl
        );

        // Create wallet with private key and provider
        signer = new ethers.Wallet(privateKey, provider);
        console.log(
          `Ethereum wallet created with address: ${await signer.getAddress()}`
        );
      } catch (error) {
        console.error("Error creating Ethereum wallet:", error);
        console.warn("Continuing without signer for write operations");
      }
    }

    // Initialize RelayVerifier if enabled
    if (RELAY_CONFIG.relay.onchainMembership) {
      if (!RELAY_CONFIG.relay.registryAddress) {
        console.warn(
          "Relay registry address not provided, skipping initialization"
        );
      } else {
        console.log("Initializing RelayVerifier...");
        relayVerifier = new RelayVerifier(
          {
            registryAddress: RELAY_CONFIG.relay.registryAddress,
            providerUrl: RELAY_CONFIG.relay.providerUrl,
          },
          shogunCoreInstance,
          signer
        );
        console.log("RelayVerifier initialized successfully");
        
        // Update relayVerifier in AuthenticationManager
        configure({ relayVerifier });
      }
    }

    // Initialize DIDVerifier if enabled
    if (RELAY_CONFIG.didVerifier.enabled) {
      if (!RELAY_CONFIG.didVerifier.contractAddress) {
        console.warn(
          "DID Registry contract address not provided, skipping initialization"
        );
      } else {
        console.log("Initializing DIDVerifier...");
        didVerifier = new DIDVerifier(
          {
            contractAddress: RELAY_CONFIG.didVerifier.contractAddress,
            providerUrl: RELAY_CONFIG.didVerifier.providerUrl,
          },
          shogunCoreInstance,
          signer
        );
        console.log("DIDVerifier initialized successfully");
      }
    }

    return true;
  } catch (error) {
    console.error("Error initializing relay components:", error);
    return false;
  }
}

/**
 * Get the RelayVerifier instance
 * @returns {RelayVerifier|null} The RelayVerifier instance or null if not initialized
 */
function getRelayVerifier() {
  return relayVerifier;
}

/**
 * Get the DIDVerifier instance
 * @returns {DIDVerifier|null} The DIDVerifier instance or null if not initialized
 */
function getDIDVerifier() {
  return didVerifier;
}

/**
 * Starts the unified relay server
 * Initializes IPFS, configures middleware, and sets up WebSocket handlers
 * @returns {Promise<void>}
 */
async function startServer() {
  try {
    console.log("Starting unified relay server...");

    // Initialize AuthenticationManager configuration first
    configure({
      SECRET_TOKEN,
      JWT_SECRET,
      authorizedKeys, // Pass the map instance
      AUTH_KEY_EXPIRY,
      RELAY_CONFIG,
      relayVerifier: null, // Will be set after relayVerifier init by initializeRelayComponents
      allowedOrigins,
    });
    console.log("AuthenticationManager configured with initial settings.");

    // Initialize ShogunCore and relay components. This will create relayVerifier
    // and update AuthenticationManager with the live instance via its configure method.
    ensureShogunCore(); // ensureShogunCore needs to be called before initializeRelayComponents if it provides the shogunCoreInstance
    await initializeRelayComponents(); 
    console.log("Relay and DID components initialized, AuthenticationManager updated with live verifiers.");

    // Initialize Gun with the options. 
    // AuthenticationManager.isValidGunMessage (bound to gunOptions.isValid) can now access the configured relayVerifier.
    gun = Gun(gunOptions);
    console.log("GunDB initialized.");

    // Set the gun instance in FileManager now that it's initialized
    // fileManager.setGun(gun); // This is done in FileManager constructor or if needed, after fileManager init

    // Initialize ShogunCore again to ensure it has the gun instance if it wasn't passed or if re-init is beneficial
    // shogunCore = getShogunCore(); // Or ensureShogunCore(); - check if needed again
    // It's generally better to initialize ShogunCore once with all dependencies if possible.
    // If ensureShogunCore() was already called and shogunCore is a module-level let, it should be fine.

    // Initialize File Manager now that gun and ipfsManager are available
    fileManager = new ShogunFileManager(
      {
        storageDir: STORAGE_DIR, // Use the defined STORAGE_DIR
        maxFileSize: 50 * 1024 * 1024, // As per the accepted diff
        allowedMimes: ["image/jpeg", "image/png", "application/pdf"], // As per the accepted diff
      },
      gun,
      ipfsManager
    );
    console.log("File Manager initialized inside startServer.");

    // Setup API routes from modules
    const authRouter = setupAuthRoutes(gun, JWT_SECRET, AuthenticationManager, ensureShogunCore, authenticateRequest);
    app.use("/api/auth", authRouter); // THIS LINE SHOULD BE BEFORE app.use("/api", authenticateRequest)

    const ipfsApiRouter = setupIpfsApiRoutes(ipfsManager, fileManager, authenticateRequest);

    // Define the reinitializeRelayComponentsCallback within startServer scope
    const reinitializeRelayComponentsCallback = async (updatedConfig) => {
      console.log("[Callback] Received config update request:", updatedConfig);
    
      let needsReinitialize = false;
    
      // Check for updates to the main relay configuration part
      if (updatedConfig && updatedConfig.registryAddress !== undefined || updatedConfig.providerUrl !== undefined || updatedConfig.onchainMembership !== undefined) {
        RELAY_CONFIG.relay = { 
          ...RELAY_CONFIG.relay, 
          ...(updatedConfig.registryAddress && { registryAddress: updatedConfig.registryAddress }),
          ...(updatedConfig.providerUrl && { providerUrl: updatedConfig.providerUrl }),
          ...(updatedConfig.onchainMembership !== undefined && { onchainMembership: updatedConfig.onchainMembership }),
        };
        console.log("[Callback] Main RELAY_CONFIG.relay updated:", RELAY_CONFIG.relay);
        needsReinitialize = true;
      }
    
      // Check for updates to the didVerifier specific part of the config
      if (updatedConfig && updatedConfig.didVerifier) {
        RELAY_CONFIG.didVerifier = { 
          ...RELAY_CONFIG.didVerifier, 
          ...updatedConfig.didVerifier 
        };
        console.log("[Callback] RELAY_CONFIG.didVerifier updated:", RELAY_CONFIG.didVerifier);
        needsReinitialize = true;
      }

      // Fallback for direct updates to RELAY_CONFIG.relay properties if not nested under 'relay' in updatedConfig
      // This handles the case where relayApiRoutes might send { onchainMembership: true } directly
      if(updatedConfig && (updatedConfig.onchainMembership !== undefined && RELAY_CONFIG.relay.onchainMembership !== updatedConfig.onchainMembership)) {
        RELAY_CONFIG.relay.onchainMembership = updatedConfig.onchainMembership;
        console.log("[Callback] RELAY_CONFIG.relay.onchainMembership directly updated to:", RELAY_CONFIG.relay.onchainMembership);
        needsReinitialize = true;
      }


      if (needsReinitialize) {
        console.log("[Callback] Reinitializing relay and/or DID components due to config change...");
        return initializeRelayComponents(); 
      } else {
        console.log("[Callback] No specific relay or didVerifier config found in update that warrants re-initialization by callback logic.");
        return false; 
      }
    };

    const relayApiRouter = setupRelayApiRoutes(
      RELAY_CONFIG, 
      getRelayVerifier, 
      authenticateRequest, 
      shogunCore, 
      reinitializeRelayComponentsCallback,
      SECRET_TOKEN, 
      AuthenticationManager 
    );
    app.use("/api/relay", relayApiRouter);

    // FILE MANAGER API ROUTES - MOVED HERE
    // Ensure these routes also have appropriate authentication if needed.
    // The authenticateRequest middleware is applied to /api, /upload, /files at the top level currently.
    // If these routes are not under /api, they might need individual authentication middleware.

    // For /upload and /files routes, if they are meant to be protected, 
    // they should either be under a protected path like /api/files or have middleware applied here.
    // Assuming /upload and /files/ should be protected as per original setup:
    app.use("/upload", authenticateRequest); 
    app.use("/files", authenticateRequest);

    app.get("/files/all", authenticateRequest, async (req, res) => {
      try {
        const files = await fileManager.getAllFiles();
          res.json({
            success: true,
            results: files,
          message: "File list retrieved successfully",
        });
      } catch (error) {
        console.error("Error retrieving files:", error);
        res.status(500).json({
          success: false,
          error: error.message,
          message: "Error retrieving files",
        });
      }
    });

    app.post("/upload", fileManager.getUploadMiddleware().single("file"), async (req, res) => {
      try {
        const fileData = await fileManager.handleFileUpload(req);
        res.json({
          success: true,
          file: fileData,
          fileInfo: { // Keep this for compatibility if some clients expect it
            originalName: fileData.originalName,
            size: fileData.size,
            mimetype: fileData.mimetype,
            fileUrl: fileData.fileUrl,
            ipfsHash: fileData.ipfsHash,
            ipfsUrl: fileData.ipfsUrl,
            customName: fileData.customName,
          },
          verified: fileData.verified, // FileManager adds this
        });
      } catch (error) {
        console.error("File upload error:", error);
        res.status(500).json({
          success: false,
          error: "Error during upload: " + error.message,
        });
      }
    });

    app.get("/files", authenticateRequest, async (req, res) => {
      try {
        const files = await fileManager.getAllFiles();
        res.json({ files });
      } catch (error) {
        console.error("Error retrieving files for /files:", error);
        res.status(500).json({
          success: false,
          error: error.message,
          message: "Error retrieving files",
        });
      }
    });

    app.get("/files/:id", authenticateRequest, async (req, res) => {
      try {
      const fileId = req.params.id;
        const fileData = await fileManager.getFileById(fileId);

        if (fileData) {
          res.json({ file: fileData });
          } else {
            res.status(404).json({ error: "File non trovato" });
          }
      } catch (error) {
        console.error(`Error retrieving file details for ${req.params.id}:`, error);
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    });

    app.delete("/files/:id", authenticateRequest, async (req, res) => {
      try {
        const fileId = req.params.id;
        const result = await fileManager.deleteFile(fileId);
        res.json(result);
      } catch (error) {
        console.error("Errore durante l'eliminazione del file:", error);
        res.status(500).json({
          success: false,
          error: `Errore durante l'eliminazione: ${error.message}`,
        });
      }
    });

    // Use a separate Gun user instance for app authentication
    if (RELAY_CONFIG.keyPair) {
      const appUser = gun.user();
      appUser.auth(JSON.parse(RELAY_CONFIG.keyPair), ({ err }) => {
        if (err) {
          console.error("App authentication error:", err);
        } else {
          console.log("GunDB authenticated successfully for app user");
        }
      });
    } else {
      console.log("No app key pair provided, skipping app authentication");
    }

    // Setup Gun-IPFS middleware
    if (ipfsManager.isEnabled()) {
      setupGunIpfsMiddleware();
    }
    // Update FileManager's IPFS manager instance and reconfigure multer
    // This ensures multer is reconfigured if IPFS state changes during runtime
    fileManager.setIpfsManager(ipfsManager);
    
    // Graceful shutdown handling
    ["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
      process.on(signal, async () => {
        console.log(`\nReceived signal ${signal}, shutting down...`);

        console.log("Closing HTTP server...");
        server.close(() => {
          console.log("HTTP server closed");
          console.log("Goodbye!");
          process.exit(0);
        });

        // Force close after 5 seconds
        setTimeout(() => {
          console.log("Timeout reached, forced shutdown");
          process.exit(1);
        }, 5000);
      });
    });

    // Start listening for HTTP requests
    server.listen(PORT, HOST, () => {
      console.log(`Server listening on http://${HOST}:${PORT}`);
      console.log(
        `Gun relay peer accessible at http://${HOST}:${PORT}/gun`
      );
    });
  } catch (error) {
    console.error("Error during server startup:", error);
    process.exit(1);
  }
}

startServer().catch((err) => {
  console.error("Critical error during startup:", err);
  process.exit(1);
});



/**
 * Initialize ShogunCore if not already initialized
 * @returns {ShogunCore} ShogunCore instance
 */
function getShogunCore() {
  if (!shogunCore && gun) {
    console.log("Initializing ShogunCore with Gun instance");

    try {
      // Configure ShogunCore with our Gun instance and configuration
      shogunCore = new ShogunCore({
        gun: gun,
        authToken: SECRET_TOKEN,
        logging: {
          enabled: true,
          level: "debug",
          prefix: "[Shogun Relay]",
        },
        did: {
          enabled: true,
        },
      });

      console.log("ShogunCore initialized successfully");
    } catch (error) {
      console.error("Failed to initialize ShogunCore:", error);
    }
  }

  return shogunCore;
}

/**
 * Get or create the ShogunCore instance
 */
function ensureShogunCore() {
  if (!shogunCore) {
    getShogunCore();
  }
  return shogunCore;
}

// 🏓 API/RELAY/SHOGUN CORE
// API - SHOGUN CORE AUTHENTICATION ENDPOINTS

// WebAuthn login
app.post("/api/auth/shogun/webauthn/login", async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({
        success: false,
        error: "Username is required",
      });
    }

    const core = ensureShogunCore();
    if (!core) {
      return res.status(500).json({
        success: false,
        error: "ShogunCore not available",
      });
    }

    const webauthnPlugin = core.getPlugin("webauthn");
    if (!webauthnPlugin) {
      return res.status(500).json({
        success: false,
        error: "WebAuthn plugin not available",
      });
    }

    // Use WebAuthn login
    const result = await webauthnPlugin.loginWithWebAuthn(username);

    if (!result.success) {
      return res.status(401).json(result);
    }

    // Create an API token for this user
    const token = await createUserToken(username, "WebAuthn Login Token");

    res.json({
      success: true,
      ...result,
      token: token,
    });
  } catch (error) {
    console.error("Error during WebAuthn login:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// WebAuthn signup
app.post("/api/auth/shogun/webauthn/signup", async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({
        success: false,
        error: "Username is required",
      });
    }

    const core = ensureShogunCore();
    if (!core) {
      return res.status(500).json({
        success: false,
        error: "ShogunCore not available",
      });
    }

    const webauthnPlugin = core.getPlugin("webauthn");
    if (!webauthnPlugin) {
      return res.status(500).json({
        success: false,
        error: "WebAuthn plugin not available",
      });
    }

    // Use WebAuthn signup
    const result = await webauthnPlugin.signUpWithWebAuthn(username);

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Create an API token for this user
    const token = await createUserToken(
      username,
      "WebAuthn Registration Token"
    );

    res.json({
      success: true,
      ...result,
      token: token,
    });
  } catch (error) {
    console.error("Error during WebAuthn signup:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// MetaMask login
app.post("/api/auth/shogun/metamask/login", async (req, res) => {
  try {
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({
        success: false,
        error: "Ethereum address is required",
      });
    }

    const core = ensureShogunCore();
    if (!core) {
      return res.status(500).json({
        success: false,
        error: "ShogunCore not available",
      });
    }

    const metamaskPlugin = core.getPlugin("metamask");
    if (!metamaskPlugin) {
      return res.status(500).json({
        success: false,
        error: "MetaMask plugin not available",
      });
    }

    // Use MetaMask login
    const result = await metamaskPlugin.loginWithMetaMask(address);

    if (!result.success) {
      return res.status(401).json(result);
    }

    // Create an API token for this user
    const token = await createUserToken(address, "MetaMask Login Token");

    res.json({
      success: true,
      ...result,
      token: token,
    });
  } catch (error) {
    console.error("Error during MetaMask login:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// MetaMask signup
app.post("/api/auth/shogun/metamask/signup", async (req, res) => {
  try {
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({
        success: false,
        error: "Ethereum address is required",
      });
    }

    const core = ensureShogunCore();
    if (!core) {
      return res.status(500).json({
        success: false,
        error: "ShogunCore not available",
      });
    }

    const metamaskPlugin = core.getPlugin("metamask");
    if (!metamaskPlugin) {
      return res.status(500).json({
        success: false,
        error: "MetaMask plugin not available",
      });
    }

    // Use MetaMask signup
    const result = await metamaskPlugin.signUpWithMetaMask(address);

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Create an API token for this user
    const token = await createUserToken(address, "MetaMask Registration Token");

    res.json({
      success: true,
      ...result,
      token: token,
    });
  } catch (error) {
    console.error("Error during MetaMask signup:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 🏓 API/RELAY
// ============ RELAY VERIFIER API ============

// API - Check relay status
app.get("/api/relay/status", authenticateRequest, async (req, res) => {
  try {
    // Verify that RelayVerifier is initialized
    if (!RELAY_CONFIG.relay.onchainMembership || !relayVerifier) {
      return res.status(503).json({
        success: false,
        error: "Relay services not available",
        config: {
          enabled: RELAY_CONFIG.relay.onchainMembership,
          registryAddress:
            RELAY_CONFIG.relay.registryAddress || "Not configured",
        },
      });
    }

    // Get all registered relays
    const allRelays = await relayVerifier.getAllRelays();

    res.json({
      success: true,
      config: {
        enabled: RELAY_CONFIG.relay.onchainMembership,
        registryAddress: RELAY_CONFIG.relay.registryAddress,
      },
      relaysCount: allRelays.length,
    });
  } catch (error) {
    console.error("Error getting relay status:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API - Get all relays
app.get("/api/relay/all", authenticateRequest, async (req, res) => {
  try {
    // Verify that RelayVerifier is initialized
    if (!RELAY_CONFIG.relay.onchainMembership || !relayVerifier) {
      return res.status(503).json({
        success: false,
        error: "Relay services not available",
      });
    }

    // Get all registered relays
    const relayAddresses = await relayVerifier.getAllRelays();

    // Get detailed info for each relay
    const relays = [];
    for (const address of relayAddresses) {
      try {
        const relayInfo = await relayVerifier.getRelayInfo(address);
        if (relayInfo) {
          relays.push(relayInfo);
        }
      } catch (error) {
        console.error(`Error getting info for relay ${address}:`, error);
      }
    }

    res.json({
      success: true,
      relays,
    });
  } catch (error) {
    console.error("Error getting all relays:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API - Check if user is subscribed to a relay
app.get(
  "/api/relay/check-subscription/:relayAddress/:userAddress",
  authenticateRequest,
  async (req, res) => {
    try {
      const { relayAddress, userAddress } = req.params;

      // Verify that RelayVerifier is initialized
      if (!RELAY_CONFIG.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay services not available",
        });
      }

      // Check if the user is subscribed to the relay
      const isSubscribed = await relayVerifier.isUserSubscribedToRelay(
        relayAddress,
        userAddress
      );

      res.json({
        success: true,
        relayAddress,
        userAddress,
        isSubscribed,
      });
    } catch (error) {
      console.error(
        `Error checking subscription for user ${req.params.userAddress} to relay ${req.params.relayAddress}:`,
        error
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Get user's active relays
app.get(
  "/api/relay/user-active-relays/:userAddress",
  authenticateRequest,
  async (req, res) => {
    try {
      const { userAddress } = req.params;

      // Verify that RelayVerifier is initialized
      if (!RELAY_CONFIG.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay services not available",
        });
      }

      // Get all relays the user is subscribed to
      const relayAddresses = await relayVerifier.getUserActiveRelays(
        userAddress
      );

      // Get detailed info for each relay
      const relays = [];
      for (const address of relayAddresses) {
        try {
          const relayInfo = await relayVerifier.getRelayInfo(address);
          if (relayInfo) {
            relays.push(relayInfo);
          }
        } catch (error) {
          console.error(`Error getting info for relay ${address}:`, error);
        }
      }

      res.json({
        success: true,
        userAddress,
        relays,
      });
    } catch (error) {
      console.error(
        `Error getting active relays for user ${req.params.userAddress}:`,
        error
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Check public key authorization against all relays
app.post("/api/relay/check-pubkey", authenticateRequest, async (req, res) => {
  try {
    const { publicKey } = req.body;

    if (!publicKey) {
      return res.status(400).json({
        success: false,
        error: "Public key is required",
      });
    }

    // Verify that RelayVerifier is initialized
    if (!RELAY_CONFIG.relay.onchainMembership || !relayVerifier) {
      return res.status(503).json({
        success: false,
        error: "Relay services not available",
      });
    }

    // Get all registered relays
    const relayAddresses = await relayVerifier.getAllRelays();

    // Check each relay for authorization
    const authorizedRelays = [];
    for (const address of relayAddresses) {
      try {
        const isAuthorized = await relayVerifier.isPublicKeyAuthorized(
          address,
          publicKey
        );

        if (isAuthorized) {
          authorizedRelays.push(address);
        }
      } catch (error) {
        console.error(
          `Error checking authorization on relay ${address}:`,
          error
        );
      }
    }

    res.json({
      success: true,
      publicKey,
      isAuthorized: authorizedRelays.length > 0,
      authorizedRelays,
    });
  } catch (error) {
    console.error("Error checking public key authorization:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API - Get user subscription info for a specific relay
app.get(
  "/api/relay/subscription-info/:relayAddress/:userAddress",
  authenticateRequest,
  async (req, res) => {
    try {
      const { relayAddress, userAddress } = req.params;

      // Verify that RelayVerifier is initialized
      if (!RELAY_CONFIG.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay services not available",
        });
      }

      // Get subscription info
      const subscriptionInfo = await relayVerifier.getUserSubscriptionInfo(
        relayAddress,
        userAddress
      );

      if (!subscriptionInfo) {
        return res.status(404).json({
          success: false,
          error: "User subscription not found",
        });
      }

      res.json({
        success: true,
        relayAddress,
        userAddress,
        subscriptionInfo: {
          expires: subscriptionInfo.expires.toString(),
          pubKey: subscriptionInfo.pubKey,
          active: subscriptionInfo.active,
        },
      });
    } catch (error) {
      console.error(
        `Error getting subscription info for user ${req.params.userAddress} on relay ${req.params.relayAddress}:`,
        error
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Subscribe to a relay
app.post("/api/relay/subscribe", authenticateRequest, async (req, res) => {
  try {
    const { relayAddress, months, publicKey } = req.body;

    if (!relayAddress || !months) {
      return res.status(400).json({
        success: false,
        error: "Relay address and number of months are required",
      });
    }

    // Verify that RelayVerifier is initialized
    if (!RELAY_CONFIG.relay.onchainMembership || !relayVerifier) {
      return res.status(503).json({
        success: false,
        error: "Relay services not available",
      });
    }

    // Only admin or system tokens can subscribe users
    if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
      return res.status(403).json({
        success: false,
        error: "Only administrators can subscribe users to relays",
      });
    }

    // Get the subscription price
    const price = await relayVerifier.getRelayPrice(relayAddress);
    if (!price) {
      return res.status(400).json({
        success: false,
        error: "Failed to get relay subscription price",
      });
    }

    // Subscribe to the relay
    const tx = await relayVerifier.subscribeToRelay(
      relayAddress,
      months,
      publicKey || undefined
    );

    if (!tx) {
      return res.status(500).json({
        success: false,
        error: "Failed to subscribe to relay",
      });
    }

    res.json({
      success: true,
      relayAddress,
      months,
      publicKey: publicKey || null,
      transactionHash: tx.hash,
      message: "Subscription successful",
    });
  } catch (error) {
    console.error("Error subscribing to relay:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API - Update relay config
app.post("/api/relay/config", authenticateRequest, async (req, res) => {
  try {
    const { registryAddress, providerUrl, enabled } = req.body;

    // Only system/admin users can modify the configuration
    if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
      return res.status(403).json({
        success: false,
        error: "Only administrators can modify relay configuration",
      });
    }

    // Update configuration
    if (enabled !== undefined) {
      RELAY_CONFIG.relay.onchainMembership = enabled;
    }

    if (registryAddress) {
      RELAY_CONFIG.relay.registryAddress = registryAddress;
    }

    if (providerUrl) {
      RELAY_CONFIG.relay.providerUrl = providerUrl;
    }

    // Reinitialize relay components
    if (RELAY_CONFIG.relay.onchainMembership) {
      const shogunCoreInstance = getShogunCore();

      console.log("Reinitializing RelayVerifier...");
      try {
        relayVerifier = new RelayVerifier(
          {
            registryAddress: RELAY_CONFIG.relay.registryAddress,
            providerUrl: RELAY_CONFIG.relay.providerUrl,
          },
          shogunCoreInstance
        );
        console.log("RelayVerifier reinitialized successfully");
      } catch (error) {
        console.error("Error reinitializing RelayVerifier:", error);
        return res.status(500).json({
          success: false,
          error: "Error reinitializing RelayVerifier: " + error.message,
        });
      }
    } else {
      relayVerifier = null;
      console.log("RelayVerifier disabled");
    }

    res.json({
      success: true,
      config: {
        enabled: RELAY_CONFIG.relay.onchainMembership,
        registryAddress: RELAY_CONFIG.relay.registryAddress,
        providerUrl: RELAY_CONFIG.relay.providerUrl,
      },
    });
  } catch (error) {
    console.error("Error updating relay configuration:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// 🏓 API/RELAY/DID VERIFIER
// ============ DID VERIFIER API ============

// API - Check DID verifier status
app.get("/api/relay/did/status", authenticateRequest, async (req, res) => {
  try {
    // Verify that DIDVerifier is initialized
    if (!RELAY_CONFIG.didVerifier.enabled || !didVerifier) {
      return res.status(503).json({
        success: false,
        error: "DID verifier services not available",
        config: {
          enabled: RELAY_CONFIG.didVerifier.enabled,
          contractAddress:
            RELAY_CONFIG.didVerifier.contractAddress || "Not configured",
        },
      });
    }

    res.json({
      success: true,
      config: {
        enabled: RELAY_CONFIG.didVerifier.enabled,
        contractAddress: RELAY_CONFIG.didVerifier.contractAddress,
      },
    });
  } catch (error) {
    console.error("Error getting DID verifier status:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API - Verify DID and get controller
app.get("/api/relay/did/verify/:did", authenticateRequest, async (req, res) => {
  try {
    const { did } = req.params;

    // Verify that DIDVerifier is initialized
    if (!RELAY_CONFIG.didVerifier.enabled || !didVerifier) {
      return res.status(503).json({
        success: false,
        error: "DID verifier services not available",
      });
    }

    // Verify DID and get controller
    const controller = await didVerifier.verifyDID(did);

    res.json({
      success: true,
      did,
      isValid: !!controller,
      controller,
    });
  } catch (error) {
    console.error(`Error verifying DID ${req.params.did}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API - Check if DID is controlled by a specific controller
app.post(
  "/api/relay/did/check-controller",
  authenticateRequest,
  async (req, res) => {
    try {
      const { did, controller } = req.body;

      if (!did || !controller) {
        return res.status(400).json({
          success: false,
          error: "DID and controller are required",
        });
      }

      // Verify that DIDVerifier is initialized
      if (!RELAY_CONFIG.didVerifier.enabled || !didVerifier) {
        return res.status(503).json({
          success: false,
          error: "DID verifier services not available",
        });
      }

      // Check if DID is controlled by the specified controller
      const isControlledBy = await didVerifier.isDIDControlledBy(
        did,
        controller
      );

      res.json({
        success: true,
        did,
        controller,
        isControlledBy,
      });
    } catch (error) {
      console.error("Error checking DID controller:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Authenticate with DID and signature
app.post(
  "/api/relay/did/authenticate",
  authenticateRequest,
  async (req, res) => {
    try {
      const { did, message, signature } = req.body;

      if (!did || !message || !signature) {
        return res.status(400).json({
          success: false,
          error: "DID, message, and signature are required",
        });
      }

      // Verify that DIDVerifier is initialized
      if (!RELAY_CONFIG.didVerifier.enabled || !didVerifier) {
        return res.status(503).json({
          success: false,
          error: "DID verifier services not available",
        });
      }

      // Authenticate with DID
      const isAuthenticated = await didVerifier.authenticateWithDID(
        did,
        message,
        signature
      );

      res.json({
        success: true,
        did,
        isAuthenticated,
      });
    } catch (error) {
      console.error("Error authenticating with DID:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Register a new DID
app.post("/api/relay/did/register", authenticateRequest, async (req, res) => {
  try {
    const { did, controller } = req.body;

    if (!did || !controller) {
      return res.status(400).json({
        success: false,
        error: "DID and controller are required",
      });
    }

    // Verify that DIDVerifier is initialized
    if (!RELAY_CONFIG.didVerifier.enabled || !didVerifier) {
      return res.status(503).json({
        success: false,
        error: "DID verifier services not available",
      });
    }

    // Only admin or system tokens can register DIDs
    if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
      return res.status(403).json({
        success: false,
        error: "Only administrators can register DIDs",
      });
    }

    // Register DID
    const success = await didVerifier.registerDID(did, controller);

    res.json({
      success,
      did,
      controller,
      message: success
        ? "DID registered successfully"
        : "Failed to register DID",
    });
  } catch (error) {
    console.error("Error registering DID:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API - Update DID verifier config
app.post("/api/relay/did/config", authenticateRequest, async (req, res) => {
  try {
    const { contractAddress, providerUrl, enabled } = req.body;

    // Only system/admin users can modify the configuration
    if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
      return res.status(403).json({
        success: false,
        error: "Only administrators can modify DID verifier configuration",
      });
    }

    // Update configuration
    if (enabled !== undefined) {
      RELAY_CONFIG.didVerifier.enabled = enabled;
    }

    if (contractAddress) {
      RELAY_CONFIG.didVerifier.contractAddress = contractAddress;
    }

    if (providerUrl) {
      RELAY_CONFIG.didVerifier.providerUrl = providerUrl;
    }

    // Reinitialize DID verifier
    if (RELAY_CONFIG.didVerifier.enabled) {
      const shogunCoreInstance = getShogunCore();

      console.log("Reinitializing DIDVerifier...");
      try {
        didVerifier = new DIDVerifier(
          {
            contractAddress: RELAY_CONFIG.didVerifier.contractAddress,
            providerUrl: RELAY_CONFIG.didVerifier.providerUrl,
          },
          shogunCoreInstance
        );
        console.log("DIDVerifier reinitialized successfully");
      } catch (error) {
        console.error("Error reinitializing DIDVerifier:", error);
        return res.status(500).json({
          success: false,
          error: "Error reinitializing DIDVerifier: " + error.message,
        });
      }
    } else {
      didVerifier = null;
      console.log("DIDVerifier disabled");
    }

    res.json({
      success: true,
      config: {
        enabled: RELAY_CONFIG.didVerifier.enabled,
        contractAddress: RELAY_CONFIG.didVerifier.contractAddress,
        providerUrl: RELAY_CONFIG.didVerifier.providerUrl,
      },
    });
  } catch (error) {
    console.error("Error updating DID verifier configuration:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API - RELAY VERIFIER API ============

// Endpoint per pre-autorizzare un token utente
app.post(
  "/api/auth/pre-authorize-token",
  authenticateRequest,
  async (req, res) => {
    try {
      const { token, userId, expiryMinutes } = req.body;

      // Validazioni di base
      if (!token) {
        return res.status(400).json({
          success: false,
          error: "Token is required",
        });
      }

      // Solo admin o system tokens possono pre-autorizzare i token
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json({
          success: false,
          error: "Only administrators can pre-authorize tokens",
        });
      }

      // Verifica se il token è già pre-autorizzato
      if (authorizedKeys.has(token)) {
        const authInfo = authorizedKeys.get(token);
        return res.json({
          success: true,
          message: "Token already pre-authorized",
          token:
            token.substring(0, 6) + "..." + token.substring(token.length - 6),
          expiresAt: authInfo.expiresAt,
          expiresIn:
            Math.round((authInfo.expiresAt - Date.now()) / 1000) + " seconds",
        });
      }

      // Validazione opzionale: verifica che il token sia valido tramite validateUserToken
      let tokenValid = true;
      let tokenInfo = null;

      // Se è specificato un userId, verifichiamo che il token appartenga a quell'utente
      if (userId) {
        tokenInfo = await validateUserToken(token);
        if (!tokenInfo || tokenInfo.userId !== userId) {
          tokenValid = false;
        }
      }

      if (!tokenValid) {
        return res.status(400).json({
          success: false,
          error:
            "The token is not valid or does not belong to the specified user",
        });
      }

      // Pre-autorizza il token
      const expiry = expiryMinutes
        ? expiryMinutes * 60 * 1000
        : AUTH_KEY_EXPIRY;
      const authInfo = authorizeKey(token, expiry);

      res.json({
        success: true,
        message: "Token pre-authorized successfully",
        token:
          token.substring(0, 6) + "..." + token.substring(token.length - 6),
        userId: tokenInfo?.userId || userId || "unknown",
        expiresAt: authInfo.expiresAt,
        expiresIn:
          Math.round((authInfo.expiresAt - Date.now()) / 1000) + " seconds",
      });
    } catch (error) {
      console.error("Error pre-authorizing token:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - RELAY API AUTHENTICATION CONFIG
app.post("/api/relay/auth/config", authenticateRequest, async (req, res) => {
  try {
    // Solo admin o system tokens possono modificare la configurazione
    if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
      return res.status(403).json({
        success: false,
        error: "Only administrators can modify authentication configuration",
      });
    }

    const { onchainMembership } = req.body;

    // Salva la configurazione precedente per confronti
    const previousConfig = {
      onchainMembership: RELAY_CONFIG.relay.onchainMembership,
    };

    // Aggiorna la configurazione se i parametri sono specificati
    if (onchainMembership !== undefined) {
      RELAY_CONFIG.relay.onchainMembership = onchainMembership;
    }

    const currentConfig = {
      onchainMembership: RELAY_CONFIG.relay.onchainMembership,
    };

    // Log delle modifiche alla configurazione
    const changesLog = Object.keys(currentConfig)
      .filter((key) => previousConfig[key] !== currentConfig[key])
      .map((key) => `${key}: ${previousConfig[key]} -> ${currentConfig[key]}`);

    if (changesLog.length > 0) {
      console.log(
        `[AUTH-CONFIG] Configuration changes: ${changesLog.join(", ")}`
      );
    } else {
      console.log(`[AUTH-CONFIG] No changes to authentication configuration`);
    }

    // Descrivi la gerarchia di autenticazione
    const authHierarchy = [
      "1. ADMIN_SECRET_TOKEN (highest priority)",
    ];
    
    if (RELAY_CONFIG.relay.onchainMembership) {
      authHierarchy.push("2. BLOCKCHAIN_MEMBERSHIP");
      authHierarchy.push("3. JWT");
      authHierarchy.push("4. PRE_AUTHORIZED_KEYS (lowest priority)");
    } else {
      authHierarchy.push("2. JWT");
      authHierarchy.push("3. PRE_AUTHORIZED_KEYS (lowest priority)");
    }

    res.json({
      success: true,
      previousConfig,
      currentConfig,
      authenticationHierarchy: authHierarchy,
      message:
        changesLog.length > 0
          ? "Authentication configuration updated successfully"
          : "No changes to authentication configuration",
    });
  } catch (error) {
    console.error("Error updating authentication configuration:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export { app as default, authorizeKey, isKeyPreAuthorized, RELAY_CONFIG };
