import { Router, Response } from "express";
import http from "http";
import multer from "multer";
import FormData from "form-data";
import { loggers } from "../../utils/logger";
import { authConfig, ipfsConfig, x402Config } from "../../config";
import { X402Merchant } from "../../utils/x402-merchant";
import { ipfsUpload } from "../../utils/ipfs-client";
import type { CustomRequest, IpfsRequestOptions } from "./types";
import { IPFS_API_TOKEN, verifyWalletSignature } from "./utils";

const router: Router = Router();

// Configurazione multer per upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

/**
 * IPFS File Upload endpoint with dual authentication and x402 subscription check
 */
router.post(
  "/upload",
  async (req: CustomRequest, res: Response, next) => {
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const adminToken = bearerToken || customToken;
    
    // Check admin token or API key
    let isAdmin = false;
    let isApiKey = false;
    
    // Ensure adminToken is a string (could be string | string[] from headers)
    const adminTokenStr = Array.isArray(adminToken) ? adminToken[0] : adminToken;
    
    if (adminTokenStr && typeof adminTokenStr === "string") {
      // Check admin password
      if (adminTokenStr === authConfig.adminPassword) {
        isAdmin = true;
      } else if (adminTokenStr.startsWith("shogun-api-")) {
        // Check API key
        try {
          const { validateApiKeyToken } = await import("../../middleware/api-keys-auth");
          const keyData = await validateApiKeyToken(adminTokenStr);
          if (keyData) {
            isAdmin = true; // API keys have admin-like privileges
            isApiKey = true;
            loggers.server.debug({ keyId: keyData.keyId }, "IPFS upload: API key accepted");
          }
        } catch (apiKeyError) {
          // API key validation failed, continue with normal flow
        }
      }
    }

    const userAddressRaw = req.headers["x-user-address"];
    const userAddress = Array.isArray(userAddressRaw) ? userAddressRaw[0] : userAddressRaw;

    const signatureRaw = req.headers["x-wallet-signature"];
    const signature = Array.isArray(signatureRaw) ? signatureRaw[0] : signatureRaw;

    // Admin authentication (with or without userAddress)
    if (isAdmin) {
      req.authType = "admin";
      if (userAddress && typeof userAddress === "string") {
        req.userAddress = userAddress;
        loggers.server.info({ userAddress }, `Admin upload - accessing own files only`);
      } else {
        loggers.server.info(`Admin upload - no user address specified`);
      }
      next();
    } else if (userAddress && typeof userAddress === "string") {
      // User-based upload - verify wallet signature first
      if (!signature) {
        return res.status(401).json({
          success: false,
          error: "Wallet signature required",
          hint: "Sign 'I Love Shogun' with your wallet and provide X-Wallet-Signature header",
        });
      }

      const isValidSignature = await verifyWalletSignature(userAddress, signature);
      if (!isValidSignature) {
        loggers.server.warn({ userAddress }, "Invalid wallet signature for upload");
        return res.status(401).json({
          success: false,
          error: "Invalid wallet signature",
          hint: "Signature does not match the claimed wallet address",
        });
      }

      loggers.server.info({ userAddress }, "Wallet signature verified for upload");
      req.authType = "user";
      req.userAddress = userAddress;

      // Check for storage deal upload
      const dealHeader = Array.isArray(req.headers["x-deal-upload"])
        ? req.headers["x-deal-upload"][0]
        : req.headers["x-deal-upload"];
      const dealQuery = Array.isArray(req.query.deal) ? req.query.deal[0] : req.query.deal;
      const isDealUpload = dealHeader === "true" || dealQuery === "true";

      if (isDealUpload) {
        loggers.server.info({ userAddress }, `Upload allowed for storage deal`);
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
              { userAddress, reason: subscription.reason },
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
              userAddress,
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
        return res.status(400).json({ success: false, error: "No file provided" });
      }

      // For user uploads with x402 subscription, verify real IPFS storage
      if (customReq.authType === "user" && customReq.subscription) {
        const fileSizeMB = req.file.size / (1024 * 1024);
        const ipfsApiUrl =
          req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
        const ipfsApiToken = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken;
        const gun = req.app.get("gunInstance");

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
            { userAddress: customReq.userAddress, reason: canUploadResult.reason },
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

      // Save to Gun database for user uploads
      if (customReq.authType === "user" && customReq.userAddress && !customReq.isDealUpload) {
        const gun = req.app.get("gunInstance");
        const fileSizeMB = req.file.size / (1024 * 1024);
        uploadData.sizeMB = fileSizeMB;
        uploadData.userAddress = customReq.userAddress;
        const userAddress = customReq.userAddress;

        if (!userAddress) {
          return res.status(400).json({ success: false, error: "User address is required" });
        }

        loggers.server.debug(
          { userAddress, fileHash: fileResult.Hash, uploadData },
          `💾 Saving upload to GunDB`
        );

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

        const updateMBPromise = (async () => {
          try {
            const { updateMBUsage } = await import("../../utils/storage-utils.js");
            const newMB = await updateMBUsage(gun, customReq.userAddress!, fileSizeMB);
            loggers.server.debug({ newMB }, `✅ MB usage updated successfully`);
            return newMB;
          } catch (error: unknown) {
            loggers.server.error({ err: error }, `❌ Error updating MB usage`);
            throw error;
          }
        })();

        const saveSystemHashPromise = new Promise((resolve) => {
          const adminToken = authConfig.adminPassword;
          if (!adminToken) {
            loggers.server.warn(`⚠️ ADMIN_PASSWORD not set, skipping system hash save`);
            resolve({ error: "ADMIN_PASSWORD not configured" });
            return;
          }

          const systemHashData = { hash: fileResult.Hash, userAddress, timestamp: Date.now() };
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

          const httpReq = http.request(options, (httpRes) => {
            let data = "";
            httpRes.on("data", (chunk) => {
              data += chunk;
            });
            httpRes.on("end", () => {
              try {
                const result = JSON.parse(data);
                if (result.success) {
                  loggers.server.debug(`✅ System hash saved successfully via endpoint`);
                  resolve({ success: true });
                } else {
                  loggers.server.error({ error: result.error }, `❌ Error saving system hash`);
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

        let subscriptionUpdatePromise: Promise<any> = Promise.resolve();
        if (customReq.subscription) {
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
            loggers.server.warn({ err }, `⚠️ Failed to save upload record`);
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

        Promise.all([saveUploadPromise, updateMBPromise, subscriptionUpdatePromise])
          .then(([, , subscriptionResult]) => {
            loggers.server.info(
              { userAddress: customReq.userAddress, fileSizeMB },
              `📊 User upload saved`
            );

            saveSystemHashPromise
              .then((systemHashResult: any) => {
                if (systemHashResult?.error) {
                  loggers.server.warn(
                    { error: systemHashResult.error },
                    `⚠️ System hash save failed`
                  );
                } else {
                  loggers.server.debug(`✅ System hash saved successfully`);
                }
              })
              .catch((systemHashError: unknown) => {
                loggers.server.warn({ err: systemHashError }, `⚠️ System hash save failed`);
              });

            if (!req.file) {
              return res
                .status(500)
                .json({ success: false, error: "File information not available" });
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
        res.json({ success: true, file: uploadData, authType: customReq.authType });
      }
    } catch (error: unknown) {
      loggers.server.error({ err: error }, "❌ IPFS Upload error");
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: errorMessage });
    }
  }
);

export default router;
