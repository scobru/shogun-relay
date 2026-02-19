/**
 * Frozen Data Utility for GunDB
 *
 * Provides immutable, verifiable data storage using:
 * - Content-addressed hashing (data identified by hash)
 * - SEA signatures (proves authorship)
 * - Public readability with tamper-proof verification
 *
 * Pattern inspired by IPFS content-addressing + blockchain signatures.
 */

import Gun from "gun";
import "gun/sea.js";
import crypto from "crypto";
import { loggers } from "./logger";
import { GUN_PATHS } from "./gun-paths";

const SEA = Gun.SEA;
const log = loggers.frozenData;

// Interfaces
export interface SEAKeyPair {
  pub: string;
  priv: string;
  epub?: string;
  epriv?: string;
}

interface GunInstance {
  get: (path: string) => GunNode;
}

interface GunNode {
  get: (path: string) => GunNode;
  put: (data: object) => void;
  once: (cb: (data: any, key?: string) => void | Promise<void>) => void;
  map: () => GunNode;
}

interface FrozenEntryMeta {
  pub: string;
  timestamp: number;
  version: number;
}

interface FrozenEntryData {
  _meta?: Partial<FrozenEntryMeta>;
  meta?: Partial<FrozenEntryMeta>; // Alternative name in case _meta is not persisted by GunDB
  [key: string]: unknown;
}

export interface FrozenEntry {
  data: FrozenEntryData;
  sig: string;
  hash: string;
}

interface VerificationDetails {
  signatureValid: boolean;
  hashValid: boolean;
  reason?: string;
}

interface FrozenEntryResult {
  data: FrozenEntryData;
  verified: boolean;
  verificationDetails?: VerificationDetails;
  pub: string | undefined;
  timestamp?: number | undefined;
  hash?: string;
  error?: string;
}

interface IndexEntry {
  latestHash: string;
  pub: string;
  updatedAt: number;
}

export interface ListEntryInfo {
  key: string;
  hash: string;
  pub: string;
  updatedAt: number;
  data?: FrozenEntryData;
  verified?: boolean;
}

interface ListOptions {
  verifyAll?: boolean;
  maxAge?: number | undefined;
  limit?: number;
}

interface ObservationResult {
  observer: string;
  observation?: object;
  timestamp?: number;
  verified?: boolean;
  hash?: string;
  updatedAt?: number;
}

interface ReputationMetrics {
  proofsSuccessful: number;
  proofsFailed: number;
  totalResponseTimeMs: number;
  responseTimeSamples: number;
  pinsFulfilled: number;
  pinsRequested: number;
  selfRatings: number;
  externalRatings: number;
}

interface AggregatedReputation {
  totalObservers: number;
  observerBreakdown?: {
    self: number;
    external: number;
  };
  aggregated:
    | {
        proofSuccessRate: number | undefined;
        avgResponseTimeMs: number | undefined;
        pinFulfillmentRate: number | undefined;
        totalProofsObserved: number;
      }
    | undefined;
  confidence: number;
  note?: string;
}

interface FrozenEntryCreateResult {
  hash: string;
  signature: string;
}

/**
 * Create a frozen (immutable, signed) data entry
 *
 * @param gun - GunDB instance
 * @param data - Data to freeze
 * @param keyPair - SEA key pair (pub + priv) for signing
 * @param namespace - Index namespace (e.g., 'announcements', 'observations')
 * @param indexKey - Key for the index (e.g., host address)
 * @returns Promise with hash and signature
 */
export async function createFrozenEntry(
  gun: GunInstance,
  data: object,
  keyPair: SEAKeyPair,
  namespace: string,
  indexKey?: string
): Promise<FrozenEntryCreateResult> {
  if (!gun || !data || !keyPair) {
    throw new Error("gun, data, and keyPair are required");
  }

  const now = Date.now();

  // Add metadata - merge with existing _meta if present
  const metaData: FrozenEntryMeta = {
    ...((data as any)._meta || (data as any).meta || {}),
    pub: keyPair.pub,
    timestamp: now,
    version: 1,
  };

  const entry: FrozenEntryData = {
    ...data,
    _meta: metaData,
    meta: metaData, // Also store as 'meta' in case _meta is not persisted
  };

  // Ensure both _meta and meta have pub set (defensive check)
  if (!entry._meta!.pub) {
    entry._meta!.pub = keyPair.pub;
  }
  if (!entry.meta!.pub) {
    entry.meta!.pub = keyPair.pub;
  }

  // Log entry structure before signing to ensure metadata is present
  log.debug(
    {
      namespace,
      indexKey,
      hasMeta: !!entry._meta,
      hasMetaAlt: !!entry.meta,
      metaPub: entry._meta?.pub?.substring(0, 16),
      dataKeys: Object.keys(entry).filter((k) => k !== "_meta" && k !== "meta"),
    },
    "Creating frozen entry with metadata"
  );

  // Create dataString - this exact string will be used for signing, hashing, and storing as dataJson
  const dataString = JSON.stringify(entry);

  log.debug(
    {
      namespace,
      indexKey,
      dataStringLength: dataString.length,
      dataStringPreview: dataString.substring(0, 300),
    },
    "Creating frozen entry - dataString created"
  );

  // Create signature using the dataString
  const signature = await SEA.sign(dataString, keyPair);

  if (!signature) {
    throw new Error("Failed to sign data");
  }

  // Create content hash for addressing using the same dataString
  // OPTIMIZATION: Use native crypto instead of SEA.work for SHA-256 (approx 14x faster)
  const hash = crypto.createHash("sha256").update(dataString).digest("base64");

  if (!hash) {
    throw new Error("Failed to create content hash");
  }

  // Store the entry
  const frozenNode = gun.get("frozen-" + namespace).get(hash);

  // Store signature and hash at the root level
  frozenNode.get("sig").put(signature as any);
  frozenNode.get("hash").put(hash as any);

  // Store dataString as dataJson
  frozenNode.get("dataJson").put(dataString as any);

  // Also store data as nested object for backward compatibility
  frozenNode.get("data").put(entry as unknown as object);

  // Update index to point to latest hash
  // CONFLICT-AWARE: Read current index before updating to avoid overwriting newer entries
  if (indexKey) {
    // Read current index to check if we should update
    const currentIndex = await new Promise<IndexEntry | null>((resolve) => {
      const timeout = setTimeout(() => resolve(null), 2000);
      gun
        .get(GUN_PATHS.SHOGUN_INDEX)
        .get(namespace)
        .get(indexKey)
        .once((data: IndexEntry | undefined) => {
          clearTimeout(timeout);
          resolve(data || null);
        });
    });

    // Only update if no existing index OR our entry is newer (last-writer-wins based on timestamp)
    const shouldUpdate = !currentIndex || !currentIndex.updatedAt || currentIndex.updatedAt <= now;

    if (shouldUpdate) {
      gun.get(GUN_PATHS.SHOGUN_INDEX).get(namespace).get(indexKey).put({
        latestHash: hash,
        pub: keyPair.pub,
        updatedAt: now,
      });
      log.debug(
        {
          namespace,
          indexKey,
          previousUpdatedAt: currentIndex?.updatedAt,
          newUpdatedAt: now,
        },
        "Index updated with new frozen entry"
      );
    } else {
      log.debug(
        {
          namespace,
          indexKey,
          existingUpdatedAt: currentIndex.updatedAt,
          ourTimestamp: now,
        },
        "Skipped index update - more recent entry exists from another relay"
      );
    }
  }

  log.debug(`Frozen entry created: ${namespace}/${hash.substring(0, 16)}...`);

  return { hash, signature };
}

/**
 * Read and verify a frozen entry by hash
 *
 * @param gun - GunDB instance
 * @param namespace - Index namespace
 * @param hash - Content hash
 * @param expectedSigner - Optional: if provided as string, verify that the entry's pub matches this value
 * @param trustedSigners - Optional: if provided as array, verify that the entry's pub is in this list
 * @returns Promise with data, verified status, and pub
 */
export async function readFrozenEntry(
  gun: GunInstance,
  namespace: string,
  hash: string,
  expectedSigner?: string | string[]
): Promise<FrozenEntryResult | undefined> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(undefined), 10000);

    gun
      .get("frozen-" + namespace)
      .get(hash)
      .once(async (entry: (FrozenEntry & { dataJson?: string }) | undefined) => {
        clearTimeout(timeout);

        if (!entry || !entry.sig) {
          resolve(undefined);
          return;
        }

        try {
          let entryData: FrozenEntryData;
          let dataString: string;
          let pub: string | undefined;

          if (entry.dataJson && typeof entry.dataJson === "string") {
            dataString = entry.dataJson;
            try {
              entryData = JSON.parse(dataString);
              pub = entryData._meta?.pub || entryData.meta?.pub;
              log.debug(
                {
                  hash: hash.substring(0, 16),
                  source: "dataJson",
                  hasMeta: !!entryData._meta,
                  hasMetaAlt: !!entryData.meta,
                  dataStringLength: dataString.length,
                },
                "Reading frozen entry from dataJson"
              );
            } catch (parseError) {
              log.warn(
                {
                  hash: hash.substring(0, 16),
                  error: parseError,
                },
                "Failed to parse dataJson, falling back to entry.data"
              );
              entryData = entry.data || {};
              dataString = JSON.stringify(entryData);
              pub = entryData._meta?.pub || entryData.meta?.pub;
            }
          } else {
            entryData = entry.data || {};
            dataString = JSON.stringify(entryData);
            pub = entryData._meta?.pub || entryData.meta?.pub;
            log.debug(
              {
                hash: hash.substring(0, 16),
                source: "entry.data",
                hasData: !!entry.data,
                hasMeta: !!entry.data?._meta,
                hasMetaAlt: !!entry.data?.meta,
                dataKeys: entry.data
                  ? Object.keys(entry.data).filter((k) => k !== "_meta" && k !== "meta")
                  : [],
                dataStringLength: dataString.length,
              },
              "Reading frozen entry from entry.data"
            );
          }

          // If pub is missing, try to get it from the index
          if (!pub) {
            log.warn(
              {
                hash: hash.substring(0, 16),
                hasMeta: !!entry.data._meta,
                hasMetaAlt: !!entry.data.meta,
                metaContent: entry.data._meta,
                metaAltContent: entry.data.meta,
              },
              "Pub missing from metadata, attempting index lookup"
            );

            const indexNamespace = namespace.replace("frozen-", "");
            const indexLookup: Promise<string | undefined> = new Promise((resolveIndex) => {
              let found = false;
              const timeoutId = setTimeout(() => {
                if (!found) resolveIndex(undefined);
              }, 2000);

              gun
                .get(GUN_PATHS.SHOGUN_INDEX)
                .get(indexNamespace)
                .map()
                .once((index: IndexEntry | undefined, _key?: string) => {
                  if (index && index.latestHash === hash && index.pub) {
                    found = true;
                    clearTimeout(timeoutId);
                    resolveIndex(index.pub);
                  }
                });
            });

            pub = await indexLookup;

            if (pub) {
              log.debug(`Recovered pub for frozen entry ${hash.substring(0, 16)}... from index`);
            }
          }

          // If still no pub after checking index, warn and skip verification
          if (!pub) {
            log.warn(
              `Frozen entry ${hash.substring(0, 16)}... missing pub in _meta, skipping signature verification`
            );
            resolve({
              data: entry.data,
              verified: false,
              verificationDetails: {
                signatureValid: false,
                hashValid: false,
                reason: "Missing pub in _meta",
              },
              pub: undefined,
              timestamp: entry.data._meta?.timestamp || undefined,
              hash,
            });
            return;
          }

          // SECURITY: If expectedSigner is provided, verify that the entry's pub matches
          // Support both single signer (string) and multiple trusted signers (array)
          if (expectedSigner) {
            const trustedSigners = Array.isArray(expectedSigner)
              ? expectedSigner
              : [expectedSigner];
            const isTrusted = trustedSigners.includes(pub);

            if (!isTrusted) {
              log.warn(
                {
                  hash: hash.substring(0, 16),
                  expectedSigners: trustedSigners.map((s) => s.substring(0, 16)),
                  actualPub: pub.substring(0, 16),
                },
                "Frozen entry signer mismatch - rejecting untrusted entry"
              );
              resolve({
                data: entry.data,
                verified: false,
                verificationDetails: {
                  signatureValid: false,
                  hashValid: false,
                  reason: `Signer mismatch: entry signed by ${pub.substring(0, 16)}..., not in trusted list`,
                },
                pub: pub,
                timestamp: entry.data._meta?.timestamp || undefined,
                hash,
              });
              return;
            }
          }

          // SEA.verify returns the original data if valid, or undefined/false if invalid
          const verifyResult = await SEA.verify(entry.sig, pub);
          const signatureValid = verifyResult !== undefined && verifyResult !== false;

          // Verify hash matches content
          // OPTIMIZATION: Use native crypto instead of SEA.work for SHA-256 (approx 14x faster)
          const expectedHash = crypto.createHash("sha256").update(dataString).digest("base64");
          const hashValid = expectedHash === hash;
          const verified = signatureValid && hashValid;

          // Log verification details for debugging
          log.debug(
            {
              hash: hash.substring(0, 16),
              expectedHash: expectedHash?.substring(0, 16),
              hashMatch: hashValid,
              signatureValid,
              verified,
              pub: pub.substring(0, 16),
              dataStringLength: dataString.length,
              dataStringPreview: dataString.substring(0, 300),
              hasMetaInData: !!entryData._meta,
              hasMetaAltInData: !!entryData.meta,
              usingDataJson: !!entry.dataJson,
            },
            "Frozen entry verification result"
          );

          resolve({
            data: entryData,
            verified,
            verificationDetails: {
              signatureValid,
              hashValid,
            },
            pub: pub,
            timestamp: entryData._meta?.timestamp || entryData.meta?.timestamp,
            hash,
          });
        } catch (error) {
          log.error({ err: error }, "Verification error");
          resolve({
            data: entry.data,
            verified: false,
            error: (error as Error).message,
            pub: undefined,
          });
        }
      });
  });
}

/**
 * Get latest frozen entry for an index key
 *
 * @param gun - GunDB instance
 * @param namespace - Index namespace
 * @param indexKey - Index key
 * @param expectedSigner - Optional: if provided as string, verify that the entry's pub matches this value
 *                         If provided as array, verify that the entry's pub is in this list
 * @returns Promise with data, verified status, and pub
 */
export async function getLatestFrozenEntry(
  gun: GunInstance,
  namespace: string,
  indexKey: string,
  expectedSigner?: string | string[]
): Promise<FrozenEntryResult | undefined> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(undefined), 10000);

    gun
      .get(GUN_PATHS.SHOGUN_INDEX)
      .get(namespace)
      .get(indexKey)
      .once(async (index: IndexEntry | undefined) => {
        clearTimeout(timeout);

        if (!index || !index.latestHash) {
          resolve(undefined);
          return;
        }

        const entry = await readFrozenEntry(gun, namespace, index.latestHash, expectedSigner);
        resolve(entry);
      });
  });
}

/**
 * List all entries in a namespace index
 */
export async function listFrozenEntries(
  gun: GunInstance,
  namespace: string,
  options: ListOptions = {}
): Promise<ListEntryInfo[]> {
  const { verifyAll = false, maxAge = undefined, limit = 100 } = options;

  return new Promise((resolve) => {
    const entries: ListEntryInfo[] = [];
    const timeout = setTimeout(() => {
      resolve(entries.slice(0, limit));
    }, 5000);

    gun
      .get(GUN_PATHS.SHOGUN_INDEX)
      .get(namespace)
      .map()
      .once(async (index: IndexEntry | undefined, key?: string) => {
        if (!index || typeof index !== "object" || !index.latestHash) return;

        // Filter by age if specified
        if (maxAge && index.updatedAt && Date.now() - index.updatedAt > maxAge) return;

        const entryInfo: ListEntryInfo = {
          key: key || "",
          hash: index.latestHash,
          pub: index.pub,
          updatedAt: index.updatedAt,
        };

        if (verifyAll) {
          const fullEntry = await readFrozenEntry(gun, namespace, index.latestHash);
          if (fullEntry) {
            entryInfo.data = fullEntry.data;
            entryInfo.verified = fullEntry.verified;
          }
        }

        entries.push(entryInfo);
      });

    // Allow time for collection
    setTimeout(() => {
      clearTimeout(timeout);
      entries.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      resolve(entries.slice(0, limit));
    }, 3000);
  });
}

/**
 * Create a frozen observation (one relay observing another)
 */
export async function createFrozenObservation(
  gun: GunInstance,
  observedHost: string,
  observation: object,
  observerKeyPair: SEAKeyPair
): Promise<FrozenEntryCreateResult> {
  const data = {
    type: "observation",
    observedHost,
    observation,
    observer: observerKeyPair.pub,
  };

  const result = await createFrozenEntry(
    gun,
    data,
    observerKeyPair,
    "observations",
    `${observedHost}:${observerKeyPair.pub.substring(0, 20)}`
  );

  // Also update aggregated index for the observed host
  // Also update aggregated index for the observed host
  gun
    .get(GUN_PATHS.SHOGUN_INDEX)
    .get(GUN_PATHS.OBSERVATIONS_BY_HOST)
    .get(observedHost)
    .get(observerKeyPair.pub)
    .put({
      hash: result.hash,
      updatedAt: Date.now(),
    });

  return result;
}

/**
 * Get all observations for a specific host
 */
export async function getObservationsForHost(
  gun: GunInstance,
  observedHost: string,
  options: { verifyAll?: boolean; limit?: number } = {}
): Promise<ObservationResult[]> {
  const { verifyAll = true, limit = 50 } = options;

  return new Promise((resolve) => {
    const observations: ObservationResult[] = [];
    const timeout = setTimeout(() => resolve(observations), 5000);

    gun
      .get(GUN_PATHS.SHOGUN_INDEX)
      .get(GUN_PATHS.OBSERVATIONS_BY_HOST)
      .get(observedHost)
      .map()
      .once(
        async (index: { hash: string; updatedAt: number } | undefined, observerPub?: string) => {
          if (!index || !index.hash) return;

          if (verifyAll) {
            const entry = await readFrozenEntry(gun, "observations", index.hash);
            if (entry && entry.verified) {
              observations.push({
                observer: observerPub || "",
                observation: (entry.data as { observation: object }).observation,
                timestamp: entry.timestamp,
                verified: true,
              });
            }
          } else {
            observations.push({
              observer: observerPub || "",
              hash: index.hash,
              updatedAt: index.updatedAt,
            });
          }
        }
      );

    setTimeout(() => {
      clearTimeout(timeout);
      resolve(observations.slice(0, limit));
    }, 3000);
  });
}

/**
 * Aggregate reputation from verified observations
 */
export function aggregateReputation(observations: ObservationResult[]): AggregatedReputation {
  if (!observations || observations.length === 0) {
    return {
      totalObservers: 0,
      aggregated: undefined,
      confidence: 0,
    };
  }

  const OBSERVER_WEIGHTS: Record<string, number> = {
    self: 0.1,
    external: 0.9,
  };

  const metrics: ReputationMetrics = {
    proofsSuccessful: 0,
    proofsFailed: 0,
    totalResponseTimeMs: 0,
    responseTimeSamples: 0,
    pinsFulfilled: 0,
    pinsRequested: 0,
    selfRatings: 0,
    externalRatings: 0,
  };

  observations.forEach((obs) => {
    const o: any = obs.observation || obs;

    const observerType: string =
      o.details?.observerType ||
      (obs as unknown as { observerType?: string }).observerType ||
      "external";

    const weight = OBSERVER_WEIGHTS[observerType] || OBSERVER_WEIGHTS.external;

    if (observerType === "self") {
      metrics.selfRatings += 1;
    } else {
      metrics.externalRatings += 1;
    }

    if (o.type === "reputation_event") {
      if (o.event === "proof_success") {
        metrics.proofsSuccessful += weight;
        if (o.details?.responseTimeMs) {
          metrics.totalResponseTimeMs += o.details.responseTimeMs * weight;
          metrics.responseTimeSamples += weight;
        }
      } else if (o.event === "proof_failure") {
        metrics.proofsFailed += weight;
      } else if (o.event === "pin_fulfillment") {
        metrics.pinsRequested += weight;
        if (o.details?.fulfilled) {
          metrics.pinsFulfilled += weight;
        }
      }
    } else {
      metrics.proofsSuccessful += (o.proofsSuccessful || 0) * weight;
      metrics.proofsFailed += (o.proofsFailed || 0) * weight;
      if (o.avgResponseTimeMs) {
        metrics.totalResponseTimeMs += o.avgResponseTimeMs * weight;
        metrics.responseTimeSamples += weight;
      }
      metrics.pinsFulfilled += (o.pinsFulfilled || 0) * weight;
      metrics.pinsRequested += (o.pinsRequested || 0) * weight;
    }
  });

  const proofsTotal = metrics.proofsSuccessful + metrics.proofsFailed;

  return {
    totalObservers: observations.length,
    observerBreakdown: {
      self: metrics.selfRatings,
      external: metrics.externalRatings,
    },
    aggregated: {
      proofSuccessRate:
        proofsTotal > 0 ? Math.round((metrics.proofsSuccessful / proofsTotal) * 100) : undefined,
      avgResponseTimeMs:
        metrics.responseTimeSamples > 0
          ? Math.round(metrics.totalResponseTimeMs / metrics.responseTimeSamples)
          : undefined,
      pinFulfillmentRate:
        metrics.pinsRequested > 0
          ? Math.round((metrics.pinsFulfilled / metrics.pinsRequested) * 100)
          : undefined,
      totalProofsObserved: Math.round(proofsTotal),
    },
    confidence: Math.min(100, metrics.externalRatings * 10),
    note: "Self-ratings have reduced weight (10%) in reputation calculation",
  };
}

/**
 * Create a signed acknowledgment
 */
export async function createSignedAcknowledgment(
  gun: GunInstance,
  originalHash: string,
  message: string,
  keyPair: SEAKeyPair
): Promise<FrozenEntryCreateResult> {
  const data = {
    type: "ack",
    re: originalHash,
    msg: message,
    signer: keyPair.pub,
  };

  const result = await createFrozenEntry(gun, data, keyPair, "acks", originalHash);

  log.debug(`Signed ACK created for ${originalHash.substring(0, 8)}...`);
  return result;
}

/**
 * Create a signed reputation event
 */
export async function createSignedReputationEvent(
  gun: GunInstance,
  subjectHost: string,
  eventType: string,
  details: object | undefined,
  observerKeyPair: SEAKeyPair
): Promise<FrozenEntryCreateResult> {
  const observation = {
    type: "reputation_event",
    event: eventType,
    subject: subjectHost,
    details: details || {},
    timestamp: Date.now(),
  };

  return await createFrozenObservation(gun, subjectHost, observation, observerKeyPair);
}

export default {
  createFrozenEntry,
  readFrozenEntry,
  getLatestFrozenEntry,
  listFrozenEntries,
  createFrozenObservation,
  getObservationsForHost,
  aggregateReputation,
  createSignedAcknowledgment,
  createSignedReputationEvent,
};
