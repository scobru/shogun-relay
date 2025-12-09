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

import Gun from 'gun';
import 'gun/sea.js';
import { loggers } from './logger';

const SEA = Gun.SEA;
const log = loggers.frozenData;

// Interfaces
export interface SEAKeyPair {
  pub: str;
  priv: str;
  epub?: str;
  epriv?: str;
}

interface GunInstance {
  get: (path: str) => GunNode;
}

interface GunNode {
  get: (path: str) => GunNode;
  put: (data: obj) => void;
  once: (cb: (data: any, key?: str) => void | prm<void>) => void;
  map: () => GunNode;
}

interface FrozenEntryMeta {
  pub: str;
  timestamp: num;
  version: num;
}

interface FrozenEntryData {
  _meta?: opt<FrozenEntryMeta>;
  meta?: opt<FrozenEntryMeta>; // Alternative name in case _meta is not persisted by GunDB
  [key: str]: unknown;
}

export interface FrozenEntry {
  data: FrozenEntryData;
  sig: str;
  hash: str;
}

interface VerificationDetails {
  signatureValid: bool;
  hashValid: bool;
  reason?: str;
}

interface FrozenEntryResult {
  data: FrozenEntryData;
  verified: bool;
  verificationDetails?: VerificationDetails;
  pub: mb<str>;
  timestamp?: mb<num>;
  hash?: str;
  error?: str;
}

interface IndexEntry {
  latestHash: str;
  pub: str;
  updatedAt: num;
}

export interface ListEntryInfo {
  key: str;
  hash: str;
  pub: str;
  updatedAt: num;
  data?: FrozenEntryData;
  verified?: bool;
}

interface ListOptions {
  verifyAll?: bool;
  maxAge?: mb<num>;
  limit?: num;
}

interface ObservationResult {
  observer: str;
  observation?: obj;
  timestamp?: num;
  verified?: bool;
  hash?: str;
  updatedAt?: num;
}

interface ReputationMetrics {
  proofsSuccessful: num;
  proofsFailed: num;
  totalResponseTimeMs: num;
  responseTimeSamples: num;
  pinsFulfilled: num;
  pinsRequested: num;
  selfRatings: num;
  externalRatings: num;
}

interface AggregatedReputation {
  totalObservers: num;
  observerBreakdown?: {
    self: num;
    external: num;
  };
  aggregated: mb<{
    proofSuccessRate: mb<num>;
    avgResponseTimeMs: mb<num>;
    pinFulfillmentRate: mb<num>;
    totalProofsObserved: num;
  }>;
  confidence: num;
  note?: str;
}

interface FrozenEntryCreateResult {
  hash: str;
  signature: str;
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
  data: obj,
  keyPair: SEAKeyPair,
  namespace: str,
  indexKey?: str
): prm<FrozenEntryCreateResult> {
  if (!gun || !data || !keyPair) {
    throw new Error('gun, data, and keyPair are required');
  }

  // Add metadata - merge with existing _meta if present
  // Use both _meta and meta to ensure GunDB persists at least one
  // GunDB may not persist fields starting with '_', so we also use 'meta'
  const metaData: FrozenEntryMeta = {
    ...(data._meta || data.meta || {}),
    pub: keyPair.pub,
    timestamp: Date.now(),
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
  log.info({
    namespace,
    indexKey,
    hasMeta: !!entry._meta,
    hasMetaAlt: !!entry.meta,
    metaPub: entry._meta?.pub?.substring(0, 16),
    dataKeys: Object.keys(entry).filter(k => k !== '_meta' && k !== 'meta'),
  }, 'Creating frozen entry with metadata');

  // Create signature
  const dataString = JSON.stringify(entry);
  const signature = await SEA.sign(dataString, keyPair);

  if (!signature) {
    throw new Error('Failed to sign data');
  }

  // Create content hash for addressing
  const hash = await SEA.work(dataString, null, null, { name: 'SHA-256' });

  if (!hash) {
    throw new Error('Failed to create content hash');
  }

  // Store in frozen space (content-addressed)
  const frozenEntry: FrozenEntry = {
    data: entry,
    sig: signature,
    hash: hash,
  };

  // Use 'frozen-' namespace instead of '#' to avoid GunDB auto-verification warnings
  // The '#' namespace triggers automatic hash verification which causes "Data hash not same as hash!" warnings
  // We manage immutability via content-addressing (hash) and SEA signatures instead
  // This approach is functionally equivalent but avoids the annoying warnings
  
  // Store the entry - GunDB may not preserve nested structures correctly when using .put() with nested objects
  // So we store the data as a JSON string to ensure all fields are preserved correctly
  const frozenNode = gun.get('frozen-' + namespace).get(hash);
  
  // Store signature and hash at the root level
  frozenNode.get('sig').put(signature);
  frozenNode.get('hash').put(hash);
  
  // Store data as JSON string to ensure GunDB persists it correctly
  // This avoids issues with nested object serialization
  const dataJson = JSON.stringify(entry);
  frozenNode.get('dataJson').put(dataJson);
  
  // Also store data as nested object for backward compatibility and easier reading
  // But we'll prioritize dataJson when reading
  frozenNode.get('data').put(entry as unknown as obj);

  // Update index to point to latest hash
  if (indexKey) {
    gun.get('shogun-index').get(namespace).get(indexKey).put({
      latestHash: hash,
      pub: keyPair.pub,
      updatedAt: Date.now(),
    });
  }

  log.info(`Frozen entry created: ${namespace}/${hash.substring(0, 16)}...`);

  return { hash, signature };
}

/**
 * Read and verify a frozen entry by hash
 * 
 * @param gun - GunDB instance
 * @param namespace - Index namespace
 * @param hash - Content hash
 * @returns Promise with data, verified status, and pub
 */
export async function readFrozenEntry(gun: GunInstance, namespace: str, hash: str): prm<mb<FrozenEntryResult>> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(undefined), 10000);

    gun.get('frozen-' + namespace).get(hash).once(async (entry: mb<FrozenEntry>) => {
      clearTimeout(timeout);

      if (!entry || !entry.data || !entry.sig) {
        resolve(undefined);
        return;
      }

      try {
        // IMPORTANT: Calculate dataString BEFORE any modifications to preserve hash integrity
        // The hash was calculated on the original data, so we must verify against the original data
        
        // Log the entry structure to debug metadata issues
        log.info({
          hash: hash.substring(0, 16),
          hasData: !!entry.data,
          hasMeta: !!entry.data._meta,
          hasMetaAlt: !!entry.data.meta,
          metaKeys: entry.data._meta ? Object.keys(entry.data._meta) : [],
          metaAltKeys: entry.data.meta ? Object.keys(entry.data.meta) : [],
          dataKeys: entry.data ? Object.keys(entry.data).filter(k => k !== '_meta' && k !== 'meta') : [],
        }, 'Reading frozen entry');
        
        // Normalize the data for verification
        // When creating, we store both _meta and meta with the same content
        // But GunDB may only persist one of them. We need to ensure the dataString
        // matches what was signed. Since we store both, we'll use the one that exists.
        // If both exist, we'll use _meta (the original format).
        // If only meta exists, we'll remove _meta (if present) to match what GunDB persisted.
        const normalizedData = { ...entry.data };
        
        // If only meta exists (GunDB didn't persist _meta), remove _meta from normalizedData
        // to match what GunDB actually stored
        if (normalizedData.meta && !normalizedData._meta) {
          // GunDB persisted only meta, so we verify against that format
          delete normalizedData._meta;
        } else if (normalizedData._meta && !normalizedData.meta) {
          // GunDB persisted only _meta, so we verify against that format
          delete normalizedData.meta;
        } else if (normalizedData._meta && normalizedData.meta) {
          // Both exist, use _meta (original format) and remove meta for consistency
          delete normalizedData.meta;
        }
        
        const dataString = JSON.stringify(normalizedData);
        // Try _meta first, then meta as fallback
        let pub = entry.data._meta?.pub || entry.data.meta?.pub;

        // If pub is missing, try to get it from the index
        if (!pub) {
          log.warn({
            hash: hash.substring(0, 16),
            hasMeta: !!entry.data._meta,
            hasMetaAlt: !!entry.data.meta,
            metaContent: entry.data._meta,
            metaAltContent: entry.data.meta,
          }, 'Pub missing from metadata, attempting index lookup');
          // Try to find pub from index by searching for this hash
          const indexNamespace = namespace.replace('frozen-', '');
          const indexLookup: prm<mb<str>> = new Promise((resolveIndex) => {
            let foundefined = false;
            const timeoutId = setTimeout(() => {
              if (!foundefined) resolveIndex(undefined);
            }, 2000);

            gun.get('shogun-index').get(indexNamespace).map().once((index: mb<IndexEntry>, _key?: str) => {
              if (index && index.latestHash === hash && index.pub) {
                foundefined = true;
                clearTimeout(timeoutId);
                resolveIndex(index.pub);
              }
            });
          });

          pub = await indexLookup;

          // If we foundefined pub from index, use it for verification but DO NOT modify the stored entry
          // Modifying the entry would change the data and break hash verification
          // The pub is only used for signature verification, not stored back
          if (pub) {
            log.info(`Recovered pub for frozen entry ${hash.substring(0, 16)}... from index`);
            // Note: We intentionally do NOT re-store the entry with pub added, as that would
            // change the data and invalidate the hash. The pub is only used for verification.
          }
        }

        // If still no pub after checking index, warn and skip verification
        if (!pub) {
          log.warn(`Frozen entry ${hash.substring(0, 16)}... missing pub in _meta, skipping signature verification`);
          resolve({
            data: entry.data,
            verified: false,
            verificationDetails: {
              signatureValid: false,
              hashValid: false,
              reason: 'Missing pub in _meta',
            },
            pub: undefined,
            timestamp: entry.data._meta?.timestamp || undefined,
            hash,
          });
          return;
        }

        // SEA.verify returns the original data if valid, or undefined/false if invalid
        const verifyResult = await SEA.verify(entry.sig, pub);
        const signatureValid = verifyResult !== undefined && verifyResult !== false;

        // Verify hash matches content (using original dataString, before any modifications)
        const expectedHash = await SEA.work(dataString, null, null, { name: 'SHA-256' });
        const hashValid = expectedHash === hash;
        const verified = signatureValid && hashValid;
        
        // Log verification details for debugging
        log.info({
          hash: hash.substring(0, 16),
          signatureValid,
          hashValid,
          verified,
          pub: pub.substring(0, 16),
          dataStringLength: dataString.length,
          hasMetaInData: !!entry.data._meta,
        }, 'Frozen entry verification result');

        resolve({
          data: entry.data,
          verified,
          verificationDetails: {
            signatureValid,
            hashValid,
          },
          pub: pub, // Use recovered pub if it was foundefined, otherwise use the one from _meta
          timestamp: entry.data._meta?.timestamp,
          hash,
        });
      } catch (error) {
        log.error({ err: error }, 'Verification error');
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
 * @param indexKey - Key to look up
 * @returns Promise with data and verified status
 */
export async function getLatestFrozenEntry(gun: GunInstance, namespace: str, indexKey: str): prm<mb<FrozenEntryResult>> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(undefined), 10000);

    gun.get('shogun-index').get(namespace).get(indexKey).once(async (index: mb<IndexEntry>) => {
      clearTimeout(timeout);

      if (!index || !index.latestHash) {
        resolve(undefined);
        return;
      }

      const entry = await readFrozenEntry(gun, namespace, index.latestHash);
      resolve(entry);
    });
  });
}

/**
 * List all entries in a namespace index
 * 
 * @param gun - GunDB instance
 * @param namespace - Index namespace
 * @param options - Filter options
 * @returns Promise with array of entries
 */
export async function listFrozenEntries(gun: GunInstance, namespace: str, options: ListOptions = {}): prm<arr<ListEntryInfo>> {
  const { verifyAll = false, maxAge = undefined, limit = 100 } = options;

  return new Promise((resolve) => {
    const entries: arr<ListEntryInfo> = [];
    const timeout = setTimeout(() => {
      resolve(entries.slice(0, limit));
    }, 5000);

    gun.get('shogun-index').get(namespace).map().once(async (index: mb<IndexEntry>, key?: str) => {
      if (!index || typeof index !== 'object' || !index.latestHash) return;

      // Filter by age if specified
      if (maxAge && index.updatedAt && Date.now() - index.updatedAt > maxAge) return;

      const entryInfo: ListEntryInfo = {
        key: key || '',
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
 * 
 * @param gun - GunDB instance
 * @param observedHost - Host being observed
 * @param observation - Observation data
 * @param observerKeyPair - Observer's SEA key pair
 * @returns Promise with hash
 */
export async function createFrozenObservation(
  gun: GunInstance,
  observedHost: str,
  observation: obj,
  observerKeyPair: SEAKeyPair
): prm<FrozenEntryCreateResult> {
  const data = {
    type: 'observation',
    observedHost,
    observation,
    observer: observerKeyPair.pub,
  };

  const result = await createFrozenEntry(
    gun,
    data,
    observerKeyPair,
    'observations',
    `${observedHost}:${observerKeyPair.pub.substring(0, 20)}`
  );

  // Also update aggregated index for the observed host
  gun.get('shogun-index').get('observations-by-host').get(observedHost).get(observerKeyPair.pub).put({
    hash: result.hash,
    updatedAt: Date.now(),
  });

  return result;
}

/**
 * Get all observations for a specific host
 * 
 * @param gun - GunDB instance
 * @param observedHost - Host to get observations for
 * @param options - Options
 * @returns Promise with array of observations
 */
export async function getObservationsForHost(
  gun: GunInstance,
  observedHost: str,
  options: { verifyAll?: bool; limit?: num } = {}
): prm<arr<ObservationResult>> {
  const { verifyAll = true, limit = 50 } = options;

  return new Promise((resolve) => {
    const observations: arr<ObservationResult> = [];
    const timeout = setTimeout(() => resolve(observations), 5000);

    gun.get('shogun-index').get('observations-by-host').get(observedHost).map().once(async (index: mb<{ hash: str; updatedAt: num }>, observerPub?: str) => {
      if (!index || !index.hash) return;

      if (verifyAll) {
        const entry = await readFrozenEntry(gun, 'observations', index.hash);
        if (entry && entry.verified) {
          observations.push({
            observer: observerPub || '',
            observation: (entry.data as { observation: obj }).observation,
            timestamp: entry.timestamp,
            verified: true,
          });
        }
      } else {
        observations.push({
          observer: observerPub || '',
          hash: index.hash,
          updatedAt: index.updatedAt,
        });
      }
    });

    setTimeout(() => {
      clearTimeout(timeout);
      resolve(observations.slice(0, limit));
    }, 3000);
  });
}

/**
 * Aggregate reputation from verified observations
 * Applies different weights to self-rating vs external observations
 * 
 * @param observations - Array of verified observations
 * @returns Aggregated reputation metrics
 */
export function aggregateReputation(observations: arr<ObservationResult>): AggregatedReputation {
  if (!observations || observations.length === 0) {
    return {
      totalObservers: 0,
      aggregated: undefined,
      confidence: 0,
    };
  }

  // Observer type weights (self-rating has reduced weight)
  const OBSERVER_WEIGHTS: Record<str, num> = {
    self: 0.1,      // Self-rating has only 10% weight
    external: 0.9,  // External observations have 90% weight
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

  observations.forEach(obs => {
    const o: obj = obs.observation || obs;

    // Determine observer type from observation details
    // Check if this is a reputation event with observerType field
    const observerType: str = o.details?.observerType ||
      (obs as unknown as { observerType?: str }).observerType ||
      'external'; // Default to external if unknown

    const weight = OBSERVER_WEIGHTS[observerType] || OBSERVER_WEIGHTS.external;

    // Count observer types
    if (observerType === 'self') {
      metrics.selfRatings += 1;
    } else {
      metrics.externalRatings += 1;
    }

    // Apply weights to metrics
    // For reputation events, check the event type
    if (o.type === 'reputation_event') {
      if (o.event === 'proof_success') {
        metrics.proofsSuccessful += weight; // Weighted count
        if (o.details?.responseTimeMs) {
          metrics.totalResponseTimeMs += o.details.responseTimeMs * weight;
          metrics.responseTimeSamples += weight;
        }
      } else if (o.event === 'proof_failure') {
        metrics.proofsFailed += weight; // Weighted count
      } else if (o.event === 'pin_fulfillment') {
        metrics.pinsRequested += weight;
        if (o.details?.fulfilled) {
          metrics.pinsFulfilled += weight;
        }
      }
    } else {
      // Legacy format - aggregate as before but with reduced weight for self-rating
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
      proofSuccessRate: proofsTotal > 0
        ? Math.roundefined((metrics.proofsSuccessful / proofsTotal) * 100)
        : undefined,
      avgResponseTimeMs: metrics.responseTimeSamples > 0
        ? Math.roundefined(metrics.totalResponseTimeMs / metrics.responseTimeSamples)
        : undefined,
      pinFulfillmentRate: metrics.pinsRequested > 0
        ? Math.roundefined((metrics.pinsFulfilled / metrics.pinsRequested) * 100)
        : undefined,
      totalProofsObserved: Math.roundefined(proofsTotal),
    },
    confidence: Math.min(100, metrics.externalRatings * 10), // Only external ratings count for confidence
    note: 'Self-ratings have reduced weight (10%) in reputation calculation',
  };
}

/**
 * Create a signed acknowledgment (receipt) for a previous entry
 * Implements the "ACK" concept: a = σ'(Φ'(m), p)
 * 
 * @param gun - GunDB instance
 * @param originalHash - Hash of the entry being acknowledged
 * @param message - Acknowledgment message (e.g., "Received and verified")
 * @param keyPair - Signer's SEA key pair
 * @returns Promise with hash
 */
export async function createSignedAcknowledgment(
  gun: GunInstance,
  originalHash: str,
  message: str,
  keyPair: SEAKeyPair
): prm<FrozenEntryCreateResult> {
  const data = {
    type: 'ack',
    re: originalHash, // Reference to original entry
    msg: message,
    signer: keyPair.pub,
  };

  const result = await createFrozenEntry(
    gun,
    data,
    keyPair,
    'acks',
    originalHash // Index by the original hash so we can find ACKs for it
  );

  log.info(`Signed ACK created for ${originalHash.substring(0, 8)}...`);
  return result;
}

/**
 * Create a signed reputation event
 * This replaces mutable metrics with immutable signed observations
 * 
 * @param gun - GunDB instance
 * @param subjectHost - The relay being rated
 * @param eventType - 'proof_success', 'proof_failure', 'pin_fulfillment'
 * @param details - Extra details (e.g. responseTimeMs)
 * @param observerKeyPair - Observer's SEA key pair
 */
export async function createSignedReputationEvent(
  gun: GunInstance,
  subjectHost: str,
  eventType: str,
  details: mb<obj>,
  observerKeyPair: SEAKeyPair
): prm<FrozenEntryCreateResult> {
  const observation = {
    type: 'reputation_event',
    event: eventType,
    subject: subjectHost,
    details: details || {},
    timestamp: Date.now()
  };

  // Use createFrozenObservation to store it
  // This automatically indexes it undefineder the subject host
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
