/**
 * API Keys Authentication Middleware
 * 
 * Generic middleware for validating API keys across all services
 */

import { Request, Response, NextFunction } from "express";
import { ApiKeysManager } from "../utils/api-keys";
import { loggers } from "../utils/logger";

const log = loggers.server || console;

// Global API keys manager instance (initialized in routes)
let apiKeysManager: ApiKeysManager | null = null;

/**
 * Initialize the API keys manager
 */
export function initApiKeysManager(gun: any, relayPub: string, relayUser: any): void {
  apiKeysManager = new ApiKeysManager(gun, relayPub, relayUser);
  log.info({ relayPub }, "API Keys Manager initialized");
}

/**
 * Get the API keys manager instance
 */
export function getApiKeysManager(): ApiKeysManager | null {
  return apiKeysManager;
}

/**
 * Check if a token is a valid API key
 * @param token Token to validate
 * @returns Key data if valid, null otherwise
 */
export async function validateApiKeyToken(token: string): Promise<any | null> {
  if (!apiKeysManager || !token || !token.startsWith("shogun-api-")) {
    return null;
  }

  try {
    const keyData = await apiKeysManager.validateApiKey(token);
    return keyData;
  } catch (error: any) {
    log.error({ err: error }, "Error validating API key");
    return null;
  }
}

