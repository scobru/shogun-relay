import dotenv from "dotenv";
dotenv.config();



import cors from "cors";
import multer from "multer";
import fs from "fs";
import express from "express";
import { ShogunIpfs } from "shogun-ipfs";
import {
  ShogunCore,
  RelayMembershipVerifier,
  DIDVerifier,
  OracleBridge,
} from "shogun-core";
import Gun from "gun";
import path from "path";
import "bullet-catcher";
import crypto from "crypto";
import http from "http";
import https from "https";

// Import the utility functions
import { gunPubKeyToHex } from "./utils.js";

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 8765;
const STORAGE_DIR = path.resolve("./uploads");
const SECRET_TOKEN = process.env.API_SECRET_TOKEN || "thisIsTheTokenForReals";
const LOGS_DIR = path.resolve("./logs");

const gunOptions = {
  web: server,
  file: "radata",
  radisk: true,
  localStorage: false,
  isValid: hasValidToken,
};

// Check if we're in a development environment
const isDevMode = process.env.NODE_ENV === 'development';

// Relay components configuration
const RELAY_CONFIG = {
  relayMembership: {
    enabled: process.env.RELAY_MEMBERSHIP_ENABLED === "true" || false,
    contractAddress: process.env.RELAY_MEMBERSHIP_CONTRACT || "",
    providerUrl: process.env.ETHEREUM_PROVIDER_URL || "http://localhost:8545",
    onchainMembership:
      process.env.ONCHAIN_MEMBERSHIP_ENABLED === "true" || false,
  },
  didVerifier: {
    enabled: process.env.DID_VERIFIER_ENABLED === "true" || false,
    contractAddress: process.env.DID_REGISTRY_CONTRACT || "",
    providerUrl: process.env.ETHEREUM_PROVIDER_URL || "http://localhost:8545",
  },
  oracleBridge: {
    enabled: process.env.ORACLE_BRIDGE_ENABLED === "true" || false,
    contractAddress: process.env.ORACLE_BRIDGE_CONTRACT || "",
    providerUrl: process.env.ETHEREUM_PROVIDER_URL || "http://localhost:8545",
  },
  heartbeat: {
    enabled: process.env.HEARTBEAT_ENABLED === "true" || false,
    // Use a shorter interval in development mode for faster testing
    interval: isDevMode ? 10 * 1000 : parseInt(process.env.HEARTBEAT_INTERVAL || "3600", 10) * 1000, // Default 1 hour in ms, 10 seconds in dev
    oracleBridgeContract: process.env.ORACLE_BRIDGE_CONTRACT || "",
    membershipContract: process.env.RELAY_MEMBERSHIP_CONTRACT || "",
    providerUrl: process.env.ETHEREUM_PROVIDER_URL || "http://localhost:8545",
  },
};

// Relay component instances
let relayMembershipVerifier = null;
let didVerifier = null;
let oracleBridge = null;

// CORS Configuration
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
  ];
};

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : getDefaultAllowedOrigins();

// Configure CORS
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

/**
 * Log errors to file and console
 * @param {string} message - Error description
 * @param {Error} error - Error object
 */
function logError(message, error) {
  const timestamp = new Date().toISOString();
  const errorLog = `[${timestamp}] ${message}: ${error.message}\n${
    error.stack || ""
  }\n\n`;

  try {
    fs.appendFileSync(path.join(LOGS_DIR, "error.log"), errorLog);
  } catch (logError) {
    console.error("Error writing to log file:", logError);
  }

  console.error(`[${timestamp}] ${message}:`, error);
}

// IPFS Configuration with in-memory state
let IPFS_CONFIG = {
  enabled: process.env.IPFS_ENABLED === "true" || false,
  service: process.env.IPFS_SERVICE || "IPFS-CLIENT",
  nodeUrl: process.env.IPFS_NODE_URL || "http://127.0.0.1:5001",
  gateway: process.env.IPFS_GATEWAY || "http://127.0.0.1:8080/ipfs",
  pinataGateway: process.env.PINATA_GATEWAY || "https://gateway.pinata.cloud",
  pinataJwt: process.env.PINATA_JWT || "",
  encryptionEnabled: process.env.ENCRYPTION_ENABLED === "true" || false,
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  encryptionAlgorithm: process.env.ENCRYPTION_ALGORITHM || "aes-256-gcm",
};

// Initialize ShogunIpfs
let shogunIpfs;

/**
 * Initialize IPFS with the current configuration
 * @returns {Object|null} IPFS instance or null if initialization failed
 */
function initializeIpfs() {
  if (!IPFS_CONFIG.enabled) {
    console.log("IPFS not enabled, initialization skipped");
    return null;
  }

  try {
    console.log("Initializing IPFS with configuration:", {
      service: IPFS_CONFIG.service,
      nodeUrl: IPFS_CONFIG.nodeUrl,
      gateway: IPFS_CONFIG.gateway,
      hasCredentials:
        IPFS_CONFIG.service === "PINATA" &&
        IPFS_CONFIG.pinataJwt &&
        IPFS_CONFIG.pinataJwt.length > 10,
    });

    // Configuration according to documentation
    const ipfsConfig = {
      storage: {
        service: IPFS_CONFIG.service || "IPFS-CLIENT", // Ensure service always has a value
        config: {
          url: IPFS_CONFIG.nodeUrl,
          apiKey: SECRET_TOKEN, // Pass secret token as apiKey
        },
      },
    };

    // Configure based on chosen service
    if (IPFS_CONFIG.service === "PINATA") {
      if (!IPFS_CONFIG.pinataJwt || IPFS_CONFIG.pinataJwt.length < 10) {
        throw new Error("JWT Pinata missing or invalid");
      }

      ipfsConfig.storage.config = {
        pinataJwt: IPFS_CONFIG.pinataJwt,
        pinataGateway: IPFS_CONFIG.pinataGateway,
      };
      console.log("Configured IPFS with Pinata service");
    } else if (IPFS_CONFIG.service === "IPFS-CLIENT") {
      ipfsConfig.storage.config = {
        url: IPFS_CONFIG.nodeUrl,
        apiKey: SECRET_TOKEN, // Pass secret token as apiKey
      };
      console.log(
        "Configured IPFS with IPFS-CLIENT, URL:",
        IPFS_CONFIG.nodeUrl
      );
    } else {
      throw new Error(`IPFS service not supported: ${IPFS_CONFIG.service}`);
    }

    // Verify ShogunIpfs is defined
    if (typeof ShogunIpfs !== "function") {
      throw new Error("ShogunIpfs not available, check module import");
    }

    // Create IPFS instance
    const ipfsInstance = new ShogunIpfs(ipfsConfig.storage);

    // Verify instance is valid
    if (!ipfsInstance || typeof ipfsInstance.uploadJson !== "function") {
      throw new Error("ShogunIpfs instance does not have uploadJson method");
    }

    // Add pin/unpin methods if they don't exist
    if (!ipfsInstance.pin) {
      console.log("pin method not found, added fallback");
      ipfsInstance.pin = async (hash) => {
        if (
          ipfsInstance.getStorage &&
          typeof ipfsInstance.getStorage === "function"
        ) {
          const storage = ipfsInstance.getStorage();
          if (storage && typeof storage.pin === "function") {
            return storage.pin(hash);
          }
        }
        console.warn(
          "IPFS library method pin not supported, returning simulated success"
        );
        return { success: true, simulated: true };
      };
    }

    if (!ipfsInstance.unpin) {
      console.log("unpin method not found, added fallback");
      ipfsInstance.unpin = async (hash) => {
        if (
          ipfsInstance.getStorage &&
          typeof ipfsInstance.getStorage === "function"
        ) {
          const storage = ipfsInstance.getStorage();
          if (storage && typeof storage.unpin === "function") {
            return storage.unpin(hash);
          }
        }
        console.warn(
          "IPFS library method unpin not supported, returning simulated success"
        );
        return { success: true, simulated: true };
      };
    }

    if (!ipfsInstance.isPinned) {
      console.log("isPinned method not found, added fallback");
      ipfsInstance.isPinned = async (hash) => {
        if (
          ipfsInstance.getStorage &&
          typeof ipfsInstance.getStorage === "function"
        ) {
          const storage = ipfsInstance.getStorage();
          if (storage && typeof storage.isPinned === "function") {
            return storage.isPinned(hash);
          }
        }

        try {
          // Try to verify if the file is pinned
          if (
            typeof ipfsInstance.pin === "function" &&
            typeof ipfsInstance.pin.ls === "function"
          ) {
            const pins = await ipfsInstance.pin.ls({ paths: [hash] });
            let found = false;

            // Convert to array if needed
            if (pins && pins.length) {
              for (const pin of pins) {
                if (pin.cid && pin.cid.toString() === hash) {
                  found = true;
                  break;
                }
              }
            }

            return found;
          } else {
            console.warn(
              "IPFS library method pin.ls not supported, returning false"
            );
            return false;
          }
        } catch (error) {
          // If the error contains "not pinned", it means the file is simply not pinned
          if (error.message && error.message.includes("not pinned")) {
            console.log(
              `File ${hash} not pinned, normal error:`,
              error.message
            );
            return false;
          }

          console.warn(
            `Error during pin verification for ${hash}:`,
            error.message
          );
          return false;
        }
      };
    }

    // Verify connection if possible
    if (typeof ipfsInstance.isConnected === "function") {
      ipfsInstance
        .isConnected()
        .then((connected) => {
          console.log(
            `IPFS connection verified: ${connected ? "OK" : "Failed"}`
          );
        })
        .catch((err) => {
          console.warn("Unable to verify IPFS connection:", err.message);
        });
    }

    console.log("ShogunIpfs initialized successfully");
    return ipfsInstance;
  } catch (error) {
    console.error("IPFS initialization error:", error);
    console.error("Error details:", error.message);

    // Disable IPFS in case of initialization error
    IPFS_CONFIG.enabled = false;
    return null;
  }
}

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
let upload;

/**
 * Configure Multer based on IPFS availability
 */
function configureMulter() {
  console.log(
    `Configuring Multer - IPFS ${IPFS_CONFIG.enabled ? "enabled" : "disabled"}`
  );

  if (IPFS_CONFIG.enabled) {
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
function generateSecureToken(length = 32) {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * Creates a new API token for a user
 * @param {string} userId - The user ID
 * @param {string} tokenName - A name/label for the token
 * @param {Date|null} expiresAt - Optional expiration date
 * @returns {Promise<object>} The created token information
 */
async function createUserToken(userId, tokenName, expiresAt = null) {
  return new Promise((resolve, reject) => {
    if (!userId) {
      reject(new Error("User ID is required"));
      return;
    }

    const tokenValue = generateSecureToken();
    const tokenId = generateSecureToken(16);

    const tokenData = {
      id: tokenId,
      token: tokenValue,
      name: tokenName || "API Token",
      userId: userId,
      createdAt: Date.now(),
      expiresAt: expiresAt ? expiresAt.getTime() : null,
      lastUsed: null,
      revoked: false,
    };

    // Store in GunDB under users/[userId]/tokens/[tokenId]
    gun
      .get("users")
      .get(userId)
      .get("tokens")
      .get(tokenId)
      .put(tokenData, (ack) => {
        if (ack.err) {
          reject(new Error("Failed to store token: " + ack.err));
        } else {
          // Also store in a token index for quick lookup
          gun
            .get("tokenIndex")
            .get(tokenValue)
            .put(
              {
                userId: userId,
                tokenId: tokenId,
              },
              (indexAck) => {
                if (indexAck.err) {
                  console.warn("Failed to index token: " + indexAck.err);
                }
                resolve(tokenData);
              }
            );
        }
      });
  });
}

/**
 * Validates a user token
 * @param {string} token - The token to validate
 * @returns {Promise<object|null>} User info if token is valid, null otherwise
 */
async function validateUserToken(token) {
  return new Promise((resolve) => {
    // First check the master token for admin/system operations
    if (token === SECRET_TOKEN) {
      resolve({
        valid: true,
        isSystemToken: true,
        userId: "system",
        permissions: ["admin"],
      });
      return;
    }

    // Look up the token in the index
    gun
      .get("tokenIndex")
      .get(token)
      .once(async (indexData) => {
        if (!indexData || !indexData.userId || !indexData.tokenId) {
          resolve(null);
          return;
        }

        const userId = indexData.userId;
        const tokenId = indexData.tokenId;

        // Get the full token data
        gun
          .get("users")
          .get(userId)
          .get("tokens")
          .get(tokenId)
          .once((tokenData) => {
            if (!tokenData || tokenData.revoked) {
              resolve(null);
              return;
            }

            // Check expiration
            if (tokenData.expiresAt && Date.now() > tokenData.expiresAt) {
              resolve(null);
              return;
            }

            // Update last used timestamp
            gun
              .get("users")
              .get(userId)
              .get("tokens")
              .get(tokenId)
              .get("lastUsed")
              .put(Date.now());

            // Get user's permissions - now from the Gun user object's profile
            gun
              .user(userId)
              .get("profile")
              .get("permissions")
              .once((permissions) => {
                resolve({
                  valid: true,
                  isSystemToken: false,
                  userId: userId,
                  tokenId: tokenId,
                  permissions: permissions || ["user"],
                });
              });
          });
      });

    // Set a timeout in case Gun doesn't respond
    setTimeout(() => {
      resolve(null);
    }, 3000);
  });
}

/**
 * Revokes a user token
 * @param {string} userId - The user ID
 * @param {string} tokenId - The token ID
 * @returns {Promise<boolean>} True if revoked successfully
 */
async function revokeUserToken(userId, tokenId) {
  return new Promise((resolve) => {
    gun
      .get("users")
      .get(userId)
      .get("tokens")
      .get(tokenId)
      .get("revoked")
      .put(true, (ack) => {
        resolve(!ack.err);
      });

    // Set a timeout in case Gun doesn't respond
    setTimeout(() => {
      resolve(false);
    }, 3000);
  });
}

/**
 * Lists all tokens for a user
 * @param {string} userId - The user ID
 * @returns {Promise<Array>} List of tokens
 */
async function listUserTokens(userId) {
  return new Promise((resolve) => {
    const tokens = [];

    gun
      .get("users")
      .get(userId)
      .get("tokens")
      .map()
      .once((token, tokenId) => {
        if (tokenId !== "_" && token) {
          // Don't include the actual token value in the response
          const safeToken = { ...token };
          if (safeToken.token) {
            // Only show first/last few characters
            safeToken.token =
              safeToken.token.substring(0, 4) +
              "..." +
              safeToken.token.substring(safeToken.token.length - 4);
          }
          tokens.push(safeToken);
        }
      });

    // Resolve after giving Gun time to respond
    setTimeout(() => {
      resolve(tokens);
    }, 2000);
  });
}

/**
 * Helper function to extract token from various request sources
 * @param {Object} req - Express request object
 * @returns {string|null} The extracted token or null
 */
function getTokenFromRequest(req) {
  // Check various places where token might be present
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token;
  const bodyToken = req.body && req.body.token;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7); // Remove 'Bearer ' from token
  } else if (authHeader) {
    return authHeader; // Token might be directly in header
  }

  return queryToken || bodyToken;
}

/**
 * Enhanced token validation middleware that supports both system and user tokens
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
const authenticateRequest = async (req, res, next) => {
  // Skip authentication for OPTIONS preflight requests
  if (req.method === "OPTIONS") {
    return next();
  }

  // Extract token from request
  const token = getTokenFromRequest(req);

  if (!token) {
    console.warn("Request rejected: token missing", req.path);
    return res.status(401).json({
      success: false,
      error: "Authentication required. Token missing.",
    });
  }

  // Verify token - now supporting both system and user tokens
  try {
    const tokenData = await validateUserToken(token);

    if (!tokenData) {
      console.warn("Request rejected: invalid token", req.path);
      return res.status(403).json({
        success: false,
        error: "Invalid token.",
      });
    }

    // Store user info in request for use in route handlers
    req.auth = tokenData;

    // Valid token, proceed
    next();
  } catch (error) {
    console.error("Authentication error:", error);
    return res.status(500).json({
      success: false,
      error: "Authentication error.",
    });
  }
};

// Modify the original hasValidToken function to use our new validation system
async function hasValidToken(msg) {
  console.log(`[hasValidToken] Current NODE_ENV: ${process.env.NODE_ENV}`);
  if (process.env.NODE_ENV === "development") {
    console.log(
      "[hasValidToken] Development mode: Bypassing token validation via NODE_ENV."
    );
    return true;
  }

  // Check if we're in a websocket context
  const isWebSocket = msg && msg._ && msg._.via && msg._.via.wire;

  if (isWebSocket) {
    console.log(
      "[hasValidToken] WebSocket message detected based on msg._.via.wire."
    );

    // If a token is present in headers, validate it
    if (msg.headers && msg.headers.token) {
      const token = msg.headers.token;
      const tokenData = await validateUserToken(token);

      const isValid = !!tokenData;
      console.log(
        "[hasValidToken] WebSocket message with header token, validation:",
        isValid
      );
      return isValid;
    }


    // Check for on-chain membership verification if enabled
    if (
      RELAY_CONFIG.relayMembership.enabled &&
      RELAY_CONFIG.relayMembership.onchainMembership &&
      relayMembershipVerifier
    ) {
      try {
        // Extract the sender's public key from the message
        // GunDB message format may include user credentials or pub
        let pubKey = null;

        // First check if this is an authenticated user message with pub
        if (msg.put && msg.put.auth && msg.put.auth.pub) {
          pubKey = msg.put.auth.pub;
          console.log(
            `[hasValidToken] Found authenticated message with pub: ${pubKey.substring(
              0,
              10
            )}...`
          );
        }
        // Check if message contains user object with pub
        else if (msg.user && msg.user.pub) {
          pubKey = msg.user.pub;
          console.log(
            `[hasValidToken] Found user message with pub: ${pubKey.substring(
              0,
              10
            )}...`
          );
        }
        // Check if message is from a specific user
        else if (msg.from && msg.from.pub) {
          pubKey = msg.from.pub;
          console.log(
            `[hasValidToken] Found message from user with pub: ${pubKey.substring(
              0,
              10
            )}...`
          );
        }
        // Alternative formats
        else if (msg.pub) {
          pubKey = msg.pub;
          console.log(
            `[hasValidToken] Found direct pub in message: ${pubKey.substring(
              0,
              10
            )}...`
          );
        }
        // Check if pubKey is in the put object keys (like in SEA auth messages)
        else if (msg.put && typeof msg.put === 'object') {
          // Loop through the keys of the put object to find ones that start with ~
          const putKeys = Object.keys(msg.put);
          for (const key of putKeys) {
            if (key.startsWith('~')) {
              // Extract the pubKey (everything after ~ until the first . if present)
              const dotIndex = key.indexOf('.');
              pubKey = dotIndex > 0 ? key.substring(1, dotIndex) : key.substring(1);
              console.log(
                `[hasValidToken] Found pubKey in put object key: ${pubKey.substring(
                  0,
                  10
                )}...`
              );
              break;
            }
          }
        }

        if (pubKey) {
          // Convert the GunDB public key to hex format for Ethereum
          const hexPubKey = gunPubKeyToHex(pubKey);
          
          if (hexPubKey) {
            console.log(`[hasValidToken] Converted pubKey to hex format: 0x${hexPubKey.substring(0, 20)}...`);
            
            const isAuthorized = await relayMembershipVerifier.isPublicKeyAuthorized(hexPubKey);

            if (isAuthorized) {
              console.log(
                `[hasValidToken] Public key ${pubKey.substring(
                  0,
                  10
                )}... is authorized on-chain`
              );
              return true;
            } else {
              console.log(
                `[hasValidToken] Public key ${pubKey.substring(
                  0,
                  10
                )}... is NOT authorized on-chain`
              );
              // Continue with other validation methods if on-chain check fails
            }
          } else {
            console.log(
              "[hasValidToken] Failed to convert public key to hex format"
            );
          }
        } else {
          console.log(
            "[hasValidToken] No public key found in message, skipping on-chain verification"
          );
        }
      } catch (error) {
        console.error(
          "[hasValidToken] Error during on-chain verification:",
          error.message
        );
        // Continue with other validation methods if on-chain check encounters an error
      }
    }

    console.log(
      "[hasValidToken] WebSocket message, assuming authenticated by upgrade"
    );
    return true;
  }

  // For regular HTTP requests or other message types
  console.log(
    "[hasValidToken] Non-WebSocket message or unidentifiable type. Validating as HTTP-like"
  );

  if (msg && msg.headers && msg.headers.token) {
    const tokenData = await validateUserToken(msg.headers.token);
    const isValid = !!tokenData;

    console.log(
      "[hasValidToken] Token validation result for non-WebSocket/HTTP-like:",
      isValid
    );
    return isValid;
  }

  return false;
}

// API - FILES LIST (must be defined before app.use("/files", authenticateRequest))
app.get("/files/all", authenticateRequest, async (req, res) => {
  try {
    const files = [];
    const seen = new Set();

    console.log("Request received for all files");

    // Set a timeout to ensure a response even if Gun is slow
    const timeout = setTimeout(() => {
      console.log(
        `Timeout reached after 3 seconds. Returning ${files.length} files`
      );
      res.json({
        success: true,
        results: files,
        message: "File list retrieved successfully (timeout reached)",
      });
    }, 3000);

    // Create a Promise to make async the data collection from Gun
    await new Promise((resolve) => {
      // Retrieve files from GunDB
      gun
        .get("files")
        .map()
        .once((data, key) => {
          if (key !== "_" && !seen.has(key) && data) {
            seen.add(key);

            console.log(
              `File found in GunDB: ${key}, name: ${data.name || "unnamed"}`
            );

            // Ensure all necessary fields are present
            const fileData = {
              id: key,
              name: data.name || "Unnamed file",
              originalName: data.originalName || data.name || "Unnamed file",
              mimetype:
                data.mimeType || data.mimetype || "application/octet-stream",
              size: data.size || 0,
              fileUrl: data.url || data.fileUrl || "",
              ipfsHash: data.ipfsHash || null,
              ipfsUrl: data.ipfsHash
                ? `${IPFS_CONFIG.gateway}/${data.ipfsHash}`
                : null,
              uploadedAt: data.timestamp || data.uploadedAt || Date.now(),
              customName: data.customName || null,
            };

            files.push(fileData);
          }
        });

      // Conclude Promise after a short period to give Gun time to respond
      setTimeout(() => {
        console.log(`Collected ${files.length} files from GunDB`);
        resolve();
      }, 1000);
    });

    // Cancel timeout if we've finished collection
    clearTimeout(timeout);

    console.log(`Returning ${files.length} files`);
    res.json({
      success: true,
      results: files,
      message: "File list successfully retrieved",
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

// Apply authentication to protected routes
app.use("/api", authenticateRequest);
app.use("/upload", authenticateRequest);
app.use("/files", authenticateRequest);

// API - UPLOAD FILE
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file && (!req.body.content || !req.body.contentType)) {
    return res.status(400).json({
      success: false,
      error: "File or content missing",
    });
  }

  try {
    let gunDbKey, fileBuffer, originalName, mimeType, fileSize;

    if (req.file) {
      originalName = req.file.originalname;
      mimeType = req.file.mimetype;
      fileSize = req.file.size;
      gunDbKey = req.body.customName || originalName.replace(/[.\/\\]/g, "_");

      // Check if file was uploaded to memory or disk
      if (req.file.buffer) {
        // multer.memoryStorage() - file is in memory
        fileBuffer = req.file.buffer;
      } else if (req.file.path) {
        // multer.diskStorage() - file is on disk
        fileBuffer = fs.readFileSync(req.file.path);
      } else {
        throw new Error("Unable to read uploaded file");
      }
    } else {
      const content = req.body.content;
      const contentType = req.body.contentType || "text/plain";
      originalName = req.body.customName || `text-${Date.now()}.txt`;
      gunDbKey = req.body.customName || `text-${Date.now()}`;
      mimeType = contentType;
      fileSize = content.length;
      fileBuffer = Buffer.from(content);
    }

    if (!fileBuffer) {
      throw new Error("File buffer not available");
    }

    let fileUrl = null;
    let ipfsHash = null;

    // If IPFS is enabled, upload to IPFS
    if (IPFS_CONFIG.enabled && shogunIpfs) {
      try {
        console.log(
          `Attempting upload to IPFS for file: ${originalName}, size: ${fileSize} bytes, type: ${mimeType}`
        );

        if (!fileBuffer || fileBuffer.length === 0) {
          throw new Error("Empty or invalid file buffer");
        }

        let result;

        // Use the correct method based on file type
        if (mimeType.startsWith("text/") || mimeType === "application/json") {
          // For text or JSON files, we can use uploadJson
          const textContent = fileBuffer.toString("utf-8");

          // Check if it's valid JSON
          let jsonData;
          try {
            jsonData = JSON.parse(textContent);
          } catch (e) {
            // If not valid JSON, treat as normal text
            jsonData = { content: textContent, filename: originalName };
          }

          result = await shogunIpfs.uploadJson(jsonData, {
            name: originalName,
            metadata: {
              size: fileSize,
              type: mimeType,
              customName: req.body.customName || null,
            },
          });
        } else {
          // For binary files (images, videos, etc.) use uploadFile directly
          // Create a temporary file
          const tempFilePath = path.join(
            STORAGE_DIR,
            `temp_${Date.now()}_${originalName}`
          );
          fs.writeFileSync(tempFilePath, fileBuffer);

          result = await shogunIpfs.uploadFile(tempFilePath, {
            name: originalName,
            metadata: {
              size: fileSize,
              type: mimeType,
              customName: req.body.customName || null,
            },
          });

          // Remove temporary file
          try {
            fs.unlinkSync(tempFilePath);
          } catch (e) {
            /* ignore errors */
          }
        }

        if (result && result.id) {
          fileUrl = `${IPFS_CONFIG.gateway}/${result.id}`;
          ipfsHash = result.id;
          console.log(`File uploaded to IPFS successfully. CID: ${result.id}`);
        } else {
          throw new Error("Upload IPFS completed but ID not received");
        }
      } catch (ipfsError) {
        console.error("Error during IPFS upload:", ipfsError);
        console.error(
          "Error details:",
          JSON.stringify(ipfsError.message || ipfsError)
        );
        // Fallback to local upload will happen automatically
      }
    }

    // Fallback to local storage
    if (!fileUrl) {
      console.log(
        `IPFS upload failed or not configured, using local storage for: ${originalName}`
      );
      const fileName = `${Date.now()}-${originalName}`;
      const localPath = path.join(STORAGE_DIR, fileName);
      fs.writeFileSync(localPath, fileBuffer);
      fileUrl = `/uploads/${fileName}`;
      console.log(`File saved locally successfully: ${localPath}`);
    }

    const fileData = {
      id: gunDbKey,
      name: originalName,
      originalName: originalName,
      mimeType: mimeType,
      mimetype: mimeType,
      size: fileSize,
      url: fileUrl,
      fileUrl: fileUrl,
      ipfsHash: ipfsHash || null,
      ipfsUrl: ipfsHash ? `${IPFS_CONFIG.gateway}/${ipfsHash}` : null,
      timestamp: Date.now(),
      uploadedAt: Date.now(),
      customName: req.body.customName || null,
    };

    // Save reference in GunDB
    console.log(
      `[UPLOAD ENDPOINT] Preparing to save to GunDB. Key: ${gunDbKey}, IPFS Enabled: ${IPFS_CONFIG.enabled}`
    );
    console.log(
      "[UPLOAD ENDPOINT] fileData being put:",
      JSON.stringify(fileData, null, 2)
    ); // Log the exact object

    await new Promise((resolve, reject) => {
      // Use a Promise to handle Gun callback
      gun
        .get("files")
        .get(gunDbKey)
        .put(fileData, (ack) => {
          if (ack.err) {
            console.error("[UPLOAD ENDPOINT] Error saving to GunDB:", ack.err);
            reject(new Error("Error saving to GunDB: " + ack.err));
          } else {
            console.log(
              "[UPLOAD ENDPOINT] File saved successfully to GunDB. ACK:",
              ack
            );
            resolve();
          }
        });

      // Add a timeout in case Gun doesn't respond
      setTimeout(resolve, 1000);
    });

    // Verify that the file was saved correctly
    let savedData = null;
    try {
      await new Promise((resolve) => {
        gun
          .get("files")
          .get(gunDbKey)
          .once((data) => {
            if (data) {
              savedData = data;
              console.log("Save verification: file found in GunDB");
            } else {
              console.warn("Save verification: file not found in GunDB");
            }
            resolve();
          });

        // Timeout to handle Gun not responding
        setTimeout(resolve, 1000);
      });
    } catch (verifyError) {
      console.warn("Error during save verification:", verifyError);
    }

    res.json({
      success: true,
      file: fileData,
      fileInfo: {
        originalName,
        size: fileSize,
        mimetype: mimeType,
        fileUrl,
        ipfsHash,
        ipfsUrl: ipfsHash ? `${IPFS_CONFIG.gateway}/${ipfsHash}` : null,
        customName: req.body.customName || null,
      },
      verified: !!savedData,
    });
  } catch (error) {
    console.error("File upload error:", error);
    res.status(500).json({
      success: false,
      error: "Error during upload: " + error.message,
    });
  }
});

// API - FILES LIST
app.get("/files", (req, res) => {
  const files = [];
  const seen = new Set();

  // Timeout per gestire la risposta se Gun è troppo lento
  const timeout = setTimeout(() => {
    res.json({ files });
  }, 3000);

  gun
    .get("files")
    .map()
    .once((data, key) => {
      if (key !== "_" && !seen.has(key) && data) {
        seen.add(key);
        files.push(data);

        // Se abbiamo più di 50 file, rispondiamo immediatamente
        if (files.length >= 50) {
          clearTimeout(timeout);
          res.json({ files });
        }
      }
    });
});

// API - FILE DETAILS
app.get("/files/:id", (req, res) => {
  const fileId = req.params.id;

  // Timeout per gestire la risposta se Gun è troppo lento
  const timeout = setTimeout(() => {
    res.status(404).json({ error: "File non trovato" });
  }, 3000);

  gun
    .get("files")
    .get(fileId)
    .once((data) => {
      clearTimeout(timeout);

      if (data) {
        res.json({ file: data });
      } else {
        res.status(404).json({ error: "File non trovato" });
      }
    });
});

// API - DELETE FILE
app.delete("/files/:id", authenticateRequest, async (req, res) => {
  try {
    const fileId = req.params.id;
    console.log(`Richiesta eliminazione file: ${fileId}`);

    // Verifica se il file esiste in GunDB
    const fileNode = gun.get("files").get(fileId);

    let fileData = null;
    await new Promise((resolve) => {
      fileNode.once((data) => {
        fileData = data;
        resolve();
      });
    });

    if (!fileData) {
      return res.status(404).json({
        success: false,
        error: "File non trovato",
      });
    }

    // Elimina il file dal filesystem locale
    const localPath = fileData.localPath;
    if (localPath && fs.existsSync(localPath)) {
      try {
        fs.unlinkSync(localPath);
        console.log(`File eliminato dal filesystem locale: ${localPath}`);
      } catch (fsError) {
        console.error("Errore durante l'eliminazione dal filesystem:", fsError);
        // Continuiamo comunque con l'eliminazione dal database
      }
    }

    // Se il file è su IPFS, tenta di eliminarlo (se possibile)
    if (fileData.ipfsHash && IPFS_CONFIG.enabled && shogunIpfs) {
      try {
        // Nota: la maggior parte dei nodi IPFS non supporta l'eliminazione completa
        // Possiamo solo fare l'unpin se supportato
        await shogunIpfs.unpin(fileData.ipfsHash);
        console.log(`File unpinned da IPFS: ${fileData.ipfsHash}`);
      } catch (ipfsError) {
        console.error("Errore durante l'unpin da IPFS:", ipfsError);
        // Continuiamo comunque con l'eliminazione dal database
      }
    }

    // Elimina il file da GunDB
    fileNode.put(null);
    console.log(`File eliminato da GunDB: ${fileId}`);

    res.json({
      success: true,
      message: "File eliminato con successo",
    });
  } catch (error) {
    console.error("Errore durante l'eliminazione del file:", error);
    res.status(500).json({
      success: false,
      error: `Errore durante l'eliminazione: ${error.message}`,
    });
  }
});

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
      enabled: IPFS_CONFIG.enabled,
      service: IPFS_CONFIG.service,
      gateway: IPFS_CONFIG.gateway,
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
app.post("/api/auth/verify-cert", async (req, res) => {
  try {
    const { certificate } = req.body;

    if (!certificate || !certificate.pub) {
      return res.status(400).json({
        success: false,
        error:
          "Invalid certificate format. Certificate must contain a pub key.",
      });
    }

    // Verify if the certificate is valid for a Gun user
    const userPub = certificate.pub;

    // Check if user exists in Gun
    const userExists = await new Promise((resolve) => {
      gun.user(userPub).once((data) => {
        resolve(!!data);
      });

      // Set a timeout in case Gun doesn't respond
      setTimeout(() => resolve(false), 3000);
    });

    if (!userExists) {
      return res.json({
        success: false,
        valid: false,
        error: "User with this certificate does not exist",
      });
    }

    // Create an API token for this user
    const username = userPub.substring(0, 10) + "..."; // Use truncated pub as username
    const token = await createUserToken(userPub, "Certificate Auth Token");

    res.json({
      success: true,
      valid: true,
      userId: userPub,
      token: token,
    });
  } catch (error) {
    console.error("Error verifying certificate:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API - IPFS STATUS
app.get("/api/ipfs/status", authenticateRequest, (req, res) => {
  try {
    res.json({
      success: true,
      config: {
        enabled: IPFS_CONFIG.enabled,
        service: IPFS_CONFIG.service,
        nodeUrl: IPFS_CONFIG.nodeUrl,
        gateway: IPFS_CONFIG.gateway,
        encryption: IPFS_CONFIG.encryptionEnabled,
      },
    });
  } catch (error) {
    console.error("Errore nell'ottenere lo stato IPFS:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API - IPFS TOGGLE
app.post("/api/ipfs/toggle", authenticateRequest, async (req, res) => {
  try {
    // Inverte lo stato di IPFS
    IPFS_CONFIG.enabled = !IPFS_CONFIG.enabled;

    // Inizializza o disattiva IPFS in base allo stato
    if (IPFS_CONFIG.enabled) {
      console.log("Attivazione IPFS in corso...");

      shogunIpfs = initializeIpfs();

      if (!shogunIpfs) {
        console.error("Inizializzazione IPFS fallita, disabilito IPFS");
        IPFS_CONFIG.enabled = false;

        return res.status(500).json({
          success: false,
          error:
            "Impossibile inizializzare IPFS, verifica la configurazione e i log",
          config: {
            enabled: false,
            service: IPFS_CONFIG.service,
            nodeUrl: IPFS_CONFIG.nodeUrl,
            gateway: IPFS_CONFIG.gateway,
          },
        });
      }

      // Test di connessione IPFS
      try {
        // Verifica la disponibilità di IPFS con un piccolo test
        console.log("Esecuzione test di connessione IPFS...");

        // Creiamo un JSON di test semplice
        const testJson = {
          test: true,
          timestamp: Date.now(),
          message: "Test di connessione",
        };

        // Utilizziamo uploadJson poiché sappiamo che è disponibile
        const testResult = await shogunIpfs.uploadJson(testJson, {
          name: "test-connection.json",
        });

        if (testResult && testResult.id) {
          console.log(`Test IPFS superato, ID: ${testResult.id}`);

          // Proviamo a recuperare il file caricato per verificare che sia accessibile
          const testUrl = `${IPFS_CONFIG.gateway}/${testResult.id}`;
          console.log(`Verifica accesso a ${testUrl}`);

          try {
            const client = testUrl.startsWith("https") ? https : http;

            await new Promise((resolve, reject) => {
              const req = client.get(testUrl, (res) => {
                if (res.statusCode === 200) {
                  console.log(
                    "Test completo: file IPFS accessibile dal gateway"
                  );
                  resolve();
                } else {
                  reject(
                    new Error(`Gateway ha restituito status ${res.statusCode}`)
                  );
                }
              });

              req.on("error", reject);
              req.end();
            });

            await setupGunIpfsMiddleware();
          } catch (gatewayError) {
            console.warn(
              `File caricato ma non accessibile dal gateway: ${gatewayError.message}`
            );
            console.warn(
              "Il gateway potrebbe essere non disponibile o richiedere tempo per la propagazione"
            );
          }
        } else {
          throw new Error("Test di connessione fallito, ID non ricevuto");
        }
      } catch (testError) {
        console.error("Test IPFS fallito:", testError.message);
        console.warn(
          "IPFS sarà comunque attivo ma potrebbero verificarsi errori durante l'upload"
        );
      }
    } else {
      // Disattiva IPFS
      console.log("Disattivazione IPFS");
      shogunIpfs = null;
    }

    // Riconfigura multer in base allo stato attuale di IPFS
    configureMulter();

    console.log(`IPFS ${IPFS_CONFIG.enabled ? "abilitato" : "disabilitato"}`);

    // Invia risposta con struttura corretta
    return res.json({
      success: true,
      config: {
        enabled: IPFS_CONFIG.enabled,
        service: IPFS_CONFIG.service,
        nodeUrl: IPFS_CONFIG.nodeUrl,
        gateway: IPFS_CONFIG.gateway,
        encryption: IPFS_CONFIG.encryptionEnabled,
      },
    });
  } catch (error) {
    console.error("Errore toggle IPFS:", error);
    return res.status(500).json({
      success: false,
      error: `Errore durante il toggle IPFS: ${error.message}`,
    });
  }
});

// API - IPFS CONFIG
app.post("/api/ipfs/config", authenticateRequest, async (req, res) => {
  try {
    console.log("Richiesta configurazione IPFS:", req.body);

    // Verifica che siano stati forniti i dati di configurazione
    if (!req.body) {
      return res.status(400).json({
        success: false,
        error: "Nessun dato di configurazione fornito",
      });
    }

    // Aggiorna i campi di configurazione solo se presenti
    if (req.body.service) IPFS_CONFIG.service = req.body.service;
    if (req.body.nodeUrl) IPFS_CONFIG.nodeUrl = req.body.nodeUrl;
    if (req.body.gateway) IPFS_CONFIG.gateway = req.body.gateway;
    if (req.body.pinataJwt) IPFS_CONFIG.pinataJwt = req.body.pinataJwt;
    if (req.body.pinataGateway)
      IPFS_CONFIG.pinataGateway = req.body.pinataGateway;
    if (req.body.encryptionEnabled !== undefined)
      IPFS_CONFIG.encryptionEnabled = req.body.encryptionEnabled;

    // Se IPFS è abilitato, reinizializzalo con le nuove impostazioni
    if (IPFS_CONFIG.enabled) {
      console.log("Reinizializzazione IPFS con nuova configurazione...");
      shogunIpfs = initializeIpfs();

      if (!shogunIpfs) {
        console.error("Reinizializzazione IPFS fallita, disabilito IPFS");
        IPFS_CONFIG.enabled = false;
      } else {
        console.log("IPFS reinizializzato con successo");
      }

      // Riconfigura multer in base allo stato attuale di IPFS
      configureMulter();
    }

    // Invia risposta con configurazione aggiornata
    return res.json({
      success: true,
      config: {
        enabled: IPFS_CONFIG.enabled,
        service: IPFS_CONFIG.service,
        nodeUrl: IPFS_CONFIG.nodeUrl,
        gateway: IPFS_CONFIG.gateway,
        pinataGateway: IPFS_CONFIG.pinataGateway,
        pinataJwt: IPFS_CONFIG.pinataJwt ? "********" : "", // Non inviare il JWT completo
        apiKey: SECRET_TOKEN,
      },
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

    if (!IPFS_CONFIG.enabled || !shogunIpfs) {
      return res.status(400).json({
        success: false,
        error: "IPFS not active",
      });
    }

    console.log(`Verifica stato pin per hash IPFS: ${hash}`);
    const isPinned = await shogunIpfs.isPinned(hash);

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

    if (!IPFS_CONFIG.enabled || !shogunIpfs) {
      return res.status(400).json({
        success: false,
        error: "IPFS not active",
      });
    }

    console.log(`Richiesta pin per hash IPFS: ${hash}`);

    // Verifica se il file è già pinnato
    const isPinned = await shogunIpfs.isPinned(hash);
    if (isPinned) {
      return res.json({
        success: true,
        message: "File già pinnato",
        hash,
        isPinned: true,
      });
    }

    // Esegui il pin direttamente sull'istanza shogunIpfs invece di usare getStorage()
    console.log("Esecuzione pin per hash", hash);
    let result;
    try {
      result = await shogunIpfs.pin(hash);
      console.log("Risultato pin:", result);
    } catch (pinError) {
      console.error("Errore durante il pin:", pinError);

      // Prova con un approccio alternativo se il metodo diretto fallisce
      try {
        console.log(
          "Tentativo alternativo di pin usando serviceInstance direttamente"
        );
        if (
          shogunIpfs.serviceInstance &&
          shogunIpfs.serviceInstance.pin &&
          shogunIpfs.serviceInstance.pin.add
        ) {
          // L'autenticazione dovrebbe già essere configurata nell'istanza
          await shogunIpfs.serviceInstance.pin.add(hash);
          result = { success: true, method: "serviceInstance.direct" };
        }
      } catch (altError) {
        console.error("Anche il tentativo alternativo è fallito:", altError);
        throw pinError; // Ripetiamo l'errore originale
      }
    }

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

    if (!IPFS_CONFIG.enabled || !shogunIpfs) {
      return res.status(400).json({
        success: false,
        error: "IPFS not active",
      });
    }

    console.log(`Richiesta unpin per hash IPFS: ${hash}`);

    // Verifica se il file è pinnato
    const isPinned = await shogunIpfs.isPinned(hash);
    if (!isPinned) {
      return res.json({
        success: true,
        message: "File già non pinnato",
        hash,
        isPinned: false,
      });
    }

    // Esegui l'unpin direttamente sull'istanza
    const result = await shogunIpfs.unpin(hash);

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
  if (!IPFS_CONFIG.enabled || !shogunIpfs) {
    console.log("IPFS not enabled, middleware not configured");
    return;
  }

  console.log("Configuring Gun-IPFS middleware...");

  // Simplified version: we don't intercept PUTs anymore
  // IPFS uploads will be handled client-side

  // We only intercept 'in' responses to retrieve IPFS data
  Gun.on("in", async function (replyMsg) {
    // If IPFS is not enabled, pass the original message
    if (!IPFS_CONFIG.enabled || !shogunIpfs) {
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
                const ipfsData = await shogunIpfs.fetchJson(hash);

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
 * This function sets up the RelayMembershipVerifier, DIDVerifier, and OracleBridge instances
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
          RELAY_CONFIG.relayMembership.providerUrl
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

    // Initialize RelayMembershipVerifier if enabled
    if (RELAY_CONFIG.relayMembership.enabled) {
      if (!RELAY_CONFIG.relayMembership.contractAddress) {
        console.warn(
          "RelayMembership contract address not provided, skipping initialization"
        );
      } else {
        console.log("Initializing RelayMembershipVerifier...");
        relayMembershipVerifier = new RelayMembershipVerifier(
          {
            contractAddress: RELAY_CONFIG.relayMembership.contractAddress,
            providerUrl: RELAY_CONFIG.relayMembership.providerUrl,
          },
          shogunCoreInstance,
          signer
        );
        console.log("RelayMembershipVerifier initialized successfully");
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

    // Initialize OracleBridge if enabled
    if (RELAY_CONFIG.oracleBridge.enabled) {
      if (!RELAY_CONFIG.oracleBridge.contractAddress) {
        console.warn(
          "OracleBridge contract address not provided, skipping initialization"
        );
      } else {
        console.log("Initializing OracleBridge...");
        oracleBridge = new OracleBridge(
          {
            contractAddress: RELAY_CONFIG.oracleBridge.contractAddress,
            providerUrl: RELAY_CONFIG.oracleBridge.providerUrl,
          },
          shogunCoreInstance,
          signer
        );
        console.log("OracleBridge initialized successfully");
      }
    }

    return true;
  } catch (error) {
    console.error("Error initializing relay components:", error);
    return false;
  }
}

/**
 * Get the RelayMembershipVerifier instance
 * @returns {RelayMembershipVerifier|null} The RelayMembershipVerifier instance or null if not initialized
 */
function getRelayMembershipVerifier() {
  return relayMembershipVerifier;
}

/**
 * Get the DIDVerifier instance
 * @returns {DIDVerifier|null} The DIDVerifier instance or null if not initialized
 */
function getDIDVerifier() {
  return didVerifier;
}

/**
 * Get the OracleBridge instance
 * @returns {OracleBridge|null} The OracleBridge instance or null if not initialized
 */
function getOracleBridge() {
  return oracleBridge;
}

/**
 * Heartbeat service for the relay
 * Periodically checks online relays and publishes a Merkle root to the blockchain
 */
let heartbeatInterval = null;

/**
 * Initialize heartbeat service
 * @returns {boolean} Whether the service was initialized successfully
 */
async function initializeHeartbeatService() {
  try {
    if (!RELAY_CONFIG.heartbeat.enabled) {
      console.log("Heartbeat service disabled, skipping initialization");
      return false;
    }

    // Check if we have all necessary configuration
    if (
      !RELAY_CONFIG.heartbeat.oracleBridgeContract ||
      !RELAY_CONFIG.heartbeat.membershipContract
    ) {
      console.warn(
        "Heartbeat service missing contract addresses, skipping initialization"
      );
      return false;
    }

    // Check if we have a private key to sign transactions
    if (!process.env.ETHEREUM_PRIVATE_KEY) {
      console.warn(
        "Heartbeat service requires ETHEREUM_PRIVATE_KEY for signing transactions, skipping initialization"
      );
      return false;
    }

    console.log("Initializing heartbeat service...");

    // Import ethers dynamically to avoid issues
    const { ethers } = await import("ethers");

    // Set up signer
    const privateKey = process.env.ETHEREUM_PRIVATE_KEY.startsWith("0x")
      ? process.env.ETHEREUM_PRIVATE_KEY
      : `0x${process.env.ETHEREUM_PRIVATE_KEY}`;

    // Create provider
    const provider = new ethers.JsonRpcProvider(
      RELAY_CONFIG.heartbeat.providerUrl
    );

    // Create wallet with private key and provider
    const signer = new ethers.Wallet(privateKey, provider);
    console.log(
      `Heartbeat service initialized with wallet address: ${await signer.getAddress()}`
    );

    // Set up contracts
    const membershipAbi = [
      "function getRelayCount() view returns (uint256)",
      "function getRelayAt(uint256) view returns (address)",
      "function relayUrl(address) view returns (string)",
      "function publishRoot(uint256, bytes32)",
    ];

    const oracleAbi = [
      "function publishRoot(uint256, bytes32)",
      "function roots(uint256) view returns (bytes32)",
      "function rootTimestamps(uint256) view returns (uint256)"
    ];

    const membershipContract = new ethers.Contract(
      RELAY_CONFIG.heartbeat.membershipContract,
      membershipAbi,
      signer
    );

    const oracleContract = new ethers.Contract(
      RELAY_CONFIG.heartbeat.oracleBridgeContract,
      oracleAbi,
      signer
    );

    // Function to ping a relay
    async function pingRelay(wsUrl, timeout = 5000) {
      return new Promise((resolve) => {
        try {
          // Clean the URL to ensure proper WebSocket format
          let cleanUrl = wsUrl.trim();
          
          // Remove any http:// or https:// prefixes
          if (cleanUrl.startsWith('http://')) {
            cleanUrl = cleanUrl.substring(7);
          } else if (cleanUrl.startsWith('https://')) {
            cleanUrl = cleanUrl.substring(8);
          }
          
          // Remove any trailing slashes
          while (cleanUrl.endsWith('/')) {
            cleanUrl = cleanUrl.slice(0, -1);
          }
          
          // Create the WebSocket URL
          const wsAddress = `ws://${cleanUrl}/gun`;
          console.log(`Attempting to ping relay at ${wsAddress}`);
          
          // Create the WebSocket
          const ws = new WebSocket(wsAddress);
          let settled = false;
          
          const timer = setTimeout(() => {
            if (!settled) {
              settled = true;
              try { ws.close(); } catch (e) {}
              console.log(`Timeout pinging ${wsAddress}`);
              resolve(false);
            }
          }, timeout);
          
          ws.onopen = () => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              try { ws.close(); } catch (e) {}
              console.log(`Successfully pinged ${wsAddress}`);
              resolve(true);
            }
          };
          
          ws.onerror = (error) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              console.error(`Error pinging ${wsAddress}:`, error.message);
              resolve(false);
            }
          };
        } catch (error) {
          console.error(`Error in pingRelay:`, error.message);
          resolve(false);
        }
      });
    }

    // Function to generate and publish heartbeat
    async function generateAndPublishHeartbeat() {
      try {
        console.log("Generating heartbeat...");

        // Calculate the current epoch (hours since epoch)
        const epoch = Math.floor(Date.now() / 1000 / 3600);
        console.log(`Current epoch: ${epoch}`);

        // Read the list of relays from the contract
        const count = await membershipContract.getRelayCount();
        console.log(`Found ${count} relays in membership contract`);

        const alive = [];
        const urls = [];
        const leavesInfo = [];

        // Check each relay
        for (let i = 0; i < count; i++) {
          try {
            const addr = await membershipContract.getRelayAt(i);
            let url = await membershipContract.relayUrl(addr);
            
            // Clean up the URL to ensure it's in the right format
            url = url.trim();
            
            console.log(`Checking relay ${i + 1}/${count}: ${addr} at ${url}`);

            const ok = await pingRelay(url);
            if (ok) {
              alive.push(addr);
              leavesInfo.push({ addr, url });
              urls.push(url);
              console.log(`Relay ${addr} is alive`);
            } else {
              console.log(`Relay ${addr} is not responding`);
            }
          } catch (error) {
            console.error(`Error checking relay ${i}:`, error);
          }
        }

        console.log(`Found ${alive.length} alive relays:`, urls);

        if (alive.length === 0) {
          console.error(
            `No relays online for epoch ${epoch}, skipping heartbeat`
          );
          return;
        }

        // Build Merkle tree
        console.log("Building Merkle tree...");

        // Import dynamic modules for cryptography
        const keccak256 = (data) => {
          return ethers.solidityPackedKeccak256(["bytes"], [data]);
        };

        // Calculate leaves
        const leaves = alive.map((addr) =>
          ethers.solidityPackedKeccak256(["address", "uint256"], [addr, epoch])
        );

        // Create a simple implementation of MerkleTree
        function createMerkleRoot(leaves) {
          if (leaves.length === 0)
            return "0x0000000000000000000000000000000000000000000000000000000000000000";

          // Sort leaves if needed
          leaves = [...leaves].sort();

          // If only one leaf, return it
          if (leaves.length === 1) return leaves[0];

          // Process pairs of leaves
          const nextLevel = [];
          for (let i = 0; i < leaves.length; i += 2) {
            if (i + 1 < leaves.length) {
              // Concatenate and hash the pair
              const left = leaves[i];
              const right = leaves[i + 1];
              const combined =
                left < right
                  ? ethers.solidityPackedKeccak256(
                      ["bytes32", "bytes32"],
                      [left, right]
                    )
                  : ethers.solidityPackedKeccak256(
                      ["bytes32", "bytes32"],
                      [right, left]
                    );
              nextLevel.push(combined);
            } else {
              // Odd number of leaves, promote the last one
              nextLevel.push(leaves[i]);
            }
          }

          // Recurse until we have a single root
          return createMerkleRoot(nextLevel);
        }

        const root = createMerkleRoot(leaves);
        console.log(`Generated root for epoch ${epoch}: ${root}`);

        // Check if we already published this root
        try {
          const existingRoot = await oracleContract.roots(epoch);
          if (existingRoot !== ethers.ZeroHash) {
            console.log(
              `Root already published for epoch ${epoch}: ${existingRoot}`
            );
            return;
          }
        } catch (error) {
          console.error("Error checking existing root:", error);
        }

        // Publish to blockchain
        console.log(`Publishing root for epoch ${epoch}: ${root}`);
        const tx = await oracleContract.publishRoot(epoch, root);
        console.log(`Transaction submitted: ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(
          `Root published in transaction ${tx.hash}, block ${receipt.blockNumber}`
        );
      } catch (error) {
        console.error("Error generating and publishing heartbeat:", error);
      }
    }

    // Set up interval to run the heartbeat
    heartbeatInterval = setInterval(
      generateAndPublishHeartbeat,
      RELAY_CONFIG.heartbeat.interval
    );

    // Run immediately on start
    setTimeout(generateAndPublishHeartbeat, 5000);

    console.log(
      `Heartbeat service initialized, running every ${
        RELAY_CONFIG.heartbeat.interval / 1000
      } seconds`
    );
    return true;
  } catch (error) {
    console.error("Error initializing heartbeat service:", error);
    return false;
  }
}

/**
 * Stop the heartbeat service
 */
function stopHeartbeatService() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    console.log("Heartbeat service stopped");
  }
}

/**
 * Starts the unified relay server
 * Initializes IPFS, configures middleware, and sets up WebSocket handlers
 * @returns {Promise<void>}
 */
async function startServer() {
  try {
    console.log("Starting unified relay server...");

    // Initialize IPFS if enabled
    if (IPFS_CONFIG.enabled) {
      shogunIpfs = initializeIpfs();
    }

    server.listen(PORT, async () => {
      console.log(`Server started on port ${PORT}`);
      console.log(`API endpoint: http://localhost:${PORT}/api`);
      console.log(`Gun endpoint: http://localhost:${PORT}/gun`);

      // Initialize Gun with the options
      gun = Gun(gunOptions);

      // Initialize ShogunCore and relay components
      ensureShogunCore();
      try {
        const relayInitialized = await initializeRelayComponents();
        if (relayInitialized) {
          console.log("Relay components initialized successfully");
        }
      } catch (error) {
        console.error("Error initializing relay components:", error);
      }

      // IMPORTANT: Configure WebSocket for GunDB only once after server start
      const websocketMiddleware = (req, socket, head) => {
        const url = req.url;
        const origin = req.headers.origin;

        // Log upgrade request
        console.log(
          `WebSocket upgrade requested for: ${url} from origin: ${
            origin || "unknown"
          }`
        );

        // Validate origin if present
        if (origin) {
          // In development mode, allow all origins
          if (process.env.NODE_ENV === "development") {
            console.log("Development mode - origin accepted:", origin);
          } else if (!allowedOrigins.includes(origin)) {
            console.warn(
              `WebSocket upgrade rejected: origin not allowed ${origin}`
            );
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
          }
        }

        // Check for authentication token in the URL
        if (url.includes("?token=") || url.includes("&token=")) {
          try {
            const fullUrl = `http://localhost${url}`;
            const urlObj = new URL(fullUrl);
            const token = urlObj.searchParams.get("token");

            console.log(
              "Token found in URL:",
              token ? token.substring(0, 3) + "..." : "missing"
            );

            if (!token || !validateToken(token)) {
              console.warn(
                `WebSocket upgrade rejected: invalid or missing token in URL`
              );
              socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
              socket.destroy();
              return;
            } else {
              console.log("Valid URL token, upgrade allowed");
            }
          } catch (e) {
            console.error("Error parsing URL:", e.message);
          }
        } else {
          // For development, allow connections without tokens
          if (process.env.NODE_ENV !== "development") {
            console.warn(`WebSocket upgrade: no token found in URL`);
            // In production we would reject, but for debugging allow it
            //socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            //socket.destroy();
            //return;
          }
        }

        if (
          url === "/gun" ||
          url.startsWith("/gun?") ||
          url.startsWith("/gun/")
        ) {
          console.log(`Handling WebSocket connection for GunDB`);
          // Do nothing here, Gun will handle the upgrade internally
        } else {
          console.log(`Unhandled WebSocket request: ${url}`);
          socket.destroy();
        }
      };

      initializeHeartbeatService();

      // Register middleware for WebSocket upgrades
      server.on("upgrade", websocketMiddleware);
    });

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
  } catch (error) {
    console.error("Error during server startup:", error);
    process.exit(1);
  }
}

startServer().catch((err) => {
  console.error("Critical error during startup:", err);
  process.exit(1);
});

// API - USER TOKEN MANAGEMENT
// These endpoints allow for token creation and management

// Create new token
app.post("/api/auth/tokens", authenticateRequest, async (req, res) => {
  try {
    // Only allow authenticated users to create tokens for themselves
    const userId = req.auth.userId;
    const { name, expiresInDays } = req.body;

    // Calculate expiration date if specified
    let expiresAt = null;
    if (expiresInDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));
    }

    const token = await createUserToken(userId, name, expiresAt);

    res.json({
      success: true,
      token: token,
    });
  } catch (error) {
    console.error("Error creating token:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// List user tokens
app.get("/api/auth/tokens", authenticateRequest, async (req, res) => {
  try {
    const userId = req.auth.userId;
    const tokens = await listUserTokens(userId);

    res.json({
      success: true,
      tokens: tokens,
    });
  } catch (error) {
    console.error("Error listing tokens:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Revoke a token
app.delete(
  "/api/auth/tokens/:tokenId",
  authenticateRequest,
  async (req, res) => {
    try {
      const userId = req.auth.userId;
      const tokenId = req.params.tokenId;

      const success = await revokeUserToken(userId, tokenId);

      if (success) {
        res.json({
          success: true,
          message: "Token revoked successfully",
        });
      } else {
        res.status(400).json({
          success: false,
          error: "Failed to revoke token",
        });
      }
    } catch (error) {
      console.error("Error revoking token:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Verify a token (for testing)
app.post("/api/auth/verify-token", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: "Token is required",
      });
    }

    const tokenData = await validateUserToken(token);

    if (tokenData) {
      // Don't include sensitive information
      const safeData = {
        valid: true,
        userId: tokenData.userId,
        permissions: tokenData.permissions,
      };

      res.json({
        success: true,
        tokenInfo: safeData,
      });
    } else {
      res.json({
        success: false,
        valid: false,
        error: "Invalid token",
      });
    }
  } catch (error) {
    console.error("Error verifying token:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// User registration endpoint
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password are required",
      });
    }

    // Use Gun's native user system
    const user = gun.user();

    // Create a promise to handle async GunDB operation
    const createUser = new Promise((resolve, reject) => {
      user.create(username, password, (ack) => {
        if (ack.err) {
          reject(new Error(ack.err));
        } else {
          resolve(ack);
        }
      });
    });

    await createUser;

    // After user creation, auth the user to get the certificate
    const authUser = new Promise((resolve, reject) => {
      user.auth(username, password, (ack) => {
        if (ack.err) {
          reject(new Error(ack.err));
        } else {
          resolve(ack);
        }
      });
    });

    await authUser;

    // Store additional user metadata
    if (email) {
      user.get("profile").get("email").put(email);
    }

    // Set default permissions
    user.get("profile").get("permissions").put(["user"]);

    // Create an API token for the user
    const token = await createUserToken(username, "Default Token");

    res.json({
      success: true,
      message: "User registered successfully",
      userId: username,
      token: token,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Login endpoint
app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password are required",
      });
    }

    // Use Gun's native user system
    const user = gun.user();

    // Create a promise to handle async GunDB login
    const authUser = new Promise((resolve, reject) => {
      user.auth(username, password, (ack) => {
        if (ack.err) {
          reject(new Error(ack.err || "Invalid username or password"));
        } else {
          resolve(ack);
        }
      });
    });

    await authUser;

    // Get or create an API token for the user
    const tokens = await listUserTokens(username);
    let activeToken = tokens.find(
      (t) => !t.revoked && (!t.expiresAt || t.expiresAt > Date.now())
    );

    if (!activeToken) {
      // No active token, create a new one
      const newToken = await createUserToken(username, "Login Token");

      res.json({
        success: true,
        message: "Login successful",
        userId: username,
        token: newToken,
        gunCert: user._.sea, // Include the Gun certificate for client-side use
      });
    } else {
      // Return the first active token
      res.json({
        success: true,
        message: "Login successful",
        userId: username,
        tokens,
        gunCert: user._.sea, // Include the Gun certificate for client-side use
      });
    }
  } catch (error) {
    console.error("Login error:", error);
    res.status(401).json({
      success: false,
      error: "Invalid username or password",
    });
  }
});

// Initialize ShogunCore with the same Gun instance
let shogunCore;

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

// API - SHOGUN CORE AUTHENTICATION ENDPOINTS

// ShogunCore login
app.post("/api/auth/shogun/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password are required",
      });
    }

    const core = ensureShogunCore();
    if (!core) {
      return res.status(500).json({
        success: false,
        error: "ShogunCore not available",
      });
    }

    // Use ShogunCore login
    const result = await core.login(username, password);

    if (!result.success) {
      return res.status(401).json(result);
    }

    // Create an API token for this user
    const token = await createUserToken(username, "ShogunCore Login Token");

    res.json({
      success: true,
      ...result,
      token: token,
    });
  } catch (error) {
    console.error("Error during ShogunCore login:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ShogunCore signup
app.post("/api/auth/shogun/signup", async (req, res) => {
  try {
    const { username, password, email } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password are required",
      });
    }

    const core = ensureShogunCore();
    if (!core) {
      return res.status(500).json({
        success: false,
        error: "ShogunCore not available",
      });
    }

    // Use ShogunCore signUp
    const result = await core.signUp(username, password, password);

    if (!result.success) {
      return res.status(400).json(result);
    }

    // Create an API token for this user
    const token = await createUserToken(
      username,
      "ShogunCore Registration Token"
    );

    res.json({
      success: true,
      ...result,
      token: token,
    });
  } catch (error) {
    console.error("Error during ShogunCore signup:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

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

// ============ RELAY MEMBERSHIP VERIFIER API ============

// API - Check relay membership status
app.get(
  "/api/relay/membership/status",
  authenticateRequest,
  async (req, res) => {
    try {
      // Verify that RelayMembershipVerifier is initialized
      if (!RELAY_CONFIG.relayMembership.enabled || !relayMembershipVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay membership services not available",
          config: {
            enabled: RELAY_CONFIG.relayMembership.enabled,
            contractAddress:
              RELAY_CONFIG.relayMembership.contractAddress || "Not configured",
          },
        });
      }

      res.json({
        success: true,
        config: {
          enabled: RELAY_CONFIG.relayMembership.enabled,
          contractAddress: RELAY_CONFIG.relayMembership.contractAddress,
        },
      });
    } catch (error) {
      console.error("Error getting relay membership status:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Check address authorization
app.get(
  "/api/relay/membership/check-address/:address",
  authenticateRequest,
  async (req, res) => {
    try {
      const { address } = req.params;

      // Verify that RelayMembershipVerifier is initialized
      if (!RELAY_CONFIG.relayMembership.enabled || !relayMembershipVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay membership services not available",
        });
      }

      // Check if the address is authorized
      const isAuthorized = await relayMembershipVerifier.isAddressAuthorized(
        address
      );

      res.json({
        success: true,
        address,
        isAuthorized,
      });
    } catch (error) {
      console.error(
        `Error checking address authorization for ${req.params.address}:`,
        error
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Check public key authorization
app.post(
  "/api/relay/membership/check-pubkey",
  authenticateRequest,
  async (req, res) => {
    try {
      const { publicKey } = req.body;

      if (!publicKey) {
        return res.status(400).json({
          success: false,
          error: "Public key is required",
        });
      }

      // Verify that RelayMembershipVerifier is initialized
      if (!RELAY_CONFIG.relayMembership.enabled || !relayMembershipVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay membership services not available",
        });
      }

      // Check if the public key is authorized
      const isAuthorized = await relayMembershipVerifier.isPublicKeyAuthorized(
        publicKey
      );

      res.json({
        success: true,
        publicKey,
        isAuthorized,
      });
    } catch (error) {
      console.error("Error checking public key authorization:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Get address for public key
app.post(
  "/api/relay/membership/address-for-pubkey",
  authenticateRequest,
  async (req, res) => {
    try {
      const { publicKey } = req.body;

      if (!publicKey) {
        return res.status(400).json({
          success: false,
          error: "Public key is required",
        });
      }

      // Verify that RelayMembershipVerifier is initialized
      if (!RELAY_CONFIG.relayMembership.enabled || !relayMembershipVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay membership services not available",
        });
      }

      // Get address for public key
      const address = await relayMembershipVerifier.getAddressForPublicKey(
        publicKey
      );

      res.json({
        success: true,
        publicKey,
        address,
      });
    } catch (error) {
      console.error("Error getting address for public key:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Get user info
app.get(
  "/api/relay/membership/user-info/:address",
  authenticateRequest,
  async (req, res) => {
    try {
      const { address } = req.params;

      // Verify that RelayMembershipVerifier is initialized
      if (!RELAY_CONFIG.relayMembership.enabled || !relayMembershipVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay membership services not available",
        });
      }

      // Get user info
      const userInfo = await relayMembershipVerifier.getUserInfo(address);

      if (!userInfo) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      res.json({
        success: true,
        address,
        userInfo: {
          expires: userInfo.expires.toString(),
          pubKey: userInfo.pubKey,
        },
      });
    } catch (error) {
      console.error(
        `Error getting user info for ${req.params.address}:`,
        error
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Check if user is active
app.get(
  "/api/relay/membership/is-active/:address",
  authenticateRequest,
  async (req, res) => {
    try {
      const { address } = req.params;

      // Verify that RelayMembershipVerifier is initialized
      if (!RELAY_CONFIG.relayMembership.enabled || !relayMembershipVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay membership services not available",
        });
      }

      // Check if user is active
      const isActive = await relayMembershipVerifier.isUserActive(address);

      res.json({
        success: true,
        address,
        isActive,
      });
    } catch (error) {
      console.error(
        `Error checking if user ${req.params.address} is active:`,
        error
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Update relay membership config
app.post(
  "/api/relay/membership/config",
  authenticateRequest,
  async (req, res) => {
    try {
      const { contractAddress, providerUrl, enabled } = req.body;

      // Only system/admin users can modify the configuration
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json({
          success: false,
          error:
            "Only administrators can modify relay membership configuration",
        });
      }

      // Update configuration
      if (enabled !== undefined) {
        RELAY_CONFIG.relayMembership.enabled = enabled;
      }

      if (contractAddress) {
        RELAY_CONFIG.relayMembership.contractAddress = contractAddress;
      }

      if (providerUrl) {
        RELAY_CONFIG.relayMembership.providerUrl = providerUrl;
      }

      // Reinitialize relay components
      if (RELAY_CONFIG.relayMembership.enabled) {
        const shogunCoreInstance = getShogunCore();

        console.log("Reinitializing RelayMembershipVerifier...");
        try {
          relayMembershipVerifier = new RelayMembershipVerifier(
            {
              contractAddress: RELAY_CONFIG.relayMembership.contractAddress,
              providerUrl: RELAY_CONFIG.relayMembership.providerUrl,
            },
            shogunCoreInstance
          );
          console.log("RelayMembershipVerifier reinitialized successfully");
        } catch (error) {
          console.error("Error reinitializing RelayMembershipVerifier:", error);
          return res.status(500).json({
            success: false,
            error:
              "Error reinitializing RelayMembershipVerifier: " + error.message,
          });
        }
      } else {
        relayMembershipVerifier = null;
        console.log("RelayMembershipVerifier disabled");
      }

      res.json({
        success: true,
        config: {
          enabled: RELAY_CONFIG.relayMembership.enabled,
          contractAddress: RELAY_CONFIG.relayMembership.contractAddress,
          providerUrl: RELAY_CONFIG.relayMembership.providerUrl,
        },
      });
    } catch (error) {
      console.error("Error updating relay membership configuration:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

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

// ============ ORACLE BRIDGE API ============

// API - Check Oracle Bridge status
app.get("/api/relay/oracle/status", authenticateRequest, async (req, res) => {
  try {
    // Verify that OracleBridge is initialized
    if (!RELAY_CONFIG.oracleBridge.enabled || !oracleBridge) {
      return res.status(503).json({
        success: false,
        error: "Oracle Bridge services not available",
        config: {
          enabled: RELAY_CONFIG.oracleBridge.enabled,
          contractAddress:
            RELAY_CONFIG.oracleBridge.contractAddress || "Not configured",
        },
      });
    }

    // Get current epoch ID
    const epochId = await oracleBridge.getEpochId();

    // Get admin address
    const admin = await oracleBridge.getAdmin();

    // Get timestamp for current epoch if available
    let timestamp = null;
    let date = null;
    
    try {
      timestamp = await oracleBridge.getRootTimestamp(epochId);
      // Convert timestamp to readable date if it's not zero
      date = timestamp > 0 ? new Date(Number(timestamp) * 1000).toISOString() : null;
    } catch (error) {
      console.warn(`Could not get timestamp for current epoch: ${error.message}`);
    }

    res.json({
      success: true,
      config: {
        enabled: RELAY_CONFIG.oracleBridge.enabled,
        contractAddress: RELAY_CONFIG.oracleBridge.contractAddress,
      },
      epochId: epochId.toString(),
      admin,
      timestamp: timestamp ? timestamp.toString() : null,
      date: date,
    });
  } catch (error) {
    console.error("Error getting Oracle Bridge status:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API - Get current epoch ID
app.get("/api/relay/oracle/epoch", authenticateRequest, async (req, res) => {
  try {
    // Verify that OracleBridge is initialized
    if (!RELAY_CONFIG.oracleBridge.enabled || !oracleBridge) {
      return res.status(503).json({
        success: false,
        error: "Oracle Bridge services not available",
      });
    }

    // Get current epoch ID
    const epochId = await oracleBridge.getEpochId();

    res.json({
      success: true,
      epochId: epochId.toString(),
    });
  } catch (error) {
    console.error("Error getting current epoch ID:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// API - Get Merkle root for a specific epoch
app.get(
  "/api/relay/oracle/root/:epochId",
  authenticateRequest,
  async (req, res) => {
    try {
      const { epochId } = req.params;

      // Verify that OracleBridge is initialized
      if (!RELAY_CONFIG.oracleBridge.enabled || !oracleBridge) {
        return res.status(503).json({
          success: false,
          error: "Oracle Bridge services not available",
        });
      }

      // Get Merkle root for the specified epoch
      const root = await oracleBridge.getRootForEpoch(BigInt(epochId));

      res.json({
        success: true,
        epochId,
        root,
      });
    } catch (error) {
      console.error(
        `Error getting Merkle root for epoch ${req.params.epochId}:`,
        error
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Get root timestamp for a specific epoch
app.get(
  "/api/relay/oracle/root-timestamp/:epochId",
  authenticateRequest,
  async (req, res) => {
    try {
      const { epochId } = req.params;

      // Verify that OracleBridge is initialized
      if (!RELAY_CONFIG.oracleBridge.enabled || !oracleBridge) {
        return res.status(503).json({
          success: false,
          error: "Oracle Bridge services not available",
        });
      }

      // Get timestamp for when the root was published
      const timestamp = await oracleBridge.getRootTimestamp(BigInt(epochId));
      
      // Convert timestamp to readable date if it's not zero
      const date = timestamp > 0 ? new Date(Number(timestamp) * 1000).toISOString() : null;

      res.json({
        success: true,
        epochId,
        timestamp: timestamp.toString(),
        date: date,
      });
    } catch (error) {
      console.error(
        `Error getting root timestamp for epoch ${req.params.epochId}:`,
        error
      );
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Verify if a Merkle root matches the expected value
app.post(
  "/api/relay/oracle/verify-root",
  authenticateRequest,
  async (req, res) => {
    try {
      const { epochId, expectedRoot } = req.body;

      if (!epochId || !expectedRoot) {
        return res.status(400).json({
          success: false,
          error: "Epoch ID and expected root are required",
        });
      }

      // Verify that OracleBridge is initialized
      if (!RELAY_CONFIG.oracleBridge.enabled || !oracleBridge) {
        return res.status(503).json({
          success: false,
          error: "Oracle Bridge services not available",
        });
      }

      // Verify if the Merkle root matches the expected value
      const isMatch = await oracleBridge.verifyRoot(
        BigInt(epochId),
        expectedRoot
      );

      res.json({
        success: true,
        epochId,
        expectedRoot,
        isMatch,
      });
    } catch (error) {
      console.error("Error verifying Merkle root:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Publish a new Merkle root for an epoch
app.post(
  "/api/relay/oracle/publish-root",
  authenticateRequest,
  async (req, res) => {
    try {
      const { epochId, root } = req.body;

      if (!epochId || !root) {
        return res.status(400).json({
          success: false,
          error: "Epoch ID and root are required",
        });
      }

      // Verify that OracleBridge is initialized
      if (!RELAY_CONFIG.oracleBridge.enabled || !oracleBridge) {
        return res.status(503).json({
          success: false,
          error: "Oracle Bridge services not available",
        });
      }

      // Only admin or system tokens can publish roots
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json({
          success: false,
          error: "Only administrators can publish roots",
        });
      }

      // Publish a new Merkle root
      const receipt = await oracleBridge.publishRoot(BigInt(epochId), root);

      if (!receipt) {
        return res.status(500).json({
          success: false,
          error: "Failed to publish root",
        });
      }

      res.json({
        success: true,
        epochId,
        root,
        txHash: receipt.hash,
        message: "Root published successfully",
      });
    } catch (error) {
      console.error("Error publishing Merkle root:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// API - Update Oracle Bridge config
app.post("/api/relay/oracle/config", authenticateRequest, async (req, res) => {
  try {
    const { contractAddress, providerUrl, enabled } = req.body;

    // Only system/admin users can modify the configuration
    if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
      return res.status(403).json({
        success: false,
        error: "Only administrators can modify Oracle Bridge configuration",
      });
    }

    // Update configuration
    if (enabled !== undefined) {
      RELAY_CONFIG.oracleBridge.enabled = enabled;
    }

    if (contractAddress) {
      RELAY_CONFIG.oracleBridge.contractAddress = contractAddress;
    }

    if (providerUrl) {
      RELAY_CONFIG.oracleBridge.providerUrl = providerUrl;
    }

    // Reinitialize Oracle Bridge
    if (RELAY_CONFIG.oracleBridge.enabled) {
      const shogunCoreInstance = getShogunCore();

      console.log("Reinitializing OracleBridge...");
      try {
        oracleBridge = new OracleBridge(
          {
            contractAddress: RELAY_CONFIG.oracleBridge.contractAddress,
            providerUrl: RELAY_CONFIG.oracleBridge.providerUrl,
          },
          shogunCoreInstance
        );
        console.log("OracleBridge reinitialized successfully");
      } catch (error) {
        console.error("Error reinitializing OracleBridge:", error);
        return res.status(500).json({
          success: false,
          error: "Error reinitializing OracleBridge: " + error.message,
        });
      }
    } else {
      oracleBridge = null;
      console.log("OracleBridge disabled");
    }

    res.json({
      success: true,
      config: {
        enabled: RELAY_CONFIG.oracleBridge.enabled,
        contractAddress: RELAY_CONFIG.oracleBridge.contractAddress,
        providerUrl: RELAY_CONFIG.oracleBridge.providerUrl,
      },
    });
  } catch (error) {
    console.error("Error updating Oracle Bridge configuration:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
