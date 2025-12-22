import express from "express";
import { annasArchiveManager } from "../utils/annas-archive";
import { loggers } from "../utils/logger";

const router = express.Router();

/**
 * GET /status
 * Get the current status of Anna's Archive integration/service
 */
router.get("/status", async (req, res) => {
  try {
    const status = annasArchiveManager.getStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to get Anna's Archive status");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * POST /add
 * Add a new torrent (magnet link or URL)
 */
router.post("/add", express.json(), async (req, res) => {
  try {
    const { magnet } = req.body;
    
    if (!magnet || typeof magnet !== 'string') {
        return res.status(400).json({
            success: false,
            error: "Magnet link is required"
        });
    }

    annasArchiveManager.addTorrent(magnet);
    
    res.json({
      success: true,
      message: "Torrent added successfully"
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to add torrent");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

export default router;
