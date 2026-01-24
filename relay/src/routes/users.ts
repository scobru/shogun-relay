import express, { Request, Response } from "express";
import { adminAuthMiddleware } from "../middleware/admin-auth";
import { getObservedUsers, getUserGraphNodes } from "../utils/relay-user";
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

/**
 * GET /api/v1/users/:pub/nodes
 * Get all graph nodes for a specific user
 * Protected by admin authentication
 */
router.get("/:pub/nodes", adminAuthMiddleware, async (req: Request, res: Response) => {
    try {
        const { pub } = req.params;

        if (!pub) {
            return res.status(400).json({
                success: false,
                error: "Public key is required"
            });
        }

        const nodes = await getUserGraphNodes(pub);

        res.json({
            success: true,
            pub,
            nodes
        });
    } catch (error: any) {
        loggers.server.error({ err: error, pub: req.params.pub }, "Error fetching user nodes");
        res.status(500).json({
            success: false,
            error: error.message || "Failed to fetch user nodes"
        });
    }
});

export default router;
