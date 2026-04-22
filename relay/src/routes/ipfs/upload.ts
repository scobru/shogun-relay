import { Router, Response } from "express";
import multer from "multer";
import FormData from "form-data";
import { loggers } from "../../utils/logger";
import { ipfsUpload } from "../../utils/ipfs-client";
import { adminOrApiKeyAuthMiddleware } from "../../middleware/admin-or-api-key-auth";

const router: Router = Router();

// Configurazione multer per upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

/**
 * IPFS File Upload endpoint with Admin/API Key authentication
 */
router.post(
  "/upload",
  adminOrApiKeyAuthMiddleware,
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: "No file provided" });
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

      const uploadData = {
        name: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        hash: fileResult.Hash,
        sizeBytes: fileResult.Size,
        uploadedAt: Date.now(),
      };

      res.json({
        success: true,
        file: uploadData,
      });
    } catch (error: unknown) {
      loggers.server.error({ err: error }, "❌ IPFS Upload error");
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: errorMessage });
    }
  }
);

export default router;
