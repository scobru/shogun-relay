import express from "express";

export default function setupAuthRoutes(gunInstance, ensureShogunCoreInstance, AuthenticationManagerInstance) {
  const router = express.Router();

  // ENDPOINT: Check authentication configuration and status
  router.get("/status", async (req, res) => {
    try {
      const basicAuthMiddleware = AuthenticationManagerInstance.getBasicAuthMiddleware();
      
      res.json({
        success: true,
        authentication: {
          basicAuth: {
            enabled: !!basicAuthMiddleware,
            description: basicAuthMiddleware ? "HTTP Basic Auth is enabled" : "HTTP Basic Auth is disabled"
          },
          tokenAuth: {
            enabled: true,
            description: "Token-based authentication is always enabled"
          },
          layers: basicAuthMiddleware ? 
            ["HTTP Basic Auth", "Token Authentication"] : 
            ["Token Authentication only"]
        },
        message: "Authentication status retrieved successfully"
      });
    } catch (error) {
      console.error("Error getting auth status:", error);
      return res.status(500).json({
        success: false,
        error: "Error retrieving authentication status"
      });
    }
  });

  // ENDPOINT: Verifica semplice on-chain (senza JWT, restituisce solo true/false)
  router.post("/verify-onchain", async (req, res) => {
    try {
      const { pubKey } = req.body;
      
      if (!pubKey) {
        return res.status(400).json({
          success: false,
          error: "Public key is required"
        });
      }
      
      // Ottieni la configurazione relay
      const core = ensureShogunCoreInstance();
      if (!core || !core.RELAY_CONFIG || !core.relayVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay services not available"
        });
      }
      
      const RELAY_CONFIG = core.RELAY_CONFIG;
      
      // Verifica che on-chain membership sia abilitata
      if (!RELAY_CONFIG.relay?.onchainMembership) {
        return res.status(503).json({
          success: false,
          error: "On-chain verification not configured"
        });
      }
      
      // Formatta la chiave per la verifica blockchain
      const formattedKey = AuthenticationManagerInstance.formatKeyForBlockchain(pubKey);
      if (!formattedKey) {
        return res.status(400).json({
          success: false,
          error: "Invalid key format"
        });
      }
      
      // Verifica diretta onchain
      try {
        // Usa relayVerifier direttamente
        const isAuthorized = await core.relayVerifier.isPublicKeyAuthorized(
          RELAY_CONFIG.relay.registryAddress,
          formattedKey
        );
        
        // Restituisci solo il risultato booleano
        return res.json({
          success: true,
          isAuthorized: isAuthorized
        });
      } catch (error) {
        console.error("Error during on-chain verification:", error);
        return res.status(500).json({
          success: false,
          error: "On-chain verification failed"
        });
      }
    } catch (error) {
      console.error("Error in verify-onchain endpoint:", error);
      return res.status(500).json({
        success: false,
        error: "Server error"
      });
    }
  });

  return router;
}
