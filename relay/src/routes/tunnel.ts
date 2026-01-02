import express, { Request, Response, Router } from "express";
import { loggers } from "../utils/logger";
import { tunnelConfig, serverConfig, relayConfig } from "../config/env-config";
import { ClientManager } from "../utils/tunnel";

const router: Router = express.Router();

/**
 * Get the ClientManager instance from app context
 */
const getClientManager = (req: Request): ClientManager | null => {
  return req.app.get("tunnelManager") || null;
};

/**
 * Get the URL scheme based on config
 */
const getScheme = (): string => {
  return tunnelConfig.secure ? "https" : "http";
};

/**
 * GET /api/v1/tunnel/new
 * Create a new tunnel with a random ID
 */
router.get("/new", async (req: Request, res: Response) => {
  try {
    const manager = getClientManager(req);
    
    if (!manager) {
      return res.status(503).json({
        success: false,
        error: "Tunnel service is not enabled",
      });
    }

    const info = await manager.newClient();
    
    // Build the public URL for this tunnel
    const host = req.get("host") || `${serverConfig.host}:${serverConfig.port}`;
    const domain = tunnelConfig.domain || host;
    const url = `${getScheme()}://${info.id}.${domain}`;

    res.json({
      success: true,
      id: info.id,
      port: info.port,
      url: url,
      maxConnCount: info.maxConnCount,
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to create tunnel");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/v1/tunnel/:id
 * Create a new tunnel with a specific ID
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const manager = getClientManager(req);
    
    if (!manager) {
      return res.status(503).json({
        success: false,
        error: "Tunnel service is not enabled",
      });
    }

    const requestedId = req.params.id;

    // Validate subdomain format
    if (!/^(?:[a-z0-9][a-z0-9\-]{2,61}[a-z0-9]|[a-z0-9]{4,63})$/.test(requestedId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid subdomain. Subdomains must be lowercase and between 4 and 63 alphanumeric characters.",
      });
    }

    // Check if ID is already in use
    if (manager.hasClient(requestedId)) {
      return res.status(409).json({
        success: false,
        error: `Tunnel '${requestedId}' is already in use`,
      });
    }

    const info = await manager.newClient(requestedId);
    
    // Build the public URL for this tunnel
    const host = req.get("host") || `${serverConfig.host}:${serverConfig.port}`;
    const domain = tunnelConfig.domain || host;
    const url = `${getScheme()}://${info.id}.${domain}`;

    res.json({
      success: true,
      id: info.id,
      port: info.port,
      url: url,
      maxConnCount: info.maxConnCount,
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to create tunnel with specific ID");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/v1/tunnel/status
 * Get general tunnel server status
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const manager = getClientManager(req);
    
    if (!manager) {
      return res.json({
        success: true,
        enabled: false,
        message: "Tunnel service is not enabled",
      });
    }

    const tunnelIds = manager.getClientIds();
    const tunnelDetails = tunnelIds.map((id) => {
      const client = manager.getClient(id);
      return {
        id,
        stats: client?.stats() || null,
      };
    });

    res.json({
      success: true,
      enabled: true,
      tunnels: manager.stats.tunnels,
      activeTunnels: tunnelDetails,
      memory: process.memoryUsage(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to get tunnel status");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/v1/tunnel/info/:id
 * Get status of a specific tunnel
 */
router.get("/info/:id", async (req: Request, res: Response) => {
  try {
    const manager = getClientManager(req);
    
    if (!manager) {
      return res.status(503).json({
        success: false,
        error: "Tunnel service is not enabled",
      });
    }

    const tunnelId = req.params.id;
    const client = manager.getClient(tunnelId);

    if (!client) {
      return res.status(404).json({
        success: false,
        error: "Tunnel not found",
      });
    }

    res.json({
      success: true,
      id: tunnelId,
      stats: client.stats(),
      timestamp: Date.now(),
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to get tunnel info");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/v1/tunnel/:id
 * Close and remove a specific tunnel
 */
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const manager = getClientManager(req);
    
    if (!manager) {
      return res.status(503).json({
        success: false,
        error: "Tunnel service is not enabled",
      });
    }

    const tunnelId = req.params.id;

    if (!manager.hasClient(tunnelId)) {
      return res.status(404).json({
        success: false,
        error: "Tunnel not found",
      });
    }

    manager.removeClient(tunnelId);

    res.json({
      success: true,
      message: `Tunnel '${tunnelId}' has been closed`,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to remove tunnel");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
