/**
 * Drive Authentication Middleware
 *
 * Supports both admin token and API key authentication
 * Uses the generic admin-or-api-key-auth middleware
 */

import { Request, Response, NextFunction } from "express";
import { adminOrApiKeyAuthMiddleware } from "./admin-or-api-key-auth";

/**
 * Drive authentication middleware
 * Accepts either admin token OR valid API key
 */
export async function driveAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Use the generic admin-or-api-key-auth middleware
  await adminOrApiKeyAuthMiddleware(req, res, next);
}
