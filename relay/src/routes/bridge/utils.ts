import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { loggers } from "../../utils/logger";
import { createBridgeClient, type BridgeClient } from "../../utils/bridge-client";
import { getRelayKeyPair } from "../../utils/relay-user";
import { relayConfig, bridgeConfig } from "../../config/env-config";

export const log = loggers.server || console;

// Helper to get relay host identifier
export function getRelayHost(req: Request): string {
  const host = (relayConfig as any).endpoint || req.headers.host || "localhost";
  if (host.includes("://")) {
    return new URL(host).hostname;
  }
  return host;
}

// Helper to get signing keypair for reputation tracking
export function getSigningKeyPair(): any {
  // Use the relay's SEA keypair if available
  // This would typically come from the relay user instance
  return getRelayKeyPair() || null;
}

// Rate limiting for bridge endpoints
export const bridgeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 20, // 20 requests per minute per IP
  message: {
    success: false,
    error: "Too many requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Stricter rate limiting for sensitive endpoints (withdraw, transfer)
export const strictLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // 5 requests per 5 minutes per IP
  message: {
    success: false,
    error: "Too many requests, please try again later",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Bridge client (lazy initialization)
let bridgeClient: BridgeClient | null = null;

// Initialize bridge client from environment variables
export function getBridgeClient(): BridgeClient {
  if (bridgeClient) return bridgeClient;

  // Use configuration from config/env-config.ts
  const rpcUrl = bridgeConfig.getRpcUrl();
  const chainId = bridgeConfig.chainId;
  const privateKey = bridgeConfig.sequencerPrivateKey;

  if (!rpcUrl) {
    throw new Error("Bridge configuration missing (RPC URL)");
  }

  log.info({ chainId, hasPrivateKey: !!privateKey }, "Initializing Bridge Client");

  bridgeClient = createBridgeClient({
    rpcUrl,
    chainId,
    privateKey,
  });

  return bridgeClient;
}
