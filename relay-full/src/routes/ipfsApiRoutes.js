import express from "express";
import fs from "fs";
import path from "path";

// Dependencies to be passed in: ipfsManager, fileManager, authenticateRequestMiddleware
export default function setupIpfsApiRoutes(ipfsManager, fileManager, authenticateRequestMiddleware) {
  const router = express.Router();

  // API - IPFS STATUS
  router.get("/status", authenticateRequestMiddleware, async (req, res) => {
    try {
      const status = {
        enabled: ipfsManager.isEnabled(),
        connected: ipfsManager.isConnected(),
        gateway: ipfsManager.getDefaultGateway(),
        nodeType: ipfsManager.getNodeType(),
        defaultGateway: ipfsManager.getDefaultGateway()
      };
      
      res.json({
        success: true,
        status
      });
    } catch (error) {
      console.error(`[ipfsApiRoutes] Error getting IPFS status: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // API - IPFS HEALTH CHECK AND CONNECTION TEST
  router.get("/health-check", authenticateRequestMiddleware, async (req, res) => {
    try {
      // First check if IPFS is enabled
      if (!ipfsManager.isEnabled()) {
        return res.json({
          success: false, 
          enabled: false,
          message: "IPFS is not enabled in the configuration"
        });
      }
      
      // Test the connection
      console.log("[IPFS API] Running IPFS connection test");
      const testResult = await ipfsManager.testConnection();
      
      return res.json({
        success: testResult.success,
        enabled: true,
        health: testResult,
        message: testResult.success 
          ? "IPFS connection test successful" 
          : "IPFS connection test failed"
      });
    } catch (error) {
      console.error("[IPFS API] Health check error:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error testing IPFS connection"
      });
    }
  });
  
  // API - IPFS REINITIALIZE CONNECTION
  router.post("/reinitialize", authenticateRequestMiddleware, async (req, res) => {
    try {
      console.log("[IPFS API] Attempting to reinitialize IPFS connection");
      
      // Attempt to reinitialize the connection
      const success = await ipfsManager.reinitialize();
      
      // Update FileManager to use the reinitialized IPFS manager
      if (success) {
        fileManager.setIpfsManager(ipfsManager);
      }
      
      return res.json({
        success: success,
        status: {
          enabled: ipfsManager.isEnabled(),
          connected: ipfsManager.isConnected(),
          gateway: ipfsManager.getDefaultGateway(),
          nodeType: ipfsManager.getNodeType()
        },
        message: success 
          ? "IPFS connection reinitialized successfully" 
          : "Failed to reinitialize IPFS connection"
      });
    } catch (error) {
      console.error("[IPFS API] Reinitialization error:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error reinitializing IPFS connection"
      });
    }
  });

  // API - IPFS TOGGLE
  router.post("/toggle", authenticateRequestMiddleware, async (req, res) => {
    try {
      // Get current state
      const currentState = ipfsManager.isEnabled();
      
      // Toggle IPFS
      ipfsManager.updateConfig({
        enabled: !currentState
      });
      
      // If enabling, initialize IPFS
      if (!currentState) {
        ipfsManager.initialize();
      }
      
      // Update FileManager's IPFS manager instance
      fileManager.setIpfsManager(ipfsManager);
      
      // Get new state
      const newState = ipfsManager.isEnabled();
      
      res.json({
        success: true,
        status: {
          enabled: newState,
          connected: ipfsManager.isConnected(),
          gateway: ipfsManager.getDefaultGateway(),
          nodeType: ipfsManager.getNodeType()
        },
        message: newState ? "IPFS enabled successfully" : "IPFS disabled successfully"
      });
    } catch (error) {
      console.error(`[ipfsApiRoutes] Error toggling IPFS: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
  
  // API - IPFS CONFIG (modificato per maggiore chiarezza)
  router.post("/update-config", authenticateRequestMiddleware, async (req, res) => {
    try {
      if (!req.body) {
        return res.status(400).json({
          success: false,
          error: "No configuration data provided",
          message: "Missing configuration data"
        });
      }
      
      ipfsManager.updateConfig(req.body);
      
      // Ensure FileManager's Multer is reconfigured if IPFS settings change
      fileManager.setIpfsManager(ipfsManager);

      return res.json({
        success: true,
        config: ipfsManager.getConfig(),
        message: "IPFS configuration updated successfully"
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error updating IPFS configuration"
      });
    }
  });

  // Support legacy route for backward compatibility
  router.post("/config", authenticateRequestMiddleware, async (req, res) => {
    try {
      if (!req.body) {
        return res.status(400).json({
          success: false,
          error: "No configuration data provided",
          message: "Missing configuration data"
        });
      }
      
      ipfsManager.updateConfig(req.body);
      
      // Ensure FileManager's Multer is reconfigured if IPFS settings change
      fileManager.setIpfsManager(ipfsManager);

      return res.json({
        success: true,
        config: ipfsManager.getConfig(),
        message: "IPFS configuration updated successfully (using legacy endpoint)"
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error updating IPFS configuration"
      });
    }
  });

  // API - IPFS CHECK PIN STATUS
  router.get("/pin-status/:hash", authenticateRequestMiddleware, async (req, res) => {
    try {
      const hash = req.params.hash;
      if (!hash) {
        return res.status(400).json({ 
          success: false, 
          error: "IPFS hash missing",
          message: "Missing required parameter"
        });
      }
      
      if (!ipfsManager.isEnabled()) {
        return res.status(400).json({ 
          success: false, 
          error: "IPFS not active",
          message: "IPFS service not enabled"
        });
      }
      
      const isPinned = await ipfsManager.isPinned(hash);
      return res.json({ 
        success: true, 
        isPinned, 
        hash,
        message: `File is ${isPinned ? "pinned" : "not pinned"}`
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error checking pin status"
      });
    }
  });

  // API - IPFS PIN FILE
  router.post("/pin", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { hash } = req.body;
      if (!hash) {
        return res.status(400).json({ 
          success: false, 
          error: "IPFS hash missing",
          message: "Missing required parameter" 
        });
      }
      
      if (!ipfsManager.isEnabled()) {
        return res.status(400).json({ 
          success: false, 
          error: "IPFS not active",
          message: "IPFS service not enabled"
        });
      }
      
      const isPinned = await ipfsManager.isPinned(hash);
      if (isPinned) {
        return res.json({ 
          success: true, 
          message: "File already pinned", 
          hash, 
          isPinned: true 
        });
      }
      
      const result = await ipfsManager.pin(hash);
      return res.json({ 
        success: true, 
        message: "File pinned successfully", 
        hash, 
        isPinned: true, 
        result 
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error pinning file"
      });
    }
  });

  // API - IPFS UNPIN FILE
  router.post("/unpin", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { hash } = req.body;
      if (!hash) {
        return res.status(400).json({ 
          success: false, 
          error: "IPFS hash missing",
          message: "Missing required parameter" 
        });
      }
      
      if (!ipfsManager.isEnabled()) {
        return res.status(400).json({ 
          success: false, 
          error: "IPFS not active",
          message: "IPFS service not enabled"
        });
      }
      
      const isPinned = await ipfsManager.isPinned(hash);
      if (!isPinned) {
        return res.json({ 
          success: true, 
          message: "File already unpinned", 
          hash, 
          isPinned: false 
        });
      }
      
      const result = await ipfsManager.unpin(hash);
      return res.json({ 
        success: true, 
        message: "File unpinned successfully", 
        hash, 
        isPinned: false, 
        result 
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error unpinning file"
      });
    }
  });

  // Get IPFS metadata for debugging
  router.get("/metadata", authenticateRequestMiddleware, async (req, res) => {
    try {
      const uploadsDir = ipfsManager.getUploadsDir() || './uploads';
      const metadataPath = path.join(uploadsDir, 'ipfs-metadata.json');
      
      if (fs.existsSync(metadataPath)) {
        const content = fs.readFileSync(metadataPath, 'utf8');
        const metadata = JSON.parse(content);
        
        res.json({
          success: true,
          metadata,
          count: Object.keys(metadata).length
        });
      } else {
        res.json({
          success: true,
          metadata: {},
          count: 0,
          message: "IPFS metadata file does not exist"
        });
      }
    } catch (error) {
      console.error(`[ipfsApiRoutes] Error getting IPFS metadata: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // API - UPLOAD EXISTING FILE TO IPFS
  router.post("/upload-existing", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { fileId, fileName } = req.body;
      
      if (!fileId) {
        return res.status(400).json({
          success: false,
          error: "File ID is required",
          message: "Missing required parameter"
        });
      }
      
      if (!ipfsManager.isEnabled()) {
        return res.status(400).json({
          success: false,
          error: "IPFS not active",
          message: "IPFS service not enabled"
        });
      }
      
      console.log(`[IPFS API] Uploading existing file to IPFS: ${fileId}`);
      
      // Get file from FileManager first
      const fileData = await fileManager.getFileById(fileId);
      if (!fileData) {
        return res.status(404).json({
          success: false,
          error: "File not found",
          message: `File with ID ${fileId} not found`
        });
      }
      
      // Check if file already has IPFS hash
      if (fileData.ipfsHash) {
        return res.json({
          success: true,
          message: "File already exists on IPFS",
          ipfsHash: fileData.ipfsHash,
          ipfsUrl: fileData.ipfsUrl,
          alreadyExists: true
        });
      }
      
      // Find the local file path
      let localFilePath = fileData.localPath;
      
      // If localPath is not available, try to construct it
      if (!localFilePath || !fs.existsSync(localFilePath)) {
        const uploadsDir = fileManager.config?.storageDir || './uploads';
        
        // Try different filename patterns
        const possiblePaths = [
          path.join(uploadsDir, fileData.name),
          path.join(uploadsDir, fileData.originalName),
          path.join(uploadsDir, `${fileData.timestamp}-${fileData.originalName}`),
          path.join(uploadsDir, `${fileData.timestamp}-${fileData.name}`)
        ];
        
        // Try to find the file in filesystem
        const files = fs.readdirSync(uploadsDir);
        for (const file of files) {
          if (file.includes(fileData.timestamp?.toString()) || 
              file.includes(fileData.name) || 
              file.includes(fileData.originalName)) {
            localFilePath = path.join(uploadsDir, file);
            break;
          }
        }
        
        // If still not found, try the possible paths
        if (!localFilePath || !fs.existsSync(localFilePath)) {
          for (const possiblePath of possiblePaths) {
            if (fs.existsSync(possiblePath)) {
              localFilePath = possiblePath;
              break;
            }
          }
        }
      }
      
      if (!localFilePath || !fs.existsSync(localFilePath)) {
        return res.status(404).json({
          success: false,
          error: "Local file not found",
          message: `Local file for ${fileId} not found in filesystem`
        });
      }
      
      console.log(`[IPFS API] Found local file at: ${localFilePath}`);
      
      // Upload to IPFS
      const result = await ipfsManager.uploadFile(localFilePath, {
        name: fileName || fileData.originalName || fileData.name,
        metadata: {
          size: fileData.size,
          type: fileData.mimetype || fileData.mimeType,
          originalFileId: fileId,
          uploadedAt: Date.now()
        }
      });
      
      if (result && result.id) {
        const ipfsHash = result.id;
        const ipfsUrl = ipfsManager.getGatewayUrl(ipfsHash);
        
        // Update file metadata in FileManager
        const updatedFileData = {
          ...fileData,
          ipfsHash: ipfsHash,
          ipfsUrl: ipfsUrl
        };
        
        // Save updated metadata
        await fileManager.saveFileMetadata(updatedFileData);
        
        // Save IPFS metadata
        fileManager._saveIpfsMetadata(fileId, ipfsHash);
        
        console.log(`[IPFS API] File uploaded to IPFS successfully: ${ipfsHash}`);
        
        return res.json({
          success: true,
          message: "File uploaded to IPFS successfully",
          fileId: fileId,
          ipfsHash: ipfsHash,
          ipfsUrl: ipfsUrl,
          result: result
        });
      } else {
        throw new Error("IPFS upload completed but no hash received");
      }
      
    } catch (error) {
      console.error(`[IPFS API] Error uploading existing file to IPFS: ${error.message}`);
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error uploading file to IPFS"
      });
    }
  });

  return router;
} 