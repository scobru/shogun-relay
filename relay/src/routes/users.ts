
import express, { Request, Response } from "express";
import { adminAuthMiddleware, getObservedUsers } from "../utils/relay-user";
import { loggers } from "../utils/logger";

const router = express.Router();

/**
 * GET /api/v1/users
 * Get list of observed users
 * Protected by admin authentication
 */
router.get("/", adminAuthMiddleware, async (req: Request, res: Response) => {
    try {
        const users = await getObservedUsers();

        res.json({
            success: true,
            count: users.length,
            users: users.sort((a, b) => b.lastSeen - a.lastSeen) // Sort by most recently seen
        });
    } catch (error: any) {
        loggers.server.error({ err: error }, "Error fetching observed users");
        res.status(500).json({
            success: false,
            error: error.message || "Failed to fetch users"
        });
    }
});

export default router;
