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

  return router;
} 