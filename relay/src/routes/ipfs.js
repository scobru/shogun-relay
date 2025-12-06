import express from 'express';
import http from 'http';
import FormData from 'form-data';
import multer from 'multer';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { X402Merchant } from '../utils/x402-merchant.js';
import { ipfsUpload } from '../utils/ipfs-client.js';

const router = express.Router();

// Configurazione IPFS
const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN;

// Configurazione multer per upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

// Funzione helper per ottenere il token JWT IPFS
function getIpfsJwtToken() {
  if (IPFS_API_TOKEN) {
    return IPFS_API_TOKEN;
  }
  return null;
}

// Funzione helper per ottenere l'header di autenticazione IPFS
function getIpfsAuthHeader() {
  const token = getIpfsJwtToken();
  if (token) {
    return `Bearer ${token}`;
  }
  return null;
}

// IPFS API Proxy - for API calls to the IPFS node
// Example: /api/v0/add, /api/v0/cat, etc.
// SECURED: This generic proxy requires the admin token for any access.
router.use(
  "/proxy",
  (req, res, next) => {
    // Middleware di autenticazione per il proxy
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (token === process.env.ADMIN_PASSWORD) {
      next();
    } else {
      console.log("Auth failed - Bearer:", bearerToken, "Custom:", customToken);
      res.status(401).json({ success: false, error: "Unauthorized" });
    }
  },
  createProxyMiddleware({
    target: IPFS_API_URL,
    changeOrigin: true,
    pathRewrite: {
      "^/proxy": "/api/v0",
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(
        `🔧 IPFS API Request: ${req.method} ${req.url} -> ${IPFS_API_URL}${req.url}`
      );

      // Add authentication headers for IPFS API
      if (IPFS_API_TOKEN) {
        proxyReq.setHeader("Authorization", `Bearer ${IPFS_API_TOKEN}`);
      }

      // IPFS API requires POST method for most endpoints
      // Override GET requests to POST for IPFS API endpoints
      if (
        req.method === "GET" &&
        (req.url.includes("/version") ||
          req.url.includes("/id") ||
          req.url.includes("/peers"))
      ) {
        proxyReq.method = "POST";
        proxyReq.setHeader("Content-Length", "0");
      }

      // Add query parameter to get JSON response
      if (req.url.includes("/version")) {
        const originalPath = proxyReq.path;
        proxyReq.path =
          originalPath +
          (originalPath.includes("?") ? "&" : "?") +
          "format=json";
      }
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(
        `📤 IPFS API Response: ${proxyRes.statusCode} for ${req.method} ${req.url}`
      );

      // Handle non-JSON responses from IPFS
      if (
        proxyRes.headers["content-type"] &&
        !proxyRes.headers["content-type"].includes("application/json")
      ) {
        console.log(
          `📝 IPFS Response Content-Type: ${proxyRes.headers["content-type"]}`
        );
      }
    },
    onError: (err, req, res) => {
      console.error("❌ IPFS API Proxy Error:", err.message);
      res.status(500).json({
        success: false,
        error: "IPFS API unavailable",
        details: err.message,
      });
    },
  })
);

// Middleware di autenticazione per webui
function ensureAdmin(req, res, next) {
  const authHeader = req.headers["authorization"];
  const bearerToken = authHeader && authHeader.split(" ")[1];
  const customHeaderToken = req.headers["token"];
  const queryToken =
    req.query?.auth_token ||
    req.query?.token ||
    req.query?._auth_token;
  const token = bearerToken || customHeaderToken || queryToken;

  if (token === process.env.ADMIN_PASSWORD) {
    // Rimuovi il token dalla query string prima di proxy-passarlo
    if (queryToken) {
      const cleanedQuery = { ...req.query };
      delete cleanedQuery.auth_token;
      delete cleanedQuery.token;

      const queryString = new URLSearchParams(cleanedQuery).toString();
      req.url = req.path + (queryString ? `?${queryString}` : "");
    }

    next();
  } else {
    res.status(401).json({ success: false, error: "Unauthorized" });
  }
}

// Note: Kubo WebUI proxy removed for security reasons
// Access Kubo WebUI directly at http://localhost:5001/webui if needed

// Custom IPFS API endpoints with better error handling
router.post("/api/:endpoint(*)", async (req, res) => {
  try {
    const endpoint = req.params.endpoint;
    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/${endpoint}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        console.log(`📡 IPFS API ${endpoint} raw response:`, data);

        try {
          // Try to parse as JSON
          const jsonData = JSON.parse(data);
          res.json({
            success: true,
            endpoint: endpoint,
            data: jsonData,
          });
        } catch (parseError) {
          // If not JSON, check if it's a structured response
          if (data.trim()) {
            // Try to clean the response
            const cleanData = data.replace(/^\uFEFF/, ""); // Remove BOM
            try {
              const jsonData = JSON.parse(cleanData);
              res.json({
                success: true,
                endpoint: endpoint,
                data: jsonData,
              });
            } catch (cleanParseError) {
              res.json({
                success: false,
                endpoint: endpoint,
                error: "Invalid JSON response",
                rawResponse: data,
                parseError: cleanParseError.message,
              });
            }
          } else {
            res.json({
              success: false,
              endpoint: endpoint,
              error: "Empty response",
              rawResponse: data,
            });
          }
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error(`❌ IPFS API ${endpoint} error:`, err);
      res.status(500).json({
        success: false,
        endpoint: endpoint,
        error: err.message,
      });
    });

    ipfsReq.setTimeout(10000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          endpoint: endpoint,
          error: "Request timeout",
        });
      }
    });

    ipfsReq.end();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// IPFS File Upload endpoint with dual authentication and x402 subscription check
router.post("/upload", 
  async (req, res, next) => {
    // Check both admin and user authentication
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const adminToken = bearerToken || customToken;
    const isAdmin = adminToken === process.env.ADMIN_PASSWORD;
    
    // Check for user address header (for x402 subscription-based uploads)
    const userAddress = req.headers["x-user-address"];
    
    if (isAdmin) {
      req.authType = 'admin';
      next();
    } else if (userAddress) {
      // User-based upload - can be for subscriptions OR storage deals
      req.authType = 'user';
      req.userAddress = userAddress;
      
      // Check if this is for a storage deal (no subscription required)
      // Storage deals are paid on-chain, so upload should work without subscription
      const isDealUpload = req.headers['x-deal-upload'] === 'true' || req.query.deal === 'true';
      
      if (isDealUpload) {
        // Allow upload for storage deals without subscription check
        console.log(`Upload allowed for storage deal - user: ${userAddress}`);
        req.isDealUpload = true;
        next();
      } else if (process.env.X402_PAY_TO_ADDRESS) {
        // For subscription-based uploads, check subscription status
        const gun = req.app.get('gunInstance');
        if (!gun) {
          return res.status(500).json({ success: false, error: "Server error - Gun instance not available" });
        }
        
        try {
          const subscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);
          
          if (!subscription.active) {
            console.log(`Upload denied - No active subscription for ${userAddress}: ${subscription.reason}`);
            return res.status(402).json({
              success: false,
              error: "Payment required - No active subscription",
              reason: subscription.reason,
              subscriptionRequired: true,
              endpoint: "/api/v1/x402/subscribe",
              tiers: "/api/v1/x402/tiers",
            });
          }
          
          req.subscription = subscription;
          console.log(`User ${userAddress} has active ${subscription.tier} subscription with ${subscription.storageRemainingMB}MB remaining`);
          next();
        } catch (error) {
          console.error("Subscription check error:", error);
          return res.status(500).json({ success: false, error: "Error checking subscription status" });
        }
      } else {
        // X402 not configured, allow upload anyway (for deals)
        console.log(`Upload allowed - X402 not configured, treating as deal upload`);
        req.isDealUpload = true;
        next();
      }
    } else {
      console.log("Auth failed - Admin token:", adminToken ? "provided" : "missing", "User address:", userAddress ? "provided" : "missing");
      res.status(401).json({ 
        success: false, 
        error: "Unauthorized - Admin token or x402 subscription required",
        hint: "Provide Authorization header with admin token, or X-User-Address header with a valid x402 subscription"
      });
    }
  },
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No file provided",
        });
      }

      // For user uploads with x402 subscription, verify real IPFS storage before allowing upload
      if (req.authType === 'user' && req.subscription) {
        const fileSizeMB = req.file.size / (1024 * 1024);
        
        // Get IPFS config
        const ipfsApiUrl = req.app.get('IPFS_API_URL') || process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
        const ipfsApiToken = req.app.get('IPFS_API_TOKEN') || process.env.IPFS_API_TOKEN;
        const gun = req.app.get('gunInstance');
        
        // Verify real storage usage from IPFS
        console.log(`Verifying real IPFS storage for ${req.userAddress} before upload...`);
        const canUploadResult = await X402Merchant.canUploadVerified(
          gun, 
          req.userAddress, 
          fileSizeMB, 
          ipfsApiUrl, 
          ipfsApiToken
        );
        
        if (!canUploadResult.allowed) {
          console.log(`Upload denied for ${req.userAddress}: ${canUploadResult.reason}`);
          return res.status(402).json({
            success: false,
            error: "Storage limit exceeded",
            details: {
              fileSizeMB: fileSizeMB.toFixed(2),
              storageUsedMB: canUploadResult.storageUsedMB?.toFixed(2) || '0',
              storageRemainingMB: canUploadResult.storageRemainingMB?.toFixed(2) || '0',
              storageTotalMB: canUploadResult.storageTotalMB || req.subscription.storageMB,
              tier: canUploadResult.currentTier || req.subscription.tier,
              verified: canUploadResult.verified,
            },
            reason: canUploadResult.reason,
            upgradeRequired: canUploadResult.requiresUpgrade,
            endpoint: "/api/v1/x402/subscribe",
            tiers: "/api/v1/x402/tiers",
          });
        }
        
        // Update subscription info with verified data
        req.verifiedStorage = canUploadResult;
        console.log(`Upload allowed. Storage: ${canUploadResult.storageUsedMB?.toFixed(2)}MB / ${canUploadResult.storageTotalMB}MB`);
      }

      const formData = new FormData();
      formData.append("file", req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      // Use IPFS client utility with automatic retry
      const fileResult = await ipfsUpload('/api/v0/add?wrap-with-directory=false', formData, {
        timeout: 60000,
        maxRetries: 3,
        retryDelay: 1000,
      });

      console.log("📤 IPFS Upload response:", fileResult);

      const uploadData = {
        name: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        hash: fileResult.Hash,
        sizeBytes: fileResult.Size,
        uploadedAt: Date.now(),
      };

            // If user upload, save to Gun database and update MB usage
            // Skip GunDB save for deal uploads (they're tracked on-chain)
            if (req.authType === 'user' && req.userAddress && !req.isDealUpload) {
              const gun = req.app.get('gunInstance');
              const fileSizeMB = req.file.size / (1024 * 1024);
              
              uploadData.sizeMB = fileSizeMB;
              uploadData.userAddress = req.userAddress;

              // Save all necessary values to avoid reference errors
              const userAddress = req.userAddress;
              const authType = req.authType;
              const fileSize = req.file.size;

              console.log(`💾 Saving upload to GunDB:`, {
                userAddress: req.userAddress,
                fileHash: fileResult.Hash,
                uploadData: uploadData
              });

              // Save upload to Gun database with Promise
              const saveUploadPromise = new Promise((resolve, reject) => {
                const uploadsNode = gun.get("shogun").get("uploads").get(req.userAddress);
                uploadsNode.get(fileResult.Hash).put(uploadData, (ack) => {
                  console.log(`💾 Upload save ack:`, ack);
                  if (ack && ack.err) {
                    console.error(`❌ Error saving upload:`, ack.err);
                    reject(new Error(ack.err));
                  } else {
                    console.log(`✅ Upload saved successfully to GunDB`);
                    resolve();
                  }
                });
              });

              // Update MB usage with Promise
              const updateMBPromise = new Promise((resolve, reject) => {
                const mbUsageNode = gun.get("shogun").get("mbUsage").get(req.userAddress);
                mbUsageNode.once((currentUsage) => {
                  console.log(`📊 Current MB usage:`, currentUsage);
                  const newUsage = {
                    mbUsed: (currentUsage?.mbUsed || 0) + fileSizeMB,
                    lastUpdated: Date.now(),
                    updatedBy: "file-upload",
                  };
                  console.log(`📊 New MB usage:`, newUsage);
                  mbUsageNode.put(newUsage, (mbAck) => {
                    console.log(`📊 MB usage update ack:`, mbAck);
                    if (mbAck && mbAck.err) {
                      console.error(`❌ Error updating MB usage:`, mbAck.err);
                      reject(new Error(mbAck.err));
                    } else {
                      console.log(`✅ MB usage updated successfully`);
                      resolve();
                    }
                  });
                });
              });

              // Save hash to systemhash node with Promise
              const saveSystemHashPromise = new Promise((resolve) => {
                // Call the save-system-hash endpoint with admin token
                const adminToken = process.env.ADMIN_PASSWORD;
                if (!adminToken) {
                  console.warn(`⚠️ ADMIN_PASSWORD not set, skipping system hash save`);
                  resolve({ error: "ADMIN_PASSWORD not configured" });
                  return;
                }

                const systemHashData = {
                  hash: fileResult.Hash,
                  userAddress: userAddress,
                  timestamp: Date.now()
                };

                // Make internal request to save-system-hash endpoint
                const postData = JSON.stringify(systemHashData);
                
                const options = {
                  hostname: 'localhost',
                  port: 8765,
                  path: '/api/v1/user-uploads/save-system-hash',
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'Authorization': `Bearer ${adminToken}`
                  }
                };

                const httpReq = http.request(options, (res) => {
                  let data = '';
                  res.on('data', (chunk) => {
                    data += chunk;
                  });
                  res.on('end', () => {
                    try {
                      const result = JSON.parse(data);
                      if (result.success) {
                        console.log(`✅ System hash saved successfully via endpoint`);
                        resolve({ success: true });
                      } else {
                        console.error(`❌ Error saving system hash via endpoint:`, result.error);
                        resolve({ error: result.error });
                      }
                    } catch (parseError) {
                      console.error(`❌ Error parsing system hash response:`, parseError);
                      resolve({ error: parseError.message });
                    }
                  });
                });

                httpReq.on('error', (error) => {
                  console.error(`❌ Error calling system hash endpoint:`, error);
                  resolve({ error: error.message });
                });

                httpReq.write(postData);
                httpReq.end();
              });

              // Update x402 subscription storage if applicable
              let subscriptionUpdatePromise = Promise.resolve();
              if (req.subscription) {
                // Save upload record to relay user space
                const uploadRecordPromise = X402Merchant.saveUploadRecord(req.userAddress, fileResult.Hash, {
                  name: req.file.originalname,
                  size: req.file.size,
                  sizeMB: fileSizeMB,
                  mimetype: req.file.mimetype,
                  uploadedAt: Date.now(),
                }).catch((err) => {
                  console.warn(`⚠️ Failed to save upload record to relay space:`, err.message);
                });

                subscriptionUpdatePromise = Promise.all([
                  uploadRecordPromise,
                  X402Merchant.updateStorageUsage(gun, req.userAddress, fileSizeMB)
                ])
                  .then(([, result]) => {
                    console.log(`📊 Subscription storage updated: ${result.storageUsedMB}MB used, ${result.storageRemainingMB}MB remaining`);
                    return result;
                  })
                  .catch((err) => {
                    console.warn(`⚠️ Subscription storage update failed:`, err.message);
                    return null;
                  });
              }

              // Wait for critical operations to complete (upload and MB usage)
              Promise.all([saveUploadPromise, updateMBPromise, subscriptionUpdatePromise])
                .then(([, , subscriptionResult]) => {
                  console.log(`📊 User upload saved: ${req.userAddress} - ${fileSizeMB} MB`);
                  
                  // Try to save system hash but don't block the response
                  saveSystemHashPromise.then((systemHashResult) => {
                    if (systemHashResult.error) {
                      console.warn(`⚠️ System hash save failed but upload completed:`, systemHashResult.error);
                    } else {
                      console.log(`✅ System hash saved successfully`);
                    }
                  }).catch((systemHashError) => {
                    console.warn(`⚠️ System hash save failed but upload completed:`, systemHashError);
                  });
                  
                  // Send response immediately after critical operations
                  res.json({
                    success: true,
                    file: uploadData,
                    authType: req.authType,
                    mbUsage: req.authType === 'user' ? {
                      actualSizeMB: +(req.file.size / 1024 / 1024).toFixed(2),
                      sizeMB: Math.ceil(req.file.size / (1024 * 1024)),
                      verified: true
                    } : undefined,
                    subscription: subscriptionResult ? {
                      storageUsedMB: subscriptionResult.storageUsedMB,
                      storageRemainingMB: subscriptionResult.storageRemainingMB,
                    } : undefined,
                  });
                })
                .catch((error) => {
                  console.error(`❌ Error during critical GunDB save:`, error);
                  // Send response anyway, the file is already on IPFS
                  res.json({
                    success: true,
                    file: uploadData,
                    authType: req.authType,
                    mbUsage: req.authType === 'user' ? {
                      actualSizeMB: +(req.file.size / 1024 / 1024).toFixed(2),
                      sizeMB: Math.ceil(req.file.size / (1024 * 1024)),
                      verified: false,
                      error: error.message
                    } : undefined
                  });
                });
            } else {
              // For admin uploads, send response immediately
              res.json({
                success: true,
                file: uploadData,
                authType: req.authType
              });
            }
    } catch (error) {
      console.error("❌ IPFS Upload error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// IPFS Status endpoint
router.get("/status", async (req, res) => {
  try {
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
            commit: versionData.Commit,
            go: versionData.Golang,
          });
        } catch (parseError) {
          res.json({
            success: false,
            status: "error",
            error: "Failed to parse IPFS response",
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      res.json({
        success: false,
        status: "disconnected",
        error: err.message,
        message: "IPFS daemon may still be starting up",
      });
    });

    ipfsReq.setTimeout(5000); // 5 second timeout
    ipfsReq.on("timeout", () => {
      ipfsReq.destroy();
      res.json({
        success: false,
        status: "timeout",
        error: "Connection timeout - IPFS daemon may still be starting",
      });
    });

    ipfsReq.end();
  } catch (error) {
    res.status(500).json({
      success: false,
      status: "error",
      error: error.message,
    });
  }
});

// IPFS Cat endpoint (aligned with Kubo's /api/v0/cat)
router.get("/cat/:cid", async (req, res) => {
  try {
    const { cid } = req.params;
    console.log(`📄 IPFS Content request for CID: ${cid}`);

    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${cid}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      // Set appropriate headers
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${cid}"`);
      res.setHeader("Cache-Control", "public, max-age=31536000"); // 1 year cache

      // Pipe the response directly
      ipfsRes.pipe(res);

      ipfsRes.on("error", (err) => {
        console.error(`❌ IPFS Content error for ${cid}:`, err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: err.message,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error(`❌ IPFS Content request error for ${cid}:`, err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });

    ipfsReq.setTimeout(30000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: "Content retrieval timeout",
        });
      }
    });

    ipfsReq.end();
  } catch (error) {
    console.error(`❌ IPFS Content error for ${req.params.cid}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// IPFS Cat with decryption (for SEA encrypted content)
router.get("/cat/:cid/decrypt", async (req, res) => {
  try {
    const { cid } = req.params;
    let { token } = req.query;
    const userAddress = req.headers['x-user-address']; // Optional: user address for signature verification
    const IPFS_GATEWAY_URL = process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";

    console.log(`🔓 IPFS Decrypt request for CID: ${cid}, Token: ${token ? "present" : "missing"}`);

    // Verify signature if userAddress is provided (for enhanced security)
    // The token can be either:
    // 1. An EIP-191 signature (recommended, more secure) - starts with 0x and is long
    // 2. An address (legacy, less secure) - starts with 0x and is short
    // 3. A JSON object (legacy keypair format)
    if (token && userAddress && typeof token === 'string' && token.startsWith('0x') && token.length > 100) {
      // Looks like a signature (long hex string), verify it if ethers is available
      try {
        const { ethers } = await import('ethers');
        const expectedMessage = `Shogun File Encryption\nAddress: ${userAddress.toLowerCase()}`;
        const recoveredAddress = ethers.verifyMessage(expectedMessage, token);
        
        if (recoveredAddress.toLowerCase() !== userAddress.toLowerCase()) {
          console.warn(`⚠️ Signature verification failed: expected ${userAddress}, got ${recoveredAddress}`);
          // Continue anyway - decryption will fail if signature is wrong
        } else {
          console.log(`✅ Signature verified for address: ${userAddress}`);
        }
      } catch (verifyError) {
        // If verification fails, continue - might be a legacy address or different format
        console.warn(`⚠️ Signature verification skipped: ${verifyError.message}`);
      }
    }

    // Parse token if it's a JSON string (not a hex string)
    if (token && typeof token === 'string' && !token.startsWith('0x')) {
      try {
        token = JSON.parse(token);
        console.log(`🔑 Token parsed successfully`);
      } catch (parseError) {
        // Not JSON, use as-is (could be address or signature)
      }
    }

    if (!cid) {
      return res.status(400).json({
        success: false,
        error: "CID is required",
      });
    }

    // Try to use IPFS API first (localhost) for better availability
    // Fallback to gateway if API is not available
    let requestOptions;
    let protocolModule;
    const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN;
    
    // Try API first if we have a local API URL
    const useApi = IPFS_GATEWAY_URL && (IPFS_GATEWAY_URL.includes('127.0.0.1') || IPFS_GATEWAY_URL.includes('localhost'));
    
    if (useApi) {
      // Use IPFS API directly (more reliable for local files)
      protocolModule = await import("http");
      requestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: `/api/v0/cat?arg=${encodeURIComponent(cid)}`,
        method: "POST",
        headers: {
          "Content-Length": "0",
        },
      };
      
      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }
    } else {
      // Use gateway
      const gatewayUrl = new URL(IPFS_GATEWAY_URL);
      protocolModule = gatewayUrl.protocol === "https:"
        ? await import("https")
        : await import("http");
      
      requestOptions = {
        hostname: gatewayUrl.hostname,
        port: gatewayUrl.port
          ? Number(gatewayUrl.port)
          : gatewayUrl.protocol === "https:" ? 443 : 80,
        path: `/ipfs/${cid}`,
        method: "GET",
        headers: {
          Host: gatewayUrl.host,
        },
      };
    }

    const ipfsReq = protocolModule.request(requestOptions, (ipfsRes) => {
      // If no token, just stream the response
      if (!token) {
        console.log(`📤 Streaming content without decryption for CID: ${cid}`);
        res.setHeader("Content-Type", ipfsRes.headers["content-type"] || "application/octet-stream");
        ipfsRes.pipe(res);
        return;
      }

      // If token is provided, buffer the response to decrypt it
      console.log(`🔓 Attempting decryption for CID: ${cid}`);
      let body = "";
      ipfsRes.on("data", (chunk) => (body += chunk));
      ipfsRes.on("end", async () => {
        try {
          // Check if body looks like encrypted JSON (SEA encrypted data)
          let isEncryptedData = false;
          try {
            const parsed = JSON.parse(body);
            // SEA encrypted data has specific structure
            isEncryptedData = parsed && typeof parsed === 'object' && 
                             (parsed.ct || parsed.iv || parsed.s || parsed.salt);
          } catch (e) {
            // Not JSON, probably not encrypted
            isEncryptedData = false;
          }
          
          // Only try to decrypt if it looks like encrypted data
          if (isEncryptedData && token) {
            const SEA = await import("gun/sea.js");
            const decrypted = await SEA.default.decrypt(body, token);

            if (decrypted) {
              console.log(`✅ Decryption successful!`);

              // Check if decrypted data is a data URL
              if (typeof decrypted === 'string' && decrypted.startsWith("data:")) {
                console.log(`📁 Detected data URL, extracting content type and data`);

                const matches = decrypted.match(/^data:([^;]+);base64,(.+)$/);
                if (matches) {
                  const contentType = matches[1];
                  const base64Data = matches[2];
                  const buffer = Buffer.from(base64Data, "base64");

                  res.setHeader("Content-Type", contentType);
                  res.setHeader("Content-Length", buffer.length);
                  res.setHeader("Cache-Control", "public, max-age=3600");
                  res.send(buffer);
                  return;
                } else {
                  res.json({
                    success: true,
                    message: "Decryption successful but could not parse data URL",
                    decryptedData: decrypted,
                    originalLength: body.length,
                  });
                  return;
                }
              } else {
                // Return as text/plain
                res.setHeader("Content-Type", "text/plain");
                res.send(decrypted);
                return;
              }
            } else {
              // Decryption failed - file might not be encrypted or wrong token
              console.log(`⚠️ Decryption returned null - file might not be encrypted or token is wrong`);
              // Return original content without decryption
              res.setHeader("Content-Type", ipfsRes.headers["content-type"] || "application/octet-stream");
              res.setHeader("Cache-Control", "public, max-age=3600");
              res.send(body);
              return;
            }
          } else {
            // File doesn't look encrypted, return as-is
            console.log(`📤 File doesn't appear to be encrypted, returning as-is`);
            res.setHeader("Content-Type", ipfsRes.headers["content-type"] || "application/octet-stream");
            res.setHeader("Cache-Control", "public, max-age=3600");
            res.send(body);
            return;
          }
        } catch (decryptError) {
          console.error("❌ Decryption error:", decryptError);
          // On error, try to return original content
          console.log(`⚠️ Returning original content due to decryption error`);
          if (!res.headersSent) {
            res.setHeader("Content-Type", ipfsRes.headers["content-type"] || "application/octet-stream");
            res.setHeader("Cache-Control", "public, max-age=3600");
            res.send(body);
          }
        }
      });
    });

    ipfsReq.on("error", (error) => {
      console.error("❌ IPFS Gateway error:", error);
      res.status(500).json({
        success: false,
        error: "IPFS Gateway error",
        details: error.message,
      });
    });

    ipfsReq.end();
  } catch (error) {
    console.error(`❌ IPFS Decrypt error for ${req.params.cid}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// IPFS Cat JSON endpoint (content parsed as JSON)
router.get("/cat/:cid/json", async (req, res) => {
  try {
    const { cid } = req.params;
    console.log(`📄 IPFS Content JSON request for CID: ${cid}`);

    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${cid}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        try {
          // Try to parse as JSON
          const jsonData = JSON.parse(data);
          res.json({
            success: true,
            cid: cid,
            data: jsonData,
          });
        } catch (parseError) {
          // If not JSON, return as text
          res.json({
            success: true,
            cid: cid,
            data: data,
            type: "text",
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error(`❌ IPFS Content JSON error for ${cid}:`, err);
      res.status(500).json({
        success: false,
        error: err.message,
      });
    });

    ipfsReq.setTimeout(30000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: "Content retrieval timeout",
        });
      }
    });

    ipfsReq.end();
  } catch (error) {
    console.error(`❌ IPFS Content JSON error for ${req.params.cid}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// IPFS Pin endpoints (aligned with Kubo's /api/v0/pin/*)
router.post("/pin/add", (req, res, next) => {
  // Usa il middleware di autenticazione esistente
  const tokenAuthMiddleware = req.app.get('tokenAuthMiddleware');
  if (tokenAuthMiddleware) {
    tokenAuthMiddleware(req, res, next);
  } else {
    // Fallback se il middleware non è disponibile
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (token === process.env.ADMIN_PASSWORD) {
      next();
    } else {
      console.log("Auth failed - Bearer:", bearerToken, "Custom:", customToken);
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
  }
}, async (req, res) => {
  try {
    console.log("🔍 IPFS Pin add request body:", req.body);
    const { cid } = req.body;
    
    if (!cid) {
      console.log("❌ IPFS Pin add error: CID is required");
      return res.status(400).json({
        success: false,
        error: "CID is required",
      });
    }

    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/pin/add?arg=${cid}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        try {
          const result = JSON.parse(data);
          res.json({
            success: true,
            message: "CID pinned successfully",
            result: result,
          });
        } catch (parseError) {
          res.status(500).json({
            success: false,
            error: "Failed to parse IPFS response",
            rawResponse: data,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error("❌ IPFS Pin add error:", err);
      res.status(500).json({
        success: false,
        error: err.message,
      });
    });

    ipfsReq.end();
  } catch (error) {
    console.error("❌ IPFS Pin add error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/pin/rm", (req, res, next) => {
  // Usa il middleware di autenticazione esistente
  const tokenAuthMiddleware = req.app.get('tokenAuthMiddleware');
  if (tokenAuthMiddleware) {
    tokenAuthMiddleware(req, res, next);
  } else {
    // Fallback se il middleware non è disponibile
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (token === process.env.ADMIN_PASSWORD) {
      next();
    } else {
      console.log("Auth failed - Bearer:", bearerToken, "Custom:", customToken);
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
  }
}, async (req, res) => {
  try {
    console.log("🔍 IPFS Pin rm request body:", req.body);
    const { cid } = req.body;
    console.log(`🔍 IPFS Pin rm request for CID: ${cid}`);
    
    if (!cid) {
      console.log("❌ IPFS Pin rm error: CID is required");
      return res.status(400).json({
        success: false,
        error: "CID is required",
      });
    }

    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/pin/rm?arg=${cid}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      console.log("🔐 IPFS API token found, adding authorization header");
    } else {
      console.log("⚠️ No IPFS API token configured");
    }

    console.log(`📡 Making IPFS API request to: ${requestOptions.hostname}:${requestOptions.port}${requestOptions.path}`);

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      console.log(`📡 IPFS API response status: ${ipfsRes.statusCode}`);
      console.log(`📡 IPFS API response headers:`, ipfsRes.headers);
      
      let data = "";
      ipfsRes.on("data", (chunk) => {
        data += chunk;
        console.log(`📡 IPFS API data chunk: ${chunk.toString()}`);
      });
      
      ipfsRes.on("end", () => {
        console.log(`📡 IPFS API complete response: ${data}`);
        
        try {
          const result = JSON.parse(data);
          console.log(`✅ IPFS Pin rm success for CID: ${cid}`, result);
          res.json({
            success: true,
            message: "CID unpinned successfully",
            result: result,
          });
        } catch (parseError) {
          console.error(`❌ IPFS Pin rm parse error for CID: ${cid}`, parseError);
          console.error(`❌ Raw response: ${data}`);
          res.status(500).json({
            success: false,
            error: "Failed to parse IPFS response",
            rawResponse: data,
            parseError: parseError.message,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error(`❌ IPFS Pin rm network error for CID: ${cid}`, err);
      res.status(500).json({
        success: false,
        error: err.message,
        details: "Network error connecting to IPFS API",
      });
    });

    ipfsReq.on("timeout", () => {
      console.error(`❌ IPFS Pin rm timeout for CID: ${cid}`);
      ipfsReq.destroy();
      res.status(408).json({
        success: false,
        error: "IPFS API request timeout",
      });
    });

    // Set timeout to 30 seconds
    ipfsReq.setTimeout(30000);
    
    console.log(`📡 Sending IPFS API request for CID: ${cid}`);
    ipfsReq.end();
  } catch (error) {
    console.error(`❌ IPFS Pin rm unexpected error for CID: ${req.body?.cid}`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: "Unexpected error in pin removal"
    });
  }
});

// Alias endpoint for shogun-ipfs compatibility: /pins/rm -> /pin/rm
router.post("/pins/rm", (req, res, next) => {
  // Usa il middleware di autenticazione esistente
  const tokenAuthMiddleware = req.app.get('tokenAuthMiddleware');
  if (tokenAuthMiddleware) {
    tokenAuthMiddleware(req, res, next);
  } else {
    // Fallback se il middleware non è disponibile
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (token === process.env.ADMIN_PASSWORD) {
      next();
    } else {
      console.log("Auth failed - Bearer:", bearerToken, "Custom:", customToken);
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
  }
}, async (req, res) => {
  try {
    console.log("🔍 IPFS Pin rm (alias /pins/rm) request body:", req.body);
    const { cid } = req.body;
    console.log(`🔍 IPFS Pin rm (alias /pins/rm) request for CID: ${cid}`);
    
    if (!cid) {
      console.log("❌ IPFS Pin rm (alias /pins/rm) error: CID is required");
      return res.status(400).json({
        success: false,
        error: "CID is required",
      });
    }

    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/pin/rm?arg=${cid}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      console.log("🔐 IPFS API token found, adding authorization header");
    } else {
      console.log("⚠️ No IPFS API token configured");
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        if (ipfsRes.statusCode === 200) {
          try {
            const result = JSON.parse(data);
            console.log(`✅ IPFS Pin rm (alias /pins/rm) success for CID: ${cid}`, result);
            res.json({
              success: true,
              message: `Pin removed successfully for CID: ${cid}`,
              data: result,
            });
          } catch (parseError) {
            console.error(`❌ IPFS Pin rm (alias /pins/rm) parse error for CID: ${cid}`, parseError);
            res.json({
              success: true,
              message: `Pin removed successfully for CID: ${cid}`,
              rawResponse: data,
            });
          }
        } else {
          console.error(`❌ IPFS Pin rm (alias /pins/rm) failed for CID: ${cid} - Status: ${ipfsRes.statusCode}`);
          res.status(ipfsRes.statusCode).json({
            success: false,
            error: `IPFS pin removal failed: ${ipfsRes.statusCode}`,
            details: data,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error(`❌ IPFS Pin rm (alias /pins/rm) network error for CID: ${cid}`, err);
      res.status(500).json({
        success: false,
        error: "Network error",
        details: err.message,
      });
    });

    // Set timeout to 30 seconds
    ipfsReq.setTimeout(30000);
    
    console.log(`📡 Sending IPFS API request for CID: ${cid}`);
    ipfsReq.end();
  } catch (error) {
    console.error(`❌ IPFS Pin rm (alias /pins/rm) unexpected error for CID: ${req.body?.cid}`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: "Unexpected error in pin removal"
    });
  }
});

router.get("/pin/ls", (req, res, next) => {
  // Usa il middleware di autenticazione esistente
  const tokenAuthMiddleware = req.app.get('tokenAuthMiddleware');
  if (tokenAuthMiddleware) {
    tokenAuthMiddleware(req, res, next);
  } else {
    // Fallback se il middleware non è disponibile
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (token === process.env.ADMIN_PASSWORD) {
      next();
    } else {
      console.log("Auth failed - Bearer:", bearerToken, "Custom:", customToken);
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
  }
}, async (req, res) => {
  try {
    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/pin/ls",
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        try {
          const result = JSON.parse(data);
          res.json({
            success: true,
            pins: result.Keys || {},
            count: Object.keys(result.Keys || {}).length,
          });
        } catch (parseError) {
          res.status(500).json({
            success: false,
            error: "Failed to parse IPFS response",
            rawResponse: data,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error("❌ IPFS Pin ls error:", err);
      res.status(500).json({
        success: false,
        error: err.message,
      });
    });

    ipfsReq.end();
  } catch (error) {
    console.error("❌ IPFS Pin ls error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// IPFS Repo GC endpoint
router.post("/repo/gc", (req, res, next) => {
  // Usa il middleware di autenticazione esistente
  const tokenAuthMiddleware = req.app.get('tokenAuthMiddleware');
  if (tokenAuthMiddleware) {
    tokenAuthMiddleware(req, res, next);
  } else {
    // Fallback se il middleware non è disponibile
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (token === process.env.ADMIN_PASSWORD) {
      next();
    } else {
      console.log("Auth failed - Bearer:", bearerToken, "Custom:", customToken);
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
  }
}, async (req, res) => {
  try {
    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/repo/gc",
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        try {
          const lines = data.trim().split("\n");
          const results = lines.map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return line;
            }
          });

          res.json({
            success: true,
            message: "Garbage collection completed",
            results: results,
          });
        } catch (parseError) {
          res.status(500).json({
            success: false,
            error: "Failed to parse IPFS response",
            rawResponse: data,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error("❌ IPFS Repo GC error:", err);
      res.status(500).json({
        success: false,
        error: err.message,
      });
    });

    ipfsReq.setTimeout(60000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: "Garbage collection timeout",
        });
      }
    });

    ipfsReq.end();
  } catch (error) {
    console.error("❌ IPFS Repo GC error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// IPFS API connectivity test endpoint
router.get("/test", (req, res, next) => {
  // Usa il middleware di autenticazione esistente
  const tokenAuthMiddleware = req.app.get('tokenAuthMiddleware');
  if (tokenAuthMiddleware) {
    tokenAuthMiddleware(req, res, next);
  } else {
    // Fallback se il middleware non è disponibile
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (token === process.env.ADMIN_PASSWORD) {
      next();
    } else {
      console.log("Auth failed - Bearer:", bearerToken, "Custom:", customToken);
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
  }
}, async (req, res) => {
  try {
    console.log("🔍 Testing IPFS API connectivity...");
    
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

    console.log(`📡 Testing IPFS API at: ${requestOptions.hostname}:${requestOptions.port}${requestOptions.path}`);

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      console.log(`📡 IPFS API test response status: ${ipfsRes.statusCode}`);
      
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        console.log(`📡 IPFS API test response: ${data}`);
        
        try {
          const result = JSON.parse(data);
          res.json({
            success: true,
            message: "IPFS API is reachable",
            version: result.Version,
            apiVersion: result["Api-Version"],
            statusCode: ipfsRes.statusCode,
          });
        } catch (parseError) {
          res.json({
            success: false,
            error: "IPFS API responded but with invalid JSON",
            rawResponse: data,
            statusCode: ipfsRes.statusCode,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error("❌ IPFS API test error:", err);
      res.status(500).json({
        success: false,
        error: "IPFS API is not reachable",
        details: err.message,
      });
    });

    ipfsReq.setTimeout(10000);
    ipfsReq.end();
  } catch (error) {
    console.error("❌ IPFS API test unexpected error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// IPFS object/block stat endpoint - get info about a CID
router.get("/stat/:cid", async (req, res) => {
  const { cid } = req.params;
  
  if (!cid) {
    return res.status(400).json({ success: false, error: 'CID is required' });
  }

  try {
    // Try object/stat first (works for most CIDs)
    const objectStatOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/object/stat?arg=${encodeURIComponent(cid)}`,
      method: "POST",
      headers: { "Content-Length": "0" },
    };

    if (IPFS_API_TOKEN) {
      objectStatOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const stat = await new Promise((resolve, reject) => {
      const statReq = http.request(objectStatOptions, (statRes) => {
        let data = "";
        statRes.on("data", (chunk) => (data += chunk));
        statRes.on("end", () => {
          if (statRes.statusCode === 200) {
            try {
              resolve(JSON.parse(data));
            } catch (e) {
              reject(new Error("Failed to parse stat response"));
            }
          } else {
            reject(new Error(`IPFS returned status ${statRes.statusCode}`));
          }
        });
      });

      statReq.on("error", reject);
      statReq.setTimeout(15000, () => {
        statReq.destroy();
        reject(new Error("Stat request timeout"));
      });
      statReq.end();
    });

    res.json({
      success: true,
      cid,
      stat: {
        Hash: stat.Hash,
        NumLinks: stat.NumLinks,
        BlockSize: stat.BlockSize,
        LinksSize: stat.LinksSize,
        DataSize: stat.DataSize,
        CumulativeSize: stat.CumulativeSize,
      }
    });
  } catch (error) {
    // Fallback to block/stat
    try {
      const blockStatOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: `/api/v0/block/stat?arg=${encodeURIComponent(cid)}`,
        method: "POST",
        headers: { "Content-Length": "0" },
      };

      if (IPFS_API_TOKEN) {
        blockStatOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const blockStat = await new Promise((resolve, reject) => {
        const blockReq = http.request(blockStatOptions, (blockRes) => {
          let data = "";
          blockRes.on("data", (chunk) => (data += chunk));
          blockRes.on("end", () => {
            if (blockRes.statusCode === 200) {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(new Error("Failed to parse block stat"));
              }
            } else {
              reject(new Error(`Block stat returned ${blockRes.statusCode}`));
            }
          });
        });

        blockReq.on("error", reject);
        blockReq.setTimeout(15000, () => {
          blockReq.destroy();
          reject(new Error("Block stat timeout"));
        });
        blockReq.end();
      });

      res.json({
        success: true,
        cid,
        stat: {
          Hash: blockStat.Key,
          CumulativeSize: blockStat.Size,
          BlockSize: blockStat.Size,
        }
      });
    } catch (blockError) {
      res.status(404).json({
        success: false,
        error: 'CID not found or not accessible',
        cid
      });
    }
  }
});

// IPFS Repo Stats endpoint
router.get("/repo/stat", (req, res, next) => {
  // Usa il middleware di autenticazione esistente
  const tokenAuthMiddleware = req.app.get('tokenAuthMiddleware');
  if (tokenAuthMiddleware) {
    tokenAuthMiddleware(req, res, next);
  } else {
    // Fallback se il middleware non è disponibile
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (token === process.env.ADMIN_PASSWORD) {
      next();
    } else {
      console.log("Auth failed - Bearer:", bearerToken, "Custom:", customToken);
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }
  }
}, async (req, res) => {
  try {
    console.log("📊 Getting IPFS repository statistics (alternative method)...");
    
    // Get all pins first
    const pinsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/pin/ls?type=all",
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      pinsRequestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const pinsPromise = new Promise((resolve, reject) => {
      const pinsReq = http.request(pinsRequestOptions, (pinsRes) => {
        let data = "";
        pinsRes.on("data", (chunk) => (data += chunk));
        pinsRes.on("end", () => {
          try {
            const pinsData = JSON.parse(data);
            resolve(pinsData);
          } catch (parseError) {
            reject(new Error("Failed to parse pins response"));
          }
        });
      });

      pinsReq.on("error", (err) => {
        reject(err);
      });

      pinsReq.setTimeout(10000, () => {
        pinsReq.destroy();
        reject(new Error("Pins request timeout"));
      });

      pinsReq.end();
    });

    // Get storage info from files/stat
    const storageRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/files/stat?arg=/",
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      storageRequestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const storagePromise = new Promise((resolve, reject) => {
      const storageReq = http.request(storageRequestOptions, (storageRes) => {
        let data = "";
        storageRes.on("data", (chunk) => (data += chunk));
        storageRes.on("end", () => {
          try {
            const storageData = JSON.parse(data);
            resolve(storageData);
          } catch (parseError) {
            reject(new Error("Failed to parse storage response"));
          }
        });
      });

      storageReq.on("error", (err) => {
        reject(err);
      });

      storageReq.setTimeout(10000, () => {
        storageReq.destroy();
        reject(new Error("Storage request timeout"));
      });

      storageReq.end();
    });

    // Get version info
    const versionRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/version",
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      versionRequestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const versionPromise = new Promise((resolve, reject) => {
      const versionReq = http.request(versionRequestOptions, (versionRes) => {
        let data = "";
        versionRes.on("data", (chunk) => (data += chunk));
        versionRes.on("end", () => {
          try {
            const versionData = JSON.parse(data);
            resolve(versionData);
          } catch (parseError) {
            reject(new Error("Failed to parse version response"));
          }
        });
      });

      versionReq.on("error", (err) => {
        reject(err);
      });

      versionReq.setTimeout(10000, () => {
        versionReq.destroy();
        reject(new Error("Version request timeout"));
      });

      versionReq.end();
    });

    // Wait for all requests to complete
    const [pinsData, storageData, versionData] = await Promise.all([
      pinsPromise,
      storagePromise,
      versionPromise
    ]);

    // Calculate statistics
    const pinKeys = pinsData.Keys || {};
    const numObjects = Object.keys(pinKeys).length;
    const totalSize = storageData.CumulativeSize || 0;
    const repoSizeMB = Math.round(totalSize / (1024 * 1024));
    
    // Estimate storage max (default to 10GB if not available)
    const storageMaxMB = 10240; // 10GB default
    const usagePercent = Math.round((repoSizeMB / storageMaxMB) * 100);

    res.json({
      success: true,
      stats: {
        repoSize: totalSize,
        repoSizeMB: repoSizeMB,
        storageMax: storageMaxMB * 1024 * 1024, // Convert back to bytes
        storageMaxMB: storageMaxMB,
        numObjects: numObjects,
        repoPath: "/ipfs", // Default path
        version: versionData.Version || "unknown"
      },
      raw: {
        pins: pinsData,
        storage: storageData,
        version: versionData
      }
    });

  } catch (error) {
    console.error("❌ IPFS Repo Stat error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// IPFS Version endpoint for connectivity testing (public)
router.get("/version", async (req, res) => {
  try {
    console.log("🔍 Testing IPFS API connectivity via /version endpoint...");
    
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

    console.log(`📡 Testing IPFS API at: ${requestOptions.hostname}:${requestOptions.port}${requestOptions.path}`);

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      console.log(`📡 IPFS API version response status: ${ipfsRes.statusCode}`);
      
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        console.log(`📡 IPFS API version response: ${data}`);
        
        try {
          const result = JSON.parse(data);
          res.json({
            success: true,
            message: "IPFS API is reachable",
            version: result.Version,
            apiVersion: result["Api-Version"],
            commit: result.Commit,
            go: result.Golang,
            statusCode: ipfsRes.statusCode,
          });
        } catch (parseError) {
          res.json({
            success: false,
            error: "IPFS API responded but with invalid JSON",
            rawResponse: data,
            statusCode: ipfsRes.statusCode,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error("❌ IPFS API version error:", err);
      res.status(500).json({
        success: false,
        error: "IPFS API is not reachable",
        details: err.message,
      });
    });

    ipfsReq.setTimeout(10000);
    ipfsReq.end();
  } catch (error) {
    console.error("❌ IPFS API version unexpected error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ============================================
// USER UPLOADS ROUTES
// ============================================

// Get user uploads list (for x402 subscription users)
router.get("/user-uploads/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;
    
    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: "User address is required",
      });
    }

    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Server error - Gun instance not available",
      });
    }

    // Get uploads from relay user space
    const uploads = await X402Merchant.getUserUploads(gun, userAddress);
    
    // Get subscription status
    const subscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);

    res.json({
      success: true,
      userAddress,
      uploads: uploads.map(upload => ({
        hash: upload.hash,
        name: upload.name,
        size: upload.size,
        sizeMB: upload.sizeMB || (upload.size ? upload.size / (1024 * 1024) : 0),
        mimetype: upload.mimetype,
        uploadedAt: upload.uploadedAt,
      })),
      count: uploads.length,
      subscription: subscription.active ? {
        tier: subscription.tier,
        storageMB: subscription.storageMB,
        storageUsedMB: subscription.storageUsedMB,
        storageRemainingMB: subscription.storageRemainingMB,
      } : null,
    });

  } catch (error) {
    console.error("❌ Get user uploads error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// View/download user uploaded file (for x402 subscription users)
// Uses the same IPFS cat endpoint but validates subscription access
router.get("/user-uploads/:userAddress/:hash/view", async (req, res) => {
  try {
    const { userAddress, hash } = req.params;
    
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Server error - Gun instance not available",
      });
    }

    // Get uploads to verify file belongs to user
    const uploads = await X402Merchant.getUserUploads(gun, userAddress);
    const uploadRecord = uploads.find(u => u.hash === hash);
    
    if (!uploadRecord) {
      return res.status(404).json({
        success: false,
        error: "File not found for this user",
      });
    }

    // Check if file is encrypted (SEA encrypted files are JSON)
    // Encrypted files have mimetype 'application/json', 'text/plain' (with .enc extension), or name ends with '.encrypted' or '.enc'
    const isEncrypted = uploadRecord.mimetype === 'application/json' || 
                        uploadRecord.mimetype === 'text/plain' ||
                        (uploadRecord.name && (uploadRecord.name.endsWith('.encrypted') || uploadRecord.name.endsWith('.enc')));
    
    // For encrypted files, we need to return as JSON so client can decrypt
    // For non-encrypted files, use the original mimetype
    const mimetype = isEncrypted ? 'application/json' : (uploadRecord.mimetype || 'application/octet-stream');
    const filename = uploadRecord.name || hash;
    
    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${encodeURIComponent(hash)}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      // Set appropriate headers based on request (view vs download)
      const isDownload = req.query.download === 'true' || req.query.dl === 'true';
      
      // For encrypted files, always return as JSON (client will decrypt)
      // For non-encrypted files, use original mimetype
      if (isEncrypted) {
        // Encrypted files must be returned as JSON for client-side decryption
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Content-Disposition", isDownload 
          ? `attachment; filename="${filename}"` 
          : `inline; filename="${filename}"`);
      } else {
        if (isDownload) {
          res.setHeader("Content-Type", mimetype);
          res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        } else {
          // View in browser
          res.setHeader("Content-Type", mimetype);
          res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
        }
      }
      res.setHeader("Cache-Control", "public, max-age=31536000"); // 1 year cache

      // Pipe the response directly
      ipfsRes.pipe(res);

      ipfsRes.on("error", (err) => {
        console.error(`❌ IPFS Content error for ${hash}:`, err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: err.message,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error(`❌ IPFS Content request error for ${hash}:`, err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });

    ipfsReq.setTimeout(30000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: "Content retrieval timeout",
        });
      }
    });

    ipfsReq.end();
  } catch (error) {
    console.error("❌ View user upload error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Download user uploaded file (alias for view with download=true)
router.get("/user-uploads/:userAddress/:hash/download", async (req, res) => {
  // Redirect to view endpoint with download parameter
  req.query.download = 'true';
  req.url = req.url.replace('/download', '/view');
  return router.handle(req, res);
});

// Delete/unpin user file (for x402 subscription users)
router.delete("/user-uploads/:userAddress/:hash", async (req, res) => {
  try {
    const { userAddress, hash } = req.params;
    
    // Verify user address header matches
    const headerUserAddress = req.headers["x-user-address"];
    
    if (!headerUserAddress || headerUserAddress.toLowerCase() !== userAddress.toLowerCase()) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized - User address mismatch",
      });
    }

    if (!hash) {
      return res.status(400).json({
        success: false,
        error: "File hash is required",
      });
    }

    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Server error - Gun instance not available",
      });
    }

    // Get subscription status to verify user has active subscription
    const subscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);
    if (!subscription.active) {
      return res.status(403).json({
        success: false,
        error: "No active subscription",
      });
    }

    // Get the upload record to get file size
    const uploads = await X402Merchant.getUserUploads(gun, userAddress);
    const uploadRecord = uploads.find(u => u.hash === hash);
    
    if (!uploadRecord) {
      return res.status(404).json({
        success: false,
        error: "Upload not found",
      });
    }

    const fileSizeMB = uploadRecord.sizeMB || (uploadRecord.size ? uploadRecord.size / (1024 * 1024) : 0);

    // Step 1: Unpin from IPFS
    console.log(`📌 Unpinning ${hash} from IPFS...`);
    
    const unpinResult = await new Promise((resolve) => {
      const requestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: `/api/v0/pin/rm?arg=${hash}`,
        method: "POST",
        headers: {
          "Content-Length": "0",
        },
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        let data = "";
        ipfsRes.on("data", (chunk) => (data += chunk));
        ipfsRes.on("end", () => {
          try {
            const result = JSON.parse(data);
            resolve({ success: true, result });
          } catch (parseError) {
            // Even if we can't parse, consider it a warning not an error
            resolve({ success: true, warning: "Could not parse IPFS response", raw: data });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        console.error(`❌ IPFS unpin error for ${hash}:`, err);
        resolve({ success: false, error: err.message });
      });

      ipfsReq.setTimeout(30000, () => {
        ipfsReq.destroy();
        resolve({ success: false, error: "Timeout" });
      });

      ipfsReq.end();
    });

    // Step 2: Delete upload record from relay user space
    console.log(`🗑️ Deleting upload record for ${hash}...`);
    
    try {
      await X402Merchant.deleteUploadRecord(userAddress, hash);
      console.log(`✅ Upload record deleted`);
    } catch (deleteError) {
      console.warn(`⚠️ Failed to delete upload record:`, deleteError.message);
    }

    // Step 3: Update storage usage (subtract file size)
    console.log(`📊 Updating storage usage (-${fileSizeMB.toFixed(2)}MB)...`);
    
    try {
      // Get current subscription and update storage
      const currentSub = await X402Merchant.getSubscriptionStatus(gun, userAddress);
      const newUsage = Math.max(0, (currentSub.storageUsedMB || 0) - fileSizeMB);
      
      const RelayUser = await import('../utils/relay-user.js');
      await RelayUser.updateSubscriptionField(userAddress, 'storageUsedMB', newUsage);
      
      console.log(`✅ Storage updated: ${newUsage.toFixed(2)}MB`);
    } catch (updateError) {
      console.warn(`⚠️ Failed to update storage:`, updateError.message);
    }

    // Get updated subscription status
    const updatedSubscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);

    res.json({
      success: true,
      message: "File unpinned and removed successfully",
      hash,
      unpin: unpinResult,
      subscription: updatedSubscription.active ? {
        storageUsedMB: updatedSubscription.storageUsedMB,
        storageRemainingMB: updatedSubscription.storageRemainingMB,
      } : null,
    });

  } catch (error) {
    console.error("❌ Delete user file error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router; 