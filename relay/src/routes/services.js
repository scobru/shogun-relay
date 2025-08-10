import express from 'express';

const router = express.Router();

// Route per riavviare un servizio specifico
router.post("/:service/restart", async (req, res) => {
  try {
    const { service } = req.params;
    console.log(`📋 services/${service}/restart: Requesting service restart`);

    // Verifica autenticazione
    const authHeader = req.headers["authorization"];
    const bearerToken = authHeader && authHeader.split(" ")[1];
    const customToken = req.headers["token"];
    const token = bearerToken || customToken;

    if (token !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
    }

    // Lista dei servizi supportati
    const supportedServices = [
      "ipfs",
      "gun",
      "relay",
      "proxy",
      "gateway"
    ];

    if (!supportedServices.includes(service)) {
      return res.status(400).json({
        success: false,
        error: `Unsupported service: ${service}`,
        supportedServices: supportedServices,
      });
    }

    // Per ora restituiamo un successo mock
    // In futuro potremmo implementare il riavvio reale dei servizi
    console.log(`📋 services/${service}/restart: Service restart initiated`);

    res.json({
      success: true,
      service: service,
      message: `Service ${service} restart initiated`,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(`❌ services/${req.params.service}/restart: Error:`, error);
    res.status(500).json({
      success: false,
      error: "Failed to restart service",
      details: error.message,
    });
  }
});

// Route per ottenere lo stato di tutti i servizi
router.get("/status", async (req, res) => {
  try {
    console.log("📋 services/status: Requesting all services status");

    // Per ora restituiamo lo stato mock dei servizi
    // In futuro potremmo controllare lo stato reale dei servizi
    const servicesStatus = {
      ipfs: {
        status: "running",
        uptime: "2h 15m",
        version: "0.20.0",
        peers: 12
      },
      gun: {
        status: "running",
        uptime: "2h 15m",
        connections: 8,
        nodes: 1250
      },
      relay: {
        status: "running",
        uptime: "2h 15m",
        requests: 1250,
        memory: "45 MB"
      },
      proxy: {
        status: "running",
        uptime: "2h 15m",
        forwarded: 890
      },
      gateway: {
        status: "running",
        uptime: "2h 15m",
        served: 567
      }
    };

    console.log("📋 services/status: Returning services status");

    res.json({
      success: true,
      services: servicesStatus,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ services/status: Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get services status",
      details: error.message,
    });
  }
});

export default router; 