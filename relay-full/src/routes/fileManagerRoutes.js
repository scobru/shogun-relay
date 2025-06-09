import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import SEA from "gun/sea.js";

// Track recent requests to prevent duplicates
const recentRequests = new Map();
const requestTimeout = 5000; // 5 seconds

// Track shared links (in production questo dovrebbe essere in un database)
const sharedLinks = new Map();

// GunDB instance for persistent shared links storage
let gunInstance = null;

/**
 * Initialize shared links from GunDB with enhanced persistence handling
 */
const initializeSharedLinks = async (gun) => {
  if (!gun) {
    console.warn('[fileManagerRoutes] Gun instance not provided for shared links initialization');
    return;
  }
  
  gunInstance = gun;
  console.log('[fileManagerRoutes] Initializing shared links from GunDB...');
  
  try {
    // Clear existing links first
    sharedLinks.clear();
    
    // Enhanced loading with multiple attempts and better timeout handling
    await new Promise((resolve) => {
      let loadedCount = 0;
      let hasStartedLoading = false;
      let isResolved = false;
      let loadAttempts = 0;
      const maxAttempts = 3;
      
      const attemptLoad = () => {
        loadAttempts++;
        console.log(`[fileManagerRoutes] Load attempt ${loadAttempts}/${maxAttempts} for shared links...`);
        
        // Reset counters for this attempt
        loadedCount = 0;
        hasStartedLoading = false;
        
        // Set timeout for this attempt
        const attemptTimeout = setTimeout(() => {
          if (!isResolved) {
            console.log(`[fileManagerRoutes] Load attempt ${loadAttempts} timed out after 10 seconds`);
            
            if (loadAttempts < maxAttempts) {
              console.log(`[fileManagerRoutes] Retrying load attempt ${loadAttempts + 1}...`);
              setTimeout(attemptLoad, 2000); // Wait 2 seconds before retry
            } else {
              console.log(`[fileManagerRoutes] All load attempts exhausted. Loaded ${sharedLinks.size} links`);
              isResolved = true;
              resolve();
            }
          }
        }, 10000); // 10 seconds per attempt
        
        // Try to load from Gun
        gun.get('shared-links').map().once((linkData, token) => {
          if (!hasStartedLoading) {
            hasStartedLoading = true;
            console.log(`[fileManagerRoutes] Started loading shared links from GunDB (attempt ${loadAttempts})...`);
          }
          
          if (linkData && token && !token.startsWith('_')) {
            // Load all links, including expired and exhausted ones for history
            sharedLinks.set(token, linkData);
            loadedCount++;
            
            const status = linkData.isExhausted ? 'exhausted' : 
                          (linkData.expiresAt && linkData.expiresAt < Date.now()) ? 'expired' : 'active';
            console.log(`[fileManagerRoutes] Loaded shared link: ${token} (${linkData.fileName}) - Status: ${status}`);
          }
        });
        
        // Wait for links to load, then check if we got any
        setTimeout(() => {
          if (!isResolved) {
            if (hasStartedLoading && loadedCount > 0) {
              console.log(`[fileManagerRoutes] Successfully loaded ${sharedLinks.size} shared links on attempt ${loadAttempts}`);
              clearTimeout(attemptTimeout);
              isResolved = true;
              resolve();
            } else if (loadAttempts >= maxAttempts) {
              console.log(`[fileManagerRoutes] No shared links found after ${maxAttempts} attempts`);
              clearTimeout(attemptTimeout);
              isResolved = true;
              resolve();
            }
            // If no links loaded and we have more attempts, the timeout will handle retry
          }
        }, 6000); // Wait 6 seconds for links to load
      };
      
      // Start the first attempt
      attemptLoad();
    });
    
    console.log(`[fileManagerRoutes] Shared links initialization completed - total loaded: ${sharedLinks.size}`);
    
    // Log summary of loaded links by status
    const statusCounts = { active: 0, expired: 0, exhausted: 0 };
    for (const [token, linkData] of sharedLinks) {
      if (linkData.isExhausted) {
        statusCounts.exhausted++;
      } else if (linkData.expiresAt && linkData.expiresAt < Date.now()) {
        statusCounts.expired++;
      } else {
        statusCounts.active++;
      }
    }
    console.log(`[fileManagerRoutes] Link status summary:`, statusCounts);
    
  } catch (error) {
    console.error(`[fileManagerRoutes] Error initializing shared links: ${error.message}`);
    throw error;
  }
};

/**
 * Save shared link to GunDB for persistence with enhanced verification
 */
const saveSharedLinkToGun = async (token, linkData, retryCount = 0) => {
  if (!gunInstance) {
    console.warn(`[fileManagerRoutes] GunDB instance not available for saving link: ${token}`);
    return false;
  }
  
  const maxRetries = 3;
  const retryDelay = 1000; // 1 second for retries
  
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('GunDB save timeout'));
      }, 10000); // Increased timeout to 10 seconds for persistence
      
      const dataToSave = {
        ...linkData,
        lastUpdated: Date.now()
      };
      
      gunInstance.get('shared-links').get(token).put(dataToSave, (ack) => {
        clearTimeout(timeout);
        if (ack.err) {
          reject(new Error(`GunDB save error: ${ack.err}`));
        } else {
          console.log(`[fileManagerRoutes] GunDB save acknowledged for link: ${token}`);
          resolve();
        }
      });
    });
    
    console.log(`[fileManagerRoutes] Saved shared link to GunDB: ${token} (downloadCount: ${linkData.downloadCount}/${linkData.maxDownloads})`);
    return true;
    
  } catch (error) {
    console.error(`[fileManagerRoutes] Error saving shared link to GunDB (attempt ${retryCount + 1}/${maxRetries + 1}): ${error.message}`);
    
    if (retryCount < maxRetries) {
      console.log(`[fileManagerRoutes] Retrying save for link ${token} in ${retryDelay}ms...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
      return await saveSharedLinkToGun(token, linkData, retryCount + 1);
    }
    
    console.error(`[fileManagerRoutes] Failed to save shared link after ${maxRetries + 1} attempts: ${token}`);
    return false;
  }
};

/**
 * Remove shared link from GunDB
 */
const removeSharedLinkFromGun = async (token) => {
  if (!gunInstance) {
    console.warn(`[fileManagerRoutes] GunDB instance not available for removing link: ${token}`);
    return false;
  }
  
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('GunDB remove timeout'));
      }, 5000); // 5 seconds timeout for removal

      gunInstance.get('shared-links').get(token).put(null, (ack) => {
        clearTimeout(timeout);
        if (ack.err) {
          reject(new Error(`GunDB removal error: ${ack.err}`));
        } else {
          console.log(`[fileManagerRoutes] GunDB remove acknowledged for link: ${token}`);
          resolve();
        }
      });
    });
    console.log(`[fileManagerRoutes] Removed shared link from GunDB: ${token}`);
    return true;
  } catch (error) {
    console.error(`[fileManagerRoutes] Error removing shared link from GunDB: ${error.message}`);
    return false;
  }
};

// Track last cleanup time to avoid excessive cleanup calls
let lastCleanupTime = 0;
const CLEANUP_INTERVAL = 60000; // 1 minute minimum between cleanups

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
const cleanupExpiredLinks = async () => {
  const now = Date.now();
  
  // Avoid excessive cleanup calls
  if (now - lastCleanupTime < CLEANUP_INTERVAL) {
    return;
  }
  
  lastCleanupTime = now;
  let cleanedCount = 0;
  
  for (const [token, linkData] of sharedLinks.entries()) {
    if (linkData.expiresAt && linkData.expiresAt < now) {
      sharedLinks.delete(token);
      // Also remove from GunDB
      try {
        await removeSharedLinkFromGun(token);
        cleanedCount++;
      } catch (removeError) {
        console.warn(`[fileManagerRoutes] Failed to remove expired link from GunDB: ${token} - ${removeError.message}`);
      }
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
 * Enhanced getFileById that supports both regular files and IPFS files
 */
const getFileByIdEnhanced = async (fileManager, fileId) => {
  // First try the regular FileManager method
  let file = await fileManager.getFileById(fileId);
  
  if (file) {
    return file;
  }
  
  // If not found, try to find in IPFS files collection
  console.log(`[fileManagerRoutes] File not found in regular collection, checking IPFS files: ${fileId}`);
  
  if (!fileManager.config?.gun) {
    console.warn('[fileManagerRoutes] Gun instance not available for IPFS file lookup');
    return null;
  }
  
  try {
    // Check ipfs-files collection
    const ipfsFile = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, 3000);
      
      fileManager.config.gun.get('ipfs-files').get(fileId).once((data) => {
        clearTimeout(timeout);
        resolve(data);
      });
    });
    
    if (ipfsFile && ipfsFile.independent) {
      console.log(`[fileManagerRoutes] Found IPFS file: ${fileId}`);
      return {
        id: ipfsFile.id || fileId,
        name: ipfsFile.name || ipfsFile.originalName,
        originalName: ipfsFile.originalName,
        mimetype: ipfsFile.mimeType || ipfsFile.mimetype,
        mimeType: ipfsFile.mimeType || ipfsFile.mimetype,
        size: ipfsFile.size,
        ipfsHash: ipfsFile.ipfsHash,
        ipfsUrl: ipfsFile.ipfsUrl,
        url: ipfsFile.ipfsUrl,
        fileUrl: ipfsFile.ipfsUrl,
        localPath: null, // IPFS files don't have local paths
        timestamp: ipfsFile.uploadedAt || ipfsFile.timestamp,
        uploadedAt: ipfsFile.uploadedAt || ipfsFile.timestamp,
        verified: ipfsFile.verified,
        independent: ipfsFile.independent,
        uploadType: ipfsFile.uploadType
      };
    }
    
    // Also try searching by IPFS hash if the fileId looks like a hash
    if (fileId.length === 46 && fileId.startsWith('Qm')) {
      console.log(`[fileManagerRoutes] Searching IPFS files by hash: ${fileId}`);
      
      const ipfsFileByHash = await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(null);
        }, 3000);
        
        let found = false;
        fileManager.config.gun.get('ipfs-files').map().once((data, key) => {
          if (data && data.ipfsHash === fileId && !found) {
            found = true;
            clearTimeout(timeout);
            resolve(data);
          }
        });
      });
      
      if (ipfsFileByHash) {
        console.log(`[fileManagerRoutes] Found IPFS file by hash: ${fileId}`);
        return {
          id: ipfsFileByHash.id || fileId,
          name: ipfsFileByHash.name || ipfsFileByHash.originalName,
          originalName: ipfsFileByHash.originalName,
          mimetype: ipfsFileByHash.mimeType || ipfsFileByHash.mimetype,
          mimeType: ipfsFileByHash.mimeType || ipfsFileByHash.mimetype,
          size: ipfsFileByHash.size,
          ipfsHash: ipfsFileByHash.ipfsHash,
          ipfsUrl: ipfsFileByHash.ipfsUrl,
          url: ipfsFileByHash.ipfsUrl,
          fileUrl: ipfsFileByHash.ipfsUrl,
          localPath: null,
          timestamp: ipfsFileByHash.uploadedAt || ipfsFileByHash.timestamp,
          uploadedAt: ipfsFileByHash.uploadedAt || ipfsFileByHash.timestamp,
          verified: ipfsFileByHash.verified,
          independent: ipfsFileByHash.independent,
          uploadType: ipfsFileByHash.uploadType
        };
      }
    }
    
    // If still not found, try checking fallback files
    console.log(`[fileManagerRoutes] Checking fallback files for: ${fileId}`);
    try {
      const fallbackDir = path.join(process.cwd(), 'radata', 'ipfs-fallback');
      const fallbackFile = path.join(fallbackDir, `${fileId}.json`);
      
      if (fs.existsSync(fallbackFile)) {
        const fallbackData = JSON.parse(fs.readFileSync(fallbackFile, 'utf8'));
        if (fallbackData.independent && fallbackData.ipfsHash) {
          console.log(`[fileManagerRoutes] Found IPFS file in fallback: ${fileId}`);
          return {
            id: fallbackData.id || fileId,
            name: fallbackData.name || fallbackData.originalName,
            originalName: fallbackData.originalName,
            mimetype: fallbackData.mimeType || fallbackData.mimetype,
            mimeType: fallbackData.mimeType || fallbackData.mimetype,
            size: fallbackData.size,
            ipfsHash: fallbackData.ipfsHash,
            ipfsUrl: fallbackData.ipfsUrl,
            url: fallbackData.ipfsUrl,
            fileUrl: fallbackData.ipfsUrl,
            localPath: null,
            timestamp: fallbackData.uploadedAt || fallbackData.timestamp,
            uploadedAt: fallbackData.uploadedAt || fallbackData.timestamp,
            verified: fallbackData.verified,
            independent: fallbackData.independent,
            uploadType: fallbackData.uploadType
          };
        }
      } else {
        // Try searching all fallback files by name or hash
        if (fs.existsSync(fallbackDir)) {
          const fallbackFiles = fs.readdirSync(fallbackDir).filter(f => f.endsWith('.json'));
          
          for (const fallbackFileName of fallbackFiles) {
            try {
              const fallbackPath = path.join(fallbackDir, fallbackFileName);
              const fallbackData = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
              
              const matches = (
                fallbackData.independent && (
                  fallbackData.id === fileId ||
                  fallbackData.ipfsHash === fileId ||
                  (fallbackData.name && (
                    fallbackData.name === fileId ||
                    fallbackData.name.includes(fileId) ||
                    fileId.includes(fallbackData.name)
                  )) ||
                  (fallbackData.originalName && (
                    fallbackData.originalName === fileId ||
                    fallbackData.originalName.includes(fileId) ||
                    fileId.includes(fallbackData.originalName)
                  ))
                )
              );
              
              if (matches) {
                console.log(`[fileManagerRoutes] Found IPFS file by search in fallback: ${fallbackFileName}`);
                return {
                  id: fallbackData.id || fileId,
                  name: fallbackData.name || fallbackData.originalName,
                  originalName: fallbackData.originalName,
                  mimetype: fallbackData.mimeType || fallbackData.mimetype,
                  mimeType: fallbackData.mimeType || fallbackData.mimetype,
                  size: fallbackData.size,
                  ipfsHash: fallbackData.ipfsHash,
                  ipfsUrl: fallbackData.ipfsUrl,
                  url: fallbackData.ipfsUrl,
                  fileUrl: fallbackData.ipfsUrl,
                  localPath: null,
                  timestamp: fallbackData.uploadedAt || fallbackData.timestamp,
                  uploadedAt: fallbackData.uploadedAt || fallbackData.timestamp,
                  verified: fallbackData.verified,
                  independent: fallbackData.independent,
                  uploadType: fallbackData.uploadType
                };
              }
            } catch (parseError) {
              console.warn(`[fileManagerRoutes] Error parsing fallback file ${fallbackFileName}: ${parseError.message}`);
            }
          }
        }
      }
    } catch (fallbackError) {
      console.warn(`[fileManagerRoutes] Error checking fallback files: ${fallbackError.message}`);
    }
    
  } catch (error) {
    console.error(`[fileManagerRoutes] Error searching IPFS files: ${error.message}`);
  }
  
  return null;
};

/**
 * Set up file manager routes
 * @param {Object} fileManager - The file manager instance
 * @param {Function} authenticateRequest - Authentication middleware
 * @returns {Object} Express router
 */
const setupFileManagerRoutes = async (fileManager, authenticateRequest) => {
  const router = express.Router();
  
  // Initialize shared links from GunDB
  if (fileManager.config?.gun) {
    await initializeSharedLinks(fileManager.config.gun);
    console.log('[fileManagerRoutes] Initial shared links loaded. Running immediate cleanup...');
    await cleanupExpiredLinks(); // Run cleanup immediately after loading
  }

  // Get file statistics
  router.get("/stats", authenticateRequest, async (req, res) => {
    const requestId = `files_stats_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`[fileManagerRoutes] Getting file statistics (Request ID: ${requestId})`);
      
      const files = await fileManager.getAllFiles();
      
      // Calculate time-based statistics
      const now = Date.now();
      const oneDayAgo = now - (24 * 60 * 60 * 1000);
      const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
      
      const todayFiles = files.filter(f => (f.timestamp || f.uploadedAt || 0) > oneDayAgo);
      const weekFiles = files.filter(f => (f.timestamp || f.uploadedAt || 0) > oneWeekAgo);
      
      // Calculate storage usage (assuming 1GB total for demo)
      const totalStorageBytes = 1024 * 1024 * 1024; // 1GB
      const usedStorageBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
      const storagePercentage = Math.round((usedStorageBytes / totalStorageBytes) * 100);
      
      // Calculate statistics
      const stats = {
        totalFiles: files.length,
        totalSize: files.reduce((sum, file) => sum + (file.size || 0), 0),
        todayFiles: todayFiles.length,
        weekFiles: weekFiles.length,
        fileTypes: {},
        ipfsFiles: files.filter(f => f.ipfsHash).length,
        localFiles: files.filter(f => f.localPath).length,
        averageSize: files.length > 0 ? Math.round(files.reduce((sum, file) => sum + (file.size || 0), 0) / files.length) : 0,
        oldestFile: files.length > 0 ? Math.min(...files.map(f => f.timestamp || f.uploadedAt || Date.now())) : null,
        newestFile: files.length > 0 ? Math.max(...files.map(f => f.timestamp || f.uploadedAt || 0)) : null,
        storage: {
          used: usedStorageBytes,
          total: totalStorageBytes,
          percentage: storagePercentage,
          remaining: totalStorageBytes - usedStorageBytes,
          remainingPercentage: 100 - storagePercentage
        },
        sharedLinks: {
          total: sharedLinks.size,
          active: Array.from(sharedLinks.values()).filter(link => 
            !link.isExhausted && 
            (!link.expiresAt || link.expiresAt > now)
          ).length,
          exhausted: Array.from(sharedLinks.values()).filter(link => link.isExhausted).length,
          expired: Array.from(sharedLinks.values()).filter(link => 
            !link.isExhausted && 
            link.expiresAt && 
            link.expiresAt <= now
          ).length
        }
      };
      
      // Count file types
      files.forEach(file => {
        const type = file.mimetype || file.mimeType || 'unknown';
        stats.fileTypes[type] = (stats.fileTypes[type] || 0) + 1;
      });
      
      console.log(`[fileManagerRoutes] File statistics calculated (Request ID: ${requestId})`);
      
      res.json({
        success: true,
        stats,
        requestId: requestId,
        timestamp: Date.now()
      });
    } catch (error) {
      console.error(`[fileManagerRoutes] Error getting file statistics: ${error.message} (Request ID: ${requestId})`);
      res.status(500).json({
        success: false,
        error: error.message,
        requestId: requestId
      });
    }
  });

  // Get all files
  router.get("/list", authenticateRequest, async (req, res) => {
    try {
      console.log("[fileManagerRoutes] Getting all files list");
      
      const files = await fileManager.getAllFiles();
      
      console.log(`[fileManagerRoutes] Retrieved ${files.length} files`);
      
      res.json({
        success: true,
        files: files,
        count: files.length,
        message: `Retrieved ${files.length} files successfully`
      });
    } catch (error) {
      console.error(`[fileManagerRoutes] Error getting files list: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Error retrieving files list"
      });
    }
  });

  // Upload file to local storage
  router.post("/upload", authenticateRequest, fileManager.getUploadMiddleware().single('file'), async (req, res) => {
    const requestId = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`[fileManagerRoutes] Starting file upload (Request ID: ${requestId})`);
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No file uploaded",
          message: "Please provide a file to upload",
          requestId: requestId
        });
      }

      // Add request ID for tracking
      req.uploadRequestId = requestId;
      
      // Process the upload using FileManager
      const result = await fileManager.handleFileUpload(req);
      
      console.log(`[fileManagerRoutes] File upload completed successfully: ${result.id} (Request ID: ${requestId})`);
      
      res.json({
        success: true,
        file: result,
        fileInfo: {
          id: result.id,
          name: result.originalName,
          size: result.size,
          type: result.mimetype,
          url: result.fileUrl
        },
        verified: true,
        requestId: requestId
      });
      
    } catch (error) {
      console.error(`[fileManagerRoutes] Error uploading file: ${error.message} (Request ID: ${requestId})`);
      res.status(500).json({
        success: false,
        error: error.message,
        requestId: requestId
      });
    }
  });

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

      // Check if file exists (using enhanced method that supports IPFS files)
      const file = await getFileByIdEnhanced(fileManager, fileId);
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

      // Debug logging for expiration times
      if (expiresAt) {
        const expiresInMinutes = Math.round(expiresIn / 60);
        const expiresInHours = Math.round(expiresIn / 3600);
        console.log(`[fileManagerRoutes] Link expiration: ${expiresIn}s (${expiresInMinutes}m / ${expiresInHours}h) - expires at ${new Date(expiresAt).toISOString()}`);
        
        // Warn about very short expiration times
        if (expiresIn < 300) { // Less than 5 minutes
          console.warn(`[fileManagerRoutes] ⚠️ WARNING: Very short expiration time detected: ${expiresIn} seconds!`);
        }
      } else {
        console.log(`[fileManagerRoutes] Link set to never expire (expiresAt: null)`);
      }

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

      // Store the link in memory and GunDB
      sharedLinks.set(token, linkData);
      
      // Save to GunDB for persistence
      await saveSharedLinkToGun(token, linkData);

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
      await cleanupExpiredLinks();

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

      // Check download limit or if link is exhausted
      if (linkData.downloadCount >= linkData.maxDownloads || linkData.isExhausted) {
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

      // Get the actual file (using enhanced method that supports IPFS files)
      const file = await getFileByIdEnhanced(fileManager, linkData.fileId);
      if (!file) {
        return res.status(404).json({
          success: false,
          error: "Original file not found",
          requestId: requestId
        });
      }

      // Increment download count atomically
      const previousCount = linkData.downloadCount;
      linkData.downloadCount += 1;
      linkData.lastAccessedAt = Date.now();

      // Save updated download count to GunDB for persistence BEFORE serving the file
      // Make this non-blocking to avoid 500 errors
      console.log(`[fileManagerRoutes] Updated download count in memory: ${linkData.downloadCount}/${linkData.maxDownloads} (Request ID: ${requestId})`);
      
      // Try to save to GunDB asynchronously, but don't block the download if it fails
      saveSharedLinkToGun(linkData.token, linkData).catch(saveError => {
        console.warn(`[fileManagerRoutes] Background save to GunDB failed for ${linkData.token}: ${saveError.message} (Request ID: ${requestId})`);
        // Don't revert the count since the download should proceed
      });

      // Check if download limit reached and mark as exhausted instead of removing
      if (linkData.downloadCount >= linkData.maxDownloads) {
        console.log(`[fileManagerRoutes] Download limit reached for shared link: ${linkData.fileName}. Marking as exhausted. (Request ID: ${requestId})`);
        linkData.isExhausted = true;
        linkData.exhaustedAt = Date.now();
        
        // Save the exhausted state to GunDB instead of removing - make it non-blocking
        saveSharedLinkToGun(linkData.token, linkData).then(() => {
          console.log(`[fileManagerRoutes] Shared link marked as exhausted in GunDB: ${linkData.token} (Request ID: ${requestId})`);
        }).catch(saveError => {
          console.warn(`[fileManagerRoutes] Failed to save exhausted state to GunDB: ${saveError.message} (Request ID: ${requestId})`);
        });
      }

      // Log access
      console.log(`[fileManagerRoutes] File downloaded via shared link: ${linkData.fileName} (${linkData.downloadCount}/${linkData.maxDownloads}) (Request ID: ${requestId})`);

      // Set appropriate headers
      res.setHeader('Content-Type', linkData.fileMimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${linkData.fileName}"`);
      res.setHeader('Content-Length', linkData.fileSize);

      // Handle different file storage types
      if (file.localPath && fs.existsSync(file.localPath)) {
        // Local file - stream from disk
        console.log(`[fileManagerRoutes] Serving local file: ${file.localPath} (Request ID: ${requestId})`);
        const fileStream = fs.createReadStream(file.localPath);
        fileStream.pipe(res);

        fileStream.on('error', (error) => {
          console.error(`[fileManagerRoutes] Error streaming local file: ${error.message} (Request ID: ${requestId})`);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: "Error reading local file",
              requestId: requestId
            });
          }
        });
      } else if (file.ipfsHash) {
        // IPFS file - redirect to IPFS gateway
        console.log(`[fileManagerRoutes] Redirecting to IPFS file: ${file.ipfsHash} (Request ID: ${requestId})`);
        
        // Get IPFS gateway URL from file manager or use default
        const ipfsGateway = fileManager.ipfsManager?.getConfig()?.gateway || 'http://127.0.0.1:8080/ipfs';
        const ipfsUrl = `${ipfsGateway}/${file.ipfsHash}`;
        
        console.log(`[fileManagerRoutes] IPFS redirect URL: ${ipfsUrl} (Request ID: ${requestId})`);
        
        // Redirect to IPFS gateway
        res.redirect(302, ipfsUrl);
      } else {
        // File not available in any storage
        return res.status(404).json({
          success: false,
          error: "File not available in any storage (neither local nor IPFS)",
          requestId: requestId
        });
      }

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
      await cleanupExpiredLinks();

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
        await removeSharedLinkFromGun(token);
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
          remainingDownloads: Math.max(0, linkData.maxDownloads - linkData.downloadCount),
          isExhausted: linkData.isExhausted || false,
          exhaustedAt: linkData.exhaustedAt || null,
          status: linkData.isExhausted ? 'exhausted' : 
                 (linkData.expiresAt && linkData.expiresAt < Date.now()) ? 'expired' : 'active'
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
      await cleanupExpiredLinks();

      // If sharedLinks is empty, try to reload from GunDB (but only if we haven't tried recently)
      if (sharedLinks.size === 0 && gunInstance) {
        console.log(`[fileManagerRoutes] No links in memory, attempting to reload from GunDB (Request ID: ${requestId})`);
        try {
          await initializeSharedLinks(gunInstance);
          console.log(`[fileManagerRoutes] Reload attempt completed, found ${sharedLinks.size} links (Request ID: ${requestId})`);
        } catch (reloadError) {
          console.warn(`[fileManagerRoutes] Failed to reload links from GunDB: ${reloadError.message} (Request ID: ${requestId})`);
          // Continue with empty list rather than failing
        }
      }

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
            remainingDownloads: Math.max(0, linkData.maxDownloads - linkData.downloadCount),
            shareUrl: `${req.protocol}://${req.get('host')}/api/files/share/${token}`,
            isExhausted: linkData.isExhausted || false,
            exhaustedAt: linkData.exhaustedAt || null,
            status: linkData.isExhausted ? 'exhausted' : 
                   (linkData.expiresAt && linkData.expiresAt < Date.now()) ? 'expired' : 'active'
          });
        }
      }

      // Sort by creation date (newest first)
      userLinks.sort((a, b) => b.createdAt - a.createdAt);

      res.json({
        success: true,
        sharedLinks: userLinks,
        count: userLinks.length,
        requestId: requestId,
        loadedFromGunDB: sharedLinks.size > 0 && userLinks.length === 0 ? false : true
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

  // RELOAD SHARED LINKS FROM GUNDB
  router.post("/shared-links/reload", authenticateRequest, async (req, res) => {
    const requestId = `share_reload_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`[fileManagerRoutes] Reloading shared links from GunDB (Request ID: ${requestId})`);

      if (!gunInstance) {
        return res.status(500).json({
          success: false,
          error: "GunDB not available",
          requestId: requestId
        });
      }

      // Backup current links before clearing
      const previousCount = sharedLinks.size;
      const backupLinks = new Map(sharedLinks);
      
      // Clear current links and reload from GunDB
      sharedLinks.clear();
      
      try {
        await initializeSharedLinks(gunInstance);
        const newCount = sharedLinks.size;

        console.log(`[fileManagerRoutes] Reloaded shared links: ${previousCount} → ${newCount} (Request ID: ${requestId})`);

        res.json({
          success: true,
          message: "Shared links reloaded from GunDB",
          previousCount: previousCount,
          newCount: newCount,
          requestId: requestId
        });
      } catch (initError) {
        // If initialization fails, restore backup
        console.warn(`[fileManagerRoutes] Failed to reload links, restoring backup: ${initError.message} (Request ID: ${requestId})`);
        sharedLinks.clear();
        for (const [token, linkData] of backupLinks) {
          sharedLinks.set(token, linkData);
        }
        
        throw new Error(`Failed to reload links: ${initError.message}`);
      }

    } catch (error) {
      console.error(`[fileManagerRoutes] Error reloading shared links: ${error.message} (Request ID: ${requestId})`);
      res.status(500).json({
        success: false,
        error: error.message,
        requestId: requestId
      });
    }
  });

  // UPDATE SHARED LINK
  router.put("/share/:token", authenticateRequest, async (req, res) => {
    const requestId = `share_update_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const { token } = req.params;
      const { description, maxDownloads, expiresIn } = req.body;

      console.log(`[fileManagerRoutes] Updating shared link: ${token} (Request ID: ${requestId})`);

      // Check if link exists
      const linkData = sharedLinks.get(token);
      if (!linkData) {
        return res.status(404).json({
          success: false,
          error: "Shared link not found",
          requestId: requestId
        });
      }

      // Check ownership
      const currentUserId = req.user?.id || 'unknown';
      if (linkData.createdBy !== currentUserId && currentUserId !== 'unknown') {
        return res.status(403).json({
          success: false,
          error: "You can only update your own shared links",
          requestId: requestId
        });
      }

      // Update link data
      if (description !== undefined) linkData.description = description;
      if (maxDownloads !== undefined && maxDownloads > linkData.downloadCount) {
        linkData.maxDownloads = maxDownloads;
      }
      if (expiresIn !== undefined) {
        linkData.expiresAt = Date.now() + (expiresIn * 1000);
      }
      
      linkData.lastModified = Date.now();

      // Save updated link to GunDB
      const saveSuccess = await saveSharedLinkToGun(token, linkData);
      if (!saveSuccess) {
        return res.status(500).json({
          success: false,
          error: "Failed to save updated link",
          requestId: requestId
        });
      }

      console.log(`[fileManagerRoutes] Shared link updated: ${token} (Request ID: ${requestId})`);

      res.json({
        success: true,
        message: "Shared link updated successfully",
        link: {
          token: linkData.token,
          description: linkData.description,
          maxDownloads: linkData.maxDownloads,
          downloadCount: linkData.downloadCount,
          expiresAt: linkData.expiresAt,
          lastModified: linkData.lastModified
        },
        requestId: requestId
      });

    } catch (error) {
      console.error(`[fileManagerRoutes] Error updating shared link: ${error.message} (Request ID: ${requestId})`);
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

      // Remove the link from memory and GunDB
      sharedLinks.delete(token);
      await removeSharedLinkFromGun(token);

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
      
      const file = await getFileByIdEnhanced(fileManager, fileId);
      
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

  // Update file metadata
  router.put("/:id", authenticateRequest, async (req, res) => {
    const requestId = `files_update_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const fileId = req.params.id;
      const { name, description, customName } = req.body;
      
      console.log(`[fileManagerRoutes] Update request for file ID: ${fileId} (Request ID: ${requestId})`);
      
      // Get existing file
      const existingFile = await getFileByIdEnhanced(fileManager, fileId);
      if (!existingFile) {
        return res.status(404).json({
          success: false,
          error: `File not found: ${fileId}`,
          requestId: requestId
        });
      }
      
      // Update metadata
      const updatedMetadata = {
        ...existingFile,
        originalName: name || existingFile.originalName,
        name: name || existingFile.name,
        description: description || existingFile.description,
        customName: customName || existingFile.customName,
        lastModified: Date.now(),
        _updatedAt: Date.now()
      };
      
      // Save updated metadata
      const result = await fileManager.saveFileMetadata(updatedMetadata);
      
      console.log(`[fileManagerRoutes] File metadata updated: ${fileId} (Request ID: ${requestId})`);
      
      res.json({
        success: true,
        message: `File metadata updated successfully`,
        file: result,
        requestId: requestId
      });
    } catch (error) {
      console.error(`[fileManagerRoutes] Error updating file metadata: ${error.message} (Request ID: ${requestId})`);
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

  // Legacy delete endpoint (kept for backward compatibility)
  router.delete("/delete/:fileId", authenticateRequest, async (req, res) => {
    const requestId = `files_delete_legacy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      const fileId = req.params.fileId;
      
      if (!fileId) {
        return res.status(400).json({
          success: false,
          error: "File ID is required",
          message: "Missing file ID parameter",
          requestId: requestId
        });
      }
      
      console.log(`[fileManagerRoutes] Legacy delete endpoint - Deleting file: ${fileId} (Request ID: ${requestId})`);
      
      const result = await fileManager.deleteFile(fileId);
      
      if (result.success) {
        console.log(`[fileManagerRoutes] File deleted successfully: ${fileId} (Request ID: ${requestId})`);
        res.json({
          success: true,
          message: "File deleted successfully",
          fileId: fileId,
          results: result.results,
          requestId: requestId,
          note: "This endpoint is deprecated, use DELETE /:id instead"
        });
      } else {
        res.status(500).json({
          success: false,
          error: result.error || "Delete operation failed",
          message: "Error deleting file",
          requestId: requestId
        });
      }
    } catch (error) {
      console.error(`[fileManagerRoutes] Error deleting file: ${error.message} (Request ID: ${requestId})`);
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Error deleting file",
        requestId: requestId
      });
    }
  });

  // FORCE GUN SYNC AND CHECK PERSISTENCE STATUS
  router.post("/shared-links/force-sync", authenticateRequest, async (req, res) => {
    const requestId = `force_sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`[fileManagerRoutes] Force sync requested (Request ID: ${requestId})`);

      if (!gunInstance) {
        return res.status(500).json({
          success: false,
          error: "GunDB not available",
          requestId: requestId
        });
      }

      // Force Gun to sync all shared links to disk
      const syncResults = [];
      
      for (const [token, linkData] of sharedLinks) {
        try {
          const saveSuccess = await saveSharedLinkToGun(token, linkData);
          syncResults.push({
            token: token,
            fileName: linkData.fileName,
            success: saveSuccess,
            status: linkData.isExhausted ? 'exhausted' : 
                   (linkData.expiresAt && linkData.expiresAt < Date.now()) ? 'expired' : 'active'
          });
        } catch (error) {
          syncResults.push({
            token: token,
            fileName: linkData.fileName,
            success: false,
            error: error.message
          });
        }
      }
      
      // Trigger additional Gun sync operations
      try {
        gunInstance.get('shared-links').get('_last_sync').put({ 
          timestamp: Date.now(),
          totalLinks: sharedLinks.size,
          requestId: requestId
        });
        console.log(`[fileManagerRoutes] Triggered additional Gun sync operations`);
      } catch (syncError) {
        console.warn(`[fileManagerRoutes] Additional sync failed: ${syncError.message}`);
      }
      
      const successCount = syncResults.filter(r => r.success).length;
      const failureCount = syncResults.length - successCount;

      console.log(`[fileManagerRoutes] Force sync completed: ${successCount} success, ${failureCount} failures (Request ID: ${requestId})`);

      res.json({
        success: true,
        message: "Force sync completed",
        results: {
          totalLinks: sharedLinks.size,
          successCount: successCount,
          failureCount: failureCount,
          syncResults: syncResults
        },
        requestId: requestId
      });

    } catch (error) {
      console.error(`[fileManagerRoutes] Error during force sync: ${error.message} (Request ID: ${requestId})`);
      res.status(500).json({
        success: false,
        error: error.message,
        requestId: requestId
      });
    }
  });

  // CHECK GUN PERSISTENCE STATUS
  router.get("/shared-links/persistence-status", authenticateRequest, async (req, res) => {
    const requestId = `persistence_check_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      console.log(`[fileManagerRoutes] Persistence status check requested (Request ID: ${requestId})`);

      if (!gunInstance) {
        return res.status(500).json({
          success: false,
          error: "GunDB not available",
          requestId: requestId
        });
      }

      // Check Gun configuration
      const gunConfig = {
        hasFile: !!(gunInstance._.opt && gunInstance._.opt.file),
        fileName: gunInstance._.opt ? gunInstance._.opt.file : null,
        hasRadisk: !!(gunInstance._.opt && gunInstance._.opt.radisk),
        hasLocalStorage: !!(gunInstance._.opt && gunInstance._.opt.localStorage),
        peers: gunInstance._.opt ? Object.keys(gunInstance._.opt.peers || {}) : []
      };

      // Test persistence by writing and reading a test value
      const testToken = `test_${Date.now()}`;
      const testData = { test: true, timestamp: Date.now() };
      
      const persistenceTest = await new Promise((resolve) => {
        const timeout = setTimeout(() => resolve({ success: false, error: 'timeout' }), 5000);
        
        gunInstance.get('shared-links').get(testToken).put(testData, (ack) => {
          if (ack.err) {
            clearTimeout(timeout);
            resolve({ success: false, error: ack.err });
          } else {
            // Try to read it back
            gunInstance.get('shared-links').get(testToken).once((readData) => {
              clearTimeout(timeout);
              if (readData && readData.test) {
                // Clean up test data
                gunInstance.get('shared-links').get(testToken).put(null);
                resolve({ success: true });
              } else {
                resolve({ success: false, error: 'read_failed' });
              }
            });
          }
        });
      });

      // Count links by status
      const statusCounts = { active: 0, expired: 0, exhausted: 0 };
      for (const [token, linkData] of sharedLinks) {
        if (linkData.isExhausted) {
          statusCounts.exhausted++;
        } else if (linkData.expiresAt && linkData.expiresAt < Date.now()) {
          statusCounts.expired++;
        } else {
          statusCounts.active++;
        }
      }

      console.log(`[fileManagerRoutes] Persistence status check completed (Request ID: ${requestId})`);

      res.json({
        success: true,
        status: {
          gunConfig: gunConfig,
          persistenceTest: persistenceTest,
          memoryLinks: sharedLinks.size,
          linksByStatus: statusCounts,
          timestamp: Date.now()
        },
        requestId: requestId
      });

    } catch (error) {
      console.error(`[fileManagerRoutes] Error checking persistence status: ${error.message} (Request ID: ${requestId})`);
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