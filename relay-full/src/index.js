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

// Define allowedOrigins once
const allowedOrigins = CONFIG.ALLOWED_ORIGINS
  ? CONFIG.ALLOWED_ORIGINS.split(",")
  : getDefaultAllowedOrigins();

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
  return (
    msg && msg.headers && msg.headers.token && msg.headers.token === "automa25"
  );
}

// Helper functions to identify message types
function isAuthOperation(msg) {
  // Auth operations typically involve user credentials
  if (msg.put) {
    const keys = Object.keys(msg.put);

    // Check for user alias patterns (e.g., ~@_newman)
    for (const key of keys) {
      // User aliases start with ~@
      if (key.startsWith("~@")) {
        console.log("ALLOWING: Auth operation with user alias:", key);
        return true;
      }

      // Public keys in Gun often start with ~ or contain a dot
      if ((key.startsWith("~") || key.includes(".")) && msg.put[key]) {
        // Check for auth data
        const data = msg.put[key];
        if (data && (data.auth || data.alias || data.epub || data.pub)) {
          console.log("ALLOWING: Auth operation with credentials");
          return true;
        }

        // Check for auth-related properties that might indicate state transitions
        if (data && (data.sea || data._sea || data.$$)) {
          console.log("ALLOWING: Auth operation with sea/state data");
          return true;
        }
      }
    }
  }

  // Also check for specific auth-related patterns in the message itself
  if (
    msg.put &&
    msg["#"] &&
    (msg["#"].includes("auth") ||
      msg["#"].includes("user") ||
      msg["#"].includes("btc_"))
  ) {
    console.log("ALLOWING: Auth operation based on message ID pattern");
    return true;
  }

  return false;
}

function isInternalOperation(msg) {
  // Check for internal operations that don't need authentication
  if (msg.put) {
    // Messages with # properties are often system messages
    if (msg["#"] && msg["#"].startsWith("test_key_")) {
      return true; // Test keys are internal
    }

    // Check if this is a radisk/storage sync operation
    const keys = Object.keys(msg.put);
    for (const key of keys) {
      // System keys or collections
      if (key.startsWith("_") || key === "users") {
        return true;
      }

      // User public keys that aren't carrying credentials
      // but just usernames or metadata
      if (key.includes(".") && msg.put[key] && msg.put[key].username) {
        console.log("ALLOWING: User metadata update");
        return true;
      }

      // Bitcoin wallet operations
      if (
        key.includes("btc_") ||
        (msg.put[key] &&
          typeof msg.put[key] === "object" &&
          (msg.put[key].bitcoin ||
            (msg.put[key].alias && msg.put[key].alias.startsWith("btc_"))))
      ) {
        console.log("ALLOWING: Bitcoin wallet operation");
        return true;
      }
    }
  }

  return false;
}

Gun.on("opt", function (ctx) {
  if (ctx.once) {
    return;
  }

  // Check all incoming traffic
  ctx.on("in", function (msg) {
    const to = this.to;

    // Allow all operations that aren't PUTs
    if (!msg.put) {
      if (msg.get) {
        console.log(
          "GET operation:",
          JSON.stringify(msg.get).slice(0, 100) + "..."
        );
      }
      to.next(msg);
      return;
    }

    // For PUT operations, apply token validation logic
    if (hasValidToken(msg)) {
      console.log("WRITING - Valid token found");
      to.next(msg);
      return;
    }

    // Special case: Check for Bitcoin wallet or auth-related messages by content
    const msgStr = JSON.stringify(msg.put || {}).toLowerCase();
    if (
      msgStr.includes("btc_") ||
      msgStr.includes("bitcoin") ||
      msgStr.includes("auth") ||
      msgStr.includes("sea") ||
      msgStr.includes("state transition")
    ) {
      console.log(
        "WRITING - Bitcoin or auth-related operation detected by content"
      );
      to.next(msg);
      return;
    }

    // Allow auth operations without token
    if (isAuthOperation(msg)) {
      console.log("WRITING - Auth operation allowed without token");
      to.next(msg);
      return;
    }

    // Allow certain internal operations without token
    if (isInternalOperation(msg)) {
      console.log("WRITING - Internal operation allowed without token");
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
    });
    authLogger.info(
      "AuthenticationManager configured with initial settings. ✅"
    );

    // Initialize Gun first
    gun = Gun(gunOptions);
    gunLogger.info("GunDB initialized. ✅");

    // Add debug middleware after initialization
    Gun.on("opt", function (ctx) {
      if (ctx.once) return;
      ctx.on("in", function (msg) {
        debugGunMessages(msg);
        this.to.next(msg);
      });
    });

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
      storagePath: STORAGE_DIR,
      maxFileSize: CONFIG.MAX_FILE_SIZE || "50mb",
    });
    serverLogger.info("File Manager initialized inside startServer. ✅");

    // Setup API routes from modules
    const authRouter = setupAuthRoutes(
      gun,
      ensureShogunCoreInitialized,
      AuthenticationManager
    );
    app.use("/api/auth", authRouter); // THIS LINE SHOULD BE BEFORE app.use("/api", authenticateRequest)

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

    app.set("gun", gun);

    app.use(
      "/shogun-core.js",
      express.static(path.join(__dirname, "src/ui/messenger/shogun-core.js"))
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
        try {
          serverLogger.info("[Server] Processing file upload request 🚀");

          // Check if there's actually a file to upload
          if (!req.file && (!req.body.content || !req.body.contentType)) {
            return res.status(400).json({
              success: false,
              error: "No file or content provided",
            });
          }

          // Set a timeout to prevent hanging uploads
          const uploadTimeout = setTimeout(() => {
            serverLogger.error(
              "[Server] File upload processing timeout after 30s ❌"
            );
            if (!res.headersSent) {
              res.status(500).json({
                success: false,
                error: "Upload timed out",
              });
            }
          }, 30000); // 30 second timeout

          // Process the upload
          let fileData = await fileManager.handleFileUpload(req);

          // Validate the file data using Mityli
          try {
            fileData = validateFileData(fileData);
            serverLogger.info(
              "[Server] File data validated successfully with Mityli ✅"
            );
          } catch (validationError) {
            serverLogger.error("[Server] File data validation error:", {
              error: validationError.message,
            });
            // Continue without validation if it fails - for backward compatibility
          }

          // Clear the timeout since we completed successfully
          clearTimeout(uploadTimeout);

          serverLogger.info(
            `[Server] File upload completed successfully: ${fileData.id} ✅`
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
          };

          // Validate response with Mityli before sending
          const validatedResponse = validateUploadResponse(response);

          // Send response if not already sent
          if (!res.headersSent) {
            res.json(validatedResponse);
          }
        } catch (error) {
          serverLogger.error("[Server] File upload error: ❌", {
            error: error.message,
          });

          // Send error response if not already sent
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: "Error during upload: " + error.message,
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

      // Enable all origins in development mode
      if (CONFIG.NODE_ENV === "development") {
        return callback(null, true);
      }

      if (allowedOrigins.indexOf(origin) !== -1) {
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
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
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
  res.json({
    status: "online",
    timestamp: Date.now(),
    server: {
      version: "1.0.0",
      cors: allowedOrigins,
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
