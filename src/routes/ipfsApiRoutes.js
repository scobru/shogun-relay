import express from "express";

// Dependencies to be passed in: ipfsManager, fileManager, authenticateRequestMiddleware
export default function setupIpfsApiRoutes(ipfsManager, fileManager, authenticateRequestMiddleware) {
  const router = express.Router();

  // API - IPFS STATUS
  router.get("/status", authenticateRequestMiddleware, (req, res) => {
    try {
      res.json({
        success: true,
        config: ipfsManager.getConfig(),
        message: "IPFS status retrieved successfully"
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Error retrieving IPFS status"
      });
    }
  });

  // API - IPFS TOGGLE
  router.post("/toggle", authenticateRequestMiddleware, async (req, res) => {
    try {
      const newState = !ipfsManager.isEnabled();
      ipfsManager.updateConfig({
        enabled: newState
      });

      // Update FileManager's IPFS manager instance and reconfigure multer
      fileManager.setIpfsManager(ipfsManager);

      return res.json({
        success: true,
        config: ipfsManager.getConfig(),
        message: `IPFS ${newState ? "enabled" : "disabled"} successfully`
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error toggling IPFS state"
      });
    }
  });
  
  // API - IPFS CONFIG
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

  return router;
} 