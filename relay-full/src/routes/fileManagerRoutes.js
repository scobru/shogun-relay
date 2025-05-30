import express from "express";
import fs from "fs";

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
    try {
      const files = await fileManager.getAllFiles();
      
      // Always return a success response, even if no files found
      res.json({
        success: true,
        files: files,
        count: files.length,
      });
    } catch (error) {
      console.error(`[fileManagerRoutes] Error getting all files: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Search files - MOVED BEFORE /:id route to ensure it matches correctly
  router.get("/search", authenticateRequest, async (req, res) => {
    try {
      const { name, mimetype, minSize, maxSize } = req.query;
      
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
      
      res.json({
        success: true,
        results,
        count: results.length,
      });
    } catch (error) {
      console.error(`[fileManagerRoutes] Error searching files: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Get file by ID
  router.get("/:id", authenticateRequest, async (req, res) => {
    try {
      const fileId = req.params.id;
      const file = await fileManager.getFileById(fileId);
      
      if (!file) {
        return res.status(404).json({
          success: false,
          error: `File not found: ${fileId}`,
        });
      }
      
      res.json({
        success: true,
        file,
      });
    } catch (error) {
      console.error(`[fileManagerRoutes] Error getting file: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Delete file
  router.delete("/:id", authenticateRequest, async (req, res) => {
    try {
      const fileId = req.params.id;
      console.log(`[fileManagerRoutes] Delete request for file ID: ${fileId}`);
      
      const result = await fileManager.deleteFile(fileId);
      
      res.json({
        success: true,
        message: `File ${fileId} deleted successfully`,
        result,
      });
    } catch (error) {
      console.error(`[fileManagerRoutes] Error deleting file: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  return router;
};

export default setupFileManagerRoutes; 