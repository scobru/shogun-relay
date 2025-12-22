import { Router, Request, Response } from "express";
import multer from "multer";
import FormData from "form-data";
import { loggers } from "../../utils/logger";
import { ipfsUpload } from "../../utils/ipfs-client";

const router: Router = Router();

// Configure multer for deal uploads
const dealUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max for deal uploads
  },
});

/**
 * POST /api/v1/deals/upload
 *
 * Upload a file to IPFS for deal creation.
 * This endpoint allows uploads without subscription - payment is via deal.
 * Requires wallet address for tracking.
 */
router.post("/upload", dealUpload.single("file"), async (req: any, res: Response) => {
  try {
    const walletAddress = req.headers["x-wallet-address"] || req.body.walletAddress;

    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: "Wallet address required (x-wallet-address header or walletAddress body param)",
      });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file provided" });
    }

    loggers.server.info(
      {
        filename: req.file.originalname,
        sizeMB: (req.file.size / 1024 / 1024).toFixed(2),
        walletAddress,
      },
      `📤 Deal upload: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(2)} MB) from ${walletAddress}`
    );

    // Upload to IPFS using utility with automatic retry
    const form = new FormData();
    form.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const ipfsResult = await ipfsUpload("/api/v0/add?pin=true", form, {
      timeout: 60000,
      maxRetries: 3,
      retryDelay: 1000,
    });

    const cid = ipfsResult.Hash;
    const sizeMB = (req.file.size / (1024 * 1024)).toFixed(2);

    loggers.server.info(
      { cid, sizeMB, walletAddress },
      `✅ Deal upload success: ${cid} (${sizeMB} MB)`
    );

    res.json({
      success: true,
      cid,
      name: req.file.originalname,
      sizeMB: parseFloat(sizeMB),
      sizeBytes: req.file.size,
      walletAddress,
      note: "File uploaded. Create a deal to ensure long-term storage.",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ Deal upload error");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;
