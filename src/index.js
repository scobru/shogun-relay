import dotenv from "dotenv";
dotenv.config();

import cors from "cors";
import fs from "fs";
import express from "express";
import { RelayVerifier } from "shogun-core";
import Gun from "gun";
import path from "path";
import http from "http";
/* import "./utils/bullet-catcher.js";
 */

import "bullet-catcher";

import {
  AuthenticationManager,
  isKeyPreAuthorized,
  authorizeKey,
  configure,
} from "./managers/AuthenticationManager.js";
import ShogunIpfsManager from "./managers/IpfsManager.js";
import ShogunFileManager from "./managers/FileManager.js";
import setupAuthRoutes from "./routes/authRoutes.js"; // Import the new auth router setup function
import setupIpfsApiRoutes from "./routes/ipfsApiRoutes.js"; // Import the new IPFS router setup function
import setupRelayApiRoutes from "./routes/relayApiRoutes.js"; // Import the new relay router setup function
import setupGunDbRoutes from "./routes/gunDbRoutes.js"; // Import the new GunDB router setup function
import setupFileManagerRoutes from "./routes/fileManagerRoutes.js"; // Import the new File Manager router setup function
import {
  initializeShogunCore,
  getInitializedShogunCore,
  ensureShogunCoreInitialized,
  initializeRelayContracts,
  createRelayVerifier
} from "./utils/shogunCoreUtils.js"; // Import ShogunCore utility functions
import { setupGunIpfsMiddleware } from "./utils/gunIpfsUtils.js"; // Import Gun-IPFS middleware utility
// La funzione createUserToken è stata spostata in AuthenticationManager

// create __dirname
const __dirname = path.resolve();

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

// Declare global variables for important instances
// These will be initialized in startServer
let gun = null;
let shogunCore = null;
let relayVerifier = null;
let fileManager = null;
let ipfsManager = null;

// Initial configuration of RELAY_CONFIG - set once at the start
const RELAY_CONFIG = {
  relay: {
    registryAddress: process.env.RELAY_REGISTRY_CONTRACT,
    individualRelayAddress: process.env.INDIVIDUAL_RELAY,
    entryPointAddress: process.env.RELAY_ENTRY_POINT_CONTRACT,
    providerUrl: process.env.ETHEREUM_PROVIDER_URL,
    // Convert string 'true'/'false' to actual boolean
    onchainMembership: process.env.ONCHAIN_MEMBERSHIP_ENABLED === "true",
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

// Fix the isValid function to properly handle authorization
const gunOptions = {
  web: server,
  peers: ["http://localhost:8765/gun"],
  file: "radata",
  radisk: true,
  localStorage: false,
  isValid: AuthenticationManager.isValidGunMessage.bind(AuthenticationManager), // Corrected: Use .bind()
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
      try {
        // Initialize the relay contracts using the utility function
        const relayContracts = await initializeRelayContracts(RELAY_CONFIG, shogunCoreInstance, signer);
        
        // Create a unified relay verifier using the contracts
        relayVerifier = createRelayVerifier(relayContracts);
        
        console.log("Relay verification components initialized successfully");
      } catch (error) {
        console.error("Error initializing relay verification components:", error);
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
      JWT_SECRET,
      authorizedKeys,
      AUTH_KEY_EXPIRY,
      RELAY_CONFIG,
      relayVerifier: null, // Will be set later after initialization
      allowedOrigins,
    });

    // Initialize IpfsManager
    ipfsManager = new ShogunIpfsManager({
      enabled: process.env.IPFS_ENABLED === "true" || false,
      service: process.env.IPFS_SERVICE || "IPFS-CLIENT",
      nodeUrl: process.env.IPFS_NODE_URL || "http://127.0.0.1:5001",
      gateway: process.env.IPFS_GATEWAY || "http://127.0.0.1:8080/ipfs",
      pinataGateway:
        process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud",
      pinataJwt: process.env.PINATA_JWT || "",
      encryptionEnabled: process.env.ENCRYPTION_ENABLED === "true" || false,
      encryptionKey: process.env.ENCRYPTION_KEY || "",
      encryptionAlgorithm: process.env.ENCRYPTION_ALGORITHM || "aes-256-gcm",
      apiKey: SECRET_TOKEN,
    });
    console.log("IpfsManager initialized.");

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

    // Initialize Gun with the options FIRST - before we use it for ShogunCore
    gun = Gun(gunOptions);
    console.log("GunDB initialized.");

    // Initialize ShogunCore and relay components
    console.log("Initializing ShogunCore with Gun instance");
    shogunCore = initializeShogunCore(gun, SECRET_TOKEN);
    console.log("ShogunCore initialized successfully.");

    await initializeRelayComponents();
    console.log(
      "Relay initialized, AuthenticationManager updated with live verifiers."
    );

    // Initialize File Manager now that gun and ipfsManager are available
    fileManager = new ShogunFileManager({
      gun,
      ipfsManager,
      storagePath: STORAGE_DIR,
      maxFileSize: process.env.MAX_FILE_SIZE || "50mb",
    });
    console.log("File Manager initialized inside startServer.");

    // Setup API routes from modules
    const authRouter = setupAuthRoutes(
      gun,
      JWT_SECRET,
      AuthenticationManager,
      getInitializedShogunCore,
      authenticateRequest
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

    // Set up GunDB routes
    const gunDbRouter = setupGunDbRoutes(gun, authenticateRequest);
    app.use("/api/gundb", gunDbRouter);

    // Set up file manager routes
    const fileManagerRouter = setupFileManagerRoutes(
      fileManager,
      authenticateRequest
    );
    app.use("/files", fileManagerRouter);
    // Set up the upload route separately
    app.post(
      "/upload",
      authenticateRequest,
      fileManager.getUploadMiddleware().single("file"),
      async (req, res) => {
        try {
          const fileData = await fileManager.handleFileUpload(req);
          res.json({
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
          });
        } catch (error) {
          console.error("File upload error:", error);
          res.status(500).json({
            success: false,
            error: "Error during upload: " + error.message,
          });
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

    // ... rest of startServer implementation...
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
  res.sendFile(path.join(__dirname, "src/ui/index.html"));
});

// Serve la pagina di login html
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "src/ui/login.html"));
});

// Serve la pagina per generare key pair
app.get("/keypair", (req, res) => {
  res.sendFile(path.join(__dirname, "src/ui/keypair.html"));
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
  console.log(`Gun relay peer accessible at http://${HOST}:${PORT}/gun`);
  
  // Force a test write to GunDB to verify disk persistence is working
  try {
    const testData = {
      message: "Server startup test data",
      timestamp: Date.now(),
      server: `${HOST}:${PORT}`
    };
    
    // Add headers for authentication
    if (!gun._.opt.headers) {
      gun._.opt.headers = {};
    }
    gun._.opt.headers.token = SECRET_TOKEN;
    gun._.opt.headers.Authorization = `Bearer ${SECRET_TOKEN}`;
    
    // Perform write test
    gun.get("server-test").put(testData, (ack) => {
      if (ack.err) {
        console.error("GunDB write test failed:", ack.err);
      } else {
        console.log("GunDB write test successful:", testData);
      }
    });
    
    // Also try a user write if we have a key pair
    if (RELAY_CONFIG.keyPair) {
      const appUser = gun.user();
      if (appUser.is) {
        appUser.get("server-test").put({
          message: "Server startup user-authenticated test",
          timestamp: Date.now()
        }, (ack) => {
          if (ack.err) {
            console.error("GunDB user write test failed:", ack.err);
          } else {
            console.log("GunDB user write test successful");
          }
        });
      }
    }
  } catch (error) {
    console.error("Error running GunDB persistence test:", error);
  }
});

export { app as default, authorizeKey, isKeyPreAuthorized, RELAY_CONFIG };
