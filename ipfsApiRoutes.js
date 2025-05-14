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
      });
    } catch (error) {
      console.error("Errore nell'ottenere lo stato IPFS:", error);
      res.status(500).json({
        success: false,
        error: error.message,
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
      // This is important because ipfsManager instance inside fileManager might be stale.
      fileManager.setIpfsManager(ipfsManager);

      console.log(`IPFS ${newState ? "abilitato" : "disabilitato"}`);

      return res.json({
        success: true,
        config: ipfsManager.getConfig(),
      });
    } catch (error) {
      console.error("Errore toggle IPFS:", error);
      return res.status(500).json({
        success: false,
        error: `Errore durante il toggle IPFS: ${error.message}`,
      });
    }
  });
  
  // API - IPFS CONFIG
  router.post("/config", authenticateRequestMiddleware, async (req, res) => {
    try {
      console.log("Richiesta configurazione IPFS:", req.body);
      if (!req.body) {
        return res.status(400).json({
          success: false,
          error: "Nessun dato di configurazione fornito",
        });
      }
      ipfsManager.updateConfig(req.body);
      // Ensure FileManager's Multer is reconfigured if IPFS settings change
      fileManager.setIpfsManager(ipfsManager);

      return res.json({
        success: true,
        config: ipfsManager.getConfig(),
      });
    } catch (error) {
      console.error("Errore configurazione IPFS:", error);
      return res.status(500).json({
        success: false,
        error: `Errore durante la configurazione IPFS: ${error.message}`,
      });
    }
  });

  // API - IPFS CHECK PIN STATUS
  router.get("/pin-status/:hash", authenticateRequestMiddleware, async (req, res) => {
    try {
      const hash = req.params.hash;
      if (!hash) {
        return res.status(400).json({ success: false, error: "IPFS hash missing" });
      }
      if (!ipfsManager.isEnabled()) {
        return res.status(400).json({ success: false, error: "IPFS not active" });
      }
      console.log(`Verifica stato pin per hash IPFS: ${hash}`);
      const isPinned = await ipfsManager.isPinned(hash);
      return res.json({ success: true, isPinned, hash });
    } catch (error) {
      console.error("Errore verifica pin IPFS:", error);
      return res.status(500).json({
        success: false,
        error: `Errore durante la verifica del pin: ${error.message}`,
      });
    }
  });

  // API - IPFS PIN FILE
  router.post("/pin", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { hash } = req.body;
      if (!hash) {
        return res.status(400).json({ success: false, error: "IPFS hash missing" });
      }
      if (!ipfsManager.isEnabled()) {
        return res.status(400).json({ success: false, error: "IPFS not active" });
      }
      console.log(`Richiesta pin per hash IPFS: ${hash}`);
      const isPinned = await ipfsManager.isPinned(hash);
      if (isPinned) {
        return res.json({ success: true, message: "File già pinnato", hash, isPinned: true });
      }
      const result = await ipfsManager.pin(hash);
      return res.json({ success: true, message: "File pinnato con successo", hash, isPinned: true, result });
    } catch (error) {
      console.error("Errore pin IPFS:", error);
      return res.status(500).json({
        success: false,
        error: `Errore durante il pin: ${error.message}`,
      });
    }
  });

  // API - IPFS UNPIN FILE
  router.post("/unpin", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { hash } = req.body;
      if (!hash) {
        return res.status(400).json({ success: false, error: "IPFS hash missing" });
      }
      if (!ipfsManager.isEnabled()) {
        return res.status(400).json({ success: false, error: "IPFS not active" });
      }
      console.log(`Richiesta unpin per hash IPFS: ${hash}`);
      const isPinned = await ipfsManager.isPinned(hash);
      if (!isPinned) {
        return res.json({ success: true, message: "File già non pinnato", hash, isPinned: false });
      }
      const result = await ipfsManager.unpin(hash);
      return res.json({ success: true, message: "File unpinnato con successo", hash, isPinned: false, result });
    } catch (error) {
      console.error("Errore unpin IPFS:", error);
      return res.status(500).json({
        success: false,
        error: `Errore durante l'unpin: ${error.message}`,
      });
    }
  });

  return router;
} 