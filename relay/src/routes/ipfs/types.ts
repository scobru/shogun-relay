import type { Request } from "express";

/**
 * Extended Request interface with custom properties for IPFS routes
 */
export interface CustomRequest extends Request {
  authType?: "admin" | "user";
  userAddress?: string;
  isDealUpload?: boolean;
  subscription?: {
    active: boolean;
    tier?: string;
    storageMB?: number;
    storageUsedMB?: number;
    storageRemainingMB?: number;
    reason?: string;
  };
  verifiedStorage?: {
    allowed: boolean;
    reason?: string;
    storageUsedMB?: number;
    storageRemainingMB?: number;
    storageTotalMB?: number;
    currentTier?: string;
    verified?: boolean;
    requiresUpgrade?: boolean;
  };
}

/**
 * Standard IPFS request options type
 */
export interface IpfsRequestOptions {
  hostname: string;
  port: number;
  path: string;
  method: string;
  headers: Record<string, string>;
}

/**
 * MIME type mapping for content type detection
 */
export const MIME_TYPES: Record<string, string> = {
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
