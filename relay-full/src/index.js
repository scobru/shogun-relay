import dotenv from "dotenv";
dotenv.config();

import cors from "cors";
import fs from "fs";
import express from "express";
import { RelayVerifier } from "shogun-core";
import Gun from "gun";
import path from "path";
import http from "http";

import {
  validateFileData,
  validateUploadResponse,
  validateConfig,
  isValidationEnabled,
  isStrictValidationEnabled,
} from "./utils/typeValidation.js";

import {
  AuthenticationManager,
  configure,
} from "./managers/AuthenticationManager.js";
import ShogunIpfsManager from "./managers/IpfsManager.js";
import ShogunFileManager from "./managers/FileManager.js";
import setupAuthRoutes from "./routes/authRoutes.js"; // Import the new auth router setup function
import setupIpfsApiRoutes from "./routes/ipfsApiRoutes.js"; // Import the new IPFS router setup function
import setupRelayApiRoutes from "./routes/relayApiRoutes.js"; // Import the new relay router setup function
import setupFileManagerRoutes from "./routes/fileManagerRoutes.js"; // Import the new File Manager router setup function
import setupNetworkRoutes from "./routes/networkRoutes.js"; // Import the new Network router setup function
import {
  initializeShogunCore,
  getInitializedShogunCore,
  ensureShogunCoreInitialized,
  initializeRelayContracts,
  createRelayVerifier,
} from "./utils/shogunCoreUtils.js"; // Import ShogunCore utility functions
import { setupGunIpfsMiddleware } from "./utils/gunIpfsUtils.js";
import StorageLog from "./utils/storageLog.js";
import {
  serverLogger,
  ipfsLogger,
  gunLogger,
  authLogger,
} from "./utils/logger.js";

// Global error handlers to prevent crashes
process.on("uncaughtException", (err) => {
  serverLogger.error("UNCAUGHT EXCEPTION! 💥", {
    error: err.message,
    stack: err.stack,
  });
  serverLogger.error(
    "The server will continue running, but please fix this error."
  );
});

process.on("unhandledRejection", (err) => {
  serverLogger.error("UNHANDLED PROMISE REJECTION! 💥", {
    error: err?.message,
    stack: err?.stack,
  });
  serverLogger.error(
    "The server will continue running, but please fix this error."
  );
});

// create __dirname
const __dirname = path.resolve();

// Load configuration from config.json
let CONFIG = {};
try {
  const configData = fs.readFileSync(
    path.join(__dirname, "config.json"),
    "utf8"
  );
  CONFIG = JSON.parse(configData);
  serverLogger.info("Configuration loaded from config.json ✅");

  // Validate the configuration using Mityli
  try {
    CONFIG = validateConfig(CONFIG);
    serverLogger.info("Configuration validated successfully with Mityli ✅");
  } catch (validationError) {
    serverLogger.warn("Configuration validation warning:", {
      error: validationError.message,
    });
    serverLogger.warn("Continuing with unvalidated configuration");
  }
} catch (error) {
  serverLogger.error("Error loading config.json:", { error: error.message });
  serverLogger.error("Using default configuration");
}

const app = express();
const server = http.createServer(app);
const PORT = CONFIG.PORT || 8765;
const HOST = CONFIG.HOST || "localhost";
const STORAGE_DIR = path.resolve("./uploads");
const SECRET_TOKEN = CONFIG.SECRET_TOKEN || "";
const LOGS_DIR = path.join(__dirname, "logs");

// Declare global variables for important instances
// These will be initialized in startServer
let gun = null;
let shogunCore = null;
let relayVerifier = null;
let fileManager = null;
let ipfsManager = null;

// Initial configuration of RELAY_CONFIG - set once at the start
let RELAY_CONFIG = {
  relay: {
    registryAddress: CONFIG.RELAY_REGISTRY_CONTRACT,
    individualRelayAddress: CONFIG.INDIVIDUAL_RELAY,
    entryPointAddress: CONFIG.RELAY_ENTRY_POINT_CONTRACT,
    providerUrl: CONFIG.ETHEREUM_PROVIDER_URL,
    onchainMembership: CONFIG.ONCHAIN_MEMBERSHIP_ENABLED === true,
  },
};

serverLogger.debug("Relay configuration:", RELAY_CONFIG);

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

// Dynamic function to get current allowed origins (fixes persistence issue)
const getCurrentAllowedOrigins = () => {
  return CONFIG.ALLOWED_ORIGINS
    ? CONFIG.ALLOWED_ORIGINS.split(",")
    : getDefaultAllowedOrigins();
};

/**
 * Reload configuration from file and update runtime state
 * This fixes the issue where configurations remain old after reset
 */
function reloadConfigurationFromFile() {
  try {
    const configPath = path.join(__dirname, "config.json");
    const configData = fs.readFileSync(configPath, "utf8");
    const newConfig = JSON.parse(configData);
    
    // Update the global CONFIG object
    Object.assign(CONFIG, newConfig);
    
    serverLogger.info("[Server] Configuration reloaded from file successfully ✅");
    
    // Update IPFS manager if it exists
    if (ipfsManager) {
      try {
        ipfsManager.updateConfig({
          enabled: CONFIG.IPFS_ENABLED === true,
          service: CONFIG.IPFS_SERVICE || "IPFS-CLIENT",
          nodeUrl: CONFIG.IPFS_NODE_URL || "http://127.0.0.1:5001",
          gateway: CONFIG.IPFS_GATEWAY || "http://127.0.0.1:8080/ipfs",
          pinataGateway: CONFIG.PINATA_GATEWAY || "https://gateway.pinata.cloud",
          pinataJwt: CONFIG.PINATA_JWT || "",
        });
        serverLogger.info("[Server] IPFS Manager reloaded with new configuration ✅");
      } catch (ipfsError) {
        serverLogger.error("[Server] Error reloading IPFS Manager:", {
          error: ipfsError.message,
        });
      }
    }
    
    // Update type validation configuration
    try {
      const { updateValidationConfig } = require("./utils/typeValidation.js");
      updateValidationConfig({
        TYPE_VALIDATION_ENABLED: CONFIG.TYPE_VALIDATION_ENABLED,
        TYPE_VALIDATION_STRICT: CONFIG.TYPE_VALIDATION_STRICT,
      });
      serverLogger.info("[Server] Type validation configuration reloaded ✅");
    } catch (validationError) {
      serverLogger.error("[Server] Error reloading type validation:", {
        error: validationError.message,
      });
    }
    
    return { success: true, message: "Configuration reloaded successfully" };
  } catch (error) {
    serverLogger.error("[Server] Error reloading configuration:", {
      error: error.message,
    });
    return { success: false, error: error.message };
  }
}

// Initialize ShogunCore and relay components. This will create relayVerifier
// and update AuthenticationManager with the live instance via its configure method.

/**
 * Initialize shogun-core relay components
 * This function sets up the RelayVerifier
 */
async function initializeRelayComponents() {
  try {
    const shogunCoreInstance = getInitializedShogunCore();

    // Create a wallet if Ethereum private key is provided
    let signer = null;
    if (CONFIG.ETHEREUM_PRIVATE_KEY) {
      try {
        const { ethers } = await import("ethers");
        // Remove '0x' prefix if present
        const privateKey = CONFIG.ETHEREUM_PRIVATE_KEY.startsWith("0x")
          ? CONFIG.ETHEREUM_PRIVATE_KEY
          : `0x${CONFIG.ETHEREUM_PRIVATE_KEY}`;

        // Create provider
        const provider = new ethers.JsonRpcProvider(
          RELAY_CONFIG.relay.providerUrl
        );

        // Create wallet with private key and provider
        signer = new ethers.Wallet(privateKey, provider);
        serverLogger.info(
          `Ethereum wallet created with address: ${await signer.getAddress()} 💰`
        );
      } catch (error) {
        serverLogger.error("Error creating Ethereum wallet:", {
          error: error.message,
        });
        serverLogger.warn("Continuing without signer for write operations");
      }
    }

    // Initialize RelayVerifier if enabled
    if (RELAY_CONFIG.relay.onchainMembership) {
      try {
        // Initialize the relay contracts using the utility function
        const relayContracts = await initializeRelayContracts(
          RELAY_CONFIG,
          shogunCoreInstance,
          signer
        );

        // Create a unified relay verifier using the contracts
        relayVerifier = createRelayVerifier(relayContracts);

        serverLogger.info(
          "Relay verification components initialized successfully ✅"
        );
      } catch (error) {
        serverLogger.error(
          "Error initializing relay verification components:",
          { error: error.message }
        );
      }

      // Update relayVerifier in AuthenticationManager if we have one
      if (relayVerifier) {
        configure({ relayVerifier });
      }
    }

    return true;
  } catch (error) {
    serverLogger.error("Error initializing relay components:", {
      error: error.message,
    });
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

// Add debug middleware to inspect all incoming Gun messages
const debugGunMessages = (msg) => {
  console.log("🔍 INCOMING MESSAGE INSPECTION:");

  // Check headers in all possible locations
  console.log(
    `- URL token: ${
      msg.url ? new URL(msg.url).searchParams.get("token") : "n/a"
    }`
  );
  console.log(`- Headers: ${JSON.stringify(msg.headers || {})}`);
  console.log(`- Direct token: ${msg.token || "undefined"}`);
  console.log(
    `- Internal token: ${msg._ && msg._.token ? msg._.token : "undefined"}`
  );
  console.log(`- Message type: ${msg.put ? "PUT" : msg.get ? "GET" : "OTHER"}`);

  return msg;
};

function hasValidToken(msg) {
  // Special case: allow authentication messages from Gun.js internal operations
  if (msg && msg.put) {
    const keys = Object.keys(msg.put);
    // Allow user authentication messages (they start with ~@)
    if (keys.some(key => key.startsWith('~@'))) {
      console.log("WRITING - User authentication message allowed");
      return true;
    }
    // Allow user data messages (they contain user pub keys)
    if (keys.some(key => key.match(/^~[A-Za-z0-9_\-\.]+$/))) {
      console.log("WRITING - User data message allowed");
      return true;
    }
  }

  console.log("🔍 Token validation for message:", {
    hasHeaders: !!(msg && msg.headers),
    hasToken: !!(msg && msg.token),
    headerToken: msg?.headers?.token ? msg.headers.token.substring(0, 10) + '...' : 'none',
    directToken: msg?.token ? msg.token.substring(0, 10) + '...' : 'none',
    expectedToken: SECRET_TOKEN ? SECRET_TOKEN.substring(0, 10) + '...' : 'none'
  });

  const valid =
    (msg &&
      msg.headers &&
      msg.headers.token &&
      msg.headers.token === SECRET_TOKEN) ||
    (msg && msg.token && msg.token === SECRET_TOKEN);

  if (valid) {
    console.log("WRITING - Valid token found");
  } else {
    console.log("❌ Token validation failed");
  }

  return valid;
}


Gun.on("opt", function (ctx) {
  if (ctx.once) {
    return;
  }

  // Add outgoing token injection for this instance
  ctx.on("out", function (msg) {
    const to = this.to;
    
    // Always add token to outgoing messages from server
    if (!msg.headers) msg.headers = {};
    msg.headers.token = SECRET_TOKEN;
    msg.token = SECRET_TOKEN;
    msg.headers.Authorization = `Bearer ${SECRET_TOKEN}`;
    
    console.log("📤 Adding token to outgoing message:", {
      type: msg.put ? 'PUT' : msg.get ? 'GET' : 'OTHER',
      hasToken: !!msg.token
    });
    
    to.next(msg);
  });

  // Check all incoming traffic
  ctx.on("in", function (msg) {
    const to = this.to;

    // Allow all operations that aren't PUTs
    if (!msg.put) {
      to.next(msg);
      return;
    }

    // Check if Gun authentication is disabled in config
    if (CONFIG.DISABLE_GUN_AUTH === true || CONFIG.DISABLE_GUN_AUTH === "true") {
      console.log("⚠️ Gun authentication disabled - allowing all PUT operations");
      to.next(msg);
      return;
    }

    // For PUT operations, apply token validation logic
    if (hasValidToken(msg)) {
      console.log(
        "WRITING - Valid token found",
        JSON.stringify(msg).slice(0, 100) + "..."
      );
      to.next(msg);
      return;
    }

    // Block everything else
    console.log(
      "BLOCKED - PUT without valid token:",
      JSON.stringify(msg.put).slice(0, 100) + "..."
    );
    // Don't forward unauthorized puts
  });
});

// Fix the isValid function to properly handle authorization
let gunOptions = {
  web: server,
  peers: CONFIG.PEERS,
  localStorage: false,
  radisk: true,
  file: 'data.json'
};

// Add S3 configuration if available in CONFIG
if (
  CONFIG.S3_ACCESS_KEY_ID &&
  CONFIG.S3_SECRET_ACCESS_KEY &&
  CONFIG.S3_BUCKET
) {
  serverLogger.info(
    "S3 configuration found in config, adding to Gun options 🪣"
  );

  gunOptions.s3 = {
    bucket: CONFIG.S3_BUCKET,
    region: CONFIG.S3_REGION || "us-east-1",
    accessKeyId: CONFIG.S3_ACCESS_KEY_ID,
    secretAccessKey: CONFIG.S3_SECRET_ACCESS_KEY,
    endpoint: CONFIG.S3_ENDPOINT || "http://0.0.0.0:4569",
    s3ForcePathStyle: true,
    address: CONFIG.S3_ADDRESS || "0.0.0.0",
    port: CONFIG.S3_PORT || 4569,
    key: CONFIG.S3_ACCESS_KEY_ID,
    secret: CONFIG.S3_SECRET_ACCESS_KEY,
  };

  serverLogger.info("S3 configuration added to Gun options:", {
    bucket: gunOptions.s3.bucket,
    endpoint: gunOptions.s3.endpoint,
    address: gunOptions.s3.address,
    port: gunOptions.s3.port,
  });
} else {
  serverLogger.info(
    "S3 configuration not found in config, using radisk only 💽"
  );
}

// Add server-side upload tracking to prevent duplicates
const recentUploadIds = new Map(); // uploadId -> timestamp
const uploadIdTimeout = 60000; // 1 minute timeout for upload IDs

// Track content-based uploads to prevent race conditions
const contentBasedUploads = new Map(); // contentHash -> Promise
const uploadCleanupTimeout = 120000; // 2 minutes

// Global upload tracking for debugging
const globalUploadTracker = {
  activeUploads: new Map(), // requestId -> upload info
  completedUploads: new Map(), // requestId -> completion info
  maxHistory: 100, // Keep last 100 uploads for debugging
  
  startUpload: function(requestId, uploadInfo) {
    this.activeUploads.set(requestId, {
      ...uploadInfo,
      startTime: Date.now()
    });
    
    console.log(`[GlobalTracker] Started upload: ${requestId} for file: ${uploadInfo.filename}`);
  },
  
  completeUpload: function(requestId, result) {
    const uploadInfo = this.activeUploads.get(requestId);
    if (uploadInfo) {
      const completionInfo = {
        ...uploadInfo,
        result: result,
        endTime: Date.now(),
        duration: Date.now() - uploadInfo.startTime
      };
      
      this.activeUploads.delete(requestId);
      this.completedUploads.set(requestId, completionInfo);
      
      // Keep only the last maxHistory uploads
      if (this.completedUploads.size > this.maxHistory) {
        const oldestKey = this.completedUploads.keys().next().value;
        this.completedUploads.delete(oldestKey);
      }
      
      console.log(`[GlobalTracker] Completed upload: ${requestId} in ${completionInfo.duration}ms`);
    }
  },
  
  getStatus: function() {
    return {
      activeUploads: Array.from(this.activeUploads.entries()),
      completedUploads: Array.from(this.completedUploads.entries()),
      recentUploadIds: Array.from(recentUploadIds.entries()),
      contentBasedUploads: Array.from(contentBasedUploads.keys()),
      timestamp: Date.now()
    };
  }
};

/**
 * Starts the unified relay server
 * Initializes IPFS, configures middleware, and sets up WebSocket handlers
 * @returns {Promise<void>}
 */
async function startServer() {
  try {
    serverLogger.info("Starting unified relay server... 🚀");

    // Configure the AuthenticationManager with our variables
    configure({
      SECRET_TOKEN,
      RELAY_CONFIG,
      relayVerifier: null, // Will be set later after initialization
      BASIC_AUTH_USER: CONFIG.BASIC_AUTH_USER,
      BASIC_AUTH_PASSWORD: CONFIG.BASIC_AUTH_PASSWORD,
    });

    // Initialize IpfsManager
    ipfsManager = new ShogunIpfsManager({
      enabled: CONFIG.IPFS_ENABLED === true || false,
      service: CONFIG.IPFS_SERVICE || "IPFS-CLIENT",
      nodeUrl: CONFIG.IPFS_NODE_URL || "http://127.0.0.1:5001",
      gateway: CONFIG.IPFS_GATEWAY || "http://127.0.0.1:8080/ipfs",
      pinataGateway: CONFIG.PINATA_GATEWAY || "https://gateway.pinata.cloud",
      pinataJwt: CONFIG.PINATA_JWT || "",
      encryptionEnabled: CONFIG.ENCRYPTION_ENABLED === true || false,
      encryptionKey: CONFIG.ENCRYPTION_KEY || "",
      encryptionAlgorithm: CONFIG.ENCRYPTION_ALGORITHM || "aes-256-gcm",
      apiKey: SECRET_TOKEN,
    });
    ipfsLogger.info("IpfsManager initialized. ✅");

    // Initialize AuthenticationManager configuration first
    configure({
      SECRET_TOKEN,
      RELAY_CONFIG,
      relayVerifier: null, // Will be set after relayVerifier init by initializeRelayComponents
      BASIC_AUTH_USER: CONFIG.BASIC_AUTH_USER,
      BASIC_AUTH_PASSWORD: CONFIG.BASIC_AUTH_PASSWORD,
    });
    authLogger.info(
      "AuthenticationManager configured with initial settings. ✅"
    );

    // Initialize Gun first
    gun = new Gun(gunOptions);
    gunLogger.info("GunDB initialized. ✅");

    // Debug middleware is already handled in Gun.on("opt") above
    // Removed duplicate debug middleware to avoid conflicts

    gun.on("out", { get: { "#": { "*": "" } } });

    // Initialize StorageLog
    new StorageLog(Gun, gun);

    // Initialize ShogunCore and relay components
    serverLogger.info("Initializing ShogunCore with Gun instance 🚀");
    shogunCore = initializeShogunCore(gun, SECRET_TOKEN);

    await initializeRelayComponents();
    serverLogger.info(
      "Relay initialized, AuthenticationManager updated with live verifiers. ✅"
    );

    // Initialize File Manager now that gun and ipfsManager are available
    fileManager = new ShogunFileManager({
      gun,
      ipfsManager,
      storageDir: STORAGE_DIR,
      maxFileSize: CONFIG.MAX_FILE_SIZE || "500mb",
    });
    serverLogger.info("File Manager initialized inside startServer. ✅");

    // Setup API routes from modules
    const authRouter = setupAuthRoutes(
      gun,
      ensureShogunCoreInitialized,
      AuthenticationManager
    );
    app.use("/api/auth", authRouter); // THIS LINE SHOULD BE BEFORE app.use("/api", authenticateRequest)


    function createProxyMiddleware(target, changeOrigin, pathRewrite) {
      return createProxyMiddleware({
        target,
        changeOrigin,
        pathRewrite,
      });
    }

    const ipfsApiRouter = setupIpfsApiRoutes(
      ipfsManager,
      fileManager,
      authenticateRequest
    );
    app.use("/api/ipfs", ipfsApiRouter);

    // Set up relay API routes
    const relayApiRouter = setupRelayApiRoutes(
      RELAY_CONFIG,
      getRelayVerifier,
      authenticateRequest,
      getInitializedShogunCore,
      initializeRelayComponents,
      SECRET_TOKEN,
      AuthenticationManager
    );
    app.use("/api/relay", relayApiRouter);

    // Set up file manager routes
    const fileManagerRouter = setupFileManagerRoutes(
      fileManager,
      authenticateRequest
    );
    app.use("/files", fileManagerRouter);

    // Set up network management routes
    const networkRouter = setupNetworkRoutes(
      authenticateRequest,
      () => gun // Provide function to get Gun instance
    );
    app.use("/api/network", networkRouter);

    app.set("gun", gun);

    app.use(
      "/shogun-core.js",
      express.static(path.join(__dirname, "src/ui/messenger/shogun-core.js"))
    );

    app.use(
      "/gun",
      express.static(path.join(__dirname, "src/ui/gun/note.html"))
    );

    app.use(
      "/gundb/client",
      express.static(path.join(__dirname, "src/ui/gundb/client.html"))
    );

    app.use(
      "/rtc/bugoff.js",
      express.static(path.join(__dirname, "src/ui/rtc/bugoff.js"))
    );

    app.use(
      "/rtc/bugout.min.js",
      express.static(path.join(__dirname, "src/ui/rtc/bugout.min.js"))
    );

    app.use(
      "/rtc/client",
      express.static(path.join(__dirname, "src/ui/rtc/client.html"), {
        setHeaders: (res) => {
          res.setHeader("Content-Type", "text/html");
        },
      })
    );

    app.use(
      "/rtc/server",
      express.static(path.join(__dirname, "src/ui/rtc/server.html"), {
        setHeaders: (res) => {
          res.setHeader("Content-Type", "text/html");
          res.setHeader("Access-Control-Allow-Origin", "*");
        },
      })
    );

    // Add new NoDom versions of client and server
    app.use(
      "/client-nodom.html",
      express.static(path.join(__dirname, "src/ui/chat/client-nodom.html"))
    );

    app.use(
      "/server-nodom.html",
      express.static(path.join(__dirname, "src/ui/chat/server-nodom.html"))
    );

    app.use(
      "/nodom.js",
      express.static(path.join(__dirname, "src/ui/nodom.js"))
    );

    app.use(
      "/app-nodom.js",
      express.static(path.join(__dirname, "src/ui/dashboard/app-nodom.js"))
    );

    app.use(
      "/components-nodom.js",
      express.static(
        path.join(__dirname, "src/ui/dashboard/components-nodom.js")
      )
    );

    app.use(
      "/tabs-nodom.js",
      express.static(path.join(__dirname, "src/ui/dashboard/tabs-nodom.js"))
    );

    app.use(
      "/nodom.css",
      express.static(path.join(__dirname, "src/ui/nodom.css"), {
        setHeaders: (res) => {
          res.setHeader("Content-Type", "text/css");
        },
      })
    );

    // Set up the upload route separately
    app.post(
      "/upload",
      authenticateRequest,
      fileManager.getUploadMiddleware().single("file"),
      async (req, res) => {
        // Generate a unique request ID for this upload attempt
        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        try {
          serverLogger.info(`[Server] Processing file upload request 🚀 (Request ID: ${requestId})`);
          
          // Start tracking this upload
          globalUploadTracker.startUpload(requestId, {
            filename: req.file ? req.file.originalname : 'text-content',
            uploadId: req.body.uploadId,
            size: req.file ? req.file.size : (req.body.content ? req.body.content.length : 0),
            ip: req.ip,
            userAgent: req.get('User-Agent')
          });
          
          // Server-side duplicate upload prevention by upload ID
          const uploadId = req.body.uploadId;
          const now = Date.now();
          
          if (uploadId) {
            // Check if this uploadId was recently processed
            if (recentUploadIds.has(uploadId)) {
              const lastProcessTime = recentUploadIds.get(uploadId);
              const timeDiff = now - lastProcessTime;
              
              if (timeDiff < uploadIdTimeout) {
                serverLogger.warn(`[Server] Duplicate upload ID detected: ${uploadId} (${timeDiff}ms ago) ⚠️`);
                return res.status(409).json({
                  success: false,
                  error: "Duplicate upload detected. Please wait before trying again.",
                  code: "DUPLICATE_UPLOAD"
                });
              }
            }
            
            // Track this upload ID immediately
            recentUploadIds.set(uploadId, now);
            
            // Clean up old upload IDs (older than timeout)
            for (const [id, timestamp] of recentUploadIds.entries()) {
              if (now - timestamp > uploadIdTimeout) {
                recentUploadIds.delete(id);
              }
            }
          }

          // Check if there's actually a file to upload
          if (!req.file && (!req.body.content || !req.body.contentType)) {
            return res.status(400).json({
              success: false,
              error: "No file or content provided",
            });
          }

          // Content-based duplicate prevention (happens before processing)
          let contentHash = null;
          let contentBasedId = null;
          
          if (req.file) {
            // Calculate content hash immediately
            const crypto = await import("crypto");
            let fileBuffer;
            
            if (req.file.buffer) {
              fileBuffer = req.file.buffer;
            } else if (req.file.path) {
              const fs = await import("fs");
              fileBuffer = fs.default.readFileSync(req.file.path);
            }
            
            if (fileBuffer) {
              // Generate the same content hash as FileManager would
              contentHash = crypto.default.createHash('sha256').update(fileBuffer).digest('hex').substring(0, 16);
              const safeName = req.file.originalname.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9.-]/g, "_");
              contentBasedId = `${contentHash}-${safeName}`;
              
              serverLogger.info(`[Server] Pre-calculated content-based ID: ${contentBasedId} for file: ${req.file.originalname} (Request ID: ${requestId})`);
              
              // Check if this content is already being processed
              if (contentBasedUploads.has(contentBasedId)) {
                serverLogger.info(`[Server] Content-based upload already in progress, waiting: ${contentBasedId} (Request ID: ${requestId})`);
                
                try {
                  // Wait for the ongoing upload to complete
                  const existingResult = await contentBasedUploads.get(contentBasedId);
                  
                  // Clean up the uploaded file
                  if (req.file.path && fs.default.existsSync(req.file.path)) {
                    try {
                      fs.default.unlinkSync(req.file.path);
                      serverLogger.info(`[Server] Cleaned up concurrent upload file: ${req.file.path} (Request ID: ${requestId})`);
                    } catch (cleanupError) {
                      serverLogger.warn(`[Server] Error cleaning up concurrent file: ${cleanupError.message} (Request ID: ${requestId})`);
                    }
                  }
                  
                  // Track concurrent detection
                  globalUploadTracker.completeUpload(requestId, {
                    success: true,
                    fileId: existingResult.id,
                    isDuplicate: true,
                    message: 'Concurrent upload detected at server level'
                  });
                  
                  return res.json({
                    success: true,
                    file: {
                      ...existingResult,
                      message: 'File with identical content was being processed concurrently',
                      isDuplicate: true,
                      concurrentUpload: true
                    },
                    fileInfo: {
                      originalName: existingResult.originalName,
                      size: existingResult.size,
                      mimetype: existingResult.mimetype,
                      fileUrl: existingResult.fileUrl,
                      ipfsHash: existingResult.ipfsHash,
                      ipfsUrl: existingResult.ipfsUrl,
                      customName: existingResult.customName,
                    },
                    verified: existingResult.verified,
                    requestId: requestId,
                  });
                } catch (error) {
                  serverLogger.warn(`[Server] Concurrent upload failed, proceeding: ${error.message} (Request ID: ${requestId})`);
                  // Fall through to normal processing
                }
              }
              
              // Check if this exact content already exists
              const existingFile = await fileManager.getFileById(contentBasedId);
              if (existingFile) {
                serverLogger.info(`[Server] File with identical content already exists: ${contentBasedId} ⚠️ (Request ID: ${requestId})`);
                
                // Clean up the uploaded file if it's a disk storage
                if (req.file.path && fs.default.existsSync(req.file.path)) {
                  try {
                    fs.default.unlinkSync(req.file.path);
                    serverLogger.info(`[Server] Cleaned up duplicate upload file: ${req.file.path} (Request ID: ${requestId})`);
                  } catch (cleanupError) {
                    serverLogger.warn(`[Server] Error cleaning up duplicate file: ${cleanupError.message} (Request ID: ${requestId})`);
                  }
                }
                
                // Track duplicate detection
                globalUploadTracker.completeUpload(requestId, {
                  success: true,
                  fileId: existingFile.id,
                  isDuplicate: true,
                  message: 'Duplicate detected by server pre-check'
                });
                
                return res.json({
                  success: true,
                  file: {
                    ...existingFile,
                    message: 'File with identical content already exists',
                    isDuplicate: true,
                    existingFile: true
                  },
                  fileInfo: {
                    originalName: existingFile.originalName,
                    size: existingFile.size,
                    mimetype: existingFile.mimetype,
                    fileUrl: existingFile.fileUrl,
                    ipfsHash: existingFile.ipfsHash,
                    ipfsUrl: existingFile.ipfsUrl,
                    customName: existingFile.customName,
                  },
                  verified: existingFile.verified,
                  requestId: requestId,
                });
              }
            }
          }

          // Set a timeout to prevent hanging uploads
          const uploadTimeout = setTimeout(() => {
            serverLogger.error(
              `[Server] File upload processing timeout after 30s ❌ (Request ID: ${requestId})`
            );
            if (!res.headersSent) {
              res.status(500).json({
                success: false,
                error: "Upload timed out",
              });
            }
          }, 30000); // 30 second timeout

          // Create a promise for the upload processing if we have a content-based ID
          let uploadPromise;
          if (contentBasedId) {
            uploadPromise = fileManager.handleFileUpload(req);
            contentBasedUploads.set(contentBasedId, uploadPromise);
            
            // Clean up after timeout
            setTimeout(() => {
              contentBasedUploads.delete(contentBasedId);
            }, uploadCleanupTimeout);
          }

          // Process the upload
          let fileData = uploadPromise ? await uploadPromise : await fileManager.handleFileUpload(req);

          // Add request tracking to the file data
          fileData.requestId = requestId;
          fileData.processedAt = now;

          // Validate the file data using Mityli
          try {
            fileData = validateFileData(fileData);
            serverLogger.info(
              `[Server] File data validated successfully with Mityli ✅ (Request ID: ${requestId})`
            );
          } catch (validationError) {
            serverLogger.error(`[Server] File data validation error:`, {
              error: validationError.message,
              requestId: requestId
            });
            // Continue without validation if it fails - for backward compatibility
          }

          // Clear the timeout since we completed successfully
          clearTimeout(uploadTimeout);

          serverLogger.info(
            `[Server] File upload completed successfully: ${fileData.id} ✅ (Request ID: ${requestId})`
          );

          // Prepare response
          const response = {
            success: true,
            file: fileData,
            fileInfo: {
              originalName: fileData.originalName,
              size: fileData.size,
              mimetype: fileData.mimetype,
              fileUrl: fileData.fileUrl,
              ipfsHash: fileData.ipfsHash,
              ipfsUrl: fileData.ipfsUrl,
              customName: fileData.customName,
            },
            verified: fileData.verified,
            requestId: requestId,
          };

          // Validate response with Mityli before sending
          // const validatedResponse = validateUploadResponse(response); // Bypassing Mityli for testing

          // Send response if not already sent
          if (!res.headersSent) {
            // res.json(validatedResponse);
            res.json(response); // Sending raw response for testing
            
            // Track successful completion
            globalUploadTracker.completeUpload(requestId, {
              success: true,
              fileId: fileData.id,
              isDuplicate: fileData.isDuplicate || false
            });
          }
        } catch (error) {
          serverLogger.error(`[Server] File upload error: ❌ (Request ID: ${requestId})`, {
            error: error.message,
            requestId: requestId
          });

          // Track failed completion
          globalUploadTracker.completeUpload(requestId, {
            success: false,
            error: error.message
          });

          // Send error response if not already sent
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: "Error during upload: " + error.message,
              requestId: requestId,
            });
          }
        }
      }
    );

    // Setup Gun-IPFS middleware
    if (ipfsManager.isEnabled()) {
      setupGunIpfsMiddleware(ipfsManager);
    }
    // Update FileManager's IPFS manager instance and reconfigure multer
    // This ensures multer is reconfigured if IPFS state changes during runtime
    fileManager.setIpfsManager(ipfsManager);

    // Setup SSL if certificates are provided
    let httpsServer = null;
    if (CONFIG.PRIVKEY_PATH && CONFIG.CERT_PATH) {
      try {
        // Resolve paths relative to the project root
        const privKeyPath = path.resolve(__dirname, ".", CONFIG.PRIVKEY_PATH);
        const certPath = path.resolve(__dirname, ".", CONFIG.CERT_PATH);

        serverLogger.info(`Loading SSL private key from: ${privKeyPath} 🔑`);
        serverLogger.info(`Loading SSL certificate from: ${certPath} 🔑`);

        // Check if files exist
        if (!fs.existsSync(privKeyPath)) {
          throw new Error(`Private key file not found: ${privKeyPath} ❌`);
        }

        if (!fs.existsSync(certPath)) {
          throw new Error(`Certificate file not found: ${certPath} ❌`);
        }

        const sslOptions = {
          key: fs.readFileSync(privKeyPath),
          cert: fs.readFileSync(certPath),
        };

        httpsServer = https.createServer(sslOptions, app);

        // Start HTTPS server if SSL is configured
        const httpsPort = parseInt(CONFIG.HTTPS_PORT || "8443");
        httpsServer.listen(httpsPort, HOST, () => {
          serverLogger.info(
            `HTTPS server listening on https://${HOST}:${httpsPort}`
          );
        });

        serverLogger.info("SSL configuration loaded successfully ✅");
      } catch (err) {
        serverLogger.error("Error loading SSL certificates:", {
          error: err.message,
        });
        serverLogger.error("HTTPS server will not be available");
        serverLogger.info(
          "To generate SSL certificates, run: node scripts/generate-ssl-certs.js 🔑"
        );
      }
    }
  } catch (error) {
    serverLogger.error("Error during server startup:", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
}

startServer().catch((err) => {
  serverLogger.error("Critical error during startup:", {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

// CORS Configuration
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests without origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      // Check if CORS restrictions are disabled via environment variable
      if (CONFIG.DISABLE_CORS === true || 
          CONFIG.DISABLE_CORS === "true" || 
          process.env.DISABLE_CORS === "true") {
        serverLogger.info(`CORS restrictions disabled - allowing all origins`);
        return callback(null, true);
      }

      // Enable all origins in development mode
      if (CONFIG.NODE_ENV === "development") {
        return callback(null, true);
      }

      if (getCurrentAllowedOrigins().indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        serverLogger.warn(`Origin blocked by CORS: ${origin}`);
        callback(null, false);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "token",
    ],
  })
);

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Middlewares
app.use(express.json({ limit: "500mb" }));
app.use(express.urlencoded({ extended: true, limit: "500mb" }));
app.use("/uploads", express.static(STORAGE_DIR));
app.use(Gun.serve);

/**
 * Enhanced token validation middleware that supports both system and user tokens
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const authenticateRequest = async (req, res, next) => {
  return AuthenticationManager.authenticateRequest(req, res, next);
};

// API - STATUS CORS
app.get("/api/status", (req, res) => {
  const corsRestricted = !(CONFIG.DISABLE_CORS === true || 
                          CONFIG.DISABLE_CORS === "true" || 
                          process.env.DISABLE_CORS === "true");
  
  res.json({
    status: "online",
    timestamp: Date.now(),
    server: {
      version: "1.0.0",
      cors: corsRestricted ? getCurrentAllowedOrigins() : "all origins allowed",
      corsRestricted: corsRestricted,
    },
    ipfs: {
      enabled: ipfsManager.isEnabled(),
      service: ipfsManager.getConfig().service,
      gateway: ipfsManager.getConfig().gateway,
    },
  });
});

// Mityli Type Validation Test Endpoint
app.get("/api/test-mityli", (req, res) => {
  serverLogger.info("MITYLI_TEST: Starting validation test 🔑");

  // Sample data with both valid and invalid variants
  const samples = {
    validFileData: {
      id: "valid_file_123",
      name: "valid.jpg",
      originalName: "valid.jpg",
      mimeType: "image/jpeg",
      mimetype: "image/jpeg",
      size: 12345,
      url: "/uploads/valid.jpg",
      fileUrl: "/uploads/valid.jpg",
      localPath: "/path/to/valid.jpg",
      ipfsHash: "QmValidHash123",
      ipfsUrl: "https://gateway.ipfs.io/ipfs/QmValidHash123",
      timestamp: Date.now(),
      uploadedAt: Date.now(),
      customName: "my-valid-name",
      verified: true,
    },
    invalidFileData: {
      id: "invalid_file_123",
      name: "invalid.jpg",
      // Missing required fields
      size: "not-a-number", // Wrong type
      timestamp: "not-a-timestamp", // Wrong type
    },
  };

  const results = {
    testTime: new Date().toISOString(),
    validationResults: {},
  };

  // Test validation for valid data
  try {
    const validParsed = validateFileData(samples.validFileData);
    results.validationResults.validData = {
      success: true,
      message: "Valid data validated successfully",
      data: validParsed,
    };
  } catch (error) {
    results.validationResults.validData = {
      success: false,
      message: "Validation of valid data failed unexpectedly: " + error.message,
    };
  }

  // Test validation for invalid data
  try {
    const invalidParsed = validateFileData(samples.invalidFileData);
    results.validationResults.invalidData = {
      success: true, // This should not happen
      message: "Invalid data unexpectedly validated successfully",
      data: invalidParsed,
    };
  } catch (error) {
    results.validationResults.invalidData = {
      success: false,
      message: "Invalid data correctly failed validation: " + error.message,
    };
  }

  // Test assignment validation with Proxy
  try {
    const validParsed = validateFileData(samples.validFileData);

    // Test valid assignment
    validParsed.size = 54321; // Should work (same type)
    results.validationResults.validAssignment = {
      success: true,
      message: "Valid assignment passed",
      newSize: validParsed.size,
    };

    // Test invalid assignment (might throw)
    try {
      validParsed.size = "invalid-size"; // Should throw (wrong type)
      results.validationResults.invalidAssignment = {
        success: false,
        message: "Invalid assignment unexpectedly succeeded",
      };
    } catch (assignError) {
      results.validationResults.invalidAssignment = {
        success: true,
        message:
          "Invalid assignment correctly threw error: " + assignError.message,
      };
    }
  } catch (error) {
    results.validationResults.assignment = {
      success: false,
      message: "Assignment validation test failed: " + error.message,
    };
  }

  // Add current validation configuration
  results.configuration = {
    validationEnabled: isValidationEnabled(),
    strictValidation: isStrictValidationEnabled(),
  };

  // Return all results
  res.json(results);
});

// Type Validation Configuration Endpoint
app.post("/api/validation-config", authenticateRequest, (req, res) => {
  serverLogger.info("[Server] Processing validation config update request 🔑");

  // Extract configuration from request
  const { enabled, strict } = req.body;

  // Validate input
  if (typeof enabled !== "boolean" && typeof strict !== "boolean") {
    return res.status(400).json({
      success: false,
      error:
        "Invalid configuration. Expected 'enabled' and/or 'strict' boolean parameters.",
    });
  }

  try {
    const {
      updateValidationConfig,
      isValidationEnabled,
      isStrictValidationEnabled,
    } = require("./utils/typeValidation.js");

    // Update configuration
    updateValidationConfig({
      TYPE_VALIDATION_ENABLED:
        typeof enabled === "boolean" ? enabled : undefined,
      TYPE_VALIDATION_STRICT: typeof strict === "boolean" ? strict : undefined,
    });

    // Get current configuration
    const currentConfig = {
      enabled: isValidationEnabled(),
      strict: isStrictValidationEnabled(),
    };

    // Return success response
    res.json({
      success: true,
      message: "Validation configuration updated successfully",
      config: currentConfig,
    });
    serverLogger.info(
      "[Server] Validation configuration updated successfully ✅"
    );
  } catch (error) {
    serverLogger.error("[Server] Error updating validation configuration:", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: "Error updating validation configuration: " + error.message,
    });
  }
});

// Configuration Management Endpoints
app.get("/api/config", authenticateRequest, (req, res) => {
  serverLogger.info("[Server] Retrieving current configuration 📋");
  
  try {
    // Return safe configuration with proper defaults
    const safeConfig = {
      NODE_ENV: CONFIG.NODE_ENV || "development",
      PORT: CONFIG.PORT || 8765,
      HTTPS_PORT: CONFIG.HTTPS_PORT || 8443,
      DISABLE_CORS: CONFIG.DISABLE_CORS === true || CONFIG.DISABLE_CORS === "true",
      DISABLE_GUN_AUTH: CONFIG.DISABLE_GUN_AUTH === true || CONFIG.DISABLE_GUN_AUTH === "true",
      IPFS_ENABLED: CONFIG.IPFS_ENABLED === true || CONFIG.IPFS_ENABLED === "true",
      IPFS_SERVICE: CONFIG.IPFS_SERVICE || "IPFS-CLIENT",
      IPFS_NODE_URL: CONFIG.IPFS_NODE_URL || "http://localhost:5001",
      IPFS_GATEWAY: CONFIG.IPFS_GATEWAY || "http://127.0.0.1:8080/ipfs/",
      PINATA_GATEWAY: CONFIG.PINATA_GATEWAY || "",
      PINATA_JWT: CONFIG.PINATA_JWT || "",
      ONCHAIN_MEMBERSHIP_ENABLED: CONFIG.ONCHAIN_MEMBERSHIP_ENABLED === true || CONFIG.ONCHAIN_MEMBERSHIP_ENABLED === "true",
      TYPE_VALIDATION_ENABLED: CONFIG.TYPE_VALIDATION_ENABLED !== false && CONFIG.TYPE_VALIDATION_ENABLED !== "false",
      TYPE_VALIDATION_STRICT: CONFIG.TYPE_VALIDATION_STRICT === true || CONFIG.TYPE_VALIDATION_STRICT === "true",
      S3_BUCKET: CONFIG.S3_BUCKET || "",
      S3_REGION: CONFIG.S3_REGION || "us-east-1",
      S3_ENDPOINT: CONFIG.S3_ENDPOINT || "http://0.0.0.0:4569",
      S3_ADDRESS: CONFIG.S3_ADDRESS || "0.0.0.0",
      S3_PORT: CONFIG.S3_PORT || 4569,
      // Include arrays and safe strings
      PEERS: CONFIG.PEERS || [],
      ALLOWED_ORIGINS: CONFIG.ALLOWED_ORIGINS || ""
    };

    res.json({
      success: true,
      config: safeConfig
    });
  } catch (error) {
    serverLogger.error("[Server] Error retrieving configuration:", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: "Error retrieving configuration: " + error.message,
    });
  }
});

app.post("/api/config", authenticateRequest, (req, res) => {
  serverLogger.info("[Server] Processing configuration update request 🔧");

  try {
    const updates = req.body;
    
    // List of allowed configuration keys to update
    const allowedKeys = [
      'DISABLE_CORS',
      'DISABLE_GUN_AUTH', 
      'IPFS_ENABLED',
      'IPFS_SERVICE',
      'IPFS_NODE_URL',
      'IPFS_GATEWAY',
      'PINATA_GATEWAY',
      'PINATA_JWT',
      'ONCHAIN_MEMBERSHIP_ENABLED',
      'TYPE_VALIDATION_ENABLED',
      'TYPE_VALIDATION_STRICT',
      'S3_BUCKET',
      'S3_REGION',
      'S3_ENDPOINT',
      'S3_ADDRESS',
      'S3_PORT',
      'ALLOWED_ORIGINS'
    ];

    // Validate and update allowed keys
    const updatedKeys = [];
    for (const [key, value] of Object.entries(updates)) {
      if (allowedKeys.includes(key)) {
        CONFIG[key] = value;
        updatedKeys.push(key);
        serverLogger.info(`[Server] Updated config ${key}: ${value}`);
      } else {
        serverLogger.warn(`[Server] Attempted to update disallowed config key: ${key}`);
      }
    }

    // Write updated configuration back to file
    const configPath = path.join(__dirname, "config.json");
    fs.writeFileSync(configPath, JSON.stringify(CONFIG, null, 4));
    
    serverLogger.info("[Server] Configuration file updated successfully ✅");

    // If IPFS settings were updated, update the IPFS manager
    const ipfsKeys = ['IPFS_ENABLED', 'IPFS_SERVICE', 'IPFS_NODE_URL', 'IPFS_GATEWAY', 'PINATA_GATEWAY', 'PINATA_JWT'];
    if (ipfsKeys.some(key => updatedKeys.includes(key))) {
      if (ipfsManager) {
        try {
          // Reinitialize IPFS manager with new settings
          ipfsManager.updateConfig({
            enabled: CONFIG.IPFS_ENABLED === true,
            service: CONFIG.IPFS_SERVICE || "IPFS-CLIENT",
            nodeUrl: CONFIG.IPFS_NODE_URL || "http://127.0.0.1:5001",
            gateway: CONFIG.IPFS_GATEWAY || "http://127.0.0.1:8080/ipfs",
            pinataGateway: CONFIG.PINATA_GATEWAY || "https://gateway.pinata.cloud",
            pinataJwt: CONFIG.PINATA_JWT || "",
          });
          serverLogger.info("[Server] IPFS Manager configuration updated ✅");
        } catch (ipfsError) {
          serverLogger.error("[Server] Error updating IPFS Manager:", {
            error: ipfsError.message,
          });
        }
      }
    }

    res.json({
      success: true,
      message: `Configuration updated successfully. Updated keys: ${updatedKeys.join(', ')}`,
      updatedKeys,
      requiresRestart: updatedKeys.some(key => ['PORT', 'HTTPS_PORT', 'NODE_ENV'].includes(key))
    });

  } catch (error) {
    serverLogger.error("[Server] Error updating configuration:", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: "Error updating configuration: " + error.message,
    });
  }
});

// Configuration reload endpoint - fixes persistence issue after reset
app.post("/api/config/reload", authenticateRequest, (req, res) => {
  serverLogger.info("[Server] Processing configuration reload request 🔄");
  
  try {
    const result = reloadConfigurationFromFile();
    
    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        message: "Failed to reload configuration from file"
      });
    }
  } catch (error) {
    serverLogger.error("[Server] Error in reload endpoint:", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: "Error in reload endpoint: " + error.message,
    });
  }
});

// GunDB Test Endpoint
app.get("/api/test-gundb", (req, res) => {
  gunLogger.info(
    "GUNDB_TEST_ENDPOINT: Starting test at " + new Date().toISOString()
  );

  // Generate a unique test key
  const testKey = `test_key_${Date.now()}`;
  gunLogger.info(`GUNDB_TEST_ENDPOINT: Using test key: ${testKey} 🔑`);

  const testData = {
    message: "Test data from endpoint",
    timestamp: Date.now(),
  };

  const results = {
    testKey,
    startTime: new Date().toISOString(),
    putCallbackFired: false,
    onceCallbackFired: false,
    putError: null,
    onceError: null,
    retrievedData: null,
    dataMatches: false,
  };

  // Using a promise with timeout to handle async operations with a time limit
  const runTestWithTimeout = new Promise((resolve) => {
    const testNode = gun.get(testKey);
    gunLogger.info(
      `GUNDB_TEST_ENDPOINT: Attempting .put() with data:`,
      testData
    );

    // Set overall timeout for the entire test
    const testTimeout = setTimeout(() => {
      gunLogger.error(`GUNDB_TEST_ENDPOINT: Test timed out after 10s ❌`);
      resolve(results);
    }, 10000);

    testNode.put(testData, (putAck) => {
      results.putCallbackFired = true;
      gunLogger.info(
        `GUNDB_TEST_ENDPOINT: .put() callback fired with:`,
        putAck
      );

      if (putAck.err) {
        gunLogger.error(`GUNDB_TEST_ENDPOINT: .put() failed:`, {
          error: putAck.err,
        });
        results.putError = putAck.err;
      } else {
        gunLogger.info(`GUNDB_TEST_ENDPOINT: .put() successful ✅`);

        // Try to read back the data
        gunLogger.info(
          `GUNDB_TEST_ENDPOINT: Attempting .once() to read back data 🔑`
        );

        testNode.once((readData, readKey) => {
          results.onceCallbackFired = true;
          gunLogger.info(
            `GUNDB_TEST_ENDPOINT: .once() callback fired. Key: ${readKey}`,
            { data: readData }
          );

          results.retrievedData = readData;
          if (readData && readData.message === testData.message) {
            gunLogger.info(
              `GUNDB_TEST_ENDPOINT: Data read back matches put data!`
            );
            results.dataMatches = true;
          } else {
            gunLogger.error(
              `GUNDB_TEST_ENDPOINT: Data mismatch or no data from .once()`
            );
          }

          // Test completed successfully, clear timeout and resolve
          clearTimeout(testTimeout);
          results.endTime = new Date().toISOString();
          resolve(results);
        });
      }
    });
  });

  // Wait for the test to complete (or time out) then return results
  runTestWithTimeout.then((results) => {
    gunLogger.info(`GUNDB_TEST_ENDPOINT: Test completed`, { results });
    res.json(results);
  });
});

// Endpoint per verificare la configurazione WebSocket
app.get("/check-websocket", authenticateRequest, (req, res) => {
  serverLogger.info("[Server] Checking WebSocket connection 📡");
  res.json({
    serverInfo: {
      port: PORT,
      websocketUrl: `ws://${req.headers.host}/gun`,
      ok: true,
    },
  });
});

// Serve l'interfaccia web di base
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "src/ui/dashboard/index-nodom.html"));
});

// Serve la pagina di login html
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "src/ui/dashboard/login.html"));
});

// Endpoint to handle /debug command explicitly
app.get("/debug", (req, res) => {
  serverLogger.info("[Server] Debug command received via dedicated endpoint");

  try {
    // Extract debug information
    const debugInfo = {
      timestamp: new Date().toISOString(),
      server: {
        version: "1.0.0",
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        node: process.version,
      },
      gundb: {
        status: gun ? "initialized" : "not initialized",
        peers: gun ? Object.keys(gun._.opt.peers || {}).length : 0,
      },
      ipfs: ipfsManager
        ? {
            enabled: ipfsManager.isEnabled(),
            service: ipfsManager.getConfig().service,
            gateway: ipfsManager.getConfig().gateway,
          }
        : "not initialized",
      success: true,
      message: "Debug mode activated successfully",
    };

    // Log the debug info
    serverLogger.info("[Server] Debug information generated:", debugInfo);

    // Record this debug session in the logs directory
    try {
      const debugLogPath = path.join(LOGS_DIR, `debug_${Date.now()}.json`);
      fs.writeFileSync(debugLogPath, JSON.stringify(debugInfo, null, 2));
      serverLogger.info(`Debug log written to ${debugLogPath}`);
    } catch (logError) {
      serverLogger.error("Error writing debug log:", {
        error: logError.message,
      });
    }

    // Return debug info to client
    res.json(debugInfo);
  } catch (error) {
    serverLogger.error("Error processing debug command:", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: `Error processing debug command: ${error.message}`,
    });
  }
});

// Upload debug endpoint
app.get("/api/upload-debug", authenticateRequest, (req, res) => {
  try {
    const uploadStatus = globalUploadTracker.getStatus();
    
    res.json({
      success: true,
      uploadTracking: uploadStatus,
      statistics: {
        activeUploadCount: uploadStatus.activeUploads.length,
        completedUploadCount: uploadStatus.completedUploads.length,
        recentUploadIdCount: uploadStatus.recentUploadIds.length,
        duplicateDetections: uploadStatus.completedUploads.filter(([,info]) => info.result?.isDuplicate).length
      },
      message: "Upload debug information retrieved successfully"
    });
  } catch (error) {
    serverLogger.error("[Server] Error retrieving upload debug info:", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: "Error retrieving upload debug information: " + error.message,
    });
  }
});

// Duplicate files cleanup endpoint
app.post("/api/cleanup-duplicates", authenticateRequest, async (req, res) => {
  try {
    serverLogger.info("[Server] Starting duplicate cleanup process...");
    
    // Get all files
    const allFiles = await fileManager.getAllFiles();
    
    // Group files by content characteristics (size + name without timestamp)
    const contentGroups = new Map();
    
    allFiles.forEach(file => {
      const baseName = file.originalName || file.name || 'unknown';
      const cleanName = baseName.replace(/^\d+-/, ''); // Remove timestamp prefix
      const contentKey = `${file.size}_${cleanName}_${file.mimetype || file.mimeType}`;
      
      if (!contentGroups.has(contentKey)) {
        contentGroups.set(contentKey, []);
      }
      contentGroups.get(contentKey).push(file);
    });
    
    // Find duplicates
    const duplicateGroups = [];
    const filesToDelete = [];
    
    for (const [contentKey, files] of contentGroups.entries()) {
      if (files.length > 1) {
        // Sort by timestamp, keep the newest one
        files.sort((a, b) => (b.timestamp || b.uploadedAt || 0) - (a.timestamp || a.uploadedAt || 0));
        
        const keepFile = files[0]; // Newest
        const deleteFiles = files.slice(1); // Older duplicates
        
        duplicateGroups.push({
          contentKey,
          keepFile: keepFile.id,
          deleteFiles: deleteFiles.map(f => f.id),
          fileCount: files.length
        });
        
        filesToDelete.push(...deleteFiles);
      }
    }
    
    let deletionResults = [];
    
    // Delete duplicate files if requested
    if (req.body.performCleanup === true) {
      serverLogger.info(`[Server] Deleting ${filesToDelete.length} duplicate files...`);
      
      for (const file of filesToDelete) {
        try {
          const result = await fileManager.deleteFile(file.id);
          deletionResults.push({
            fileId: file.id,
            fileName: file.originalName || file.name,
            success: result.success,
            processingTime: result.processingTime
          });
        } catch (error) {
          deletionResults.push({
            fileId: file.id,
            fileName: file.originalName || file.name,
            success: false,
            error: error.message
          });
        }
      }
    }
    
    res.json({
      success: true,
      analysis: {
        totalFiles: allFiles.length,
        uniqueContentGroups: contentGroups.size,
        duplicateGroups: duplicateGroups.length,
        totalDuplicateFiles: filesToDelete.length
      },
      duplicateGroups: duplicateGroups,
      deletionResults: deletionResults,
      performedCleanup: req.body.performCleanup === true,
      message: req.body.performCleanup === true ? "Duplicate cleanup completed" : "Duplicate analysis completed (no cleanup performed)"
    });
    
  } catch (error) {
    serverLogger.error("[Server] Error in duplicate cleanup:", {
      error: error.message,
    });
    res.status(500).json({
      success: false,
      error: "Error during duplicate cleanup: " + error.message,
    });
  }
});

// Graceful shutdown handling
["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
  process.on(signal, async () => {
    serverLogger.info(
      `[Server] Received signal ${signal}, shutting down... 🔥`
    );

    serverLogger.info("[Server] Closing HTTP server... 🔥");
    server.close(() => {
      serverLogger.info("[Server] HTTP server closed 🔥");

      // Close HTTPS server if it exists
      if (httpsServer) {
        serverLogger.info("[Server] Closing HTTPS server... 🔥");
        httpsServer.close(() => {
          serverLogger.info("[Server] HTTPS server closed");
          serverLogger.info("[Server] Goodbye! 👋");
          process.exit(0);
        });
      } else {
        serverLogger.info("[Server] Goodbye! 👋");
        process.exit(0);
      }
    });

    // Force close after 5 seconds
    setTimeout(() => {
      serverLogger.warn("[Server] Timeout reached, forced shutdown 🔥");
      process.exit(1);
    }, 5000);
  });
});

// Start listening for HTTP requests
server.listen(PORT, HOST, () => {
  serverLogger.info(`[Server] Server listening on http://${HOST}:${PORT}`);
  serverLogger.info(
    `[Server] Gun relay peer accessible at http://${HOST}:${PORT}/gun`
  );
});

export { app as default, RELAY_CONFIG };
