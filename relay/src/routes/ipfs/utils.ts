import { ipfsConfig } from "../../config";
import { loggers } from "../../utils/logger";
import type { IpfsRequestOptions } from "./types";

// IPFS Configuration
export const IPFS_API_URL: string = ipfsConfig.apiUrl;
export const IPFS_API_TOKEN: string | undefined = ipfsConfig.apiToken;
export const IPFS_GATEWAY_URL: string = ipfsConfig.gatewayUrl;

/**
 * Get the IPFS JWT token if configured
 */
export function getIpfsJwtToken(): string | null {
  if (IPFS_API_TOKEN) {
    return IPFS_API_TOKEN;
  }
  return null;
}

/**
 * Get the IPFS auth header for API requests
 */
export function getIpfsAuthHeader(): string | null {
  const token = getIpfsJwtToken();
  if (token) {
    return `Bearer ${token}`;
  }
  return null;
}

/**
 * Create standardized IPFS request options
 */
export function createIpfsRequestOptions(
  path: string,
  method: string = "POST"
): IpfsRequestOptions {
  const options: IpfsRequestOptions = {
    hostname: "127.0.0.1",
    port: 5001,
    path,
    method,
    headers: {
      "Content-Length": "0",
    },
  };

  if (IPFS_API_TOKEN) {
    options.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
  }

  return options;
}

/**
 * Verify wallet signature for user authentication
 */
export async function verifyWalletSignature(
  addr: string,
  sig: string,
  timestamp?: number
): Promise<boolean> {
  if (!sig || !sig.startsWith("0x") || sig.length < 100) {
    return false;
  }
  try {
    const { ethers } = await import("ethers");
    let expectedMessage = "I Love Shogun";

    // If timestamp is provided, validate it and include in message to prevent replay attacks
    if (timestamp) {
      const now = Date.now();
      const diff = Math.abs(now - timestamp);
      const MAX_DIFF = 5 * 60 * 1000; // 5 minutes

      if (diff > MAX_DIFF) {
        loggers.server.warn({ timestamp, now, diff }, "Wallet signature timestamp expired or invalid");
        return false;
      }

      expectedMessage = `I Love Shogun - ${timestamp}`;
    }

    const recoveredAddress = ethers.verifyMessage(expectedMessage, sig);
    return recoveredAddress.toLowerCase() === addr.toLowerCase();
  } catch (error) {
    loggers.server.warn({ error }, "Wallet signature verification failed");
    return false;
  }
}

/**
 * Detect content type from file extension
 */
export function getContentTypeFromExtension(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const mimeTypes: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    pdf: "application/pdf",
    txt: "text/plain",
    json: "application/json",
    html: "text/html",
    css: "text/css",
    js: "application/javascript",
    xml: "application/xml",
    zip: "application/zip",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

/**
 * Detect content type from file buffer (magic bytes)
 */
export function detectContentType(buffer: Buffer): string {
  const firstBytes = buffer.slice(0, 512);

  // PNG
  if (
    firstBytes[0] === 0x89 &&
    firstBytes[1] === 0x50 &&
    firstBytes[2] === 0x4e &&
    firstBytes[3] === 0x47
  ) {
    return "image/png";
  }
  // JPEG
  if (firstBytes[0] === 0xff && firstBytes[1] === 0xd8) {
    return "image/jpeg";
  }
  // GIF
  if (firstBytes[0] === 0x47 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46) {
    return "image/gif";
  }
  // PDF
  if (
    firstBytes[0] === 0x25 &&
    firstBytes[1] === 0x50 &&
    firstBytes[2] === 0x44 &&
    firstBytes[3] === 0x46
  ) {
    return "application/pdf";
  }
  // HTML
  if (buffer.slice(0, 5).toString() === "<html" || buffer.slice(0, 9).toString() === "<!DOCTYPE") {
    return "text/html";
  }
  // JSON
  try {
    JSON.parse(buffer.toString());
    return "application/json";
  } catch {
    // Not JSON
  }

  return "application/octet-stream";
}
