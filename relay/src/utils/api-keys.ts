/**
 * API Keys Manager
 * 
 * Generic API key management service, usable across all relay services (Drive, IPFS, etc.)
 * Keys are stored in GunDB user space
 */

import crypto from "crypto";
import { loggers } from "./logger";

export interface ApiKey {
  keyId: string;
  name: string;
  hash: string; // SHA-256 hash of the key
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
}

export interface ApiKeyWithToken extends ApiKey {
  token: string; // Only returned when key is first created
}

/**
 * Generate a new API key token
 * @returns {string} Raw API key (to be shown only once)
 */
export function generateApiKeyToken(): string {
  // Generate a secure random token: shogun-api-{64 hex chars}
  const randomBytes = crypto.randomBytes(32);
  return `shogun-api-${randomBytes.toString("hex")}`;
}

/**
 * Hash an API key for storage
 * @param token Raw API key token
 * @returns SHA-256 hash of the token
 */
export function hashApiKey(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a unique key ID
 * @returns Unique key identifier
 */
export function generateKeyId(): string {
  return crypto.randomBytes(16).toString("hex");
}

/**
 * Generic API Keys Manager class
 */
export class ApiKeysManager {
  private gun: any;
  private relayPub: string;
  private relayUser: any; // Relay user instance for writing to userspace

  constructor(gun: any, relayPub: string, relayUser: any) {
    this.gun = gun;
    this.relayPub = relayPub;
    this.relayUser = relayUser;

    // Diagnostic logging
    const userAuthenticated = relayUser && relayUser.is;
    loggers.server.info(
      {
        relayPub,
        userAuthenticated,
        relayUserExists: !!relayUser,
        relayUserIs: relayUser?.is ? 'authenticated' : 'not authenticated'
      },
      "API Keys Manager initialized (using relay user space)"
    );

    if (!userAuthenticated) {
      loggers.server.warn(
        { relayPub },
        "⚠️ API Keys Manager initialized but relay user is NOT authenticated yet!"
      );
    }
  }

  /**
   * Get the node path for API keys in relay user space
   * For reading: gun.get("~" + relayPub).get("api-keys")
   * For writing: relayUser.get("api-keys")
   */
  private getUserSpaceKeysNode() {
    if (!this.relayUser) {
      throw new Error("Relay user not initialized");
    }
    return this.relayUser.get("api-keys");
  }

  private getPublicKeysNode() {
    // Access public user space via ~ prefix
    return this.gun.get("~" + this.relayPub).get("api-keys");
  }

  /**
   * Save an API key to GunDB (in relay user space)
   */
  async saveApiKey(keyData: Omit<ApiKey, "lastUsedAt">): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Diagnostic: Check relay user authentication before saving
        const isAuthenticated = this.relayUser && this.relayUser.is;
        loggers.server.debug(
          {
            keyId: keyData.keyId,
            name: keyData.name,
            relayPub: this.relayPub,
            userAuthenticated: isAuthenticated,
            hashPreview: keyData.hash.substring(0, 16) + "..."
          },
          "💾 Attempting to save API key"
        );

        if (!isAuthenticated) {
          loggers.server.error(
            { keyId: keyData.keyId, relayPub: this.relayPub },
            "❌ Cannot save API key - relay user is NOT authenticated!"
          );
          reject(new Error("Relay user is not authenticated"));
          return;
        }

        const keysNode = this.getUserSpaceKeysNode();
        const keyNode = keysNode.get(keyData.keyId);

        const dataToSave = {
          keyId: keyData.keyId,
          name: keyData.name,
          hash: keyData.hash,
          createdAt: keyData.createdAt,
          expiresAt: keyData.expiresAt || null,
          lastUsedAt: null,
        };

        keyNode.put(dataToSave, (ack: any) => {
          if (ack && "err" in ack && ack.err) {
            loggers.server.error(
              { err: ack.err, keyId: keyData.keyId },
              "❌ Failed to save API key to GunDB"
            );
            reject(new Error(`Failed to save API key: ${ack.err}`));
          } else {
            loggers.server.info(
              { keyId: keyData.keyId, name: keyData.name, relayPub: this.relayPub },
              "✅ API key saved to relay user space"
            );
            resolve();
          }
        });
      } catch (error: any) {
        loggers.server.error({ err: error, keyId: keyData.keyId }, "Error saving API key");
        reject(error);
      }
    });
  }

  /**
   * Get all API keys (without hashes for security)
   * Reads from public user space
   */
  async listApiKeys(): Promise<Omit<ApiKey, "hash">[]> {
    return new Promise((resolve, reject) => {
      try {
        const keys: Omit<ApiKey, "hash">[] = [];
        const keysNode = this.getPublicKeysNode();

        // Set timeout for the operation
        const timeout = setTimeout(() => {
          loggers.server.warn("Timeout listing API keys from GunDB");
          resolve(keys); // Return what we have so far
        }, 5000);

        keysNode.map().once((data: ApiKey | undefined, keyId: string) => {
          if (data && keyId && typeof data === "object" && !keyId.startsWith("_")) {
            const key: Omit<ApiKey, "hash"> = {
              keyId: data.keyId || keyId,
              name: data.name || "Unnamed Key",
              createdAt: data.createdAt || 0,
              lastUsedAt: data.lastUsedAt || null,
              expiresAt: data.expiresAt || null,
            };
            keys.push(key);
          }
        });

        // Wait a bit for data to arrive, then resolve
        setTimeout(() => {
          clearTimeout(timeout);
          const sorted = [...keys].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          resolve(sorted); // Sort by creation date, newest first
        }, 1000);
      } catch (error: any) {
        loggers.server.error({ err: error }, "Error listing API keys");
        reject(error);
      }
    });
  }

  /**
   * Validate an API key token
   * Reads from public user space for validation
   * @param token Raw API key token
   * @returns Key data if valid, null otherwise
   */
  async validateApiKey(token: string): Promise<ApiKey | null> {
    if (!token || !token.startsWith("shogun-api-")) {
      loggers.server.debug("❌ Invalid token format (must start with 'shogun-api-')");
      return null;
    }

    const tokenHash = hashApiKey(token);
    const tokenPreview = token.substring(0, 20) + "...";
    const hashPreview = tokenHash.substring(0, 16) + "...";

    return new Promise((resolve, reject) => {
      try {
        // Diagnostic: Log validation attempt
        loggers.server.debug(
          {
            tokenPreview,
            hashPreview,
            relayPub: this.relayPub,
            publicNodePath: `~${this.relayPub}/api-keys`
          },
          "🔍 Attempting to validate API key"
        );

        const keysNode = this.getPublicKeysNode();
        let found = false;
        let keysChecked = 0;

        const timeout = setTimeout(() => {
          if (!found) {
            loggers.server.warn(
              { keysChecked, tokenPreview, relayPub: this.relayPub },
              "⏱️ API key validation timeout - no matching key found"
            );
            resolve(null);
          }
        }, 3000);

        keysNode.map().once((data: ApiKey | undefined, keyId: string) => {
          if (found) return;
          if (!data || typeof data !== "object" || keyId.startsWith("_")) return;

          keysChecked++;

          // Diagnostic: Log each key checked
          loggers.server.debug(
            {
              keyId,
              dataHash: data.hash?.substring(0, 16) + "...",
              searchHash: hashPreview,
              matches: data.hash === tokenHash,
              keyName: data.name
            },
            `🔑 Checking API key #${keysChecked}`
          );

          if (data.hash === tokenHash) {
            // Check expiration
            if (data.expiresAt && Date.now() > data.expiresAt) {
              loggers.server.debug({ keyId: data.keyId }, "API key expired");
              return; // Key expired, continue searching
            }

            found = true;
            clearTimeout(timeout);

            // Update last used timestamp (write to user space)
            if (this.relayUser) {
              try {
                const userKeysNode = this.getUserSpaceKeysNode();
                userKeysNode.get(data.keyId || keyId).get("lastUsedAt").put(Date.now());
              } catch (updateError) {
                loggers.server.warn({ err: updateError }, "Failed to update lastUsedAt");
              }
            }

            const keyData: ApiKey = {
              keyId: data.keyId || keyId,
              name: data.name || "Unnamed Key",
              hash: data.hash,
              createdAt: data.createdAt || 0,
              lastUsedAt: Date.now(),
              expiresAt: data.expiresAt || null,
            };

            loggers.server.debug({ keyId: keyData.keyId, name: keyData.name }, "API key validated");
            resolve(keyData);
          }
        });

        // If no match found after timeout, resolve with null
        setTimeout(() => {
          if (!found) {
            clearTimeout(timeout);
            resolve(null);
          }
        }, 3000);
      } catch (error: any) {
        loggers.server.error({ err: error }, "Error validating API key");
        reject(error);
      }
    });
  }

  /**
   * Revoke (delete) an API key
   * Writes to relay user space
   */
  async revokeApiKey(keyId: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        const keysNode = this.getUserSpaceKeysNode();
        const keyNode = keysNode.get(keyId);
        keyNode.put(null, (ack: any) => {
          if (ack && "err" in ack && ack.err) {
            loggers.server.error({ err: ack.err, keyId }, "Failed to revoke API key");
            reject(new Error(`Failed to revoke API key: ${ack.err}`));
          } else {
            loggers.server.info({ keyId }, "API key revoked");
            resolve(true);
          }
        });
      } catch (error: any) {
        loggers.server.error({ err: error, keyId }, "Error revoking API key");
        reject(error);
      }
    });
  }

  /**
   * Create a new API key
   */
  async createApiKey(name: string, expiresInDays?: number): Promise<ApiKeyWithToken> {
    const keyId = generateKeyId();
    const token = generateApiKeyToken();
    const hash = hashApiKey(token);
    const createdAt = Date.now();
    const expiresAt = expiresInDays ? createdAt + expiresInDays * 24 * 60 * 60 * 1000 : null;

    const keyData: Omit<ApiKey, "lastUsedAt"> = {
      keyId,
      name: name || "Unnamed Key",
      hash,
      createdAt,
      expiresAt,
    };

    await this.saveApiKey(keyData);

    return {
      ...keyData,
      lastUsedAt: null,
      token, // Return token only once!
    };
  }
}

