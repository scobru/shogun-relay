import dotenv from "dotenv";
dotenv.config();

import cors from "cors";
import fs from "fs";
import express from "express";
import { RelayVerifier } from "shogun-core";
import Gun from "gun";
import "gun/axe.js";
import "gun/lib/wire.js";
import "gun/lib/webrtc.js";
import path from "path";
import http from "http";
import https from "https";
import "./utils/bullet-catcher.js";
import {
  validateFileData,
  validateUploadResponse,
  validateConfig,
  isValidationEnabled,
  isStrictValidationEnabled,
} from "./utils/typeValidation.js";
import keccak from "keccak";

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
import { MerkleTree } from "merkletreejs";
import StorageLog from "./utils/storageLog.js";
import { MerkleManager } from "./utils/merkleUtils.js";

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
  console.log("Configuration loaded from config.json");

  // Validate the configuration using Mityli
  try {
    CONFIG = validateConfig(CONFIG);
    console.log("Configuration validated successfully with Mityli");
  } catch (validationError) {
    console.warn("Configuration validation warning:", validationError.message);
    console.warn("Continuing with unvalidated configuration");
  }
} catch (error) {
  console.error("Error loading config.json:", error.message);
  console.log("Using default configuration");
}

const app = express();
const server = http.createServer(app);
const PORT = CONFIG.PORT || 8765;
const HOST = CONFIG.HOST || "localhost";
const STORAGE_DIR = path.resolve("./uploads");
const SECRET_TOKEN = CONFIG.SECRET_TOKEN || "";
const LOGS_DIR = path.resolve("./logs");

// Declare global variables for important instances
// These will be initialized in startServer
let gun = null;
let shogunCore = null;
let relayVerifier = null;
let fileManager = null;
let ipfsManager = null;
let merkleManager;

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

console.log(RELAY_CONFIG);

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

// Fix the isValid function to properly handle authorization
let gunOptions = {
  web: server,
  peers: CONFIG.PEERS,
  file: "radata",
  radisk: true,
  localStorage: false,
  isValid: AuthenticationManager.isValidGunMessage.bind(AuthenticationManager),
};

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
      try {
        // Initialize the relay contracts using the utility function
        const relayContracts = await initializeRelayContracts(
          RELAY_CONFIG,
          shogunCoreInstance,
          signer
        );

        // Create a unified relay verifier using the contracts
        relayVerifier = createRelayVerifier(relayContracts);

        console.log("Relay verification components initialized successfully");
      } catch (error) {
        console.error(
          "Error initializing relay verification components:",
          error
        );
      }

      // Update relayVerifier in AuthenticationManager if we have one
      if (relayVerifier) {
        configure({ relayVerifier });
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
 * Starts the unified relay server
 * Initializes IPFS, configures middleware, and sets up WebSocket handlers
 * @returns {Promise<void>}
 */
async function startServer() {
  try {
    console.log("Starting unified relay server...");

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
    console.log("IpfsManager initialized.");

    // Initialize AuthenticationManager configuration first
    configure({
      SECRET_TOKEN,
      RELAY_CONFIG,
      relayVerifier: null, // Will be set after relayVerifier init by initializeRelayComponents
    });
    console.log("AuthenticationManager configured with initial settings.");

    // Initialize Gun with the options FIRST - before we use it for ShogunCore
    gun = Gun(gunOptions);
    console.log("GunDB initialized.");

    // Initialize StorageLog
    new StorageLog(Gun, gun);

    // Initialize ShogunCore and relay components
    console.log("Initializing ShogunCore with Gun instance");
    shogunCore = initializeShogunCore(gun, SECRET_TOKEN);

    const radataPath = path.resolve("./radata");
    console.log(`Using absolute radata path: ${radataPath}`);

    // Then initialize Merkle tree with radata path
    merkleManager = new MerkleManager(radataPath);
    await merkleManager.initialize();
    console.log("Merkle root:", merkleManager.getRoot());

    await initializeRelayComponents();
    console.log(
      "Relay initialized, AuthenticationManager updated with live verifiers."
    );

    // Initialize File Manager now that gun and ipfsManager are available
    fileManager = new ShogunFileManager({
      gun,
      ipfsManager,
      storagePath: STORAGE_DIR,
      maxFileSize: CONFIG.MAX_FILE_SIZE || "50mb",
    });
    console.log("File Manager initialized inside startServer.");

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
      "/messenger",
      express.static(path.join(__dirname, "src/ui/messenger/client.html"))
    );

    app.use(
      "/bugoff.js",
      express.static(path.join(__dirname, "src/ui/chat/bugoff.js"))
    );

    app.use(
      "/bugout.min.js",
      express.static(path.join(__dirname, "src/ui/chat/bugout.min.js"))
    );

    app.use(
      "/client",
      express.static(path.join(__dirname, "src/ui/chat/client.html"))
    );

    app.use(
      "/node",
      express.static(path.join(__dirname, "src/ui/chat/server.html"))
    );

    app.use(
      "/nodom.js",
      express.static(path.join(__dirname, "src/ui/dashboard/nodom.js"))
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
      express.static(path.join(__dirname, "src/ui/dashboard/nodom.css"), {
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
          console.log("[Server] Processing file upload request");

          // Check if there's actually a file to upload
          if (!req.file && (!req.body.content || !req.body.contentType)) {
            return res.status(400).json({
              success: false,
              error: "No file or content provided",
            });
          }

          // Set a timeout to prevent hanging uploads
          const uploadTimeout = setTimeout(() => {
            console.error("[Server] File upload processing timeout after 30s");
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
            console.log(
              "[Server] File data validated successfully with Mityli"
            );
          } catch (validationError) {
            console.error(
              "[Server] File data validation error:",
              validationError.message
            );
            // Continue without validation if it fails - for backward compatibility
          }

          // Clear the timeout since we completed successfully
          clearTimeout(uploadTimeout);

          console.log(
            `[Server] File upload completed successfully: ${fileData.id}`
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
          console.error("[Server] File upload error:", error);

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

        console.log(`Loading SSL private key from: ${privKeyPath}`);
        console.log(`Loading SSL certificate from: ${certPath}`);

        // Check if files exist
        if (!fs.existsSync(privKeyPath)) {
          throw new Error(`Private key file not found: ${privKeyPath}`);
        }

        if (!fs.existsSync(certPath)) {
          throw new Error(`Certificate file not found: ${certPath}`);
        }

        const sslOptions = {
          key: fs.readFileSync(privKeyPath),
          cert: fs.readFileSync(certPath),
        };

        httpsServer = https.createServer(sslOptions, app);

        // Start HTTPS server if SSL is configured
        const httpsPort = parseInt(CONFIG.HTTPS_PORT || "8443");
        httpsServer.listen(httpsPort, HOST, () => {
          console.log(`HTTPS server listening on https://${HOST}:${httpsPort}`);
        });

        console.log("SSL configuration loaded successfully");
      } catch (err) {
        console.error("Error loading SSL certificates:", err);
        console.error("HTTPS server will not be available");
        console.log(
          "To generate SSL certificates, run: node scripts/generate-ssl-certs.js"
        );
      }
    }
  } catch (error) {
    console.error("Error during server startup:", error);
    process.exit(1);
  }
}

startServer().catch((err) => {
  console.error("Critical error during startup:", err);
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
  console.log("MITYLI_TEST: Starting validation test");

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
  console.log("[Server] Processing validation config update request");

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
  } catch (error) {
    console.error("[Server] Error updating validation configuration:", error);
    res.status(500).json({
      success: false,
      error: "Error updating validation configuration: " + error.message,
    });
  }
});

// GunDB Test Endpoint
app.get("/api/test-gundb", (req, res) => {
  console.log(
    "GUNDB_TEST_ENDPOINT: Starting test at",
    new Date().toISOString()
  );

  // Generate a unique test key
  const testKey = `test_key_${Date.now()}`;
  console.log(`GUNDB_TEST_ENDPOINT: Using test key: ${testKey}`);

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
    console.log(`GUNDB_TEST_ENDPOINT: Attempting .put() with data:`, testData);

    // Set overall timeout for the entire test
    const testTimeout = setTimeout(() => {
      console.log(`GUNDB_TEST_ENDPOINT: Test timed out after 10s`);
      resolve(results);
    }, 10000);

    testNode.put(testData, (putAck) => {
      results.putCallbackFired = true;
      console.log(`GUNDB_TEST_ENDPOINT: .put() callback fired with:`, putAck);

      if (putAck.err) {
        console.error(`GUNDB_TEST_ENDPOINT: .put() failed:`, putAck.err);
        results.putError = putAck.err;
      } else {
        console.log(`GUNDB_TEST_ENDPOINT: .put() successful`);

        // Try to read back the data
        console.log(
          `GUNDB_TEST_ENDPOINT: Attempting .once() to read back data`
        );

        testNode.once((readData, readKey) => {
          results.onceCallbackFired = true;
          console.log(
            `GUNDB_TEST_ENDPOINT: .once() callback fired. Key: ${readKey}, Data:`,
            readData
          );

          results.retrievedData = readData;
          if (readData && readData.message === testData.message) {
            console.log(
              `GUNDB_TEST_ENDPOINT: Data read back matches put data!`
            );
            results.dataMatches = true;
          } else {
            console.error(
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
    console.log(`GUNDB_TEST_ENDPOINT: Test completed, results:`, results);
    res.json(results);
  });
});

// Endpoint per verificare la configurazione WebSocket
app.get("/check-websocket", authenticateRequest, (req, res) => {
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

// Serve la pagina di login html

// Endpoint to handle /debug command explicitly
app.post("/debug", (req, res) => {
  console.log("Debug command received via dedicated endpoint");

  // Log request info
  console.log("Debug request headers:", req.headers);
  console.log("Debug request body:", req.body);

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
    console.log(
      "Debug information generated:",
      JSON.stringify(debugInfo, null, 2)
    );

    // Record this debug session in the logs directory
    try {
      const debugLogPath = path.join(LOGS_DIR, `debug_${Date.now()}.json`);
      fs.writeFileSync(debugLogPath, JSON.stringify(debugInfo, null, 2));
      console.log(`Debug log written to ${debugLogPath}`);
    } catch (logError) {
      console.error("Error writing debug log:", logError);
    }

    // Return debug info to client
    res.json(debugInfo);
  } catch (error) {
    console.error("Error processing debug command:", error);
    res.status(500).json({
      success: false,
      error: `Error processing debug command: ${error.message}`,
    });
  }
});

// Graceful shutdown handling
["SIGINT", "SIGTERM", "SIGQUIT"].forEach((signal) => {
  process.on(signal, async () => {
    console.log(`\nReceived signal ${signal}, shutting down...`);

    console.log("Closing HTTP server...");
    server.close(() => {
      console.log("HTTP server closed");

      // Close HTTPS server if it exists
      if (httpsServer) {
        console.log("Closing HTTPS server...");
        httpsServer.close(() => {
          console.log("HTTPS server closed");
          console.log("Goodbye!");
          process.exit(0);
        });
      } else {
        console.log("Goodbye!");
        process.exit(0);
      }
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
  console.log(`Gun relay peer accessible at http://${HOST}:${PORT}/gun`);
});

export { app as default, RELAY_CONFIG };
