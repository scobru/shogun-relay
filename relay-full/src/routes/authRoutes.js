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
   // returdn TODO
   res.json({
    success: true,
    message: "Under Construction"
   })
  });

  return router;
}
