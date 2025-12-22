import express, { Request, Response, Router } from "express";
import http from "http";
import FormData from "form-data";
import multer, { Multer } from "multer";
import { createProxyMiddleware } from "http-proxy-middleware";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import type { ClientRequest, IncomingMessage as HttpIncomingMessage } from "http";
import { X402Merchant } from "../utils/x402-merchant";
import { ipfsUpload } from "../utils/ipfs-client";
import { loggers } from "../utils/logger";
import type { IncomingMessage, ServerResponse } from "http";
import { authConfig, registryConfig, ipfsConfig, x402Config } from "../config";

// Extended Request interface with custom properties
interface CustomRequest extends Request {
  authType?: "admin" | "user";
  userAddress?: string;
  isDealUpload?: boolean;
  subscription?: {
    active: boolean;
    tier?: string;
    storageMB?: number;
    storageUsedMB?: number;
    storageRemainingMB?: number;
    reason?: string;
  };
  verifiedStorage?: {
    allowed: boolean;
    reason?: string;
    storageUsedMB?: number;
    storageRemainingMB?: number;
    storageTotalMB?: number;
    currentTier?: string;
    verified?: boolean;
    requiresUpgrade?: boolean;
  };
}

const router: Router = express.Router();

// Configurazione IPFS
const IPFS_API_URL: string = ipfsConfig.apiUrl;
const IPFS_API_TOKEN: string | undefined = ipfsConfig.apiToken;

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

// Helper function to create request options with proper typing
function createIpfsRequestOptions(
  path: string,
  method: string = "POST"
): {
  hostname: string;
  port: number;
  path: string;
  method: string;
  headers: Record<string, string>;
} {
  const options: {
    hostname: string;
    port: number;
    path: string;
    method: string;
    headers: Record<string, string>;
  } = {
    hostname: "127.0.0.1",
    port: 5001,
    path,
    method,
    headers: {
      "Content-Length": "0",
    },
  };

  if (IPFS_API_TOKEN) {
    options.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
  }

  return options;
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

    if (token === authConfig.adminPassword) {
      next();
    } else {
      loggers.server.warn(
        { bearerToken: !!bearerToken, customToken: !!customToken },
        "Auth failed"
      );
      res.status(401).json({ success: false, error: "Unauthorized" });
    }
  },
  createProxyMiddleware({
    target: IPFS_API_URL,
    changeOrigin: true,
    pathRewrite: {
      "^/proxy": "/api/v0",
    },
    onProxyReq: (proxyReq: ClientRequest, req: ExpressRequest, res: ExpressResponse) => {
      loggers.server.debug(
        {
          method: req.method,
          url: req.url,
          target: `${IPFS_API_URL}${req.url}`,
        },
        `🔧 IPFS API Request`
      );

      // Add authentication headers for IPFS API
      if (IPFS_API_TOKEN) {
        proxyReq.setHeader("Authorization", `Bearer ${IPFS_API_TOKEN}`);
      }

      // IPFS API requires POST method for most endpoints
      // Override GET requests to POST for IPFS API endpoints
      if (
        req.method === "GET" &&
        (req.url?.includes("/version") || req.url?.includes("/id") || req.url?.includes("/peers"))
      ) {
        proxyReq.method = "POST";
        proxyReq.setHeader("Content-Length", "0");
      }

      // Add query parameter to get JSON response
      if (req.url?.includes("/version")) {
        const originalPath = proxyReq.path || "";
        proxyReq.path = originalPath + (originalPath.includes("?") ? "&" : "?") + "format=json";
      }
    },
    onProxyRes: (proxyRes: HttpIncomingMessage, req: ExpressRequest, res: ExpressResponse) => {
      loggers.server.debug(
        { statusCode: proxyRes.statusCode, method: req.method, url: req.url },
        `📤 IPFS API Response`
      );

      // Handle non-JSON responses from IPFS
      if (
        proxyRes.headers["content-type"] &&
        !proxyRes.headers["content-type"].includes("application/json")
      ) {
        loggers.server.debug(
          { contentType: proxyRes.headers["content-type"] },
          `📝 IPFS Response Content-Type`
        );
      }
    },
    onError: (err: Error, req: ExpressRequest, res: ExpressResponse) => {
      loggers.server.error({ err }, "❌ IPFS API Proxy Error");
      res.status(500).json({
        success: false,
        error: "IPFS API unavailable",
        details: err.message,
      });
    },
  } as any)
);

// Note: Kubo WebUI proxy removed for security reasons
// Access Kubo WebUI directly at http://localhost:5001/webui if needed

// Compatibility endpoint for shogun-ipfs: /api/v0/cat
// This endpoint doesn't need JSON body parsing - it only uses query params
// We skip body parsing by using a middleware that doesn't parse JSON
router.post("/api/v0/cat", (req, res, next) => {
  // Skip JSON body parsing for this endpoint - it only uses query params
  req.body = undefined;
  next();
}, async (req: CustomRequest, res: Response) => {
  try {
    const { arg } = req.query; // IPFS API uses ?arg=CID or ?arg=CID/path/to/file
    const cid = Array.isArray(arg) ? arg[0] : arg;

    if (!cid || typeof cid !== "string") {
      return res.status(400).json({
        success: false,
        error: "CID parameter (arg) is required",
      });
    }

    loggers.server.debug({ cid }, `📄 IPFS API v0 cat (compatibility endpoint) request`);

    // IPFS API supports paths like CID/path/to/file for directory navigation
    // We need to encode the CID part but keep slashes for path navigation
    // Format: /api/v0/cat?arg=QmDirectory/index.html
    // The slash should NOT be encoded, only special characters in the path components
    const requestOptions: {
      hostname: string;
      port: number;
      path: string;
      method: string;
      headers: Record<string, string>;
    } = {
      hostname: "127.0.0.1",
      port: 5001,
      // For paths with slashes, encode only the CID part, keep slashes for navigation
      // Split by first slash, encode CID, then append path
      path: cid.includes('/')
        ? `/api/v0/cat?arg=${encodeURIComponent(cid.split('/')[0])}/${cid.split('/').slice(1).join('/')}`
        : `/api/v0/cat?arg=${encodeURIComponent(cid)}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      } as Record<string, string>,
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      // Set appropriate headers
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=31536000");

      // Pipe the response directly
      ipfsRes.pipe(res);

      ipfsRes.on("error", (err) => {
        loggers.server.error({ err, cid }, `❌ IPFS API v0 cat error`);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: err.message,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, cid }, `❌ IPFS API v0 cat request error`);
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, `❌ IPFS API v0 cat error`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Endpoint per recuperare file da una directory IPFS
// Format: /api/v1/ipfs/cat-directory/:directoryCid/:filePath(*)
router.get("/cat-directory/:directoryCid/:filePath(*)", async (req: CustomRequest, res: Response) => {
  try {
    const { directoryCid, filePath } = req.params;

    if (!directoryCid || !filePath) {
      return res.status(400).json({
        success: false,
        error: "Directory CID and file path are required",
      });
    }

    loggers.server.debug(
      { directoryCid, filePath },
      `📄 IPFS Cat from directory request`
    );

    // Costruisci il path completo per IPFS: CID/path
    const ipfsPath = `${directoryCid}/${filePath}`;

    const requestOptions: {
      hostname: string;
      port: number;
      path: string;
      method: string;
      headers: Record<string, string>;
    } = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${encodeURIComponent(directoryCid)}/${filePath}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      } as Record<string, string>,
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      // Set appropriate headers
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Cache-Control", "public, max-age=31536000");

      // Pipe the response directly
      ipfsRes.pipe(res);

      ipfsRes.on("error", (err) => {
        loggers.server.error({ err, directoryCid, filePath }, `❌ IPFS Cat from directory error`);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: err.message,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, directoryCid, filePath }, `❌ IPFS Cat from directory request error`);
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, `❌ IPFS Cat from directory error`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Custom IPFS API endpoints with better error handling
router.post("/api/:endpoint(*)", async (req: CustomRequest, res: Response) => {
  try {
    const endpoint = req.params.endpoint;
    const requestOptions: {
      hostname: string;
      port: number;
      path: string;
      method: string;
      headers: Record<string, string>;
    } = {
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
        loggers.server.debug({ endpoint, data }, `📡 IPFS API raw response`);

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
            } catch (cleanParseError: unknown) {
              const errorMessage =
                cleanParseError instanceof Error
                  ? cleanParseError.message
                  : String(cleanParseError);
              res.json({
                success: false,
                endpoint: endpoint,
                error: "Invalid JSON response",
                rawResponse: data,
                parseError: errorMessage,
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
      loggers.server.error({ err, endpoint }, `❌ IPFS API error`);
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// IPFS File Upload endpoint with dual authentication and x402 subscription check
router.post(
  "/upload",
  async (req: CustomRequest, res: Response, next) => {
    // Check both admin and user authentication
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const adminToken = bearerToken || customToken;
    const isAdmin = adminToken === authConfig.adminPassword;

    // Check for user address header (for x402 subscription-based uploads)
    const userAddressRaw = req.headers["x-user-address"];
    const userAddress = Array.isArray(userAddressRaw) ? userAddressRaw[0] : userAddressRaw;

    if (isAdmin) {
      req.authType = "admin";
      next();
    } else if (userAddress && typeof userAddress === "string") {
      // User-based upload - can be for subscriptions OR storage deals
      req.authType = "user";
      req.userAddress = userAddress;

      // Check if this is for a storage deal (no subscription required)
      // Storage deals are paid on-chain, so upload should work without subscription
      const dealHeader = Array.isArray(req.headers["x-deal-upload"])
        ? req.headers["x-deal-upload"][0]
        : req.headers["x-deal-upload"];
      const dealQuery = Array.isArray(req.query.deal) ? req.query.deal[0] : req.query.deal;
      const isDealUpload = dealHeader === "true" || dealQuery === "true";

      if (isDealUpload) {
        // Allow upload for storage deals without subscription check
        loggers.server.info({ userAddress }, `Upload allowed for storage deal`);
        req.isDealUpload = true;
        next();
      } else if (x402Config.payToAddress as string) {
        // For subscription-based uploads, check subscription status
        const gun = req.app.get("gunInstance");
        if (!gun) {
          return res.status(500).json({
            success: false,
            error: "Server error - Gun instance not available",
          });
        }

        try {
          const subscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);

          if (!subscription.active) {
            loggers.server.warn(
              { userAddress: userAddress, reason: subscription.reason },
              `Upload denied - No active subscription`
            );
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
          req.userAddress = userAddress;
          loggers.server.info(
            {
              userAddress: userAddress,
              tier: subscription.tier,
              storageRemainingMB: subscription.storageRemainingMB,
            },
            `User has active subscription`
          );
          next();
        } catch (error: unknown) {
          loggers.server.error({ err: error }, "Subscription check error");
          const errorMessage = error instanceof Error ? error.message : String(error);
          return res.status(500).json({
            success: false,
            error: "Error checking subscription status",
            details: errorMessage,
          });
        }
      } else {
        // X402 not configured, allow upload anyway (for deals)
        loggers.server.info(`Upload allowed - X402 not configured, treating as deal upload`);
        req.isDealUpload = true;
        next();
      }
    } else {
      loggers.server.warn({ adminToken: !!adminToken, userAddress: !!userAddress }, "Auth failed");
      res.status(401).json({
        success: false,
        error: "Unauthorized - Admin token or x402 subscription required",
        hint: "Provide Authorization header with admin token, or X-User-Address header with a valid x402 subscription",
      });
    }
  },
  upload.single("file"),
  async (req, res) => {
    try {
      const customReq = req as CustomRequest;
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No file provided",
        });
      }

      // For user uploads with x402 subscription, verify real IPFS storage before allowing upload
      if (customReq.authType === "user" && customReq.subscription) {
        const fileSizeMB = req.file.size / (1024 * 1024);

        // Get IPFS config
        const ipfsApiUrl =
          req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
        const ipfsApiToken = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken;
        const gun = req.app.get("gunInstance");

        // Verify real storage usage from IPFS
        loggers.server.debug(
          { userAddress: customReq.userAddress },
          `Verifying real IPFS storage before upload`
        );
        const canUploadResult = await X402Merchant.canUploadVerified(
          gun,
          customReq.userAddress!,
          fileSizeMB,
          ipfsApiUrl,
          ipfsApiToken
        );

        if (!canUploadResult.allowed) {
          loggers.server.warn(
            {
              userAddress: customReq.userAddress,
              reason: canUploadResult.reason,
            },
            `Upload denied`
          );
          return res.status(402).json({
            success: false,
            error: "Storage limit exceeded",
            details: {
              fileSizeMB: fileSizeMB.toFixed(2),
              storageUsedMB: canUploadResult.storageUsedMB?.toFixed(2) || "0",
              storageRemainingMB: canUploadResult.storageRemainingMB?.toFixed(2) || "0",
              storageTotalMB: canUploadResult.storageTotalMB || customReq.subscription?.storageMB,
              tier: canUploadResult.currentTier || customReq.subscription?.tier,
              verified: canUploadResult.verified,
            },
            reason: canUploadResult.reason,
            upgradeRequired: canUploadResult.requiresUpgrade,
            endpoint: "/api/v1/x402/subscribe",
            tiers: "/api/v1/x402/tiers",
          });
        }

        // Update subscription info with verified data
        customReq.verifiedStorage = canUploadResult;
        loggers.server.info(
          {
            userAddress: customReq.userAddress,
            storageUsedMB: canUploadResult.storageUsedMB?.toFixed(2),
            storageTotalMB: canUploadResult.storageTotalMB,
          },
          `Upload allowed`
        );
      }

      const formData = new FormData();
      formData.append("file", req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      // Use IPFS client utility with automatic retry
      const fileResult = await ipfsUpload("/api/v0/add?wrap-with-directory=false", formData, {
        timeout: 60000,
        maxRetries: 3,
        retryDelay: 1000,
      });

      loggers.server.debug({ fileResult }, "📤 IPFS Upload response");

      const uploadData: {
        name: string;
        size: number;
        mimetype: string;
        hash: any;
        sizeBytes: any;
        uploadedAt: number;
        sizeMB?: number;
        userAddress?: string;
      } = {
        name: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        hash: fileResult.Hash,
        sizeBytes: fileResult.Size,
        uploadedAt: Date.now(),
      };

      // If user upload, save to Gun database and update MB usage
      // Skip GunDB save for deal uploads (they're tracked on-chain)
      if (customReq.authType === "user" && customReq.userAddress && !customReq.isDealUpload) {
        const gun = req.app.get("gunInstance");
        const fileSizeMB = req.file.size / (1024 * 1024);

        uploadData.sizeMB = fileSizeMB;
        uploadData.userAddress = customReq.userAddress;

        // Save all necessary values to avoid reference errors
        const userAddress = customReq.userAddress;
        const authType = customReq.authType;
        const fileSize = req.file.size;

        if (!userAddress) {
          return res.status(400).json({ success: false, error: "User address is required" });
        }

        loggers.server.debug(
          {
            userAddress: customReq.userAddress,
            fileHash: fileResult.Hash,
            uploadData,
          },
          `💾 Saving upload to GunDB`
        );

        // Save upload to Gun database with Promise
        const saveUploadPromise = new Promise<void>((resolve, reject) => {
          const uploadsNode = gun.get("shogun").get("uploads").get(userAddress);
          uploadsNode.get(fileResult.Hash).put(uploadData, (ack: any) => {
            loggers.server.debug({ ack }, `💾 Upload save ack`);
            if (ack && ack.err) {
              loggers.server.error({ err: ack.err }, `❌ Error saving upload`);
              reject(new Error(ack.err));
            } else {
              loggers.server.debug(`✅ Upload saved successfully to GunDB`);
              resolve();
            }
          });
        });

        // Update MB usage with Promise (legacy system)
        const updateMBPromise = (async () => {
          try {
            const { updateMBUsage } = await import("../utils/storage-utils.js");
            const newMB = await updateMBUsage(gun, customReq.userAddress!, fileSizeMB);
            loggers.server.debug({ newMB }, `✅ MB usage updated successfully`);
            return newMB;
          } catch (error: unknown) {
            loggers.server.error({ err: error }, `❌ Error updating MB usage`);
            throw error;
          }
        })();

        // Save hash to systemhash node with Promise
        const saveSystemHashPromise = new Promise((resolve) => {
          // Call the save-system-hash endpoint with admin token
          const adminToken = authConfig.adminPassword;
          if (!adminToken) {
            loggers.server.warn(`⚠️ ADMIN_PASSWORD not set, skipping system hash save`);
            resolve({ error: "ADMIN_PASSWORD not configured" });
            return;
          }

          const systemHashData = {
            hash: fileResult.Hash,
            userAddress: userAddress,
            timestamp: Date.now(),
          };

          // Make internal request to save-system-hash endpoint
          const postData = JSON.stringify(systemHashData);

          const options = {
            hostname: "localhost",
            port: 8765,
            path: "/api/v1/user-uploads/save-system-hash",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(postData),
              Authorization: `Bearer ${adminToken}`,
            },
          };

          const httpReq = http.request(options, (res) => {
            let data = "";
            res.on("data", (chunk) => {
              data += chunk;
            });
            res.on("end", () => {
              try {
                const result = JSON.parse(data);
                if (result.success) {
                  loggers.server.debug(`✅ System hash saved successfully via endpoint`);
                  resolve({ success: true });
                } else {
                  loggers.server.error(
                    { error: result.error },
                    `❌ Error saving system hash via endpoint`
                  );
                  resolve({ error: result.error });
                }
              } catch (parseError: unknown) {
                const errorMessage =
                  parseError instanceof Error ? parseError.message : String(parseError);
                loggers.server.error({ err: parseError }, `❌ Error parsing system hash response`);
                resolve({ error: errorMessage });
              }
            });
          });

          httpReq.on("error", (error: Error) => {
            loggers.server.error({ err: error }, `❌ Error calling system hash endpoint`);
            resolve({ error: error.message });
          });

          httpReq.write(postData);
          httpReq.end();
        });

        // Update x402 subscription storage if applicable
        let subscriptionUpdatePromise: Promise<any> = Promise.resolve();
        if (customReq.subscription) {
          // Save upload record to relay user space
          const uploadRecordPromise = X402Merchant.saveUploadRecord(
            customReq.userAddress!,
            fileResult.Hash,
            {
              name: req.file.originalname,
              size: req.file.size,
              sizeMB: fileSizeMB,
              mimetype: req.file.mimetype,
              uploadedAt: Date.now(),
            }
          ).catch((err) => {
            loggers.server.warn({ err }, `⚠️ Failed to save upload record to relay space`);
          });

          subscriptionUpdatePromise = Promise.all([
            uploadRecordPromise,
            X402Merchant.updateStorageUsage(gun, customReq.userAddress!, fileSizeMB),
          ])
            .then(([, result]) => {
              loggers.server.info(
                {
                  storageUsedMB: result?.storageUsedMB,
                  storageRemainingMB: result?.storageRemainingMB,
                },
                `📊 Subscription storage updated`
              );
              return result;
            })
            .catch((err: unknown) => {
              loggers.server.warn({ err }, `⚠️ Subscription storage update failed`);
              return null;
            });
        }

        // Wait for critical operations to complete (upload and MB usage)
        Promise.all([saveUploadPromise, updateMBPromise, subscriptionUpdatePromise])
          .then(([, , subscriptionResult]) => {
            loggers.server.info(
              { userAddress: customReq.userAddress, fileSizeMB },
              `📊 User upload saved`
            );

            // Try to save system hash but don't block the response
            saveSystemHashPromise
              .then((systemHashResult: any) => {
                if (systemHashResult?.error) {
                  loggers.server.warn(
                    { error: systemHashResult.error },
                    `⚠️ System hash save failed but upload completed`
                  );
                } else {
                  loggers.server.debug(`✅ System hash saved successfully`);
                }
              })
              .catch((systemHashError: unknown) => {
                loggers.server.warn(
                  { err: systemHashError },
                  `⚠️ System hash save failed but upload completed`
                );
              });

            // Send response immediately after critical operations
            if (!req.file) {
              return res.status(500).json({
                success: false,
                error: "File information not available",
              });
            }
            res.json({
              success: true,
              file: uploadData,
              authType: customReq.authType,
              mbUsage:
                customReq.authType === "user"
                  ? {
                    actualSizeMB: +(req.file.size / 1024 / 1024).toFixed(2),
                    sizeMB: Math.ceil(req.file.size / (1024 * 1024)),
                    verified: true,
                  }
                  : undefined,
              subscription: subscriptionResult
                ? {
                  storageUsedMB: subscriptionResult.storageUsedMB,
                  storageRemainingMB: subscriptionResult.storageRemainingMB,
                }
                : undefined,
            });
          })
          .catch((error: unknown) => {
            loggers.server.error({ err: error }, `❌ Error during critical GunDB save`);
            // Send response anyway, the file is already on IPFS
            res.json({
              success: true,
              file: uploadData,
              authType: customReq.authType,
              mbUsage:
                customReq.authType === "user" && req.file
                  ? {
                    actualSizeMB: +(req.file.size / 1024 / 1024).toFixed(2),
                    sizeMB: Math.ceil(req.file.size / (1024 * 1024)),
                    verified: false,
                    error: error instanceof Error ? error.message : String(error),
                  }
                  : undefined,
            });
          });
      } else {
        // For admin uploads, send response immediately
        res.json({
          success: true,
          file: uploadData,
          authType: customReq.authType,
        });
      }
    } catch (error: unknown) {
      loggers.server.error({ err: error }, "❌ IPFS Upload error");
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

// IPFS Directory Upload endpoint - supports multiple files with directory structure
router.post(
  "/upload-directory",
  async (req: CustomRequest, res: Response, next) => {
    // Same authentication logic as single file upload
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const adminToken = bearerToken || customToken;
    const isAdmin = adminToken === authConfig.adminPassword;

    const userAddressRaw = req.headers["x-user-address"];
    const userAddress = Array.isArray(userAddressRaw) ? userAddressRaw[0] : userAddressRaw;

    if (isAdmin) {
      req.authType = "admin";
      next();
    } else if (userAddress && typeof userAddress === "string") {
      req.authType = "user";
      req.userAddress = userAddress;

      const dealHeader = Array.isArray(req.headers["x-deal-upload"])
        ? req.headers["x-deal-upload"][0]
        : req.headers["x-deal-upload"];
      const dealQuery = Array.isArray(req.query.deal) ? req.query.deal[0] : req.query.deal;
      const isDealUpload = dealHeader === "true" || dealQuery === "true";

      if (isDealUpload) {
        loggers.server.info({ userAddress }, `Directory upload allowed for storage deal`);
        req.isDealUpload = true;
        next();
      } else if (x402Config.payToAddress as string) {
        const gun = req.app.get("gunInstance");
        if (!gun) {
          return res.status(500).json({
            success: false,
            error: "Server error - Gun instance not available",
          });
        }

        try {
          const subscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);

          if (!subscription.active) {
            loggers.server.warn(
              { userAddress: userAddress, reason: subscription.reason },
              `Directory upload denied - No active subscription`
            );
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
          req.userAddress = userAddress;
          loggers.server.info(
            {
              userAddress: userAddress,
              tier: subscription.tier,
              storageRemainingMB: subscription.storageRemainingMB,
            },
            `User has active subscription for directory upload`
          );
          next();
        } catch (error: unknown) {
          loggers.server.error({ err: error }, "Subscription check error");
          const errorMessage = error instanceof Error ? error.message : String(error);
          return res.status(500).json({
            success: false,
            error: "Error checking subscription status",
            details: errorMessage,
          });
        }
      } else {
        loggers.server.info(`Directory upload allowed - X402 not configured, treating as deal upload`);
        req.isDealUpload = true;
        next();
      }
    } else {
      loggers.server.warn({ adminToken: !!adminToken, userAddress: !!userAddress }, "Auth failed for directory upload");
      res.status(401).json({
        success: false,
        error: "Unauthorized - Admin token or x402 subscription required",
        hint: "Provide Authorization header with admin token, or X-User-Address header with a valid x402 subscription",
      });
    }
  },
  upload.any(), // Accept any number of files
  async (req, res) => {
    try {
      const customReq = req as CustomRequest;
      const files = (req.files || []) as Express.Multer.File[];

      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No files provided",
        });
      }

      // Calculate total size for subscription checks
      const totalSize = files.reduce((sum, file) => sum + file.size, 0);
      const totalSizeMB = totalSize / (1024 * 1024);

      loggers.server.info(
        {
          fileCount: files.length,
          totalSizeMB: totalSizeMB.toFixed(2),
          userAddress: customReq.userAddress,
        },
        `📁 Directory upload: ${files.length} files (${totalSizeMB.toFixed(2)} MB)`
      );

      // For user uploads with x402 subscription, verify storage
      if (customReq.authType === "user" && customReq.subscription) {
        const ipfsApiUrl =
          req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
        const ipfsApiToken = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken;
        const gun = req.app.get("gunInstance");

        loggers.server.debug(
          { userAddress: customReq.userAddress },
          `Verifying real IPFS storage before directory upload`
        );

        const canUploadResult = await X402Merchant.canUploadVerified(
          gun,
          customReq.userAddress!,
          totalSizeMB,
          ipfsApiUrl,
          ipfsApiToken
        );

        if (!canUploadResult.allowed) {
          loggers.server.warn(
            {
              userAddress: customReq.userAddress,
              reason: canUploadResult.reason,
            },
            `Directory upload denied`
          );
          return res.status(402).json({
            success: false,
            error: "Storage limit exceeded",
            details: {
              totalSizeMB: totalSizeMB.toFixed(2),
              fileCount: files.length,
              storageUsedMB: canUploadResult.storageUsedMB?.toFixed(2) || "0",
              storageRemainingMB: canUploadResult.storageRemainingMB?.toFixed(2) || "0",
              storageTotalMB: canUploadResult.storageTotalMB || customReq.subscription?.storageMB,
              tier: canUploadResult.currentTier || customReq.subscription?.tier,
              verified: canUploadResult.verified,
            },
            reason: canUploadResult.reason,
            upgradeRequired: canUploadResult.requiresUpgrade,
            endpoint: "/api/v1/x402/subscribe",
            tiers: "/api/v1/x402/tiers",
          });
        }

        customReq.verifiedStorage = canUploadResult;
        loggers.server.info(
          {
            userAddress: customReq.userAddress,
            storageUsedMB: canUploadResult.storageUsedMB?.toFixed(2),
            storageTotalMB: canUploadResult.storageTotalMB,
          },
          `Directory upload allowed`
        );
      }

      // Create FormData with all files maintaining directory structure
      const formData = new FormData();

      // Get file paths from request (can be in fieldname or originalname)
      // For directory uploads, the path might be in the fieldname or we use originalname
      files.forEach((file) => {
        // Try to get relative path from fieldname (if sent as "files" with path)
        // Otherwise use originalname
        const filePath = file.fieldname && file.fieldname !== "files"
          ? file.fieldname
          : file.originalname;

        formData.append("file", file.buffer, {
          filename: filePath,
          contentType: file.mimetype || "application/octet-stream",
        });
      });

      // Use IPFS client utility with wrap-with-directory=true to maintain structure
      loggers.server.debug(`Uploading ${files.length} files to IPFS with wrap-with-directory=true`);
      const directoryResult = await ipfsUpload("/api/v0/add?wrap-with-directory=true", formData, {
        timeout: 120000, // Longer timeout for multiple files
        maxRetries: 3,
        retryDelay: 1000,
      });

      loggers.server.debug({ directoryResult }, "📤 IPFS Directory Upload response");

      // The result should contain the directory CID
      // IPFS returns the directory hash when wrap-with-directory=true
      const directoryCid = directoryResult.Hash || directoryResult.cid;

      if (!directoryCid) {
        loggers.server.error({ directoryResult }, "❌ Directory CID not found in IPFS response");
        return res.status(500).json({
          success: false,
          error: "Directory CID not found in IPFS response",
        });
      }

      const uploadData = {
        directoryCid: directoryCid,
        fileCount: files.length,
        totalSize: totalSize,
        totalSizeMB: totalSizeMB,
        files: files.map((f) => ({
          name: f.originalname,
          path: f.fieldname && f.fieldname !== "files" ? f.fieldname : f.originalname,
          size: f.size,
          mimetype: f.mimetype,
        })),
        uploadedAt: Date.now(),
      };

      // If user upload, save to Gun database
      if (customReq.authType === "user" && customReq.userAddress && !customReq.isDealUpload) {
        const gun = req.app.get("gunInstance");
        const userAddress = customReq.userAddress;

        loggers.server.debug(
          {
            userAddress,
            directoryCid,
            fileCount: files.length,
          },
          `💾 Saving directory upload to GunDB`
        );

        // Save directory upload record
        const saveUploadPromise = new Promise<void>((resolve, reject) => {
          const uploadsNode = gun.get("shogun").get("uploads").get(userAddress);
          uploadsNode.get(directoryCid).put(uploadData, (ack: any) => {
            loggers.server.debug({ ack }, `💾 Directory upload save ack`);
            if (ack && ack.err) {
              loggers.server.error({ err: ack.err }, `❌ Error saving directory upload`);
              reject(new Error(ack.err));
            } else {
              loggers.server.debug(`✅ Directory upload saved successfully to GunDB`);
              resolve();
            }
          });
        });

        // Update MB usage
        const updateMBPromise = (async () => {
          try {
            const { updateMBUsage } = await import("../utils/storage-utils.js");
            const newMB = await updateMBUsage(gun, customReq.userAddress!, totalSizeMB);
            loggers.server.debug({ newMB }, `✅ MB usage updated successfully`);
            return newMB;
          } catch (error: unknown) {
            loggers.server.error({ err: error }, `❌ Error updating MB usage`);
            throw error;
          }
        })();

        // Update x402 subscription storage
        let subscriptionUpdatePromise: Promise<any> = Promise.resolve();
        if (customReq.subscription) {
          const uploadRecordPromise = X402Merchant.saveUploadRecord(
            customReq.userAddress!,
            directoryCid,
            {
              name: `Directory (${files.length} files)`,
              size: totalSize,
              sizeMB: totalSizeMB,
              mimetype: "application/directory",
              uploadedAt: Date.now(),
            }
          ).catch((err) => {
            loggers.server.warn({ err }, `⚠️ Failed to save directory upload record`);
          });

          subscriptionUpdatePromise = Promise.all([
            uploadRecordPromise,
            X402Merchant.updateStorageUsage(gun, customReq.userAddress!, totalSizeMB),
          ])
            .then(([, result]) => {
              loggers.server.info(
                {
                  storageUsedMB: result?.storageUsedMB,
                  storageRemainingMB: result?.storageRemainingMB,
                },
                `📊 Subscription storage updated for directory`
              );
              return result;
            })
            .catch((err: unknown) => {
              loggers.server.warn({ err }, `⚠️ Subscription storage update failed`);
              return null;
            });
        }

        // Wait for critical operations
        Promise.all([saveUploadPromise, updateMBPromise, subscriptionUpdatePromise])
          .then(([, , subscriptionResult]) => {
            loggers.server.info(
              { userAddress, fileCount: files.length, totalSizeMB },
              `📊 Directory upload saved`
            );

            res.json({
              success: true,
              cid: directoryCid,
              directoryCid: directoryCid,
              fileCount: files.length,
              totalSize: totalSize,
              totalSizeMB: totalSizeMB,
              files: uploadData.files,
              authType: customReq.authType,
              mbUsage: {
                actualSizeMB: +totalSizeMB.toFixed(2),
                sizeMB: Math.ceil(totalSizeMB),
                verified: true,
              },
              subscription: subscriptionResult
                ? {
                  storageUsedMB: subscriptionResult.storageUsedMB,
                  storageRemainingMB: subscriptionResult.storageRemainingMB,
                }
                : undefined,
            });
          })
          .catch((error: unknown) => {
            loggers.server.error({ err: error }, `❌ Error during critical GunDB save`);
            // Send response anyway, the directory is already on IPFS
            res.json({
              success: true,
              cid: directoryCid,
              directoryCid: directoryCid,
              fileCount: files.length,
              totalSize: totalSize,
              totalSizeMB: totalSizeMB,
              files: uploadData.files,
              authType: customReq.authType,
              mbUsage: {
                actualSizeMB: +totalSizeMB.toFixed(2),
                sizeMB: Math.ceil(totalSizeMB),
                verified: false,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          });
      } else {
        // For admin uploads, send response immediately
        res.json({
          success: true,
          cid: directoryCid,
          directoryCid: directoryCid,
          fileCount: files.length,
          totalSize: totalSize,
          totalSizeMB: totalSizeMB,
          files: uploadData.files,
          authType: customReq.authType,
        });
      }
    } catch (error: unknown) {
      loggers.server.error({ err: error }, "❌ IPFS Directory Upload error");
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

// IPFS Status endpoint
router.get("/status", async (req: Request, res: Response) => {
  try {
    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/version",
      method: "POST",
      headers: {
        "Content-Length": "0",
      } as Record<string, string>,
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      success: false,
      status: "error",
      error: errorMessage,
    });
  }
});

// IPFS Cat endpoint (aligned with Kubo's /api/v0/cat)
router.get("/cat/:cid", async (req, res) => {
  try {
    const { cid } = req.params;
    loggers.server.debug({ cid }, `📄 IPFS Content request`);

    const requestOptions: {
      hostname: string;
      port: number;
      path: string;
      method: string;
      headers: Record<string, string>;
    } = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${cid}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      } as Record<string, string>,
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
        loggers.server.error({ err, cid }, `❌ IPFS Content error`);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: err.message,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, cid }, `❌ IPFS Content request error`);
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error, cid: req.params.cid }, `❌ IPFS Content error`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Compatibility endpoint for shogun-ipfs: /content/:cid
router.get("/content/:cid", async (req, res) => {
  // Redirect to /cat/:cid endpoint
  const { cid } = req.params;
  loggers.server.debug({ cid }, `📄 IPFS Content (compatibility endpoint) request`);

  // Reuse the same logic as /cat/:cid
  try {
    const requestOptions: {
      hostname: string;
      port: number;
      path: string;
      method: string;
      headers: Record<string, string>;
    } = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${cid}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      } as Record<string, string>,
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
        loggers.server.error({ err, cid }, `❌ IPFS Content error`);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: err.message,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, cid }, `❌ IPFS Content request error`);
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error, cid: req.params.cid }, `❌ IPFS Content error`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Compatibility endpoint for shogun-ipfs: /ipfs/:cid (under /api/v1/ipfs/)
router.get("/ipfs/:cid", async (req, res) => {
  // Redirect to /cat/:cid endpoint
  const { cid } = req.params;
  loggers.server.debug({ cid }, `📄 IPFS Gateway (compatibility endpoint) request`);

  // Reuse the same logic as /cat/:cid
  try {
    const requestOptions: {
      hostname: string;
      port: number;
      path: string;
      method: string;
      headers: Record<string, string>;
    } = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${cid}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      } as Record<string, string>,
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      // Try to detect content type
      let contentType = "application/octet-stream";
      const chunks: Buffer[] = [];

      ipfsRes.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
        // Detect content type from first bytes
        if (chunks.length === 1 && chunk.length > 0) {
          const firstBytes = chunk.slice(0, 512);
          if (
            firstBytes[0] === 0x89 &&
            firstBytes[1] === 0x50 &&
            firstBytes[2] === 0x4e &&
            firstBytes[3] === 0x47
          ) {
            contentType = "image/png";
          } else if (firstBytes[0] === 0xff && firstBytes[1] === 0xd8) {
            contentType = "image/jpeg";
          } else if (firstBytes[0] === 0x47 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46) {
            contentType = "image/gif";
          } else if (
            firstBytes[0] === 0x25 &&
            firstBytes[1] === 0x50 &&
            firstBytes[2] === 0x44 &&
            firstBytes[3] === 0x46
          ) {
            contentType = "application/pdf";
          } else {
            try {
              JSON.parse(chunk.toString());
              contentType = "application/json";
            } catch {
              // Keep default
            }
          }
        }
      });

      ipfsRes.on("end", () => {
        const buffer = Buffer.concat(chunks);
        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Length", buffer.length.toString());
        res.setHeader("Cache-Control", "public, max-age=31536000");
        res.send(buffer);
      });

      ipfsRes.on("error", (err) => {
        loggers.server.error({ err, cid }, `❌ IPFS Gateway error`);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: err.message,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, cid }, `❌ IPFS Gateway request error`);
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error, cid: req.params.cid }, `❌ IPFS Gateway error`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// IPFS Cat with decryption (for SEA encrypted content)
router.get("/cat/:cid/decrypt", async (req, res) => {
  try {
    const { cid } = req.params;
    let { token } = req.query;
    const userAddress = req.headers["x-user-address"]; // Optional: user address for signature verification
    const IPFS_GATEWAY_URL = ipfsConfig.gatewayUrl || "http://127.0.0.1:8080";

    loggers.server.debug({ cid, hasToken: !!token }, `🔓 IPFS Decrypt request`);

    // Verify signature if userAddress is provided (for enhanced security)
    // The token can be either:
    // 1. An EIP-191 signature (recommended, more secure) - starts with 0x and is long
    // 2. An address (legacy, less secure) - starts with 0x and is short
    // 3. A JSON object (legacy keypair format)
    const tokenStr = Array.isArray(token) ? token[0] : token;
    if (
      tokenStr &&
      userAddress &&
      typeof tokenStr === "string" &&
      tokenStr.startsWith("0x") &&
      tokenStr.length > 100
    ) {
      // Looks like a signature (long hexstr), verify it if ethers is available
      try {
        const { ethers } = await import("ethers");
        const expectedMessage = "I Love Shogun";
        const recoveredAddress = ethers.verifyMessage(expectedMessage, tokenStr);

        const userAddressStr = Array.isArray(userAddress) ? userAddress[0] : userAddress;
        if (
          userAddressStr &&
          typeof userAddressStr === "string" &&
          recoveredAddress.toLowerCase() !== userAddressStr.toLowerCase()
        ) {
          loggers.server.warn(
            { userAddress, recoveredAddress },
            `⚠️ Signature verification failed`
          );
          // Continue anyway - decryption will fail if signature is wrong
        } else {
          loggers.server.debug({ userAddress }, `✅ Signature verified`);
        }
      } catch (verifyError) {
        // If verification fails, continue - might be a legacy address or different format
        loggers.server.warn({ err: verifyError }, `⚠️ Signature verification skipped`);
      }
    }

    // Parse token if it's a JSONstr(not a hexstr)
    // Note: Simple passwords like "shogun2025" should NOT be parsed as JSON
    if (token && typeof token === "string" && !token.startsWith("0x")) {
      // Only try to parse as JSON if it looks like JSON (starts with { or [)
      if (token.trim().startsWith("{") || token.trim().startsWith("[")) {
        try {
          token = JSON.parse(token);
          loggers.server.debug(`🔑 Token parsed as JSON successfully`);
        } catch (parseError) {
          // Not valid JSON, use as-is (could be password, address, or signature)
          loggers.server.debug(`🔑 Token is not JSON, using as-is (password or other format)`);
        }
      } else {
        // Token is a simplestr(password), use as-is
        loggers.server.debug(`🔑 Token is a simplestr(password), using as-is`);
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
    const IPFS_API_TOKEN = ipfsConfig.apiToken;

    // Try API first if we have a local API URL
    const useApi =
      IPFS_GATEWAY_URL &&
      (IPFS_GATEWAY_URL.includes("127.0.0.1") || IPFS_GATEWAY_URL.includes("localhost"));

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
        (requestOptions.headers as Record<string, string>)["Authorization"] =
          `Bearer ${IPFS_API_TOKEN}`;
      }
    } else {
      // Use gateway
      const gatewayUrl = new URL(IPFS_GATEWAY_URL);
      protocolModule =
        gatewayUrl.protocol === "https:" ? await import("https") : await import("http");

      requestOptions = {
        hostname: gatewayUrl.hostname,
        port: gatewayUrl.port
          ? Number(gatewayUrl.port)
          : gatewayUrl.protocol === "https:"
            ? 443
            : 80,
        path: `/ipfs/${cid}`,
        method: "GET",
        headers: {
          Host: gatewayUrl.host,
        },
      };
    }

    const ipfsReq = protocolModule.request(requestOptions, (ipfsRes) => {
      loggers.server.debug({ cid, statusCode: ipfsRes.statusCode }, `📥 IPFS response received`);

      // Handle IPFS errors
      ipfsRes.on("error", (err) => {
        loggers.server.error({ err, cid }, `❌ IPFS response error`);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: "Failed to fetch from IPFS",
            message: err.message,
          });
        }
      });

      // If no token, just stream the response
      if (!token) {
        loggers.server.debug({ cid }, `📤 Streaming content without decryption`);
        res.setHeader(
          "Content-Type",
          ipfsRes.headers["content-type"] || "application/octet-stream"
        );
        ipfsRes.pipe(res);
        return;
      }

      // If token is provided, buffer the response to decrypt it
      loggers.server.debug(
        {
          cid,
          tokenType: typeof token,
          tokenLength: typeof token === "string" ? token.length : "N/A",
          tokenPreview: token
            ? typeof token === "string"
              ? token.substring(0, 20) + "..."
              : "object"
            : "missing",
        },
        `🔓 Attempting decryption`
      );
      const chunks: Buffer[] = [];
      let chunkCount = 0;
      ipfsRes.on("data", (chunk) => {
        chunks.push(chunk);
        chunkCount++;
        if (chunkCount === 1) {
          loggers.server.debug({ cid, chunkSize: chunk.length }, `   First chunk received`);
        }
      });
      ipfsRes.on("end", async () => {
        const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
        loggers.server.debug({ cid, chunkCount, totalSize }, `   All chunks received`);
        // Convert chunks tostrproperly (handles both Buffer andstrchunks)
        const body = Buffer.concat(chunks).toString("utf8");
        loggers.server.debug(
          { cid, bodyLength: body.length, preview: body.substring(0, 100) },
          `   Body received`
        );
        try {
          // Check if body looks like encrypted JSON (SEA encrypted data)
          let isEncryptedData = false;
          let encryptedObject = null;

          // Check if body is "[object Object]" (happens when File was created with object instead of JSONstr)
          if (body && typeof body === "string" && body.trim() === "[object Object]") {
            loggers.server.warn(
              { cid },
              `⚠️ Detected "[object Object]"string- file was uploaded incorrectly`
            );
            // Cannot decrypt this, return error
            if (!res.headersSent) {
              res.status(400).json({
                success: false,
                error: "File was uploaded in incorrect format. Please re-upload the file.",
                details:
                  "The encrypted file was saved as '[object Object]' instead of JSON. This is a known issue with files uploaded before the fix.",
              });
            }
            return;
          }

          try {
            // Try to parse as JSON
            let parsed = JSON.parse(body);
            loggers.server.debug(
              {
                cid,
                parsedType: typeof parsed,
                isString: typeof parsed === "string",
              },
              `📦 Parsed JSON`
            );

            // Check if parsed result is astrthat starts with "SEA{" (double-encoded JSON)
            // This happens when the encrypted object was stringified: JSON.stringify(SEA.encrypt(...))
            // But SEA.encrypt() returns an object, so JSON.stringify() should produce normal JSON
            // However, if the body was saved as astrrepresentation, it might be "SEA{...}"
            if (typeof parsed === "string" && parsed.trim().startsWith("SEA{")) {
              loggers.server.debug(
                {
                  cid,
                  stringLength: parsed.length,
                  preview: parsed.substring(0, 100),
                },
                `🔐 Detectedstrstarting with SEA{ (might be SEA serialization)`
              );
              try {
                // Try to parse the SEAstr- remove "SEA" prefix if present
                let seaString = parsed.trim();
                if (seaString.startsWith("SEA{")) {
                  seaString = seaString.substring(3); // Remove "SEA" prefix, keep the "{...}"
                }
                const innerParsed = JSON.parse(seaString);
                const keys =
                  innerParsed && typeof innerParsed === "object"
                    ? Object.keys(innerParsed).join(", ")
                    : "N/A";
                loggers.server.debug(
                  { cid, innerParsedType: typeof innerParsed, keys },
                  `   Inner parsed`
                );
                if (
                  innerParsed &&
                  typeof innerParsed === "object" &&
                  (innerParsed.ct || innerParsed.iv || innerParsed.s || innerParsed.salt)
                ) {
                  isEncryptedData = true;
                  encryptedObject = innerParsed;
                  loggers.server.debug(
                    { cid },
                    `✅ Detected encrypted data structure (SEAstrformat)`
                  );
                } else {
                  loggers.server.debug(
                    { cid },
                    `⚠️ Inner parsed object doesn't have SEA structure`
                  );
                }
              } catch (innerError) {
                loggers.server.debug({ err: innerError, cid }, `⚠️ Failed to parse SEAstr`);
                // Thestrmight not be valid JSON - this is expected if it's a SEA serialization
                // In this case, the original body should be the actual JSON object
                loggers.server.debug(
                  { cid },
                  `   Trying to use original body as encrypted object...`
                );
                // Try to parse the original body directly as JSON (without the outerstrwrapper)
                try {
                  const directParsed = JSON.parse(body);
                  if (
                    directParsed &&
                    typeof directParsed === "object" &&
                    (directParsed.ct || directParsed.iv || directParsed.s || directParsed.salt)
                  ) {
                    isEncryptedData = true;
                    encryptedObject = directParsed;
                    loggers.server.debug(
                      { cid },
                      `✅ Detected encrypted data structure (direct from body)`
                    );
                  }
                } catch (directError) {
                  loggers.server.debug(
                    { err: directError, cid },
                    `⚠️ Also failed to parse body directly`
                  );
                  isEncryptedData = false;
                }
              }
            }
            // SEA encrypted data has specific structure (direct object)
            else if (
              parsed &&
              typeof parsed === "object" &&
              (parsed.ct || parsed.iv || parsed.s || parsed.salt)
            ) {
              isEncryptedData = true;
              encryptedObject = parsed;
              loggers.server.debug({ cid }, `✅ Detected encrypted data structure (direct object)`);
            } else if (parsed && typeof parsed === "object") {
              loggers.server.debug(
                { cid, keys: Object.keys(parsed).join(", ") },
                `📄 Body is JSON object but doesn't look encrypted`
              );
            } else if (typeof parsed === "string") {
              loggers.server.debug(
                {
                  cid,
                  length: parsed.length,
                  preview: parsed.substring(0, 100),
                },
                `📄 Parsed JSON is astr(not SEA{...})`
              );
            }
          } catch (e) {
            // Not JSON, but might be direct SEAstr
            if (typeof body === "string" && body.trim().startsWith("SEA{")) {
              loggers.server.debug(
                { cid },
                `🔐 Body is not JSON but starts with SEA{, trying to parse as SEA data`
              );
              try {
                let seaString = body.trim();
                if (seaString.startsWith("SEA{")) {
                  seaString = seaString.substring(3); // Remove "SEA" prefix
                }
                const seaParsed = JSON.parse(seaString);
                if (
                  seaParsed &&
                  typeof seaParsed === "object" &&
                  (seaParsed.ct || seaParsed.iv || seaParsed.s || seaParsed.salt)
                ) {
                  isEncryptedData = true;
                  encryptedObject = seaParsed;
                  loggers.server.debug(
                    { cid },
                    `✅ Detected encrypted data structure (direct SEA, no JSON wrapper)`
                  );
                } else {
                  loggers.server.debug(
                    { cid },
                    `⚠️ SEA parsed object doesn't have expected structure`
                  );
                }
              } catch (seaError: unknown) {
                const eMessage = e instanceof Error ? e.message : String(e);
                const seaErrorMessage =
                  seaError instanceof Error ? seaError.message : String(seaError);
                loggers.server.debug(
                  {
                    cid,
                    parseError: eMessage,
                    seaError: seaErrorMessage,
                    preview: body.substring(0, 200),
                  },
                  `📄 Body is not valid JSON and not valid SEA data`
                );
                isEncryptedData = false;
              }
            } else {
              // Not JSON, probably not encrypted
              isEncryptedData = false;
              const eMessage = e instanceof Error ? e.message : String(e);
              loggers.server.debug(
                { cid, error: eMessage, preview: body.substring(0, 200) },
                `📄 Body is not valid JSON, skipping decryption`
              );
            }
          }

          // Only try to decrypt if it looks like encrypted data
          if (isEncryptedData && encryptedObject && token) {
            loggers.server.debug(
              {
                cid,
                tokenType: typeof token,
                tokenLength: typeof token === "string" ? token.length : "N/A",
                tokenPreview:
                  typeof token === "string"
                    ? token.substring(0, 20) + "..."
                    : JSON.stringify(token).substring(0, 50),
                encryptedKeys: Object.keys(encryptedObject).join(", "),
                encryptedPreview: JSON.stringify(encryptedObject).substring(0, 200),
              },
              `🔓 Attempting decryption with token`
            );
            const SEA = await import("gun/sea.js");
            // Decrypt using the token (signature, password, or key)
            // Token can be:string(password), signature (hex), or keypair object
            // Note: SEA.decrypt expects the encrypted object and the key/password
            let decrypted;
            try {
              const tokenForDecrypt =
                typeof token === "string" ? token : Array.isArray(token) ? token[0] : "";
              if (typeof tokenForDecrypt === "string") {
                decrypted = await SEA.default.decrypt(encryptedObject, tokenForDecrypt);
              } else {
                decrypted = null;
              }
              loggers.server.debug(
                {
                  cid,
                  result: decrypted
                    ? typeof decrypted === "string"
                      ? `string (${decrypted.length} chars)`
                      : typeof decrypted
                    : "null/undefined",
                },
                `   Decryption result`
              );
            } catch (decryptErr) {
              loggers.server.error({ err: decryptErr, cid }, `   Decryption threw error`);
              decrypted = null;
            }

            if (decrypted) {
              loggers.server.debug({ cid }, `✅ Decryption successful!`);

              // Check if decrypted data is a data URL
              if (typeof decrypted === "string" && decrypted.startsWith("data:")) {
                loggers.server.debug(
                  { cid },
                  `📁 Detected data URL, extracting content type and data`
                );

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
              } else if (typeof decrypted === "string") {
                // Check if it's a plain base64str(without data: prefix)
                // This handles old files that were encrypted with only base64
                try {
                  // Try to decode as base64
                  const buffer = Buffer.from(decrypted, "base64");

                  // Try to detect content type from magic numbers
                  let contentType = "application/octet-stream";
                  if (buffer.length >= 4) {
                    // PNG: 89 50 4E 47
                    if (
                      buffer[0] === 0x89 &&
                      buffer[1] === 0x50 &&
                      buffer[2] === 0x4e &&
                      buffer[3] === 0x47
                    ) {
                      contentType = "image/png";
                    }
                    // JPEG: FF D8 FF
                    else if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
                      contentType = "image/jpeg";
                    }
                    // GIF: 47 49 46 38
                    else if (
                      buffer[0] === 0x47 &&
                      buffer[1] === 0x49 &&
                      buffer[2] === 0x46 &&
                      buffer[3] === 0x38
                    ) {
                      contentType = "image/gif";
                    }
                    // PDF: 25 50 44 46
                    else if (
                      buffer[0] === 0x25 &&
                      buffer[1] === 0x50 &&
                      buffer[2] === 0x44 &&
                      buffer[3] === 0x46
                    ) {
                      contentType = "application/pdf";
                    }
                    // WebP: Check for RIFF header
                    else if (
                      buffer.length >= 12 &&
                      buffer[0] === 0x52 &&
                      buffer[1] === 0x49 &&
                      buffer[2] === 0x46 &&
                      buffer[3] === 0x46 &&
                      buffer[8] === 0x57 &&
                      buffer[9] === 0x45 &&
                      buffer[10] === 0x42 &&
                      buffer[11] === 0x50
                    ) {
                      contentType = "image/webp";
                    }
                  }

                  loggers.server.debug(
                    { cid, contentType },
                    `📁 Detected plain base64, converted to buffer`
                  );
                  res.setHeader("Content-Type", contentType);
                  res.setHeader("Content-Length", buffer.length);
                  res.setHeader("Cache-Control", "public, max-age=3600");
                  res.send(buffer);
                  return;
                } catch (base64Error) {
                  // Not valid base64, return as text/plain
                  loggers.server.debug({ cid }, `📄 Returning as text/plain (not valid base64)`);
                  res.setHeader("Content-Type", "text/plain");
                  res.send(decrypted);
                  return;
                }
              } else {
                // Return as text/plain for other types
                res.setHeader("Content-Type", "text/plain");
                res.send(decrypted);
                return;
              }
            } else {
              // Decryption failed - file might not be encrypted or wrong token
              loggers.server.warn(
                {
                  cid,
                  tokenType: typeof token,
                  tokenLength: typeof token === "string" ? token.length : "N/A",
                  tokenValue:
                    typeof token === "string"
                      ? token.substring(0, 30) + "..."
                      : JSON.stringify(token).substring(0, 50),
                  encryptedKeys: encryptedObject ? Object.keys(encryptedObject).join(", ") : "none",
                  encryptedPreview: JSON.stringify(encryptedObject).substring(0, 200),
                },
                `⚠️ Decryption returned null - file might not be encrypted or token is wrong`
              );

              // Return error instead of encrypted content
              if (!res.headersSent) {
                res.status(400).json({
                  success: false,
                  error: "Decryption failed",
                  message:
                    "The file could not be decrypted. Please check that you're using the correct token/password.",
                  details:
                    "This usually means the token/password is incorrect or the file was encrypted with a different key.",
                });
              }
              return;
            }
          } else {
            // File doesn't look encrypted, but if token is provided, we should try to decrypt anyway
            // This handles edge cases where the encrypted structure isn't detected properly
            if (token && body && body.length > 0) {
              loggers.server.debug(
                { cid, preview: body.substring(0, 200) },
                `⚠️ File doesn't appear encrypted but token provided, attempting decryption anyway`
              );
              try {
                const SEA = await import("gun/sea.js");
                // Try to parse body as JSON first
                let encryptedObj = null;
                try {
                  const parsed = JSON.parse(body);
                  if (
                    parsed &&
                    typeof parsed === "object" &&
                    (parsed.ct || parsed.iv || parsed.s || parsed.salt)
                  ) {
                    encryptedObj = parsed;
                  } else if (typeof parsed === "string" && parsed.trim().startsWith("SEA{")) {
                    // Handle SEA{...} format
                    let seaString = parsed.trim();
                    if (seaString.startsWith("SEA{")) {
                      seaString = seaString.substring(3);
                    }
                    encryptedObj = JSON.parse(seaString);
                  }
                } catch (parseErr) {
                  // Body might not be JSON, but could still be encrypted
                  loggers.server.debug({ cid }, `   Body is not JSON, cannot attempt decryption`);
                }

                if (encryptedObj) {
                  loggers.server.debug({ cid }, `   Attempting decryption with parsed object`);
                  const tokenForDecrypt =
                    typeof token === "string" ? token : Array.isArray(token) ? token[0] : "";
                  const decrypted =
                    typeof tokenForDecrypt === "string"
                      ? await SEA.default.decrypt(encryptedObj, tokenForDecrypt)
                      : null;
                  if (decrypted) {
                    loggers.server.debug({ cid }, `✅ Decryption successful!`);
                    // Handle decrypted data (same as above)
                    if (typeof decrypted === "string" && decrypted.startsWith("data:")) {
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
                      }
                    } else if (typeof decrypted === "string") {
                      try {
                        const buffer = Buffer.from(decrypted, "base64");
                        res.setHeader("Content-Type", "application/octet-stream");
                        res.setHeader("Content-Length", buffer.length);
                        res.send(buffer);
                        return;
                      } catch (e) {
                        res.setHeader("Content-Type", "text/plain");
                        res.send(decrypted);
                        return;
                      }
                    }
                  }
                }
              } catch (fallbackErr) {
                loggers.server.debug({ err: fallbackErr, cid }, `   Fallback decryption failed`);
              }
            }

            // File doesn't look encrypted, return as-is
            loggers.server.debug(
              {
                cid,
                isEncryptedData,
                hasToken: !!token,
                preview: body.substring(0, 200),
              },
              `📤 File doesn't appear to be encrypted, returning as-is`
            );
            if (!res.headersSent) {
              res.setHeader(
                "Content-Type",
                ipfsRes.headers["content-type"] || "application/octet-stream"
              );
              res.setHeader("Cache-Control", "public, max-age=3600");
              res.send(body);
            }
            return;
          }
        } catch (decryptError) {
          loggers.server.error({ err: decryptError, cid }, "❌ Decryption error");
          // On error, try to return original content
          loggers.server.warn({ cid }, `⚠️ Returning original content due to decryption error`);
          if (!res.headersSent) {
            res.setHeader(
              "Content-Type",
              ipfsRes.headers["content-type"] || "application/octet-stream"
            );
            res.setHeader("Cache-Control", "public, max-age=3600");
            res.send(body);
          }
        }
      });
    });

    ipfsReq.on("error", (error) => {
      loggers.server.error({ err: error, cid }, `❌ IPFS Gateway error`);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "IPFS Gateway error",
          details: error.message,
        });
      }
    });

    loggers.server.debug(
      { cid, method: requestOptions.method, path: requestOptions.path },
      `📤 Sending IPFS request`
    );
    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error, cid: req.params.cid }, `❌ IPFS Decrypt error`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// IPFS Cat JSON endpoint (content parsed as JSON)
router.get("/cat/:cid/json", async (req: Request, res: Response) => {
  try {
    const { cid } = req.params;
    loggers.server.debug({ cid }, `📄 IPFS Content JSON request`);

    const requestOptions: {
      hostname: string;
      port: number;
      path: string;
      method: string;
      headers: Record<string, string>;
    } = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${cid}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      } as Record<string, string>,
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
      loggers.server.error({ err, cid }, `❌ IPFS Content JSON error`);
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error, cid: req.params.cid }, `❌ IPFS Content JSON error`);
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// IPFS Pin endpoints (aligned with Kubo's /api/v0/pin/*)
router.post(
  "/pin/add",
  (req, res, next) => {
    // Usa il middleware di autenticazione esistente
    const tokenAuthMiddleware = req.app.get("tokenAuthMiddleware");
    if (tokenAuthMiddleware) {
      tokenAuthMiddleware(req, res, next);
    } else {
      // Fallback se il middleware non è disponibile
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const token = bearerToken || customToken;

      if (token === authConfig.adminPassword) {
        next();
      } else {
        loggers.server.warn(
          { bearerToken: !!bearerToken, customToken: !!customToken },
          "Auth failed"
        );
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
    }
  },
  async (req, res) => {
    try {
      loggers.server.debug({ body: req.body }, "🔍 IPFS Pin add request");
      const { cid } = req.body;

      if (!cid) {
        loggers.server.warn("❌ IPFS Pin add error: CID is required");
        return res.status(400).json({
          success: false,
          error: "CID is required",
        });
      }

      const requestOptions: {
        hostname: string;
        port: number;
        path: string;
        method: string;
        headers: Record<string, string>;
      } = {
        hostname: "127.0.0.1",
        port: 5001,
        path: `/api/v0/pin/add?arg=${cid}`,
        method: "POST",
        headers: {
          "Content-Length": "0",
        } as Record<string, string>,
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
        loggers.server.error({ err }, "❌ IPFS Pin add error");
        res.status(500).json({
          success: false,
          error: err.message,
        });
      });

      ipfsReq.end();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error }, "❌ IPFS Pin add error");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

router.post(
  "/pin/rm",
  (req: Request, res: Response, next) => {
    // Usa il middleware di autenticazione esistente
    const tokenAuthMiddleware = req.app.get("tokenAuthMiddleware");
    if (tokenAuthMiddleware) {
      tokenAuthMiddleware(req, res, next);
    } else {
      // Fallback se il middleware non è disponibile
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const token = bearerToken || customToken;

      if (token === authConfig.adminPassword) {
        next();
      } else {
        loggers.server.warn(
          { bearerToken: !!bearerToken, customToken: !!customToken },
          "Auth failed"
        );
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
    }
  },
  async (req, res) => {
    try {
      loggers.server.debug({ body: req.body }, "🔍 IPFS Pin rm request");
      const { cid } = req.body;
      loggers.server.debug({ cid }, `🔍 IPFS Pin rm request for CID`);

      if (!cid) {
        loggers.server.warn("❌ IPFS Pin rm error: CID is required");
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
        (requestOptions.headers as Record<string, string>)["Authorization"] =
          `Bearer ${IPFS_API_TOKEN}`;
        loggers.server.debug("🔐 IPFS API token found, adding authorization header");
      } else {
        loggers.server.warn("⚠️ No IPFS API token configured");
      }

      loggers.server.debug(
        {
          hostname: requestOptions.hostname,
          port: requestOptions.port,
          path: requestOptions.path,
        },
        `📡 Making IPFS API request`
      );

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        loggers.server.debug(
          { statusCode: ipfsRes.statusCode, headers: ipfsRes.headers },
          `📡 IPFS API response`
        );

        let data = "";
        ipfsRes.on("data", (chunk) => {
          data += chunk;
          loggers.server.debug({ chunk: chunk.toString() }, `📡 IPFS API data chunk`);
        });

        ipfsRes.on("end", () => {
          loggers.server.debug({ data }, `📡 IPFS API complete response`);

          try {
            const result = JSON.parse(data);
            loggers.server.info({ cid, result }, `✅ IPFS Pin rm success`);
            res.json({
              success: true,
              message: "CID unpinned successfully",
              result: result,
            });
          } catch (parseError) {
            loggers.server.error(
              { err: parseError, cid, rawResponse: data },
              `❌ IPFS Pin rm parse error`
            );
            res.status(500).json({
              success: false,
              error: "Failed to parse IPFS response",
              rawResponse: data,
              parseError: parseError instanceof Error ? parseError.message : String(parseError),
            });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        loggers.server.error({ err, cid }, `❌ IPFS Pin rm network error`);
        res.status(500).json({
          success: false,
          error: err.message,
          details: "Network error connecting to IPFS API",
        });
      });

      ipfsReq.on("timeout", () => {
        loggers.server.error({ cid }, `❌ IPFS Pin rm timeout`);
        ipfsReq.destroy();
        res.status(408).json({
          success: false,
          error: "IPFS API request timeout",
        });
      });

      // Set timeout to 30 seconds
      ipfsReq.setTimeout(30000);

      loggers.server.debug({ cid }, `📡 Sending IPFS API request`);
      ipfsReq.end();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error, cid: req.body?.cid }, `❌ IPFS Pin rm unexpected error`);
      res.status(500).json({
        success: false,
        error: errorMessage,
        details: "Unexpected error in pin removal",
      });
    }
  }
);

// Alias endpoint for shogun-ipfs compatibility: /pins/rm -> /pin/rm
router.post(
  "/pins/rm",
  (req: Request, res: Response, next) => {
    // Usa il middleware di autenticazione esistente
    const tokenAuthMiddleware = req.app.get("tokenAuthMiddleware");
    if (tokenAuthMiddleware) {
      tokenAuthMiddleware(req, res, next);
    } else {
      // Fallback se il middleware non è disponibile
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const token = bearerToken || customToken;

      if (token === authConfig.adminPassword) {
        next();
      } else {
        loggers.server.warn(
          { bearerToken: !!bearerToken, customToken: !!customToken },
          "Auth failed"
        );
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
    }
  },
  async (req, res) => {
    try {
      loggers.server.debug({ body: req.body }, "🔍 IPFS Pin rm (alias /pins/rm) request");
      const { cid } = req.body;
      loggers.server.debug({ cid }, `🔍 IPFS Pin rm (alias /pins/rm) request for CID`);

      if (!cid) {
        loggers.server.warn("❌ IPFS Pin rm (alias /pins/rm) error: CID is required");
        return res.status(400).json({
          success: false,
          error: "CID is required",
        });
      }

      const requestOptions: {
        hostname: string;
        port: number;
        path: string;
        method: string;
        headers: Record<string, string>;
      } = {
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
        loggers.server.debug("🔐 IPFS API token found, adding authorization header");
      } else {
        loggers.server.warn("⚠️ No IPFS API token configured");
      }

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        let data = "";
        ipfsRes.on("data", (chunk) => (data += chunk));
        ipfsRes.on("end", () => {
          if (ipfsRes.statusCode === 200) {
            try {
              const result = JSON.parse(data);
              loggers.server.info({ cid, result }, `✅ IPFS Pin rm (alias /pins/rm) success`);
              res.json({
                success: true,
                message: `Pin removed successfully for CID: ${cid}`,
                data: result,
              });
            } catch (parseError) {
              loggers.server.error(
                { err: parseError, cid },
                `❌ IPFS Pin rm (alias /pins/rm) parse error`
              );
              res.json({
                success: true,
                message: `Pin removed successfully for CID: ${cid}`,
                rawResponse: data,
              });
            }
          } else {
            const statusCode = ipfsRes.statusCode || 500;
            loggers.server.error({ cid, statusCode }, `❌ IPFS Pin rm (alias /pins/rm) failed`);
            res.status(statusCode).json({
              success: false,
              error: `IPFS pin removal failed: ${statusCode}`,
              details: data,
            });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        loggers.server.error({ err, cid }, `❌ IPFS Pin rm (alias /pins/rm) network error`);
        res.status(500).json({
          success: false,
          error: "Network error",
          details: err.message,
        });
      });

      // Set timeout to 30 seconds
      ipfsReq.setTimeout(30000);

      loggers.server.debug({ cid }, `📡 Sending IPFS API request`);
      ipfsReq.end();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error(
        { err: error, cid: req.body?.cid },
        `❌ IPFS Pin rm (alias /pins/rm) unexpected error`
      );
      res.status(500).json({
        success: false,
        error: errorMessage,
        details: "Unexpected error in pin removal",
      });
    }
  }
);

router.get(
  "/pin/ls",
  (req, res, next) => {
    // Usa il middleware di autenticazione esistente
    const tokenAuthMiddleware = req.app.get("tokenAuthMiddleware");
    if (tokenAuthMiddleware) {
      tokenAuthMiddleware(req, res, next);
    } else {
      // Fallback se il middleware non è disponibile
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const token = bearerToken || customToken;

      if (token === authConfig.adminPassword) {
        next();
      } else {
        loggers.server.warn(
          { bearerToken: !!bearerToken, customToken: !!customToken },
          "Auth failed"
        );
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
    }
  },
  async (req, res) => {
    try {
      const requestOptions: {
        hostname: string;
        port: number;
        path: string;
        method: string;
        headers: Record<string, string>;
      } = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/pin/ls",
        method: "POST",
        headers: {
          "Content-Length": "0",
        } as Record<string, string>,
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
        loggers.server.error({ err }, "❌ IPFS Pin ls error");
        res.status(500).json({
          success: false,
          error: err.message,
        });
      });

      ipfsReq.end();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error }, "❌ IPFS Pin ls error");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

// IPFS Repo GC endpoint
router.post(
  "/repo/gc",
  (req: Request, res: Response, next) => {
    // Usa il middleware di autenticazione esistente
    const tokenAuthMiddleware = req.app.get("tokenAuthMiddleware");
    if (tokenAuthMiddleware) {
      tokenAuthMiddleware(req, res, next);
    } else {
      // Fallback se il middleware non è disponibile
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const token = bearerToken || customToken;

      if (token === authConfig.adminPassword) {
        next();
      } else {
        loggers.server.warn(
          { bearerToken: !!bearerToken, customToken: !!customToken },
          "Auth failed"
        );
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
    }
  },
  async (req, res) => {
    try {
      const requestOptions: {
        hostname: string;
        port: number;
        path: string;
        method: string;
        headers: Record<string, string>;
      } = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/repo/gc",
        method: "POST",
        headers: {
          "Content-Length": "0",
        } as Record<string, string>,
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
        loggers.server.error({ err }, "❌ IPFS Repo GC error");
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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error }, "❌ IPFS Repo GC error");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

// IPFS API connectivity test endpoint
router.get(
  "/test",
  (req, res, next) => {
    // Usa il middleware di autenticazione esistente
    const tokenAuthMiddleware = req.app.get("tokenAuthMiddleware");
    if (tokenAuthMiddleware) {
      tokenAuthMiddleware(req, res, next);
    } else {
      // Fallback se il middleware non è disponibile
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const token = bearerToken || customToken;

      if (token === authConfig.adminPassword) {
        next();
      } else {
        loggers.server.warn(
          { bearerToken: !!bearerToken, customToken: !!customToken },
          "Auth failed"
        );
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
    }
  },
  async (req, res) => {
    try {
      loggers.server.debug("🔍 Testing IPFS API connectivity...");

      const requestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/version",
        method: "POST",
        headers: {
          "Content-Length": "0",
        } as Record<string, string>,
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      loggers.server.debug(
        {
          hostname: requestOptions.hostname,
          port: requestOptions.port,
          path: requestOptions.path,
        },
        `📡 Testing IPFS API`
      );

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        loggers.server.debug(
          { statusCode: ipfsRes.statusCode },
          `📡 IPFS API test response status`
        );

        let data = "";
        ipfsRes.on("data", (chunk) => (data += chunk));
        ipfsRes.on("end", () => {
          loggers.server.debug({ data }, `📡 IPFS API test response`);

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
        loggers.server.error({ err }, "❌ IPFS API test error");
        res.status(500).json({
          success: false,
          error: "IPFS API is not reachable",
          details: err.message,
        });
      });

      ipfsReq.setTimeout(10000);
      ipfsReq.end();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error }, "❌ IPFS API test unexpected error");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

// IPFS object/block stat endpoint - get info about a CID
router.get("/stat/:cid", async (req: Request, res: Response) => {
  const { cid } = req.params;

  if (!cid) {
    return res.status(400).json({ success: false, error: "CID is required" });
  }

  try {
    // Try object/stat first (works for most CIDs)
    const objectStatOptions: {
      hostname: string;
      port: number;
      path: string;
      method: string;
      headers: Record<string, string>;
    } = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/object/stat?arg=${encodeURIComponent(cid)}`,
      method: "POST",
      headers: { "Content-Length": "0" },
    };

    if (IPFS_API_TOKEN) {
      objectStatOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const stat = await new Promise<any>((resolve, reject) => {
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
            reject(new Error(`IPFS returned status ${statRes.statusCode || "unknown"}`));
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
      },
    });
  } catch (error: unknown) {
    // Fallback to block/stat
    try {
      const blockStatOptions: {
        hostname: string;
        port: number;
        path: string;
        method: string;
        headers: Record<string, string>;
      } = {
        hostname: "127.0.0.1",
        port: 5001,
        path: `/api/v0/block/stat?arg=${encodeURIComponent(cid)}`,
        method: "POST",
        headers: { "Content-Length": "0" },
      };

      if (IPFS_API_TOKEN) {
        blockStatOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const blockStat = await new Promise<any>((resolve, reject) => {
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

      const blockStatObj = blockStat as any;
      res.json({
        success: true,
        cid,
        stat: {
          Hash: blockStatObj.Key,
          CumulativeSize: blockStatObj.Size,
          BlockSize: blockStatObj.Size,
        },
      });
    } catch (blockError) {
      res.status(404).json({
        success: false,
        error: "CID not found or not accessible",
        cid,
      });
    }
  }
});

// IPFS Repo Stats endpoint
router.get(
  "/repo/stat",
  (req, res, next) => {
    // Usa il middleware di autenticazione esistente
    const tokenAuthMiddleware = req.app.get("tokenAuthMiddleware");
    if (tokenAuthMiddleware) {
      tokenAuthMiddleware(req, res, next);
    } else {
      // Fallback se il middleware non è disponibile
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const token = bearerToken || customToken;

      if (token === authConfig.adminPassword) {
        next();
      } else {
        loggers.server.warn(
          { bearerToken: !!bearerToken, customToken: !!customToken },
          "Auth failed"
        );
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }
    }
  },
  async (req, res) => {
    try {
      loggers.server.debug("📊 Getting IPFS repository statistics (alternative method)...");

      // Get all pins first
      const pinsRequestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/pin/ls?type=all",
        method: "POST",
        headers: {
          "Content-Length": "0",
        } as Record<string, string>,
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

      // Get storage info from repo/stat (correct endpoint for repository size)
      // Note: Removed size-only=true to get full stats including RepoSize
      const storageRequestOptions: {
        hostname: string;
        port: number;
        path: string;
        method: string;
        headers: Record<string, string>;
      } = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/repo/stat",
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
              loggers.server.debug({ storageData }, "📦 IPFS repo/stat raw response");
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
      const versionRequestOptions: {
        hostname: string;
        port: number;
        path: string;
        method: string;
        headers: Record<string, string>;
      } = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/version",
        method: "POST",
        headers: {
          "Content-Length": "0",
        } as Record<string, string>,
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
        versionPromise,
      ]);

      // Calculate statistics
      const pinsDataObj = pinsData as any;
      const storageDataObj = storageData as any;
      const versionDataObj = versionData as any;
      const pinKeys = pinsDataObj.Keys || {};
      const numObjects = Object.keys(pinKeys).length;

      // Try multiple field names for RepoSize (IPFS API may return different formats)
      // RepoSize can be a number (bytes) or string (with units like "1234" or "1234B")
      let totalSize = 0;
      if (storageDataObj.RepoSize !== undefined) {
        totalSize =
          typeof storageDataObj.RepoSize === "string"
            ? parseInt(storageDataObj.RepoSize, 10) || 0
            : storageDataObj.RepoSize || 0;
      } else if (storageDataObj.repoSize !== undefined) {
        totalSize =
          typeof storageDataObj.repoSize === "string"
            ? parseInt(storageDataObj.repoSize, 10) || 0
            : storageDataObj.repoSize || 0;
      } else if (storageDataObj.Size !== undefined) {
        totalSize =
          typeof storageDataObj.Size === "string"
            ? parseInt(storageDataObj.Size, 10) || 0
            : storageDataObj.Size || 0;
      }

      // If RepoSize is 0 but we have pinned objects, try to calculate from pins
      if (totalSize === 0 && numObjects > 0) {
        loggers.server.warn(
          { numObjects, storageDataKeys: Object.keys(storageDataObj) },
          "⚠️ RepoSize is 0 but there are pinned objects. This may indicate files are pinned but not yet stored locally."
        );
      }

      const repoSizeMB = Math.round(totalSize / (1024 * 1024));

      // Get storage max from repo/stat response, or default to 10GB
      // Try multiple field names for StorageMax
      let storageMaxBytes = 0;
      if (storageDataObj.StorageMax !== undefined) {
        storageMaxBytes =
          typeof storageDataObj.StorageMax === "string"
            ? parseInt(storageDataObj.StorageMax, 10) || 10240 * 1024 * 1024
            : storageDataObj.StorageMax || 10240 * 1024 * 1024;
      } else if (storageDataObj.storageMax !== undefined) {
        storageMaxBytes =
          typeof storageDataObj.storageMax === "string"
            ? parseInt(storageDataObj.storageMax, 10) || 10240 * 1024 * 1024
            : storageDataObj.storageMax || 10240 * 1024 * 1024;
      } else {
        storageMaxBytes = 10240 * 1024 * 1024; // Default 10GB in bytes
      }

      const storageMaxMB = Math.round(storageMaxBytes / (1024 * 1024));
      const usagePercent = storageMaxMB > 0 ? Math.round((repoSizeMB / storageMaxMB) * 100) : 0;

      loggers.server.debug(
        { totalSize, repoSizeMB, storageMaxMB, usagePercent, numObjects },
        "📊 IPFS storage statistics calculated"
      );

      res.json({
        success: true,
        stats: {
          repoSize: totalSize,
          repoSizeMB: repoSizeMB,
          storageMax: storageMaxMB * 1024 * 1024, // Convert back to bytes
          storageMaxMB: storageMaxMB,
          numObjects: numObjects,
          repoPath: "/ipfs", // Default path
          version: versionDataObj.Version || "unknown",
        },
        raw: {
          pins: pinsDataObj,
          storage: storageDataObj,
          version: versionDataObj,
        },
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error }, "❌ IPFS Repo Stat error");
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
);

// IPFS Version endpoint for connectivity testing (public)
router.get("/version", async (req, res) => {
  try {
    loggers.server.debug("🔍 Testing IPFS API connectivity via /version endpoint...");

    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/version",
      method: "POST",
      headers: {
        "Content-Length": "0",
      } as Record<string, string>,
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    loggers.server.debug(
      {
        hostname: requestOptions.hostname,
        port: requestOptions.port,
        path: requestOptions.path,
      },
      `📡 Testing IPFS API`
    );

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      loggers.server.debug(
        { statusCode: ipfsRes.statusCode },
        `📡 IPFS API version response status`
      );

      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        loggers.server.debug({ data }, `📡 IPFS API version response`);

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
      loggers.server.error({ err }, "❌ IPFS API version error");
      res.status(500).json({
        success: false,
        error: "IPFS API is not reachable",
        details: err.message,
      });
    });

    ipfsReq.setTimeout(10000);
    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ IPFS API version unexpected error");
    res.status(500).json({
      success: false,
      error: errorMessage,
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

    const gun = req.app.get("gunInstance");
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
      uploads: uploads.map((upload) => ({
        hash: upload.hash,
        name: upload.name,
        size: upload.size,
        sizeMB: upload.sizeMB || (upload.size ? upload.size / (1024 * 1024) : 0),
        mimetype: upload.mimetype,
        uploadedAt: upload.uploadedAt,
      })),
      count: uploads.length,
      subscription: subscription.active
        ? {
          tier: subscription.tier,
          storageMB: subscription.storageMB,
          storageUsedMB: subscription.storageUsedMB,
          storageRemainingMB: subscription.storageRemainingMB,
        }
        : null,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ Get user uploads error");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// View/download user uploaded file (for x402 subscription users)
// Uses the same IPFS cat endpoint but validates subscription access
router.get("/user-uploads/:userAddress/:hash/view", async (req, res) => {
  try {
    const { userAddress, hash } = req.params;

    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Server error - Gun instance not available",
      });
    }

    // Get uploads to verify file belongs to user
    const uploads = await X402Merchant.getUserUploads(gun, userAddress);
    const uploadRecord = uploads.find((u) => u.hash === hash);

    if (!uploadRecord) {
      return res.status(404).json({
        success: false,
        error: "File not found for this user",
      });
    }

    // Check if file is encrypted (SEA encrypted files are JSON)
    // Encrypted files have mimetype 'application/json', 'text/plain' (with .enc extension), or name ends with '.encrypted' or '.enc'
    const isEncrypted =
      uploadRecord.mimetype === "application/json" ||
      uploadRecord.mimetype === "text/plain" ||
      (uploadRecord.name &&
        (uploadRecord.name.endsWith(".encrypted") || uploadRecord.name.endsWith(".enc")));

    // For encrypted files, we need to return as JSON so client can decrypt
    // For non-encrypted files, use the original mimetype
    const mimetype = isEncrypted
      ? "application/json"
      : uploadRecord.mimetype || "application/octet-stream";
    const filename = uploadRecord.name || hash;

    const requestOptions: {
      hostname: string;
      port: number;
      path: string;
      method: string;
      headers: Record<string, string>;
    } = {
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
      const isDownload = req.query.download === "true" || req.query.dl === "true";

      // For encrypted files, always return as JSON (client will decrypt)
      // For non-encrypted files, use original mimetype
      if (isEncrypted) {
        // Encrypted files must be returned as JSON for client-side decryption
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          isDownload ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`
        );
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
        loggers.server.error({ err, hash }, `❌ IPFS Content error`);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: err.message,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, hash }, `❌ IPFS Content request error`);
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
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ View user upload error");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

// Download user uploaded file (alias for view with download=true)
router.get("/user-uploads/:userAddress/:hash/download", async (req, res) => {
  // Redirect to view endpoint with download parameter
  req.query.download = "true";
  // Use res.redirect or handle the request manually since router.handle doesn't exist
  const newUrl = req.url.replace("/download", "/view");
  return res.redirect(newUrl);
});

// Decrypt user uploaded file (for subscription files)
// This endpoint verifies file ownership, then delegates to /cat/:cid/decrypt
router.get("/user-uploads/:userAddress/:hash/decrypt", async (req: Request, res: Response) => {
  try {
    const { userAddress, hash } = req.params;
    const headerUserAddressRaw = req.headers["x-user-address"];
    const headerUserAddress = Array.isArray(headerUserAddressRaw)
      ? headerUserAddressRaw[0]
      : headerUserAddressRaw;

    loggers.server.debug({ hash, userAddress }, `🔓 User upload decrypt request`);

    // Verify user address matches
    if (
      !headerUserAddress ||
      typeof headerUserAddress !== "string" ||
      headerUserAddress.toLowerCase() !== userAddress.toLowerCase()
    ) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized - User address mismatch",
      });
    }

    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(500).json({
        success: false,
        error: "Server error - Gun instance not available",
      });
    }

    // Get uploads to verify file belongs to user
    const uploads = await X402Merchant.getUserUploads(gun, userAddress);
    const uploadRecord = uploads.find((u) => u.hash === hash);

    if (!uploadRecord) {
      return res.status(404).json({
        success: false,
        error: "File not found for this user",
      });
    }

    // File ownership verified, redirect to /cat/:cid/decrypt endpoint
    // which already handles IPFS retrieval and decryption properly
    loggers.server.debug({ hash }, `✅ File ownership verified, redirecting to /cat/:cid/decrypt`);

    // Redirect to the cat decrypt endpoint with same query params
    const queryParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") {
        queryParams[key] = value;
      } else if (Array.isArray(value) && value.length > 0) {
        queryParams[key] = String(value[0]);
      }
    }
    const queryString = new URLSearchParams(queryParams).toString();
    const redirectUrl = `/api/v1/ipfs/cat/${hash}/decrypt${queryString ? `?${queryString}` : ""}`;

    return res.redirect(redirectUrl);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ User upload decrypt error");
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }
});

// Delete/unpin user file (for x402 subscription users)
router.delete("/user-uploads/:userAddress/:hash", async (req, res) => {
  try {
    const { userAddress, hash } = req.params;

    // Verify user address header matches
    const headerUserAddressRaw = req.headers["x-user-address"];
    const headerUserAddress = Array.isArray(headerUserAddressRaw)
      ? headerUserAddressRaw[0]
      : headerUserAddressRaw;

    if (
      !headerUserAddress ||
      typeof headerUserAddress !== "string" ||
      headerUserAddress.toLowerCase() !== userAddress.toLowerCase()
    ) {
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

    const gun = req.app.get("gunInstance");
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
    const uploadRecord = uploads.find((u) => u.hash === hash);

    if (!uploadRecord) {
      return res.status(404).json({
        success: false,
        error: "Upload not found",
      });
    }

    const fileSizeMB =
      uploadRecord.sizeMB || (uploadRecord.size ? uploadRecord.size / (1024 * 1024) : 0);

    // Step 1: Unpin from IPFS
    loggers.server.info({ hash }, `📌 Unpinning from IPFS`);

    const unpinResult = await new Promise((resolve) => {
      const requestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: `/api/v0/pin/rm?arg=${hash}`,
        method: "POST",
        headers: {
          "Content-Length": "0",
        } as Record<string, string>,
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
            resolve({
              success: true,
              warning: "Could not parse IPFS response",
              raw: data,
            });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        loggers.server.error({ err, hash }, `❌ IPFS unpin error`);
        resolve({ success: false, error: err.message });
      });

      ipfsReq.setTimeout(30000, () => {
        ipfsReq.destroy();
        resolve({ success: false, error: "Timeout" });
      });

      ipfsReq.end();
    });

    // Step 2: Delete upload record from relay user space
    loggers.server.info({ hash }, `🗑️ Deleting upload record`);

    try {
      await X402Merchant.deleteUploadRecord(userAddress, hash);
      loggers.server.info({ hash }, `✅ Upload record deleted`);
    } catch (deleteError: unknown) {
      loggers.server.warn({ err: deleteError, hash }, `⚠️ Failed to delete upload record`);
    }

    // Step 3: Update storage usage (subtract file size)
    loggers.server.info({ hash, fileSizeMB: fileSizeMB.toFixed(2) }, `📊 Updating storage usage`);

    try {
      // Use centralized method for consistency
      const updateResult = await X402Merchant.updateStorageUsage(gun, userAddress, -fileSizeMB);
      loggers.server.info(
        {
          storageUsedMB: updateResult.storageUsedMB.toFixed(2),
          storageRemainingMB: updateResult.storageRemainingMB.toFixed(2),
        },
        `✅ Storage updated via X402Merchant`
      );
    } catch (updateError: unknown) {
      // If subscription is not active, this is expected - just log warning
      const errorMessage = updateError instanceof Error ? updateError.message : String(updateError);
      if (errorMessage.includes("No active subscription")) {
        loggers.server.info({ userAddress }, `ℹ️ No active subscription, skipping storage update`);
      } else {
        loggers.server.warn({ err: updateError }, `⚠️ Failed to update storage`);
      }
    }

    // Get updated subscription status
    const updatedSubscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);

    res.json({
      success: true,
      message: "File unpinned and removed successfully",
      hash,
      unpin: unpinResult,
      subscription: updatedSubscription.active
        ? {
          storageUsedMB: updatedSubscription.storageUsedMB,
          storageRemainingMB: updatedSubscription.storageRemainingMB,
        }
        : null,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ Delete user file error");
    res.status(500).json({
      success: false,
      error: errorMessage,
    });
  }
});

export default router;
