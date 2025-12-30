import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { torrentManager } from "../utils/torrent";
import { loggers } from "../utils/logger";
import { relayConfig, ipfsConfig } from "../config/env-config";

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'data', 'torrents', 'uploads');
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
 * Get the current status of the Torrent service
 */
router.get("/status", async (req, res) => {
  try {
    const status = torrentManager.getStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to get Torrent status");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * GET /list
 * Alias for /status - Get the current status of the Torrent service
 * Used by dashboard for backwards compatibility
 */
router.get("/list", async (req, res) => {
  try {
    const status = torrentManager.getStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to get Torrent list");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * GET /stats
 * Get statistics about torrent storage and usage
 */
router.get("/stats", async (req, res) => {
  try {
    const status = torrentManager.getStatus();
    const storageStats = torrentManager.getStorageStats();
    
    res.json({
      success: true,
      stats: {
        ...storageStats,
        enabled: status.enabled,
        activeTorrents: status.activeTorrents,
        downloadSpeed: status.downloadSpeed,
        uploadSpeed: status.uploadSpeed,
        ratio: status.ratio,
      },
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to get Torrent stats");
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

    torrentManager.addTorrent(magnet);
    
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
    torrentManager.createTorrent(filePaths)
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
 * POST /control
 * Unified control endpoint for pause/resume/remove actions
 * Used by dashboard frontend
 */
router.post("/control", express.json(), async (req, res) => {
  try {
    const { infoHash, action, deleteFiles } = req.body;
    
    if (!infoHash || !action) {
      return res.status(400).json({
        success: false,
        error: "infoHash and action are required"
      });
    }
    
    const validActions = ['pause', 'resume', 'remove'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        error: `Invalid action. Must be one of: ${validActions.join(', ')}`
      });
    }
    
    switch (action) {
      case 'pause':
        torrentManager.pauseTorrent(infoHash);
        break;
      case 'resume':
        torrentManager.resumeTorrent(infoHash);
        break;
      case 'remove':
        await torrentManager.removeTorrent(infoHash, deleteFiles === true);
        break;
    }
    
    res.json({
      success: true,
      message: `Torrent ${action} successful`
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, `Failed to ${req.body?.action || 'control'} torrent`);
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
    
    torrentManager.pauseTorrent(infoHash);
    
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
    
    torrentManager.resumeTorrent(infoHash);
    
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
    
    await torrentManager.removeTorrent(infoHash, deleteFiles);
    
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
    
    const result = await torrentManager.pinFile(infoHash, filePath);
    
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
    
    const files = torrentManager.getFiles(infoHash);
    
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
    const catalog = torrentManager.getCatalog();
    
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
    const networkCatalog = await torrentManager.getNetworkCatalog();
    
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

/**
 * POST /refetch
 * Re-fetch and add dynamic torrents from Anna's Archive API
 */
router.post("/refetch", express.json(), async (req, res) => {
  try {
    const maxTb = req.body.maxTb;
    
    const result = await torrentManager.refetchDynamicTorrents(maxTb);
    
    res.json({
      success: true,
      message: `Fetched ${result.added} new torrents from Anna's Archive`,
      added: result.added,
      skipped: result.skipped,
      total: result.total
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to refetch torrents");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * POST /refresh-catalog
 * Manually refresh and publish the catalog based on active torrents
 */
router.post("/refresh-catalog", async (req, res) => {
  try {
    const result = torrentManager.refreshCatalog();
    
    res.json({
      success: true,
      message: `Catalog refreshed: ${result.catalogSize} active torrents${result.removed > 0 ? `, removed ${result.removed} inactive` : ''}`,
      catalogSize: result.catalogSize,
      published: result.published,
      removed: result.removed
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to refresh catalog");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

// ============================================================================
// GLOBAL REGISTRY ENDPOINTS
// ============================================================================

/**
 * GET /registry/search
 * Search the global torrent registry by keyword
 */
router.get("/registry/search", async (req, res) => {
  try {
    const query = req.query.q as string;
    const limit = parseInt(req.query.limit as string) || 50;
    
    if (!query || query.length < 3) {
      return res.status(400).json({
        success: false,
        error: "Query must be at least 3 characters"
      });
    }
    
    const results = await torrentManager.searchGlobalRegistry(query, limit);
    
    res.json({
      success: true,
      query,
      count: results.length,
      results
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to search registry");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * GET /registry/browse
 * Browse all torrents in the global registry
 */
router.get("/registry/browse", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    
    const results = await torrentManager.browseGlobalRegistry(limit);
    
    res.json({
      success: true,
      count: results.length,
      results
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to browse registry");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * GET /registry/check/:infoHash
 * Check if a torrent exists in the global registry
 */
router.get("/registry/check/:infoHash", async (req, res) => {
  try {
    const { infoHash } = req.params;
    
    const result = await torrentManager.checkTorrentInRegistry(infoHash);
    
    res.json({
      success: true,
      exists: !!result,
      data: result
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to check registry");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

// ============================================================================
// ARCHIVE SEARCH ENDPOINTS (Internet Archive + PirateBay)
// ============================================================================

import { 
  searchInternetArchive, 
  searchPirateBay, 
  searchArchives,
  getTorrentForItem 
} from "../utils/archive-search";

/**
 * GET /search
 * Unified search across Internet Archive and PirateBay
 */
router.get("/search", async (req, res) => {
  try {
    const query = req.query.q as string;
    const sources = req.query.sources as string; // comma-separated: 'internet-archive,piratebay'
    const limit = parseInt(req.query.limit as string) || 25;
    const mediaType = req.query.mediaType as string; // For Internet Archive
    const category = req.query.category ? parseInt(req.query.category as string) : undefined; // For PirateBay

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        error: "Query (q) must be at least 2 characters"
      });
    }

    const validSources = ['internet-archive', 'piratebay'] as const;
    const sourceList: ('internet-archive' | 'piratebay')[] = sources 
      ? sources.split(',').map(s => s.trim()).filter((s): s is 'internet-archive' | 'piratebay' => 
          validSources.includes(s as any))
      : ['internet-archive', 'piratebay'];

    const results = await searchArchives(query, {
      sources: sourceList,
      rows: limit,
      mediaType,
      category
    });

    res.json({
      success: true,
      query,
      sources: sourceList,
      count: results.length,
      results
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to search archives");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * GET /search/internet-archive
 * Search Internet Archive for items with BitTorrent format
 */
router.get("/search/internet-archive", async (req, res) => {
  try {
    const query = req.query.q as string;
    const mediaType = req.query.mediaType as string; // audio, video, texts, software
    const rows = parseInt(req.query.rows as string) || 50;
    const page = parseInt(req.query.page as string) || 1;

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        error: "Query (q) must be at least 2 characters"
      });
    }

    const results = await searchInternetArchive(query, { mediaType, rows, page });

    res.json({
      success: true,
      source: 'internet-archive',
      query,
      mediaType: mediaType || 'all',
      page,
      count: results.length,
      results
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to search Internet Archive");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * GET /search/piratebay
 * Search PirateBay via apibay.org
 */
router.get("/search/piratebay", async (req, res) => {
  try {
    const query = req.query.q as string;
    const category = req.query.category ? parseInt(req.query.category as string) : undefined;
    const rows = parseInt(req.query.rows as string) || 50;

    if (!query || query.length < 2) {
      return res.status(400).json({
        success: false,
        error: "Query (q) must be at least 2 characters"
      });
    }

    const results = await searchPirateBay(query, { category, rows });

    res.json({
      success: true,
      source: 'piratebay',
      query,
      category: category || 'all',
      count: results.length,
      results
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to search PirateBay");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * POST /add-from-search
 * Add a torrent from search results
 */
router.post("/add-from-search", express.json(), async (req, res) => {
  try {
    const { source, identifier, magnetUri } = req.body;

    if (!source || !identifier) {
      return res.status(400).json({
        success: false,
        error: "source and identifier are required"
      });
    }

    let torrentData: { magnetUri?: string; torrentUrl?: string } | null = null;

    // If magnetUri was provided directly (from search results), use it
    if (magnetUri) {
      torrentData = { magnetUri };
    } else {
      // Otherwise fetch it
      torrentData = await getTorrentForItem(source, identifier);
    }

    if (!torrentData) {
      return res.status(404).json({
        success: false,
        error: `Could not find torrent for ${source}:${identifier}`
      });
    }

    // Add the torrent
    const torrentUri = torrentData.magnetUri || torrentData.torrentUrl;
    if (!torrentUri) {
      return res.status(400).json({
        success: false,
        error: "No magnet URI or torrent URL available"
      });
    }

    torrentManager.addTorrent(torrentUri);

    res.json({
      success: true,
      message: `Torrent from ${source} added successfully`,
      source,
      identifier,
      magnetUri: torrentData.magnetUri,
      torrentUrl: torrentData.torrentUrl
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to add torrent from search");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

export default router;

