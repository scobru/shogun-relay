/**
 * API Keys Management Routes
 * 
 * Generic API key management endpoints, usable across all services
 */

import express, { Request, Response } from "express";
import { loggers } from "../utils/logger";
import { adminAuthMiddleware } from "../middleware/admin-auth";
import { getApiKeysManager } from "../middleware/api-keys-auth";

const router = express.Router();

/**
 * GET /api/v1/api-keys
 * List all API keys
 */
router.get("/", adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const manager = getApiKeysManager();
    if (!manager) {
      return res.status(503).json({
        success: false,
        error: "API keys manager not initialized",
      });
    }

    const keys = await manager.listApiKeys();
    res.json({
      success: true,
      keys,
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to list API keys");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * POST /api/v1/api-keys
 * Create a new API key
 */
router.post("/", adminAuthMiddleware, express.json(), async (req: Request, res: Response) => {
  try {
    const { name, expiresInDays } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Key name is required",
      });
    }

    const manager = getApiKeysManager();
    if (!manager) {
      return res.status(503).json({
        success: false,
        error: "API keys manager not initialized",
      });
    }

    const expiresDays =
      expiresInDays && typeof expiresInDays === "number" && expiresInDays > 0
        ? expiresInDays
        : undefined;

    const keyData = await manager.createApiKey(name.trim(), expiresDays);

    res.status(201).json({
      success: true,
      keyId: keyData.keyId,
      token: keyData.token, // Only shown once!
      name: keyData.name,
      createdAt: keyData.createdAt,
      expiresAt: keyData.expiresAt,
      message: "Save this token securely. It will not be shown again.",
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to create API key");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

/**
 * DELETE /api/v1/api-keys/:keyId
 * Revoke an API key
 */
router.delete("/:keyId", adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { keyId } = req.params;

    if (!keyId) {
      return res.status(400).json({
        success: false,
        error: "Key ID is required",
      });
    }

    const manager = getApiKeysManager();
    if (!manager) {
      return res.status(503).json({
        success: false,
        error: "API keys manager not initialized",
      });
    }

    const revoked = await manager.revokeApiKey(keyId);
    if (revoked) {
      res.json({
        success: true,
        message: "API key revoked successfully",
      });
    } else {
      res.status(404).json({
        success: false,
        error: "API key not found",
      });
    }
  } catch (error: any) {
    loggers.server.error({ err: error }, "Failed to revoke API key");
    res.status(500).json({
      success: false,
      error: error.message || "Internal Server Error",
    });
  }
});

export default router;

