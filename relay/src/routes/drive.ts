import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import path from "path";
import { driveManager } from "../utils/drive";
import { loggers } from "../utils/logger";
import { adminAuthMiddleware } from "../middleware/admin-auth";
import { driveAuthMiddleware } from "../middleware/drive-auth";
import { DrivePublicLinksManager } from "../utils/drive-public-links";

const router = express.Router();

// Initialize public links manager when router is set up (will be called from routes/index.ts)
let publicLinksInitialized = false;
let publicLinksManager: DrivePublicLinksManager | null = null;

export function initDrivePublicLinks(gun: any, relayPub: string, relayUser: any): void {
  if (!publicLinksInitialized && gun && relayPub && relayUser) {
    // Initialize public links manager
    publicLinksManager = new DrivePublicLinksManager(gun, relayPub, relayUser);
    publicLinksInitialized = true;
    loggers.server.info({ relayPub }, "Drive Public Links Manager initialized");
  }
}

function getPublicLinksManager(): DrivePublicLinksManager | null {
  return publicLinksManager;
}

export function isPublicLinksInitialized(): boolean {
  return publicLinksInitialized;
}

// Middleware to initialize public links manager on first request
export async function ensurePublicLinksInitialized(req: Request, res: Response, next: NextFunction): Promise<void> {
  const gun = req.app.get("gunInstance");
  const relayPub = req.app.get("relayUserPub");
  
  // Only log at debug level to avoid spam
  if (!publicLinksInitialized) {
    loggers.server.debug({ 
      hasGun: !!gun, 
      hasRelayPub: !!relayPub, 
      publicLinksInitialized 
    }, "ensurePublicLinksInitialized check");
  }
  
  if (gun && relayPub && !publicLinksInitialized) {
    try {
      const { getRelayUser, isRelayUserInitialized } = await import("../utils/relay-user");
      
      // Check if relay user is initialized
      if (!isRelayUserInitialized()) {
        loggers.server.debug("Relay user not yet initialized, skipping public links manager init");
        next();
        return;
      }
      
      const relayUser = getRelayUser();
      
      if (relayUser) {
        initDrivePublicLinks(gun, relayPub, relayUser);
        loggers.server.info({ relayPub }, "🔗 DrivePublicLinksManager initialized on first request");
      } else {
        loggers.server.warn("relayUser returned undefined even though isRelayUserInitialized was true");
      }
    } catch (error) {
      loggers.server.error({ err: error }, "Failed to initialize public links manager");
    }
  }
  
  next();
}

// Configure multer for file uploads (memory storage for flexibility)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB limit
});

/**
 * GET /list/:path?
 * List directory contents
 */
router.get("/list/:path(*)?", driveAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const relativePath = req.params.path || "";
    const items = driveManager.listDirectory(relativePath);

    res.json({
      success: true,
      items,
      path: relativePath,
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to list directory");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * POST /upload/:path?
 * Upload file(s) - supports both single and multiple files
 */
router.post(
  "/upload/:path(*)?",
  driveAuthMiddleware,
  upload.fields([{ name: "file", maxCount: 1 }, { name: "files", maxCount: 100 }]),
  async (req: Request, res: Response) => {
    try {
      const relativePath = req.params.path || "";
      const files = req.files as { [fieldname: string]: Express.Multer.File[] };

      if (!files || (Object.keys(files).length === 0)) {
        return res.status(400).json({
          success: false,
          error: "No files uploaded",
        });
      }

      const uploadedFiles: string[] = [];

      // Handle single file upload (field name: "file")
      if (files.file && files.file.length > 0) {
        const file = files.file[0];
        driveManager.uploadFile(relativePath, file.buffer, file.originalname);
        uploadedFiles.push(file.originalname);
      }

      // Handle multiple files upload (field name: "files")
      if (files.files && files.files.length > 0) {
        for (const file of files.files) {
          driveManager.uploadFile(relativePath, file.buffer, file.originalname);
          uploadedFiles.push(file.originalname);
        }
      }

      res.json({
        success: true,
        message: `Successfully uploaded ${uploadedFiles.length} file(s)`,
        files: uploadedFiles,
      });
    } catch (error: any) {
      loggers.server.error({ err: error }, "Failed to upload file");
      res.status(500).json({
        success: false,
        error: error.message || "Internal Server Error",
      });
    }
  }
);

/**
 * GET /download/:path(*)
 * Download a file
 */
router.get("/download/:path(*)", driveAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const relativePath = req.params.path;

    if (!relativePath) {
      return res.status(400).json({
        success: false,
        error: "Path is required",
      });
    }

    const { buffer, filename, size } = driveManager.downloadFile(relativePath);

    // Detect content type based on file extension
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "text/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
      ".zip": "application/zip",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".xml": "application/xml",
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";

    // Set headers
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", size.toString());
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader("Cache-Control", "private, max-age=3600");

    res.send(buffer);
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to download file");
    
    if (error.message.includes("does not exist")) {
      res.status(404).json({
        success: false,
        error: error.message || "File not found",
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message || "Internal Server Error",
      });
    }
  }
});

/**
 * DELETE /delete/:path(*)
 * Delete a file or directory
 */
router.delete("/delete/:path(*)", driveAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const relativePath = req.params.path;

    if (!relativePath) {
      return res.status(400).json({
        success: false,
        error: "Path is required",
      });
    }

    driveManager.deleteItem(relativePath);

    res.json({
      success: true,
      message: "Item deleted successfully",
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to delete item");
    
    if (error.message.includes("does not exist")) {
      res.status(404).json({
        success: false,
        error: error.message || "Item not found",
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message || "Internal Server Error",
      });
    }
  }
});

/**
 * POST /mkdir/:path(*)?
 * Create a directory
 */
router.post("/mkdir/:path(*)?", driveAuthMiddleware, express.json(), async (req: Request, res: Response) => {
  try {
    const parentPath = req.params.path || "";
    const { name } = req.body;

    if (!name || typeof name !== "string") {
      return res.status(400).json({
        success: false,
        error: "Directory name is required",
      });
    }

    // Validate name (no path separators)
    if (name.includes("/") || name.includes("\\") || name.includes("..")) {
      return res.status(400).json({
        success: false,
        error: "Invalid directory name",
      });
    }

    const relativePath = parentPath ? `${parentPath}/${name}` : name;
    driveManager.createDirectory(relativePath);

    res.json({
      success: true,
      message: "Directory created successfully",
      path: relativePath,
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to create directory");
    
    if (error.message.includes("already exists")) {
      res.status(409).json({
        success: false,
        error: error.message || "Directory already exists",
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message || "Internal Server Error",
      });
    }
  }
});

/**
 * POST /rename
 * Rename a file or directory
 */
router.post("/rename", driveAuthMiddleware, express.json(), async (req: Request, res: Response) => {
  try {
    const { oldPath, newName } = req.body;

    if (!oldPath || typeof oldPath !== "string") {
      return res.status(400).json({
        success: false,
        error: "oldPath is required",
      });
    }

    if (!newName || typeof newName !== "string") {
      return res.status(400).json({
        success: false,
        error: "newName is required",
      });
    }

    // Validate new name (no path separators)
    if (newName.includes("/") || newName.includes("\\") || newName.includes("..")) {
      return res.status(400).json({
        success: false,
        error: "Invalid name - cannot contain path separators",
      });
    }

    driveManager.renameItem(oldPath, newName);

    res.json({
      success: true,
      message: "Item renamed successfully",
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to rename item");
    
    if (error.message.includes("does not exist")) {
      res.status(404).json({
        success: false,
        error: error.message || "Item not found",
      });
    } else if (error.message.includes("already exists")) {
      res.status(409).json({
        success: false,
        error: error.message || "Target name already exists",
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message || "Internal Server Error",
      });
    }
  }
});

/**
 * POST /move
 * Move a file or directory
 */
router.post("/move", driveAuthMiddleware, express.json(), async (req: Request, res: Response) => {
  try {
    const { sourcePath, destPath } = req.body;

    if (!sourcePath || typeof sourcePath !== "string") {
      return res.status(400).json({
        success: false,
        error: "sourcePath is required",
      });
    }

    if (!destPath || typeof destPath !== "string") {
      return res.status(400).json({
        success: false,
        error: "destPath is required",
      });
    }

    driveManager.moveItem(sourcePath, destPath);

    res.json({
      success: true,
      message: "Item moved successfully",
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to move item");
    
    if (error.message.includes("does not exist")) {
      res.status(404).json({
        success: false,
        error: error.message || "Source item not found",
      });
    } else if (error.message.includes("already exists")) {
      res.status(409).json({
        success: false,
        error: error.message || "Destination already exists",
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message || "Internal Server Error",
      });
    }
  }
});

/**
 * GET /stats
 * Get storage statistics
 */
router.get("/stats", driveAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const stats = driveManager.getStorageStats();

    res.json({
      success: true,
      stats: {
        totalBytes: stats.totalBytes,
        totalSizeMB: stats.totalMB.toFixed(2),
        totalSizeGB: stats.totalGB.toFixed(4),
        fileCount: stats.fileCount,
        dirCount: stats.dirCount,
      },
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to get storage stats");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * Public Links Management Routes
 */

/**
 * GET /links
 * List all public links
 */
router.get("/links", driveAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const manager = getPublicLinksManager();
    if (!manager) {
      return res.status(503).json({
        success: false,
        error: "Public links manager not initialized",
      });
    }

    const links = await manager.listPublicLinks();
    res.json({
      success: true,
      links,
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to list public links");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * POST /links
 * Create a new public link for a file
 */
router.post("/links", driveAuthMiddleware, express.json(), async (req: Request, res: Response) => {
  try {
    const { filePath, expiresInDays } = req.body;

    if (!filePath || typeof filePath !== "string") {
      return res.status(400).json({
        success: false,
        error: "File path is required",
      });
    }

    const manager = getPublicLinksManager();
    if (!manager) {
      return res.status(503).json({
        success: false,
        error: "Public links manager not initialized",
      });
    }

    const expiresDays =
      expiresInDays && typeof expiresInDays === "number" && expiresInDays > 0
        ? expiresInDays
        : undefined;

    const link = await manager.createPublicLink(filePath, expiresDays);

    // Generate the public URL
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const publicUrl = `${baseUrl}/api/v1/drive/public/${link.linkId}`;

    res.status(201).json({
      success: true,
      linkId: link.linkId,
      filePath: link.filePath,
      publicUrl,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to create public link");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * DELETE /links/:linkId
 * Revoke a public link
 */
router.delete("/links/:linkId", driveAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { linkId } = req.params;

    if (!linkId) {
      return res.status(400).json({
        success: false,
        error: "Link ID is required",
      });
    }

    const manager = getPublicLinksManager();
    if (!manager) {
      return res.status(503).json({
        success: false,
        error: "Public links manager not initialized",
      });
    }

    const revoked = await manager.revokePublicLink(linkId);
    if (revoked) {
      res.json({
        success: true,
        message: "Public link revoked successfully",
      });
    } else {
      res.status(404).json({
        success: false,
        error: "Public link not found",
      });
    }
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to revoke public link");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * Handle public link access (exported for direct use without router)
 */
export async function handlePublicLinkAccess(req: Request, res: Response): Promise<void> {
  try {
    // Extract linkId from URL path if not in params
    let linkId: string | undefined = req.params?.linkId;
    if (!linkId && req.url) {
      const match = req.url.match(/\/public\/([^/?]+)/);
      linkId = match?.[1];
    }

    if (!linkId) {
      res.status(400).json({
        success: false,
        error: "Link ID is required",
      });
      return;
    }

    const manager = getPublicLinksManager();
    if (!manager) {
      res.status(503).json({
        success: false,
        error: "Public links manager not initialized",
      });
      return;
    }

    const link = await manager.getPublicLink(linkId);
    if (!link) {
      res.status(404).json({
        success: false,
        error: "Link not found or expired",
      });
      return;
    }

    // Download the file using driveManager
    const { buffer, filename, size } = driveManager.downloadFile(link.filePath);

    // Detect content type based on file extension
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".html": "text/html",
      ".css": "text/css",
      ".js": "text/javascript",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
      ".zip": "application/zip",
      ".txt": "text/plain",
      ".md": "text/markdown",
      ".xml": "application/xml",
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";

    // Set headers
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", size.toString());
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(filename)}"`);
    res.setHeader("Cache-Control", "public, max-age=3600");

    res.send(buffer);
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to access file via public link");

    if (error.message && error.message.includes("does not exist")) {
      res.status(404).json({
        success: false,
        error: "File not found",
      });
    } else {
      res.status(500).json({
        success: false,
        error: error.message || "Internal Server Error",
      });
    }
  }
}

export default router;
