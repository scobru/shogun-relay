import express from "express";

/**
 * Setup Gateway Routes per esporre il relay tramite HTTPS
 * @param {Object} config - Configurazione con PORT, HOST, etc.
 * @param {Function} serverLogger - Logger del server
 * @returns {Router} Express router con le route gateway
 */
export default function setupGatewayRoutes(config, serverLogger) {
  const router = express.Router();
  const { PORT, HOST } = config;

  // Gateway endpoint principale - espone il relay tramite HTTPS
  router.get("/ipfs/:hash", async (req, res) => {
    try {
      const ipfsHash = req.params.hash;
      serverLogger.info(`[Gateway] IPFS request received for hash: ${ipfsHash}`);
      
      // Utilizziamo fetch per ottenere il contenuto direttamente
      const localIpfsGateway = `http://localhost:8080/ipfs/${ipfsHash}`;
      
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
      });
      res.status(500).json({
        success: false,
        error: "IPFS Gateway error: " + error.message,
      });
    }
  });

  return router;
} 