import { Router, Response } from "express";
import multer from "multer";
import FormData from "form-data";
import { loggers } from "../../utils/logger";
import { authConfig, ipfsConfig } from "../../config";
import { ipfsUpload } from "../../utils/ipfs-client";
import type { CustomRequest } from "./types";
import { GUN_PATHS } from "../../utils/gun-paths";

const router: Router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
});

/**
 * IPFS Directory Upload endpoint - supports multiple files with directory structure
 */
router.post(
  "/upload-directory",
  async (req: CustomRequest, res: Response, next) => {
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
      } else {
        // X402 subscription checks moved to shogun-commerce
        loggers.server.info({ userAddress }, `Directory upload allowed - user authenticated`);
        req.isDealUpload = true;
        next();
      }
    } else {
      loggers.server.warn(
        { adminToken: !!adminToken, userAddress: !!userAddress },
        "Auth failed for directory upload"
      );
      res.status(401).json({
        success: false,
        error: "Unauthorized - Admin token or wallet required",
        hint: "Provide Authorization header with admin token, or X-User-Address header",
      });
    }
  },
  upload.any(),
  async (req, res) => {
    try {
      const customReq = req as CustomRequest;
      const files = (req.files || []) as Express.Multer.File[];

      if (!files || files.length === 0) {
        return res.status(400).json({ success: false, error: "No files provided" });
      }

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


      // Create FormData with all files
      const formData = new FormData();
      files.forEach((file) => {
        const filePath =
          file.fieldname && file.fieldname !== "files" ? file.fieldname : file.originalname;
        formData.append("file", file.buffer, {
          filename: filePath,
          contentType: file.mimetype || "application/octet-stream",
        });
      });

      loggers.server.debug(`Uploading ${files.length} files to IPFS with wrap-with-directory=true`);
      const directoryResult = await ipfsUpload("/api/v0/add?wrap-with-directory=true", formData, {
        timeout: 120000,
        maxRetries: 3,
        retryDelay: 1000,
      });

      loggers.server.debug({ directoryResult }, "📤 IPFS Directory Upload response");

      const directoryCid = directoryResult.Hash || directoryResult.cid;
      if (!directoryCid) {
        loggers.server.error({ directoryResult }, "❌ Directory CID not found in IPFS response");
        return res
          .status(500)
          .json({ success: false, error: "Directory CID not found in IPFS response" });
      }

      const uploadData = {
        directoryCid,
        fileCount: files.length,
        totalSize,
        totalSizeMB,
        files: files.map((f) => ({
          name: f.originalname,
          path: f.fieldname && f.fieldname !== "files" ? f.fieldname : f.originalname,
          size: f.size,
          mimetype: f.mimetype,
        })),
        uploadedAt: Date.now(),
      };

      // Save to Gun database for user uploads
      if (customReq.authType === "user" && customReq.userAddress && !customReq.isDealUpload) {
        const gun = req.app.get("gunInstance");
        const userAddress = customReq.userAddress;

        loggers.server.debug(
          { userAddress, directoryCid, fileCount: files.length },
          `💾 Saving directory upload to GunDB`
        );

        const saveUploadPromise = new Promise<void>((resolve, reject) => {
          const uploadsNode = gun.get(GUN_PATHS.UPLOADS).get(userAddress);
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

        const updateMBPromise = (async () => {
          try {
            const { updateMBUsage } = await import("../../utils/storage-utils.js");
            const newMB = await updateMBUsage(gun, customReq.userAddress!, totalSizeMB);
            loggers.server.debug({ newMB }, `✅ MB usage updated successfully`);
            return newMB;
          } catch (error: unknown) {
            loggers.server.error({ err: error }, `❌ Error updating MB usage`);
            throw error;
          }
        })();


        Promise.all([saveUploadPromise, updateMBPromise])
          .then(() => {
            loggers.server.info(
              { userAddress, fileCount: files.length, totalSizeMB },
              `📊 Directory upload saved`
            );
            res.json({
              success: true,
              cid: directoryCid,
              directoryCid,
              fileCount: files.length,
              totalSize,
              totalSizeMB,
              files: uploadData.files,
              authType: customReq.authType,
              mbUsage: {
                actualSizeMB: +totalSizeMB.toFixed(2),
                sizeMB: Math.ceil(totalSizeMB),
                verified: true,
              },
            });
          })
          .catch((error: unknown) => {
            loggers.server.error({ err: error }, `❌ Error during critical GunDB save`);
            res.json({
              success: true,
              cid: directoryCid,
              directoryCid,
              fileCount: files.length,
              totalSize,
              totalSizeMB,
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
        res.json({
          success: true,
          cid: directoryCid,
          directoryCid,
          fileCount: files.length,
          totalSize,
          totalSizeMB,
          files: uploadData.files,
          authType: customReq.authType,
        });
      }
    } catch (error: unknown) {
      loggers.server.error({ err: error }, "❌ IPFS Directory Upload error");
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: errorMessage });
    }
  }
);

export default router;
