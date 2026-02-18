/**
 * Drive Public Links Manager
 *
 * Manages public sharing links for drive files, stored in GunDB user space
 */

import crypto from "crypto";
import { loggers } from "./logger";

export interface PublicLink {
  linkId: string;
  filePath: string;
  createdAt: number;
  expiresAt: number | null;
  accessCount: number;
  lastAccessedAt: number | null;
}

/**
 * Generate a unique link ID
 * @returns Unique link identifier
 */
export function generateLinkId(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Drive Public Links Manager class
 */
export class DrivePublicLinksManager {
  private gun: any;
  private relayPub: string;
  private relayUser: any; // Relay user instance for writing to userspace

  constructor(gun: any, relayPub: string, relayUser: any) {
    this.gun = gun;
    this.relayPub = relayPub;
    this.relayUser = relayUser;
    loggers.server.info(
      { relayPub },
      "Drive Public Links Manager initialized (using relay user space)"
    );
  }

  /**
   * Get the node path for public links in relay user space
   * For reading: gun.get("~" + relayPub).get("drive").get("public-links")
   * For writing: relayUser.get("drive").get("public-links")
   */
  private getUserSpaceLinksNode() {
    if (!this.relayUser) {
      throw new Error("Relay user not initialized");
    }
    return this.relayUser.get("drive").get("public-links");
  }

  private getPublicLinksNode() {
    // Access public user space via ~ prefix
    return this.gun
      .get("~" + this.relayPub)
      .get("drive")
      .get("public-links");
  }

  /**
   * Create a new public link for a file
   */
  async createPublicLink(filePath: string, expiresInDays?: number): Promise<PublicLink> {
    const linkId = generateLinkId();
    const createdAt = Date.now();
    const expiresAt = expiresInDays ? createdAt + expiresInDays * 24 * 60 * 60 * 1000 : null;

    const linkData: PublicLink = {
      linkId,
      filePath,
      createdAt,
      expiresAt,
      accessCount: 0,
      lastAccessedAt: null,
    };

    return new Promise((resolve, reject) => {
      try {
        const linksNode = this.getUserSpaceLinksNode();
        const linkNode = linksNode.get(linkId);

        linkNode.put(linkData, (ack: any) => {
          if (ack && "err" in ack && ack.err) {
            loggers.server.error({ err: ack.err, linkId }, "Failed to save public link to GunDB");
            reject(new Error(`Failed to save public link: ${ack.err}`));
          } else {
            loggers.server.info({ linkId, filePath }, "Public link created");
            resolve(linkData);
          }
        });
      } catch (error: any) {
        loggers.server.error({ err: error, linkId }, "Error creating public link");
        reject(error);
      }
    });
  }

  /**
   * Get a public link by ID (for validation/access)
   */
  async getPublicLink(linkId: string): Promise<PublicLink | null> {
    return new Promise((resolve, reject) => {
      try {
        const linksNode = this.getPublicLinksNode();
        const linkNode = linksNode.get(linkId);

        const timeout = setTimeout(() => {
          resolve(null);
        }, 3000);

        linkNode.once((data: PublicLink | undefined) => {
          clearTimeout(timeout);

          if (!data || typeof data !== "object") {
            resolve(null);
            return;
          }

          // Check expiration
          if (data.expiresAt && Date.now() > data.expiresAt) {
            loggers.server.debug({ linkId }, "Public link expired");
            resolve(null);
            return;
          }

          // Update access count and last accessed time
          if (this.relayUser) {
            try {
              const userLinksNode = this.getUserSpaceLinksNode();
              const userLinkNode = userLinksNode.get(linkId);
              userLinkNode.get("accessCount").put((data.accessCount || 0) + 1);
              userLinkNode.get("lastAccessedAt").put(Date.now());
            } catch (updateError) {
              loggers.server.warn({ err: updateError }, "Failed to update link access stats");
            }
          }

          const linkData: PublicLink = {
            linkId: data.linkId || linkId,
            filePath: data.filePath,
            createdAt: data.createdAt || 0,
            expiresAt: data.expiresAt || null,
            accessCount: (data.accessCount || 0) + 1,
            lastAccessedAt: Date.now(),
          };

          resolve(linkData);
        });
      } catch (error: any) {
        loggers.server.error({ err: error }, "Error getting public link");
        reject(error);
      }
    });
  }

  /**
   * List all public links (for admin)
   */
  async listPublicLinks(): Promise<PublicLink[]> {
    return new Promise((resolve, reject) => {
      try {
        const links: PublicLink[] = [];
        const linksNode = this.getPublicLinksNode();

        const timeout = setTimeout(() => {
          loggers.server.warn("Timeout listing public links from GunDB");
          resolve(links);
        }, 5000);

        linksNode.map().once((data: PublicLink | undefined, linkId: string) => {
          if (data && linkId && typeof data === "object" && !linkId.startsWith("_")) {
            const link: PublicLink = {
              linkId: data.linkId || linkId,
              filePath: data.filePath,
              createdAt: data.createdAt || 0,
              expiresAt: data.expiresAt || null,
              accessCount: data.accessCount || 0,
              lastAccessedAt: data.lastAccessedAt || null,
            };
            links.push(link);
          }
        });

        setTimeout(() => {
          clearTimeout(timeout);
          const sorted = [...links].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          resolve(sorted);
        }, 1000);
      } catch (error: any) {
        loggers.server.error({ err: error }, "Error listing public links");
        reject(error);
      }
    });
  }

  /**
   * Revoke (delete) a public link
   */
  async revokePublicLink(linkId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        const linksNode = this.getUserSpaceLinksNode();
        const linkNode = linksNode.get(linkId);
        linkNode.put(null, (ack: any) => {
          if (ack && "err" in ack && ack.err) {
            loggers.server.error({ err: ack.err, linkId }, "Failed to revoke public link");
            reject(new Error(`Failed to revoke public link: ${ack.err}`));
          } else {
            loggers.server.info({ linkId }, "Public link revoked");
            resolve(true);
          }
        });
      } catch (error: any) {
        loggers.server.error({ err: error, linkId }, "Error revoking public link");
        reject(error);
      }
    });
  }
}
