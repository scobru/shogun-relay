import express from "express";
import fs from "fs";

// Track recent requests to prevent duplicates
const recentRequests = new Map();
const requestTimeout = 5000; // 5 seconds

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