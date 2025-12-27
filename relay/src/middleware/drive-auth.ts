/**
 * Drive Authentication Middleware
 * 
 * Supports both admin token and API key authentication
 */

import { Request, Response, NextFunction } from "express";
import { secureCompare, hashToken } from "../utils/security";
import { authConfig } from "../config";
import { DriveApiKeysManager } from "../utils/drive-api-keys";
import { loggers } from "../utils/logger";

const log = loggers.server || console;

// Global API keys manager instance (initialized in routes)
let apiKeysManager: DriveApiKeysManager | null = null;

/**
 * Initialize the API keys manager
 */
export function initDriveApiKeysManager(gun: any, relayPub: string, relayUser: any): void {
  apiKeysManager = new DriveApiKeysManager(gun, relayPub, relayUser);
  log.info({ relayPub }, "Drive API Keys Manager initialized");
}

/**
 * Get the API keys manager instance
 */
export function getDriveApiKeysManager(): DriveApiKeysManager | null {
  return apiKeysManager;
}

// Cache admin password hash (computed once)
let adminPasswordHash: string | null = null;

function getAdminPasswordHash(): string | null {
  if (!adminPasswordHash && authConfig.adminPassword) {
    adminPasswordHash = hashToken(authConfig.adminPassword);
  }
  return adminPasswordHash;
}

/**
 * Drive authentication middleware
 * Accepts either admin token OR valid API key
 */
export async function driveAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers["authorization"];
  const bearerToken = authHeader && authHeader.split(" ")[1];

  // Check custom token header (for compatibility)
  const customToken = req.headers["token"] as string | undefined;

  // Accept either format
  const token = bearerToken || customToken;

  if (!token) {
    log.warn(
      {
        ip: req.ip || req.connection.remoteAddress,
        path: req.path,
      },
      "Drive auth failed - no token"
    );
    res.status(401).json({
      success: false,
      error: "Unauthorized - Token or API key required",
    });
    return;
  }

  // First, try admin token authentication
  const tokenHash = hashToken(token);
  const adminHash = getAdminPasswordHash();

  if (adminHash && secureCompare(tokenHash, adminHash)) {
    log.debug({ ip: req.ip, path: req.path }, "Drive auth: Admin token accepted");
    return next();
  }

  // If admin token fails, try API key authentication
  if (apiKeysManager && token.startsWith("shogun-drive-")) {
    try {
      const keyData = await apiKeysManager.validateApiKey(token);
      if (keyData) {
        log.debug(
          {
            ip: req.ip || req.connection.remoteAddress,
            path: req.path,
            keyId: keyData.keyId,
          },
          "Drive auth: API key accepted"
        );
        // Attach key info to request for logging/auditing
        (req as any).driveApiKey = keyData;
        return next();
      }
    } catch (error: any) {
      log.error({ err: error }, "Error validating API key");
    }
  }

  // Both authentication methods failed
  log.warn(
    {
      ip: req.ip || req.connection.remoteAddress,
      path: req.path,
      hasToken: !!token,
    },
    "Drive auth failed - invalid token or API key"
  );
  res.status(401).json({
    success: false,
    error: "Unauthorized - Invalid token or API key",
  });
}

