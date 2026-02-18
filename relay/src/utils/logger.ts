/**
 * Centralized Logger for Shogun Relay
 *
 * Uses pino for high-performance structured JSON logging.
 * In development, uses pino-pretty for human-readable output.
 */

import pino from "pino";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Determine environment
const isDev = process.env.NODE_ENV !== "production";
const logLevel = (process.env.LOG_LEVEL as string) || (isDev ? "debug" : "info");

// Create base logger configuration
const loggerOptions: pino.LoggerOptions = {
  level: logLevel,
  // Add timestamp
  timestamp: pino.stdTimeFunctions.isoTime,
  // Format options for production (JSON structured)
  formatters: {
    level: (label) => ({ level: label }),
  },
};

// In development, use pino-pretty for human-readable output
const transport = isDev
  ? {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "HH:MM:ss",
        ignore: "pid,hostname",
        singleLine: false,
      },
    }
  : undefined;

// Create the base logger
const baseLogger = pino(loggerOptions, transport ? pino.transport(transport) : undefined);

/**
 * Create a child logger with a specific module name
 * @param moduleName - Name of the module (e.g., 'relay-user', 'storage-deals')
 */
export function createLogger(moduleName: string): pino.Logger {
  return baseLogger.child({ module: moduleName });
}

/**
 * Default logger for general use
 */
export const logger = baseLogger;

/**
 * Pre-configured loggers for common modules
 */
export const loggers = {
  server: createLogger("server"),
  relayUser: createLogger("relay-user"),
  storagDeals: createLogger("storage-deals"),
  dealSync: createLogger("deal-sync"),
  frozenData: createLogger("frozen-data"),
  reputation: createLogger("reputation"),
  x402: createLogger("x402-merchant"),
  ipfs: createLogger("ipfs-client"),
  registry: createLogger("registry-client"),
  erasure: createLogger("erasure-coding"),
  sqlite: createLogger("sqlite-store"),
  bullet: createLogger("bullet-catcher"),
  services: createLogger("services"),
  uploads: createLogger("uploads"),
  visualGraph: createLogger("visual-graph"),
  bridge: createLogger("bridge-client"),
};

export default logger;
