import express from "express";

/**
 * Setup Gateway Routes per esporre il relay tramite HTTPS
 * @param {Object} config - Configurazione con PORT, HOST, etc.
 * @param {Function} serverLogger - Logger del server
 * @returns {Router} Express router con le route gateway
 */
export default function setupGatewayRoutes(authenticateRequestMiddleware, serverLogger) {
  const router = express.Router();

  // OPZIONE 1: Gateway con autenticazione rigorosa (attuale)
  // Custom authentication middleware for gateway that's more strict
  const strictGatewayAuth = (req, res, next) => {
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.substring(7)
      : req.headers.authorization || req.query.token || req.body?.token || req.headers.token;

    if (!token) {
      serverLogger.warn(`[Gateway] Unauthorized access attempt to IPFS hash: ${req.params.hash} - No token provided`);
      return res.status(401).json({
        success: false,
        error: "Authentication required for IPFS gateway access",
        message: "Please provide a valid authorization token",
      });
    }

    // Call the original middleware
    return authenticateRequestMiddleware(req, res, next);
  };

  // Gateway endpoint principale - espone il relay tramite HTTPS CON AUTENTICAZIONE
  router.all("/ipfs/:hash", strictGatewayAuth, async (req, res) => {
    try {
      const ipfsHash = req.params.hash;
      serverLogger.info(`[Gateway] Authenticated IPFS request for hash: ${ipfsHash}`);
      
      // Utilizziamo fetch per ottenere il contenuto direttamente
      const localIpfsGateway = `http://127.0.0.1:8080/ipfs/${ipfsHash}`;
      
      const response = await fetch(localIpfsGateway);
      
      if (!response.ok) {
        throw new Error(`IPFS gateway returned status ${response.status}`);
      }
      
      // Otteniamo il content-type dalla risposta
      const contentType = response.headers.get('content-type');
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      
      // Inoltriamo tutti gli headers rilevanti
      const headers = response.headers;
      headers.forEach((value, key) => {
        // Escludiamo gli headers che Express gestisce autonomamente
        if (!['connection', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      });
      
      // Stream della risposta
      const data = await response.arrayBuffer();
      return res.send(Buffer.from(data));
      
    } catch (error) {
      serverLogger.error("[Gateway] Error in IPFS gateway endpoint:", {
        error: error.message,
        hash: req.params.hash,
        userAgent: req.headers['user-agent'],
        ip: req.ip
      });
      res.status(500).json({
        success: false,
        error: "IPFS Gateway error: " + error.message,
      });
    }
  });

  // OPZIONE 2: Gateway pubblico SENZA autenticazione (scommentare se preferisci)
  /*
  router.all("/public/ipfs/:hash", async (req, res) => {
    try {
      const ipfsHash = req.params.hash;
      serverLogger.info(`[Gateway] Public IPFS request for hash: ${ipfsHash}`);
      
      // Utilizziamo fetch per ottenere il contenuto direttamente
      const localIpfsGateway = `http://127.0.0.1:8080/ipfs/${ipfsHash}`;
      
      const response = await fetch(localIpfsGateway);
      
      if (!response.ok) {
        throw new Error(`IPFS gateway returned status ${response.status}`);
      }
      
      // Otteniamo il content-type dalla risposta
      const contentType = response.headers.get('content-type');
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      
      // Inoltriamo tutti gli headers rilevanti
      const headers = response.headers;
      headers.forEach((value, key) => {
        // Escludiamo gli headers che Express gestisce autonomamente
        if (!['connection', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) {
          res.setHeader(key, value);
        }
      });
      
      // Stream della risposta
      const data = await response.arrayBuffer();
      return res.send(Buffer.from(data));
      
    } catch (error) {
      serverLogger.error("[Gateway] Error in public IPFS gateway:", {
        error: error.message,
        hash: req.params.hash,
      });
      res.status(500).json({
        success: false,
        error: "IPFS Gateway error: " + error.message,
      });
    }
  });
  */

  return router;
} 