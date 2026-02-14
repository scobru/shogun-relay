/**
 * Authentication Utilities
 *
 * Provides centralized, secure helper functions for authentication checks.
 * Replaces ad-hoc insecure comparisons with timing-safe validation.
 */

import { authConfig } from "../config";
import { hashToken, secureCompare } from "./security";
import { loggers } from "./logger";

// Cache admin password hash (computed once)
let adminPasswordHash: string | null = null;

function getAdminPasswordHash(): string | null {
  if (!adminPasswordHash && authConfig.adminPassword) {
    adminPasswordHash = hashToken(authConfig.adminPassword);
  }
  return adminPasswordHash;
}

/**
 * Validate an admin token using timing-safe comparison
 *
 * @param token The token provided by the user/request
 * @returns true if the token matches the configured admin password
 */
export function validateAdminToken(token: string | undefined | null): boolean {
  if (!token) {
    return false;
  }

  const adminHash = getAdminPasswordHash();
  if (!adminHash) {
    // Only log this once or if really needed to avoid spamming logs on every unauthorized request
    // loggers.server.error("Admin password not configured - validation impossible");
    return false;
  }

  // Hash the incoming token
  const tokenHash = hashToken(token);

  // Use timing-safe comparison
  return secureCompare(tokenHash, adminHash);
}
