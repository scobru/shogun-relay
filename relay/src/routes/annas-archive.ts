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

/**
 * POST /pause/:infoHash
 * Pause a torrent
 */
router.post("/pause/:infoHash", async (req, res) => {
  try {
    const { infoHash } = req.params;
    
    annasArchiveManager.pauseTorrent(infoHash);
    
    res.json({
      success: true,
      message: "Torrent paused successfully"
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to pause torrent");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * POST /resume/:infoHash
 * Resume a paused torrent
 */
router.post("/resume/:infoHash", async (req, res) => {
  try {
    const { infoHash } = req.params;
    
    annasArchiveManager.resumeTorrent(infoHash);
    
    res.json({
      success: true,
      message: "Torrent resumed successfully"
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to resume torrent");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * DELETE /remove/:infoHash
 * Remove a torrent (query param ?deleteFiles=true to also delete files)
 */
router.delete("/remove/:infoHash", async (req, res) => {
  try {
    const { infoHash } = req.params;
    const deleteFiles = req.query.deleteFiles === 'true';
    
    annasArchiveManager.removeTorrent(infoHash, deleteFiles);
    
    res.json({
      success: true,
      message: `Torrent removed successfully${deleteFiles ? ' (files deleted)' : ''}`
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to remove torrent");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * GET /files/:infoHash?
 * Get files for a specific torrent or all torrents
 */
router.get("/files/:infoHash?", async (req, res) => {
  try {
    const { infoHash } = req.params;
    
    const files = annasArchiveManager.getFiles(infoHash);
    
    res.json({
      success: true,
      data: files
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to get files");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * GET /catalog
 * Get catalog of all torrents with IPFS CIDs
 * This allows other relays to discover and replicate content
 */
router.get("/catalog", async (req, res) => {
  try {
    const catalog = annasArchiveManager.getCatalog();
    
    res.json({
      success: true,
      relay: {
        url: process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`,
        ipfsGateway: process.env.IPFS_GATEWAY || 'http://localhost:8080/ipfs'
      },
      catalog: catalog,
      count: catalog.length,
      totalFiles: catalog.reduce((sum, entry) => sum + entry.files.length, 0)
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to get catalog");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * GET /network
 * Get torrents from entire GunDB network (all relays)
 */
router.get("/network", async (req, res) => {
  try {
    const networkCatalog = await annasArchiveManager.getNetworkCatalog();
    
    res.json({
      success: true,
      network: networkCatalog,
      relays: networkCatalog.length,
      totalTorrents: networkCatalog.reduce((sum, relay) => 
        sum + Object.keys(relay.torrents || {}).length, 0
      )
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to get network catalog");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

export default router;
