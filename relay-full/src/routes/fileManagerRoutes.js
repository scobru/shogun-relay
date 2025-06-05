import express from "express";
import fs from "fs";
import crypto from "crypto";
import SEA from "gun/sea.js";

// Track recent requests to prevent duplicates
const recentRequests = new Map();
const requestTimeout = 5000; // 5 seconds

// Track shared links (in production questo dovrebbe essere in un database)
const sharedLinks = new Map();

/**
 * Middleware to prevent duplicate requests
 */
const preventDuplicateRequests = (req, res, next) => {
  const requestKey = `${req.method}_${req.path}_${req.ip}_${req.params.id || 'no-id'}`;
  const now = Date.now();
  
  // Clean up old requests
  for (const [key, timestamp] of recentRequests.entries()) {
    if (now - timestamp > requestTimeout) {
      recentRequests.delete(key);
    }
  }
  
  // Check if this is a duplicate request
  if (recentRequests.has(requestKey)) {
    const lastRequestTime = recentRequests.get(requestKey);
    const timeDiff = now - lastRequestTime;
    
    if (timeDiff < requestTimeout) {
      console.warn(`[fileManagerRoutes] Duplicate request blocked: ${requestKey} (${timeDiff}ms ago)`);
      return res.status(429).json({
        success: false,
        error: "Duplicate request detected. Please wait before trying again.",
        code: "DUPLICATE_REQUEST"
      });
    }
  }
  
  // Track this request
  recentRequests.set(requestKey, now);
  next();
};

/**
 * Clean up expired shared links
 */
const cleanupExpiredLinks = () => {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [token, linkData] of sharedLinks.entries()) {
    if (linkData.expiresAt && linkData.expiresAt < now) {
      sharedLinks.delete(token);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`[fileManagerRoutes] Cleaned up ${cleanedCount} expired shared links`);
  }
};

// Cleanup expired links ogni 5 minuti
setInterval(cleanupExpiredLinks, 5 * 60 * 1000);

/**
 * Generate secure token for shared links
 */
const generateSecureToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Hash password using SEA with consistent salt
 */
const hashPassword = async (password) => {
  try {
    // Use a consistent salt for password hashing to ensure same password = same hash
    const salt = 'shogun_shared_links_salt_2025'; // Fixed salt for consistency
    const hash = await SEA.work(password, salt, null, {name: 'PBKDF2', hash: 'SHA-256'});
    return hash;
  } catch (error) {
    console.error('[fileManagerRoutes] Error hashing password with SEA:', error);
    throw new Error('Password hashing failed');
  }
};

/**
 * Verify password against SEA hash
 */
const verifyPassword = async (password, hash) => {
  try {
    console.log(`[verifyPassword] Starting verification:`);
    console.log(`  - Input password: "${password}"`);
    console.log(`  - Stored hash: "${hash}"`);
    
    // Use the same salt for verification
    const salt = 'shogun_shared_links_salt_2025'; // Same salt as in hashPassword
    const testHash = await SEA.work(password, salt, null, {name: 'PBKDF2', hash: 'SHA-256'});
    
    console.log(`  - Generated test hash: "${testHash}"`);
    console.log(`  - Hash comparison: ${testHash === hash}`);
    
    return testHash === hash;
  } catch (error) {
    console.error('[fileManagerRoutes] Error verifying password with SEA:', error);
    return false;
  }
};

/**
 * Set up file manager routes
 * @param {Object} fileManager - The file manager instance
 * @param {Function} authenticateRequest - Authentication middleware
 * @returns {Object} Express router
 */
const setupFileManagerRoutes = (fileManager, authenticateRequest) => {
  const router = express.Router();

  // Get all files
  router.get("/all", authenticateRequest, async (req, res) => {
    const requestId = `files_all_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`[fileManagerRoutes] Getting all files (Request ID: ${requestId})`);
      const files = await fileManager.getAllFiles();
      
      console.log(`[fileManagerRoutes] Retrieved ${files.length} files (Request ID: ${requestId})`);
      
      // Always return a success response, even if no files found
      res.json({
        success: true,
        files: files,
        count: files.length,
        requestId: requestId,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`[fileManagerRoutes] Error getting all files: ${error.message} (Request ID: ${requestId})`);
      res.status(500).json({
        success: false,
        error: error.message,
        requestId: requestId
      });
    }
  });

  // Search files - MOVED BEFORE /:id route to ensure it matches correctly
  router.get("/search", authenticateRequest, async (req, res) => {
    const requestId = `files_search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const { name, mimetype, minSize, maxSize } = req.query;
      console.log(`[fileManagerRoutes] Searching files with filters: ${JSON.stringify(req.query)} (Request ID: ${requestId})`);
      
      // Get all files first
      const allFiles = await fileManager.getAllFiles();
      
      // Apply filters
      const results = allFiles.filter(file => {
        let match = true;
        
        if (name && !file.originalName.toLowerCase().includes(name.toLowerCase())) {
          match = false;
        }
        
        if (mimetype && !file.mimetype.toLowerCase().includes(mimetype.toLowerCase())) {
          match = false;
        }
        
        if (minSize && file.size < parseInt(minSize)) {
          match = false;
        }
        
        if (maxSize && file.size > parseInt(maxSize)) {
          match = false;
        }
        
        return match;
      });
      
      console.log(`[fileManagerRoutes] Search returned ${results.length} results out of ${allFiles.length} total files (Request ID: ${requestId})`);
      
      res.json({
        success: true,
        results,
        count: results.length,
        requestId: requestId,
        filters: req.query
      });
    } catch (error) {
      console.error(`[fileManagerRoutes] Error searching files: ${error.message} (Request ID: ${requestId})`);
      res.status(500).json({
        success: false,
        error: error.message,
        requestId: requestId
      });
    }
  });

  // ================== SHARED LINKS ENDPOINTS ==================

  // CREATE SHARED LINK WITH PASSWORD
  router.post("/create-share-link", authenticateRequest, async (req, res) => {
    const requestId = `share_create_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const {
        fileId,
        password,
        expiresIn = 3600, // Default 1 hour in seconds
        maxDownloads = 10, // Default max downloads
        description
      } = req.body;

      if (!fileId) {
        return res.status(400).json({
          success: false,
          error: "File ID is required",
          requestId: requestId
        });
      }

      console.log(`[fileManagerRoutes] Creating shared link for file: ${fileId} (Request ID: ${requestId})`);

      // Check if file exists
      const file = await fileManager.getFileById(fileId);
      if (!file) {
        return res.status(404).json({
          success: false,
          error: `File not found: ${fileId}`,
          requestId: requestId
        });
      }

      // Generate secure token
      const token = generateSecureToken();
      const createdAt = Date.now();
      const expiresAt = expiresIn > 0 ? createdAt + (expiresIn * 1000) : null;

      // Hash password if provided
      let passwordHash = null;
      if (password && password.trim()) {
        passwordHash = await hashPassword(password.trim());
      }

      // Create shared link data
      const linkData = {
        token,
        fileId,
        fileName: file.originalName || file.name,
        fileSize: file.size,
        fileMimeType: file.mimetype || file.mimeType,
        passwordHash,
        hasPassword: !!passwordHash,
        createdAt,
        expiresAt,
        maxDownloads,
        downloadCount: 0,
        description: description || null,
        createdBy: req.user?.id || 'unknown', // Se disponibile dal middleware auth
        requestId
      };

      // Store the link
      sharedLinks.set(token, linkData);

      // Generate the public URL
      const baseUrl = req.protocol + '://' + req.get('host');
      const shareUrl = `${baseUrl}/api/files/share/${token}`;

      console.log(`[fileManagerRoutes] Shared link created successfully: ${token} (Request ID: ${requestId})`);

      res.json({
        success: true,
        message: "Shared link created successfully",
        shareData: {
          token,
          shareUrl,
          fileName: linkData.fileName,
          hasPassword: linkData.hasPassword,
          expiresAt: linkData.expiresAt,
          maxDownloads: linkData.maxDownloads,
          description: linkData.description,
          createdAt: linkData.createdAt
        },
        requestId: requestId
      });

    } catch (error) {
      console.error(`[fileManagerRoutes] Error creating shared link: ${error.message} (Request ID: ${requestId})`);
      res.status(500).json({
        success: false,
        error: error.message,
        requestId: requestId
      });
    }
  });

  // ACCESS SHARED FILE (PUBLIC ENDPOINT - NO AUTH REQUIRED)
  router.get("/share/:token", async (req, res) => {
    const requestId = `share_access_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const { token } = req.params;
      const { password } = req.query;

      console.log(`[fileManagerRoutes] Accessing shared file: ${token} (Request ID: ${requestId})`);

      // Clean up expired links first
      cleanupExpiredLinks();

      // Check if link exists
      const linkData = sharedLinks.get(token);
      if (!linkData) {
        return res.status(404).json({
          success: false,
          error: "Shared link not found or expired",
          requestId: requestId
        });
      }

      // Check if link has expired
      if (linkData.expiresAt && linkData.expiresAt < Date.now()) {
        sharedLinks.delete(token);
        return res.status(410).json({
          success: false,
          error: "Shared link has expired",
          requestId: requestId
        });
      }

      // Check download limit
      if (linkData.downloadCount >= linkData.maxDownloads) {
        return res.status(429).json({
          success: false,
          error: "Download limit exceeded",
          requestId: requestId
        });
      }

      // Check password if required
      if (linkData.hasPassword) {
        if (!password) {
          return res.status(401).json({
            success: false,
            error: "Password required",
            message: "This shared link is password protected",
            requiresPassword: true,
            requestId: requestId
          });
        }

        console.log(`[fileManagerRoutes] Password verification for token ${token}:`);
        console.log(`  - Provided password: "${password}"`);
        console.log(`  - Stored hash: "${linkData.passwordHash}"`);
        console.log(`  - Password from query: "${req.query.password}"`);

        const isPasswordValid = await verifyPassword(password, linkData.passwordHash);
        console.log(`  - Password verification result: ${isPasswordValid}`);
        
        if (!isPasswordValid) {
          console.warn(`[fileManagerRoutes] Password verification failed for token ${token}`);
          return res.status(401).json({
            success: false,
            error: "Invalid password",
            requestId: requestId
          });
        }
        
        console.log(`[fileManagerRoutes] Password verification successful for token ${token}`);
      }

      // Get the actual file
      const file = await fileManager.getFileById(linkData.fileId);
      if (!file) {
        return res.status(404).json({
          success: false,
          error: "Original file not found",
          requestId: requestId
        });
      }

      // Check if file exists on filesystem
      if (!file.localPath || !fs.existsSync(file.localPath)) {
        return res.status(404).json({
          success: false,
          error: "File not available on disk",
          requestId: requestId
        });
      }

      // Increment download count
      linkData.downloadCount += 1;
      linkData.lastAccessedAt = Date.now();

      // Log access
      console.log(`[fileManagerRoutes] File downloaded via shared link: ${linkData.fileName} (${linkData.downloadCount}/${linkData.maxDownloads}) (Request ID: ${requestId})`);

      // Set appropriate headers
      res.setHeader('Content-Type', linkData.fileMimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${linkData.fileName}"`);
      res.setHeader('Content-Length', linkData.fileSize);

      // Stream the file
      const fileStream = fs.createReadStream(file.localPath);
      fileStream.pipe(res);

      fileStream.on('error', (error) => {
        console.error(`[fileManagerRoutes] Error streaming shared file: ${error.message} (Request ID: ${requestId})`);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: "Error reading file",
            requestId: requestId
          });
        }
      });

    } catch (error) {
      console.error(`[fileManagerRoutes] Error accessing shared file: ${error.message} (Request ID: ${requestId})`);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error.message,
          requestId: requestId
        });
      }
    }
  });

  // GET SHARED LINK INFO (PUBLIC ENDPOINT - NO AUTH REQUIRED)
  router.get("/share/:token/info", async (req, res) => {
    const requestId = `share_info_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const { token } = req.params;

      console.log(`[fileManagerRoutes] Getting shared link info: ${token} (Request ID: ${requestId})`);

      // Clean up expired links first
      cleanupExpiredLinks();

      // Check if link exists
      const linkData = sharedLinks.get(token);
      if (!linkData) {
        return res.status(404).json({
          success: false,
          error: "Shared link not found or expired",
          requestId: requestId
        });
      }

      // Check if link has expired
      if (linkData.expiresAt && linkData.expiresAt < Date.now()) {
        sharedLinks.delete(token);
        return res.status(410).json({
          success: false,
          error: "Shared link has expired",
          requestId: requestId
        });
      }

      // Return safe info (no sensitive data)
      res.json({
        success: true,
        linkInfo: {
          fileName: linkData.fileName,
          fileSize: linkData.fileSize,
          fileMimeType: linkData.fileMimeType,
          hasPassword: linkData.hasPassword,
          expiresAt: linkData.expiresAt,
          maxDownloads: linkData.maxDownloads,
          downloadCount: linkData.downloadCount,
          description: linkData.description,
          createdAt: linkData.createdAt,
          remainingDownloads: linkData.maxDownloads - linkData.downloadCount
        },
        requestId: requestId
      });

    } catch (error) {
      console.error(`[fileManagerRoutes] Error getting shared link info: ${error.message} (Request ID: ${requestId})`);
      res.status(500).json({
        success: false,
        error: error.message,
        requestId: requestId
      });
    }
  });

  // LIST USER'S SHARED LINKS
  router.get("/shared-links", authenticateRequest, async (req, res) => {
    const requestId = `share_list_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`[fileManagerRoutes] Listing shared links (Request ID: ${requestId})`);

      // Clean up expired links first
      cleanupExpiredLinks();

      const userLinks = [];
      const currentUserId = req.user?.id || 'unknown';

      // Filter links by creator (se disponibile)
      for (const [token, linkData] of sharedLinks.entries()) {
        if (linkData.createdBy === currentUserId || currentUserId === 'unknown') {
          userLinks.push({
            token,
            fileName: linkData.fileName,
            hasPassword: linkData.hasPassword,
            expiresAt: linkData.expiresAt,
            maxDownloads: linkData.maxDownloads,
            downloadCount: linkData.downloadCount,
            description: linkData.description,
            createdAt: linkData.createdAt,
            remainingDownloads: linkData.maxDownloads - linkData.downloadCount,
            shareUrl: `${req.protocol}://${req.get('host')}/api/files/share/${token}`
          });
        }
      }

      // Sort by creation date (newest first)
      userLinks.sort((a, b) => b.createdAt - a.createdAt);

      res.json({
        success: true,
        sharedLinks: userLinks,
        count: userLinks.length,
        requestId: requestId
      });

    } catch (error) {
      console.error(`[fileManagerRoutes] Error listing shared links: ${error.message} (Request ID: ${requestId})`);
      res.status(500).json({
        success: false,
        error: error.message,
        requestId: requestId
      });
    }
  });

  // REVOKE SHARED LINK
  router.delete("/share/:token", authenticateRequest, async (req, res) => {
    const requestId = `share_revoke_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const { token } = req.params;

      console.log(`[fileManagerRoutes] Revoking shared link: ${token} (Request ID: ${requestId})`);

      // Check if link exists
      const linkData = sharedLinks.get(token);
      if (!linkData) {
        return res.status(404).json({
          success: false,
          error: "Shared link not found",
          requestId: requestId
        });
      }

      // Check ownership (se disponibile)
      const currentUserId = req.user?.id || 'unknown';
      if (linkData.createdBy !== currentUserId && currentUserId !== 'unknown') {
        return res.status(403).json({
          success: false,
          error: "You can only revoke your own shared links",
          requestId: requestId
        });
      }

      // Remove the link
      sharedLinks.delete(token);

      console.log(`[fileManagerRoutes] Shared link revoked: ${token} (Request ID: ${requestId})`);

      res.json({
        success: true,
        message: "Shared link revoked successfully",
        fileName: linkData.fileName,
        requestId: requestId
      });

    } catch (error) {
      console.error(`[fileManagerRoutes] Error revoking shared link: ${error.message} (Request ID: ${requestId})`);
      res.status(500).json({
        success: false,
        error: error.message,
        requestId: requestId
      });
    }
  });

  // ================== ORIGINAL ENDPOINTS ==================

  // Get file by ID
  router.get("/:id", authenticateRequest, async (req, res) => {
    const requestId = `files_get_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const fileId = req.params.id;
      console.log(`[fileManagerRoutes] Getting file by ID: ${fileId} (Request ID: ${requestId})`);
      
      const file = await fileManager.getFileById(fileId);
      
      if (!file) {
        console.log(`[fileManagerRoutes] File not found: ${fileId} (Request ID: ${requestId})`);
        return res.status(404).json({
          success: false,
          error: `File not found: ${fileId}`,
          requestId: requestId
        });
      }
      
      console.log(`[fileManagerRoutes] File retrieved successfully: ${fileId} (Request ID: ${requestId})`);
      
      res.json({
        success: true,
        file,
        requestId: requestId
      });
    } catch (error) {
      console.error(`[fileManagerRoutes] Error getting file: ${error.message} (Request ID: ${requestId})`);
      res.status(500).json({
        success: false,
        error: error.message,
        requestId: requestId
      });
    }
  });

  // Delete file
  router.delete("/:id", authenticateRequest, preventDuplicateRequests, async (req, res) => {
    const requestId = `files_delete_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const fileId = req.params.id;
      console.log(`[fileManagerRoutes] Delete request for file ID: ${fileId} (Request ID: ${requestId})`);
      
      const result = await fileManager.deleteFile(fileId);
      
      console.log(`[fileManagerRoutes] File deletion completed: ${fileId} (Request ID: ${requestId}, Processing time: ${result.processingTime}ms)`);
      
      res.json({
        success: true,
        message: `File ${fileId} deleted successfully`,
        result,
        requestId: requestId
      });
    } catch (error) {
      console.error(`[fileManagerRoutes] Error deleting file: ${error.message} (Request ID: ${requestId})`);
      res.status(500).json({
        success: false,
        error: error.message,
        requestId: requestId
      });
    }
  });

  return router;
};

export default setupFileManagerRoutes; 