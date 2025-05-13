import dotenv from "dotenv";
dotenv.config();

import cors from "cors";
import multer from "multer";
import fs from "fs";
import express from "express";
import { ShogunIpfs } from "shogun-ipfs";
import {
  ShogunCore,
  RelayVerifier,
  DIDVerifier,
} from "shogun-core";
import Gun from "gun";
import path from "path";
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
};

// Check if we're in a development environment
const isDevMode = process.env.NODE_ENV === "development";

// Relay components configuration
const RELAY_CONFIG = {
  relay: {
    // Force relay to be enabled
    enabled: true,
    registryAddress: process.env.RELAY_REGISTRY_CONTRACT || "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    providerUrl: process.env.ETHEREUM_PROVIDER_URL || "http://localhost:8545",
    // Force onchain membership to be enabled
    onchainMembership: true,
  },
  didVerifier: {
    enabled: process.env.DID_VERIFIER_ENABLED === "true" || false,
    contractAddress: process.env.DID_REGISTRY_CONTRACT || "",
    providerUrl: process.env.ETHEREUM_PROVIDER_URL || "http://localhost:8545",
  },
};

// Relay component instances
let relayVerifier = null;
let didVerifier = null;

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
    if (RELAY_CONFIG.relay.enabled) {
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
      const websocketMiddleware = async (req, socket, head) => {
        try {
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

          // In development mode, allow all connections
          if (process.env.NODE_ENV === "development") {
            console.log(
              "Development mode - allowing all WebSocket connections"
            );
            // Continue with the upgrade process
            if (
              url === "/gun" ||
              url.startsWith("/gun?") ||
              url.startsWith("/gun/")
            ) {
              console.log(
                `Handling WebSocket connection for GunDB in development mode`
              );
              return; // Let Gun handle the upgrade
            } else {
              console.log(
                `Unhandled WebSocket request in development mode: ${url}`
              );
              socket.destroy();
              return;
            }
          }

          // PRODUCTION MODE CHECKS
          // In production, require valid authentication
          let isAuthenticated = false;

          // Aggiungi un intercettore per bloccare esplicitamente messaggi da utenti non autorizzati
          gun.on("opt", function (context) {
            if (context.once) {
              return;
            }

            console.log("[DEBUG] Gun.on.opt middleware initialized");

            // Aggancia un hook a tutti i messaggi in entrata
            this.to.next(context);

            // Intercetta i messaggi OUT (le scritture) prima che vengano elaborate
            context.on("out", function (msg) {
              // Salva il riferimento a this per usarlo nelle funzioni asincrone
              const self = this;

              // DEBUGGING
              if (msg.put && Object.keys(msg.put).length > 0) {
                console.log("[DEBUG] Gun.on.out: Detected PUT message");
                const putKeys = Object.keys(msg.put);
                console.log(`[DEBUG] PUT keys: ${putKeys.join(", ")}`);
                
                // Extract pubKey for debugging
                let pubKey = null;
                for (const key of putKeys) {
                  if (key.startsWith("~")) {
                    const dotIndex = key.indexOf(".");
                    pubKey = dotIndex > 0 ? key.substring(1, dotIndex) : key.substring(1);
                    break;
                  }
                }
                if (!pubKey && msg.user && msg.user.pub) pubKey = msg.user.pub;
                if (!pubKey && msg.from && msg.from.pub) pubKey = msg.from.pub;
                if (!pubKey && msg.pub) pubKey = msg.pub;
                
                if (pubKey) {
                  console.log(`[DEBUG] Found pubKey: ${pubKey.substring(0, 10)}...`);
                }
                
                console.log(`[DEBUG] RELAY_CONFIG.relay.enabled: ${RELAY_CONFIG.relay.enabled}`);
                console.log(`[DEBUG] RELAY_CONFIG.relay.onchainMembership: ${RELAY_CONFIG.relay.onchainMembership}`);
                console.log(`[DEBUG] relayVerifier available: ${!!relayVerifier}`);
                console.log(`[DEBUG] process.env.NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
              }

              // DEVELOPMENT MODE BYPASS - DISABLED TO ENFORCE RELAY AUTH
              // if (process.env.NODE_ENV === "development") {
              //   console.log(
              //     "[Gun.on.out] Development mode: Bypassing authorization."
              //   );
              //   return self.to.next(msg); // Allow message
              // }

              // Intercetta i messaggi in ingresso che contengono dati
              const containsPut = msg.put && Object.keys(msg.put).length > 0;

              // Verifica se il messaggio è una scrittura (contiene put)
              if (
                containsPut &&
                RELAY_CONFIG.relay.enabled &&
                RELAY_CONFIG.relay.onchainMembership &&
                relayVerifier
              ) {
                // Funzione per estrarre e verificare la chiave pubblica
                const verifyPubKey = async function () {
                  console.log("===== RELAY AUTHORIZATION CHECK TRIGGERED =====");
                  let pubKey = null;

                  // Estrai la chiave pubblica
                  // Cerca nei nodi put che iniziano con ~
                  const putKeys = Object.keys(msg.put);
                  for (const key of putKeys) {
                    if (key.startsWith("~")) {
                      const dotIndex = key.indexOf(".");
                      pubKey =
                        dotIndex > 0
                          ? key.substring(1, dotIndex)
                          : key.substring(1);
                      break;
                    }
                  }

                  // Se non trovata in put, cerca in altri campi del messaggio
                  if (!pubKey) {
                    if (msg.user && msg.user.pub) {
                      pubKey = msg.user.pub;
                    } else if (msg.from && msg.from.pub) {
                      pubKey = msg.from.pub;
                    } else if (msg.pub) {
                      pubKey = msg.pub;
                    }
                  }

                  if (pubKey) {
                    console.log(`[AUTH CHECK] Found pubKey: ${pubKey}`);
                    try {
                      // Converti pubKey in formato hex
                      const hexPubKey = gunPubKeyToHex(pubKey);
                      if (!hexPubKey) {
                        console.warn(
                          `[AUTH CHECK FAILED] Failed to convert pubKey ${pubKey.substring(
                            0,
                            10
                          )}... to hex format`
                        );
                        return false;
                      }
                      console.log(`[AUTH CHECK] Converted to hex: ${hexPubKey}`);

                      // Get all active relays for this user
                      console.log(`[AUTH CHECK] Getting all active relays...`);
                      const activeRelays = await relayVerifier.getAllRelays();
                      console.log(`[AUTH CHECK] Found ${activeRelays.length} relays`);
                      
                      // If there are no active relays, reject
                      if (!activeRelays || activeRelays.length === 0) {
                        console.warn(`[AUTH CHECK FAILED] No active relays found, rejecting message`);
                        return false;
                      }
                      
                      // Check each relay until we find one that authorizes this pubkey
                      let isAuthorized = false;
                      for (const relayAddress of activeRelays) {
                        console.log(`[AUTH CHECK] Checking authorization on relay ${relayAddress}...`);
                        isAuthorized = await relayVerifier.isPublicKeyAuthorized(
                          relayAddress,
                          hexPubKey
                        );
                        
                        if (isAuthorized) {
                          console.log(`[AUTH CHECK SUCCESS] Key authorized by relay ${relayAddress}`);
                          break;
                        }
                      }

                      if (!isAuthorized) {
                        console.warn(
                          `[AUTH CHECK FAILED] BLOCKING write from unauthorized key ${pubKey.substring(
                            0,
                            10
                          )}...`
                        );
                        return false;
                      }

                      console.log(
                        `[AUTH CHECK SUCCESS] Allowing write from authorized key ${pubKey.substring(
                          0,
                          10
                        )}...`
                      );
                      return true;
                    } catch (error) {
                      console.error(
                        `[AUTH CHECK ERROR] Error during authorization check:`,
                        error
                      );
                      return false;
                    }
                  } else {
                    console.warn(
                      `[AUTH CHECK FAILED] Could not find pubKey in message`
                    );
                    return false;
                  }
                };

                // Esegui la verifica in modo asincrono ma blocca il flusso fino al completamento
                verifyPubKey()
                  .then((isAuthorized) => {
                    if (isAuthorized) {
                      // Solo se autorizzato, continua con il messaggio
                      self.to.next(msg);
                    } else {
                      // Altrimenti, blocca silenziosamente la scrittura non propagando il messaggio
                      console.warn(
                        `[Gun.on.out] Message was blocked from propagating`
                      );
                      // Forza un ACK di errore per il client
                      if (msg._.via && msg._.via.say) {
                        try {
                          msg._.via.say({
                            err: "Unauthorized: Your public key is not authorized on-chain",
                            ok: 0,
                            "@": msg["#"],
                          });
                        } catch (e) {
                          console.error(
                            "[Gun.on.out] Error sending rejection message:",
                            e
                          );
                        }
                      }
                    }
                  })
                  .catch((err) => {
                    console.error(
                      `[Gun.on.out] Error in verification process:`,
                      err
                    );
                    // In caso di errore, blocca la richiesta
                  });

                // IMPORTANTE: Ritorna senza chiamare next() per bloccare il flusso normale
                // La propagazione avverrà solo quando verifyPubKey() restituirà true
                return;
              }

              // Se non è un messaggio put o non abbiamo bisogno di verificarlo, continua normalmente
              this.to.next(msg);
            });

            // Manteniamo anche l'intercettore 'in' per sicurezza
            context.on("in", function (msg) {
              // Salva il riferimento a this per usarlo nelle funzioni asincrone
              const self = this;

              // Intercetta i messaggi in ingresso che contengono dati
              const containsPut = msg.put && Object.keys(msg.put).length > 0;

              // Se il messaggio contiene dati in put e onchainMembership è abilitato
              if (
                containsPut &&
                RELAY_CONFIG.relay.enabled &&
                RELAY_CONFIG.relay.onchainMembership &&
                relayVerifier
              ) {
                // Funzione per estrarre e verificare la chiave pubblica
                const verifyPubKey = async function () {
                  console.log("===== RELAY AUTHORIZATION CHECK TRIGGERED =====");
                  let pubKey = null;

                  // Estrai la chiave pubblica
                  // Cerca nei nodi put che iniziano con ~
                  const putKeys = Object.keys(msg.put);
                  for (const key of putKeys) {
                    if (key.startsWith("~")) {
                      const dotIndex = key.indexOf(".");
                      pubKey =
                        dotIndex > 0
                          ? key.substring(1, dotIndex)
                          : key.substring(1);
                      break;
                    }
                  }

                  // Se non trovata in put, cerca in altri campi del messaggio
                  if (!pubKey) {
                    if (msg.user && msg.user.pub) {
                      pubKey = msg.user.pub;
                    } else if (msg.from && msg.from.pub) {
                      pubKey = msg.from.pub;
                    } else if (msg.pub) {
                      pubKey = msg.pub;
                    }
                  }

                  if (pubKey) {
                    console.log(`[AUTH CHECK] Found pubKey: ${pubKey}`);
                    try {
                      // Converti pubKey in formato hex
                      const hexPubKey = gunPubKeyToHex(pubKey);
                      if (!hexPubKey) {
                        console.warn(
                          `[AUTH CHECK FAILED] Failed to convert pubKey ${pubKey.substring(
                            0,
                            10
                          )}... to hex format`
                        );
                        return false;
                      }
                      console.log(`[AUTH CHECK] Converted to hex: ${hexPubKey}`);

                      // Get all active relays for this user
                      console.log(`[AUTH CHECK] Getting all active relays...`);
                      const activeRelays = await relayVerifier.getAllRelays();
                      console.log(`[AUTH CHECK] Found ${activeRelays.length} relays`);
                      
                      // If there are no active relays, reject
                      if (!activeRelays || activeRelays.length === 0) {
                        console.warn(`[AUTH CHECK FAILED] No active relays found, rejecting message`);
                        return false;
                      }
                      
                      // Check each relay until we find one that authorizes this pubkey
                      let isAuthorized = false;
                      for (const relayAddress of activeRelays) {
                        console.log(`[AUTH CHECK] Checking authorization on relay ${relayAddress}...`);
                        isAuthorized = await relayVerifier.isPublicKeyAuthorized(
                          relayAddress,
                          hexPubKey
                        );
                        
                        if (isAuthorized) {
                          console.log(`[AUTH CHECK SUCCESS] Key authorized by relay ${relayAddress}`);
                          break;
                        }
                      }

                      if (!isAuthorized) {
                        console.warn(
                          `[AUTH CHECK FAILED] BLOCKING write from unauthorized key ${pubKey.substring(
                            0,
                            10
                          )}...`
                        );
                        return false;
                      }

                      console.log(
                        `[AUTH CHECK SUCCESS] Allowing write from authorized key ${pubKey.substring(
                          0,
                          10
                        )}...`
                      );
                      return true;
                    } catch (error) {
                      console.error(
                        `[AUTH CHECK ERROR] Error during authorization check:`,
                        error
                      );
                      return false;
                    }
                  } else {
                    console.warn(
                      `[AUTH CHECK FAILED] Could not find pubKey in message`
                    );
                    return false;
                  }
                };

                // Esegui la verifica in modo asincrono ma blocca il flusso fino al completamento
                verifyPubKey()
                  .then((isAuthorized) => {
                    if (isAuthorized) {
                      // Solo se autorizzato, continua con il messaggio
                      self.to.next(msg);
                    } else {
                      // Altrimenti, blocca silenziosamente il messaggio non propagandolo
                      console.warn(
                        `[Gun.on.in] Message was blocked from propagating`
                      );
                    }
                  })
                  .catch((err) => {
                    console.error(
                      `[Gun.on.in] Error in verification process:`,
                      err
                    );
                    // In caso di errore, blocca il messaggio
                  });

                // IMPORTANTE: Ritorna senza chiamare next() per bloccare il flusso normale
                // La propagazione avverrà solo quando verifyPubKey() restituirà true
                return;
              }

              // Se non è un messaggio con put o non abbiamo bisogno di verificarlo, continua normalmente
              this.to.next(msg);
            });

            // AGGIUNTA: Intercetta a livello di storage per impedire scritture non autorizzate
            if (
              context.on &&
              RELAY_CONFIG.relay.enabled &&
              RELAY_CONFIG.relay.onchainMembership &&
              relayVerifier
            ) {
              // Mantieni un riferimento al put originale
              const originalPut = context.on.put;

              // Sostituisci con la nostra versione che verifica l'autorizzazione prima di salvare
              context.on.put = function (msg) {
                // Salva il riferimento al this e agli argomenti originali
                const self = this;
                const args = arguments;

                // DEVELOPMENT MODE BYPASS
                if (process.env.NODE_ENV === "development") {
                  console.log(
                    "[Gun.on.put] Development mode: Bypassing authorization for storage."
                  );
                  return originalPut.apply(self, args); // Allow storage
                }

                // Se non contiene dati, procedi normalmente
                if (!msg || !msg.put || Object.keys(msg.put).length === 0) {
                  return originalPut.apply(self, args);
                }

                // Estrai pubKey dai dati
                let pubKey = null;
                try {
                  const putKeys = Object.keys(msg.put);
                  for (const key of putKeys) {
                    if (key.startsWith("~")) {
                      const dotIndex = key.indexOf(".");
                      pubKey =
                        dotIndex > 0
                          ? key.substring(1, dotIndex)
                          : key.substring(1);
                      break;
                    }
                  }

                  // Controlla anche altri campi comuni
                  if (!pubKey) {
                    if (msg.user && msg.user.pub) pubKey = msg.user.pub;
                    else if (msg.from && msg.from.pub) pubKey = msg.from.pub;
                    else if (msg.pub) pubKey = msg.pub;
                  }
                } catch (e) {
                  console.error("[Gun.on.put] Error extracting pubKey:", e);
                }

                // Se non abbiamo una chiave pubblica, blocca per sicurezza nel dubbio
                if (!pubKey) {
                  console.warn(
                    "[Gun.on.put] No pubKey found, blocking storage operation"
                  );
                  return; // Non chiamare originalPut
                }

                // Verifica se il pubKey è autorizzato prima di scrivere
                (async () => {
                  try {
                    const hexPubKey = gunPubKeyToHex(pubKey);
                    if (!hexPubKey) {
                      console.warn(
                        `[Gun.on.put] Failed to convert pubKey ${pubKey.substring(
                          0,
                          10
                        )}... to hex format`
                      );
                      return; // Non chiamare originalPut
                    }

                    const isAuthorized =
                      await relayVerifier.isPublicKeyAuthorized(
                        hexPubKey
                      );

                    if (isAuthorized) {
                      console.log(
                        `[Gun.on.put] Authorizing STORAGE for key ${pubKey.substring(
                          0,
                          10
                        )}...`
                      );
                      originalPut.apply(self, args);
                    } else {
                      console.warn(
                        `[Gun.on.put] BLOCKING STORAGE for unauthorized key ${pubKey.substring(
                          0,
                          10
                        )}...`
                      );
                      // Non chiamare originalPut, effettivamente impedendo la persistenza del dato
                    }
                  } catch (error) {
                    console.error(
                      `[Gun.on.put] Error during authorization check:`,
                      error
                    );
                    // In caso di errore di verifica, per sicurezza non procediamo con la scrittura
                  }
                })();

                // Non chiamare originalPut qui - sarà chiamato solo dopo verifica positiva
                return;
              };
            }
          });

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

              if (token) {
                const tokenData = await validateUserToken(token);
                isAuthenticated = !!tokenData;

                if (isAuthenticated) {
                  console.log("Valid URL token, authentication succeeded");
                } else {
                  console.warn("Invalid token provided in URL");
                }
              }
            } catch (e) {
              console.error(
                "Error parsing URL or validating token:",
                e.message
              );
            }
          }

          // If not authenticated in production, reject the connection
          if (!isAuthenticated) {
            console.warn(
              `WebSocket upgrade rejected: authentication required in production`
            );
            socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
            socket.destroy();
            return;
          }

          // Authentication passed, handle the connection
          if (
            url === "/gun" ||
            url.startsWith("/gun?") ||
            url.startsWith("/gun/")
          ) {
            console.log(
              `Handling authenticated WebSocket connection for GunDB`
            );
            return; // Let Gun handle the upgrade
          } else {
            console.log(`Unhandled WebSocket request: ${url}`);
            socket.destroy();
            return;
          }
        } catch (error) {
          console.error("Error in websocketMiddleware:", error);
          socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
          socket.destroy();
        }
      };

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

// ============ RELAY VERIFIER API ============

// API - Check relay status
app.get(
  "/api/relay/status",
  authenticateRequest,
  async (req, res) => {
    try {
      // Verify that RelayVerifier is initialized
      if (!RELAY_CONFIG.relay.enabled || !relayVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay services not available",
          config: {
            enabled: RELAY_CONFIG.relay.enabled,
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
          enabled: RELAY_CONFIG.relay.enabled,
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
  }
);

// API - Get all relays
app.get(
  "/api/relay/all",
  authenticateRequest,
  async (req, res) => {
    try {
      // Verify that RelayVerifier is initialized
      if (!RELAY_CONFIG.relay.enabled || !relayVerifier) {
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
  }
);

// API - Check if user is subscribed to a relay
app.get(
  "/api/relay/check-subscription/:relayAddress/:userAddress",
  authenticateRequest,
  async (req, res) => {
    try {
      const { relayAddress, userAddress } = req.params;

      // Verify that RelayVerifier is initialized
      if (!RELAY_CONFIG.relay.enabled || !relayVerifier) {
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
      if (!RELAY_CONFIG.relay.enabled || !relayVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay services not available",
        });
      }

      // Get all relays the user is subscribed to
      const relayAddresses = await relayVerifier.getUserActiveRelays(userAddress);
      
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
app.post(
  "/api/relay/check-pubkey",
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

      // Verify that RelayVerifier is initialized
      if (!RELAY_CONFIG.relay.enabled || !relayVerifier) {
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
          console.error(`Error checking authorization on relay ${address}:`, error);
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
  }
);

// API - Get user subscription info for a specific relay
app.get(
  "/api/relay/subscription-info/:relayAddress/:userAddress",
  authenticateRequest,
  async (req, res) => {
    try {
      const { relayAddress, userAddress } = req.params;

      // Verify that RelayVerifier is initialized
      if (!RELAY_CONFIG.relay.enabled || !relayVerifier) {
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
app.post(
  "/api/relay/subscribe",
  authenticateRequest,
  async (req, res) => {
    try {
      const { relayAddress, months, publicKey } = req.body;

      if (!relayAddress || !months) {
        return res.status(400).json({
          success: false,
          error: "Relay address and number of months are required",
        });
      }

      // Verify that RelayVerifier is initialized
      if (!RELAY_CONFIG.relay.enabled || !relayVerifier) {
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
  }
);

// API - Update relay config
app.post(
  "/api/relay/config",
  authenticateRequest,
  async (req, res) => {
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
        RELAY_CONFIG.relay.enabled = enabled;
      }

      if (registryAddress) {
        RELAY_CONFIG.relay.registryAddress = registryAddress;
      }

      if (providerUrl) {
        RELAY_CONFIG.relay.providerUrl = providerUrl;
      }

      // Reinitialize relay components
      if (RELAY_CONFIG.relay.enabled) {
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
          enabled: RELAY_CONFIG.relay.enabled,
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

export default app;
