/**
 * Relay User Management for GunDB
 *
 * Initializes the relay's GunDB user account with a direct SEA keypair.
 * Subscription data is stored in the relay's user space,
 * ensuring only the relay can modify or delete this data.
 *
 * The relay MUST use a SEA keypair for initialization (no username/password).
 * This prevents "Signature did not match" errors when using frozen data.
 */

import { loggers } from "./logger";
const log = loggers.relayUser;
import { authConfig } from "../config/env-config";
import { GUN_PATHS, getGunNode } from "./gun-paths";

// Module state
let relayUser: GunUser | undefined = undefined;
let relayPub: string | undefined = undefined;
let relayKeyPair: ISEAPair | undefined = undefined;
let isInitialized: boolean = false;
let initPromise: Promise<RelayUserResult> | undefined = undefined;

// Interfaces - Import native Gun types
import type { IGunChain, GunCallbackPut, GunMessagePut } from "gun/types/gun";
import { IGunUserInstance, IGunInstance, ISEAPair, GunCallbackUserAuth } from "gun";

// Type aliases for Gun types
type GunInstance = IGunInstance<any>;
type GunNode = IGunChain<any, any, any, any>;
type GunUser = IGunUserInstance<any, any, any, any>;

// Alias for GunMessagePut (used in callback)
type GunAck = GunMessagePut;

interface RelayUserResult {
  user: GunUser;
  pub: string;
  keyPair: ISEAPair;
}



interface UploadData {
  hash?: string;
  name?: string;
  size?: number;
  sizeMB?: number;
  uploadedAt?: number;
  savedAt?: number;
  userAddress?: string;
  savedBy?: string;
  [key: string]: unknown;
}

interface UploadInfo {
  hash: string;
  name?: string;
  size: number;
  sizeMB: number;
  uploadedAt?: number;
}

/**
 * Initialize relay user with direct SEA keypair (no login needed)
 * @param gun - GunDB instance
 * @param keyPair - SEA keypair object {pub, priv, epub, epriv}
 * @returns Promise with user, pub, and keyPair
 */
async function initRelayUserWithKeyPair(
  gun: GunInstance,
  keyPair: ISEAPair
): Promise<RelayUserResult> {
  if (isInitialized && relayUser && relayKeyPair) {
    return { user: relayUser, pub: relayPub!, keyPair: relayKeyPair };
  }

  log.debug("Initializing relay user with direct SEA keypair...");

  return new Promise((resolve, reject) => {
    const user = gun.user();

    // Authenticate directly with keypair (no username/password needed)
    (user as any).auth(keyPair, (ack: { err?: string; soul?: string; sea?: ISEAPair }) => {
      if (ack.err) {
        log.error({ err: ack.err }, "Failed to authenticate with keypair");
        reject(new Error(ack.err));
        return;
      }

      relayUser = user;
      relayPub = keyPair.pub;
      relayKeyPair = keyPair;
      isInitialized = true;

      // IMPORTANT: Explicitly publish epub to user graph for encrypted chat
      // This ensures other relays can find our encryption key
      if (keyPair.epub) {
        user.get('epub').put(keyPair.epub);
        user.get('pub').put(keyPair.pub);
        log.debug({ pub: relayPub }, "Published epub key for encrypted chat");
      }

      log.debug({ pub: relayPub, pubLength: relayPub?.length }, "Relay user authenticated with keypair");
      resolve({ user: relayUser, pub: relayPub!, keyPair: relayKeyPair });
    });
  });
}

/**
 * Initialize the relay user with a direct SEA keypair (REQUIRED)
 * @param gun - GunDB instance
 * @param keyPair - SEA keypair object {pub, priv, epub, epriv}
 * @returns Promise with user, pub, and keyPair
 */
export async function initRelayUser(gun: GunInstance, keyPair: ISEAPair): Promise<RelayUserResult> {
  if (isInitialized && relayUser) {
    return {
      user: relayUser,
      pub: relayPub!,
      keyPair: relayKeyPair!,
    };
  }

  // Prevent multiple simultaneous initializations
  if (initPromise) {
    return initPromise;
  }

  // Validate keypair
  if (!keyPair || typeof keyPair !== "object") {
    throw new Error(
      "RELAY_SEA_KEYPAIR is required. Please configure a keypair via RELAY_SEA_KEYPAIR or RELAY_SEA_KEYPAIR_PATH environment variable."
    );
  }

  if (!keyPair.pub || !keyPair.priv) {
    throw new Error(
      "Invalid keypair: missing pub or priv fields. Please generate a new keypair using: node scripts/generate-relay-keys.js"
    );
  }

  // Use the existing keypair initialization function
  initPromise = initRelayUserWithKeyPair(gun, keyPair);
  return initPromise;
}

/**
 * Get the relay user instance
 * @returns GunUser or undefined
 */
export function getRelayUser(): GunUser | undefined {
  return relayUser;
}

/**
 * Get the relay user's public key
 * @returns Public key or undefined
 */
export function getRelayPub(): string | undefined {
  return relayPub;
}

/**
 * Get the relay user's SEA keypair
 * @returns SEA keypair or undefined
 */
export function getRelayKeyPair(): ISEAPair | undefined {
  return relayKeyPair;
}

/**
 * Check if relay user is initialized
 * @returns True if initialized
 */
export function isRelayUserInitialized(): boolean {
  return isInitialized && relayUser !== undefined;
}



/**
 * Middleware to require admin authentication
 */
export const adminAuthMiddleware = (req: any, res: any, next: any) => {
  const authHeader = req.headers["authorization"];
  const bearerToken = authHeader && authHeader.split(" ")[1];
  const customToken = req.headers["token"];
  const token = bearerToken || customToken;

  if (!token) {
    return res.status(401).json({ success: false, error: "Unauthorized - Token required" });
  }

  if (token === authConfig.adminPassword) {
    next();
  } else {
    return res.status(401).json({ success: false, error: "Unauthorized - Invalid token" });
  }
};

export default {
  initRelayUser,
  getRelayUser,
  getRelayPub,
  isRelayUserInitialized,

};

