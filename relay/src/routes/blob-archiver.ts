import express from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { fetchBlobData, sendBlobTransaction } from "../utils/eth-blobs";
import { torrentManager } from "../utils/torrent";
import { loggers } from "../utils/logger";
import { getGunNode, GUN_PATHS } from "../utils/gun-paths";

const router = express.Router();
const BLOB_DATA_DIR = path.join(process.cwd(), "data", "blobs");

// Ensure blob data directory exists
if (!fs.existsSync(BLOB_DATA_DIR)) {
  fs.mkdirSync(BLOB_DATA_DIR, { recursive: true });
}

/**
 * POST /archive
 * Archive an Ethereum Blob by TX Hash
 */
router.post("/archive", express.json(), async (req, res) => {
  try {
    const { txHash } = req.body;

    if (!txHash || typeof txHash !== "string" || !txHash.startsWith("0x")) {
      return res.status(400).json({
        success: false,
        error: "Valid Ethereum Transaction Hash (starting with 0x) is required",
      });
    }

    loggers.server.info(`📦 Archiving Blob for TX: ${txHash}`);

    // 1. Fetch Blob Data (Ethereum)
    const blobData = await fetchBlobData(txHash);

    // 2. Save to Disk
    const filename = `${txHash}.blob`;
    const filePath = path.join(BLOB_DATA_DIR, filename);

    fs.writeFileSync(filePath, blobData.data);
    loggers.server.info(`📦 Saved blob data to ${filePath}`);

    // 3. Create Torrent (WebTorrent)
    // We use the existing torrentManager to seed this file
    // createTorrent expects an array of file paths
    const torrentResult = await torrentManager.createTorrent([filePath]);

    // 4. Index in GunDB (Decentralized Index)
    const gun = req.app.get("gunInstance");
    if (gun) {
      const archiveRecord = {
        txHash: txHash,
        blobHash: blobData.kzgCommitment || "unknown", // Ideally we get this
        magnetLink: torrentResult.magnetURI,
        timestamp: Date.now(),
        size: blobData.data.length,
        archivedBy: torrentManager.getRelayKey(),
      };

      // Index by TX Hash
      // Path: shogun -> blob-archive -> <txHash>
      getGunNode(gun, "blob-archive").get(txHash).put(archiveRecord);

      // Also add to a timeline/list if needed, or rely on iterating the graph
      loggers.server.info(`📦 Indexed blob in GunDB: ${txHash}`);
    } else {
      loggers.server.warn("⚠️ GunDB instance not available, skipping indexing");
    }

    res.json({
      success: true,
      message: "Blob archived successfully",
      data: {
        txHash,
        magnetURI: torrentResult.magnetURI,
        infoHash: torrentResult.infoHash,
        size: blobData.data.length,
      },
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to archive blob");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * GET /list
 * List locally archived blobs (from GunDB or local file check)
 */
router.get("/list", async (req, res) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({ success: false, error: "GunDB not available" });
    }

    // Fetch list from GunDB
    // Note: Graph traversal can be async/slow. For MVP we'll do a simple map.once
    // In production, you'd probably maintain a local cache or use a dedicated indexer.

    const blobs: any[] = [];
    const limit = 50;

    // This is a simplified fetch. Real GunDB usage requires proper listening/collecting.
    // We will return what we find in 500ms

    await new Promise<void>((resolve) => {
      let count = 0;
      const timeout = setTimeout(resolve, 500);

      getGunNode(gun, "blob-archive")
        .map()
        .once((data: any, key: string) => {
          if (data && data.txHash) {
            blobs.push(data);
            count++;
            if (count >= limit) {
              clearTimeout(timeout);
              resolve();
            }
          }
        });
    });

    res.json({
      success: true,
      count: blobs.length,
      data: blobs,
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to list archived blobs");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Configure multer for memory storage
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 128 * 1024, // Blobs are ~128KB, prevent massive uploads for now
  },
});

/**
 * POST /create
 * Create a new blob from uploaded file
 */
router.post("/create", upload.single("file"), async (req: any, res: any) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }

    const buffer = req.file.buffer;

    // Check size fit for one blob (approx 128KB)
    // Viem might handle splitting, but for MVP let's keep it simple or allow viem to handle it.
    // We'll just pass the buffer.

    loggers.server.info(
      `📦 Creating Blob from file: ${req.file.originalname} (${buffer.length} bytes)`
    );

    // 1. Send Blob Transaction
    const txHash = await sendBlobTransaction(buffer);

    // 2. Save to Disk (same as archive)
    const filename = `${txHash}.blob`;
    const filePath = path.join(BLOB_DATA_DIR, filename);

    // We replicate the logic from /archive here to ensure it's available for seeding immediately
    fs.writeFileSync(filePath, buffer);
    loggers.server.info(`📦 Saved created blob data to ${filePath}`);

    // 3. Create Torrent
    const torrentResult = await torrentManager.createTorrent([filePath]);

    // 4. Index in GunDB
    const gun = req.app.get("gunInstance");
    if (gun) {
      const archiveRecord = {
        txHash: txHash,
        blobHash: "pending", // We might get this from sidecars if we waited/decoded
        magnetLink: torrentResult.magnetURI,
        timestamp: Date.now(),
        size: buffer.length,
        archivedBy: torrentManager.getRelayKey(),
        originalName: req.file.originalname,
        type: "created",
      };

      getGunNode(gun, "blob-archive").get(txHash).put(archiveRecord);
      loggers.server.info(`📦 Indexed created blob in GunDB: ${txHash}`);
    }

    res.json({
      success: true,
      message: "Blob created successfully",
      data: {
        txHash,
        magnetURI: torrentResult.magnetURI,
        size: buffer.length,
      },
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to create blob");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

export default router;
