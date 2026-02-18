import express, { Request, Response } from "express";
import { loggers } from "../utils/logger";
import { authRateLimiter } from "../middleware/rate-limit";

const router = express.Router();

// Helper to get gun instance safely
const getGun = (req: Request) => {
  return req.app.get("gunInstance");
};

/**
 * POST /api/v1/auth/register
 * Create a new GunDB user on the Relay
 */
router.post("/register", authRateLimiter, async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password are required",
      });
    }

    const gun = getGun(req);
    if (!gun) {
      return res.status(503).json({ success: false, error: "GunDB not initialized" });
    }

    // Attempt to create user
    // Note: Gun.user().create() is asynchronous but uses callbacks
    const user = gun.user();

    await new Promise((resolve, reject) => {
      user.create(username, password, (ack: any) => {
        if (ack.err) {
          reject(new Error(ack.err));
        } else {
          resolve(ack);
        }
      });
    });

    loggers.server.info({ username }, "User registered via Relay API");

    // Authenticate immediately to get the pub key and alias
    await new Promise((resolve, reject) => {
      user.auth(username, password, (ack: any) => {
        if (ack.err) {
          reject(new Error(ack.err));
        } else {
          res.status(201).json({
            success: true,
            username: username,
            pub: ack.pub,
            alias: ack.sea.alias, // Typically same as username
            message: "User registered successfully",
          });
          user.leave(); // Don't keep session open on server
          resolve(ack);
        }
      });
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Registration failed");
    res.status(400).json({
      // 400 because usually it's "User already created!"
      success: false,
      error: error.message || "Registration failed",
    });
  }
});

/**
 * POST /api/v1/auth/login
 * Authenticate a GunDB user on the Relay
 */
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username and password are required",
      });
    }

    const gun = getGun(req);
    if (!gun) {
      return res.status(503).json({ success: false, error: "GunDB not initialized" });
    }

    const user = gun.user();

    await new Promise((resolve, reject) => {
      user.auth(username, password, (ack: any) => {
        if (ack.err) {
          reject(new Error(ack.err));
        } else {
          // Success!
          res.json({
            success: true,
            username: username,
            pub: ack.pub,
            epub: ack.epub,
            alias: ack.sea.alias,
            sea: ack.sea, // Return the SEA pair so client can use it if needed (be careful!)
          });
          user.leave(); // Don't leave session open on server
          resolve(ack);
        }
      });
    });
  } catch (error: any) {
    loggers.server.warn({ err: error }, "Login failed");
    res.status(401).json({
      success: false,
      error: error.message || "Authentication failed",
    });
  }
});

export default router;
