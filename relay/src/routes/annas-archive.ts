import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { annasArchiveManager } from "../utils/annas-archive";
import { loggers } from "../utils/logger";
import { relayConfig, ipfsConfig } from "../config/env-config";

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'data', 'annas-archive', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Keep original filename
    cb(null, file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB limit

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
 * POST /create
 * Upload files and create a torrent from them
 * Responds immediately after upload, creates torrent in background
 */
router.post("/create", upload.array('files', 20), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No files uploaded"
      });
    }

    loggers.server.info(`📚 Creating torrent from ${files.length} files`);

    // Get file paths
    const filePaths = files.map(f => f.path);
    
    // Start torrent creation in background (don't await)
    annasArchiveManager.createTorrent(filePaths)
      .then(result => {
        loggers.server.info(`📚 Torrent created: ${result.name} - ${result.magnetURI.substring(0, 60)}...`);
      })
      .catch(err => {
        loggers.server.error({ err }, "📚 Background torrent creation failed");
      });
    
    // Respond immediately with files info
    res.json({
      success: true,
      message: "Files uploaded, torrent creation started. Check Active Torrents in a few seconds.",
      files: files.map(f => f.originalname),
      note: "Refresh the dashboard to see the new torrent"
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to create torrent");
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
    
    await annasArchiveManager.removeTorrent(infoHash, deleteFiles);
    
    res.json({
      success: true,
      message: `Torrent removed${deleteFiles ? ' (files deleted)' : ''}, IPFS pins removed`
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
 * POST /pin
 * Manually pin a file from a torrent to IPFS
 */
router.post("/pin", async (req, res) => {
  try {
    const { infoHash, filePath } = req.body;
    
    if (!infoHash || !filePath) {
      return res.status(400).json({
        success: false,
        error: "infoHash and filePath are required"
      });
    }
    
    const result = await annasArchiveManager.pinFile(infoHash, filePath);
    
    if (result.success) {
      res.json({
        success: true,
        cid: result.cid,
        message: `File pinned to IPFS: ${result.cid}`
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to pin file to IPFS");
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
    
    // Build public relay URL - strip /gun suffix if present
    let relayEndpoint = relayConfig.endpoint || process.env.PUBLIC_URL || 'http://localhost:3000';
    if (relayEndpoint.endsWith('/gun')) {
      relayEndpoint = relayEndpoint.slice(0, -4);
    }
    const relayUrl = relayEndpoint.startsWith('http') ? relayEndpoint : `https://${relayEndpoint}`;
    const ipfsGateway = ipfsConfig.gatewayUrl || `${relayUrl}/ipfs`;
    
    res.json({
      success: true,
      relay: {
        url: relayUrl,
        ipfsGateway: ipfsGateway
      },
      catalog: catalog,
      count: catalog.length,
      totalFiles: catalog.reduce((sum, entry) => sum + entry.files.length, 0),
      totalPinnedFiles: catalog.reduce((sum, entry) => sum + entry.files.filter(f => f.ipfsCid).length, 0)
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
