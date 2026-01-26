/**
 * Users Routes - List observed users on the relay
 */

import express, { Request, Response, Router } from "express";
import { loggers } from "../utils/logger";
import { GUN_PATHS, getGunNode } from "../utils/gun-paths";

const router: Router = express.Router();

// Helper to get gun instance safely
const getGun = (req: Request) => {
  return req.app.get("gunInstance");
};

/**
 * GET /api/v1/users
 * Get list of users observed on this relay
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const gun = getGun(req);
    if (!gun) {
      return res.status(503).json({ 
        success: false, 
        error: "GunDB not initialized" 
      });
    }

    // Read users from GunDB path
    const usersNode = getGunNode(gun, GUN_PATHS.USERS);
    
    // Collect users from GunDB
    const users: any[] = [];
    
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        resolve();
      }, 5000); // 5 second timeout

      usersNode.map().once((data: any, key: string) => {
        if (!data || typeof data !== "object") return;
        
        // Extract user data
        const user = {
          pub: key || data.pub || "",
          alias: data.alias || data.username || "",
          lastSeen: data.lastSeen || data.timestamp || Date.now(),
          registeredAt: data.registeredAt || data.createdAt || data.lastSeen || Date.now(),
        };

        // Only add if we have a pub key
        if (user.pub) {
          users.push(user);
        }
      });

      // Give GunDB a moment to collect data
      setTimeout(() => {
        clearTimeout(timeout);
        resolve();
      }, 2000);
    });

    loggers.server.debug({ count: users.length }, "Users list requested");

    res.json({
      success: true,
      users: users.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)), // Sort by lastSeen desc
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Error fetching users");
    res.status(500).json({
      success: false,
      error: "Failed to fetch users",
      message: error.message,
    });
  }
});

export default router;
