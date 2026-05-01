import express, { Router, Request, Response } from "express";
import { getGunNode, GUN_PATHS } from "../utils/gun-paths";
import { tokenAuthMiddleware } from "../middleware/token-auth";
import { loggers } from "../utils/logger";
import { kprs } from "../utils/zen-network";

const router: Router = express.Router();

/**
 * GET /api/v1/network/relays
 * Returns a list of discovered relays from the network (Gun shogun/network/relays)
 * supplemented with locally discovered ZEN peers.
 */
router.get("/relays", tokenAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const gun = req.app.get("zenInstance") || req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({ success: false, error: "Storage engine not ready" });
    }

    const discoveredRelays: any[] = [];
    
    // Add locally discovered ZEN peers from the kprs Set
    kprs.forEach(peerUrl => {
      try {
        const url = new URL(peerUrl);
        discoveredRelays.push({
          host: url.hostname,
          endpoint: peerUrl,
          lastSeen: Date.now(),
          uptime: 0,
          connections: { active: 0 },
          source: 'zen-discovery'
        });
      } catch (e) {
        discoveredRelays.push({
          host: peerUrl,
          endpoint: peerUrl,
          lastSeen: Date.now(),
          uptime: 0,
          connections: { active: 0 },
          source: 'zen-discovery'
        });
      }
    });

    // Fetch relays from the Gun global discovery path
    const relaysNode = getGunNode(gun, GUN_PATHS.RELAYS);
    
    // Use a timeout for Gun once() to avoid hanging if the network is slow
    const gunData = await new Promise<any>((resolve) => {
      const timer = setTimeout(() => resolve(null), 5000);
      relaysNode.once((data: any) => {
        clearTimeout(timer);
        resolve(data);
      });
    });

    if (gunData) {
      Object.keys(gunData).forEach(key => {
        if (key === '_' || key === '#') return;
        const item = gunData[key];
        
        // Prevent duplicates if already in discoveredRelays
        const exists = discoveredRelays.some(r => r.host === key || r.endpoint === key);
        if (exists) return;

        if (item && typeof item === 'object') {
          discoveredRelays.push({
            host: item.host || key,
            endpoint: item.endpoint || item.url || null,
            lastSeen: item.lastSeen || Date.now(),
            uptime: item.uptime || 0,
            connections: item.connections || { active: 0 },
            source: 'gun-network'
          });
        } else if (typeof item === 'string') {
          discoveredRelays.push({
            host: key,
            endpoint: item,
            lastSeen: Date.now(),
            uptime: 0,
            connections: { active: 0 },
            source: 'gun-network'
          });
        }
      });
    }

    res.json({
      success: true,
      relays: discoveredRelays,
      count: discoveredRelays.length,
      timestamp: Date.now()
    });

  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Error fetching network relays");
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
