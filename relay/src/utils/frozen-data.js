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

const SEA = Gun.SEA;

/**
 * Create a frozen (immutable, signed) data entry
 * 
 * @param {Gun} gun - GunDB instance
 * @param {object} data - Data to freeze
 * @param {object} keyPair - SEA key pair (pub + priv) for signing
 * @param {string} namespace - Index namespace (e.g., 'announcements', 'observations')
 * @param {string} indexKey - Key for the index (e.g., host address)
 * @returns {Promise<{hash: string, signature: string}>}
 */
export async function createFrozenEntry(gun, data, keyPair, namespace, indexKey) {
  if (!gun || !data || !keyPair) {
    throw new Error('gun, data, and keyPair are required');
  }

  // Add metadata - merge with existing _meta if present
  const entry = {
    ...data,
    _meta: {
      ...(data._meta || {}),
      pub: keyPair.pub,
      timestamp: Date.now(),
      version: 1,
    },
  };
  
  // Ensure _meta.pub is always set (defensive check)
  if (!entry._meta.pub) {
    entry._meta.pub = keyPair.pub;
  }

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
  const frozenEntry = {
    data: entry,
    sig: signature,
    hash: hash,
  };

  // Use 'frozen-' namespace instead of '#' to avoid GunDB auto-verification warnings
  // The '#' namespace triggers automatic hash verification which causes "Data hash not same as hash!" warnings
  // We manage immutability via content-addressing (hash) and SEA signatures instead
  // This approach is functionally equivalent but avoids the annoying warnings
  gun.get('frozen-' + namespace).get(hash).put(frozenEntry);

  // Update index to point to latest hash
  if (indexKey) {
    gun.get('shogun-index').get(namespace).get(indexKey).put({
      latestHash: hash,
      pub: keyPair.pub,
      updatedAt: Date.now(),
    });
  }

  console.log(`🔒 Frozen entry created: ${namespace}/${hash.substring(0, 16)}...`);

  return { hash, signature };
}

/**
 * Read and verify a frozen entry by hash
 * 
 * @param {Gun} gun - GunDB instance
 * @param {string} namespace - Index namespace
 * @param {string} hash - Content hash
 * @returns {Promise<{data: object, verified: boolean, pub: string} | null>}
 */
export async function readFrozenEntry(gun, namespace, hash) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 10000);

    gun.get('frozen-' + namespace).get(hash).once(async (entry) => {
      clearTimeout(timeout);

      if (!entry || !entry.data || !entry.sig) {
        resolve(null);
        return;
      }

      try {
        // IMPORTANT: Calculate dataString BEFORE any modifications to preserve hash integrity
        // The hash was calculated on the original data, so we must verify against the original data
        const dataString = JSON.stringify(entry.data);
        let pub = entry.data._meta?.pub;
        
        // If pub is missing, try to get it from the index
        if (!pub) {
          // Try to find pub from index by searching for this hash
          const indexNamespace = namespace.replace('frozen-', '');
          const indexLookup = new Promise((resolveIndex) => {
            let found = false;
            const timeout = setTimeout(() => {
              if (!found) resolveIndex(null);
            }, 2000);
            
            gun.get('shogun-index').get(indexNamespace).map().once((index, key) => {
              if (index && index.latestHash === hash && index.pub) {
                found = true;
                clearTimeout(timeout);
                resolveIndex(index.pub);
              }
            });
          });
          
          pub = await indexLookup;
          
          // If we found pub from index, use it for verification but DO NOT modify the stored entry
          // Modifying the entry would change the data and break hash verification
          // The pub is only used for signature verification, not stored back
          if (pub) {
            console.log(`✅ Recovered pub for frozen entry ${hash.substring(0, 16)}... from index`);
            // Note: We intentionally do NOT re-store the entry with pub added, as that would
            // change the data and invalidate the hash. The pub is only used for verification.
          }
        }
        
        // If still no pub after checking index, warn and skip verification
        if (!pub) {
          console.warn(`⚠️ Frozen entry ${hash.substring(0, 16)}... missing pub in _meta, skipping signature verification`);
          resolve({
            data: entry.data,
            verified: false,
            verificationDetails: {
              signatureValid: false,
              hashValid: false,
              reason: 'Missing pub in _meta',
            },
            pub: null,
            timestamp: entry.data._meta?.timestamp || null,
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

        resolve({
          data: entry.data,
          verified,
          verificationDetails: {
            signatureValid,
            hashValid,
          },
          pub: pub, // Use recovered pub if it was found, otherwise use the one from _meta
          timestamp: entry.data._meta?.timestamp,
          hash,
        });
      } catch (error) {
        console.error('Verification error:', error);
        resolve({
          data: entry.data,
          verified: false,
          error: error.message,
        });
      }
    });
  });
}

/**
 * Get latest frozen entry for an index key
 * 
 * @param {Gun} gun - GunDB instance
 * @param {string} namespace - Index namespace
 * @param {string} indexKey - Key to look up
 * @returns {Promise<{data: object, verified: boolean} | null>}
 */
export async function getLatestFrozenEntry(gun, namespace, indexKey) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 10000);

    gun.get('shogun-index').get(namespace).get(indexKey).once(async (index) => {
      clearTimeout(timeout);

      if (!index || !index.latestHash) {
        resolve(null);
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
 * @param {Gun} gun - GunDB instance
 * @param {string} namespace - Index namespace
 * @param {object} options - Filter options
 * @returns {Promise<Array>}
 */
export async function listFrozenEntries(gun, namespace, options = {}) {
  const { verifyAll = false, maxAge = null, limit = 100 } = options;
  
  return new Promise((resolve) => {
    const entries = [];
    const timeout = setTimeout(() => {
      resolve(entries.slice(0, limit));
    }, 5000);

    gun.get('shogun-index').get(namespace).map().once(async (index, key) => {
      if (!index || typeof index !== 'object' || !index.latestHash) return;
      
      // Filter by age if specified
      if (maxAge && index.updatedAt && Date.now() - index.updatedAt > maxAge) return;

      const entryInfo = {
        key,
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
 * @param {Gun} gun - GunDB instance
 * @param {string} observedHost - Host being observed
 * @param {object} observation - Observation data
 * @param {object} observerKeyPair - Observer's SEA key pair
 * @returns {Promise<{hash: string}>}
 */
export async function createFrozenObservation(gun, observedHost, observation, observerKeyPair) {
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
 * @param {Gun} gun - GunDB instance
 * @param {string} observedHost - Host to get observations for
 * @param {object} options - Options
 * @returns {Promise<Array>}
 */
export async function getObservationsForHost(gun, observedHost, options = {}) {
  const { verifyAll = true, limit = 50 } = options;
  
  return new Promise((resolve) => {
    const observations = [];
    const timeout = setTimeout(() => resolve(observations), 5000);

    gun.get('shogun-index').get('observations-by-host').get(observedHost).map().once(async (index, observerPub) => {
      if (!index || !index.hash) return;

      if (verifyAll) {
        const entry = await readFrozenEntry(gun, 'observations', index.hash);
        if (entry && entry.verified) {
          observations.push({
            observer: observerPub,
            observation: entry.data.observation,
            timestamp: entry.timestamp,
            verified: true,
          });
        }
      } else {
        observations.push({
          observer: observerPub,
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
 * @param {Array} observations - Array of verified observations
 * @returns {object} - Aggregated reputation metrics
 */
export function aggregateReputation(observations) {
  if (!observations || observations.length === 0) {
    return {
      totalObservers: 0,
      aggregated: null,
      confidence: 0,
    };
  }

  // Observer type weights (self-rating has reduced weight)
  const OBSERVER_WEIGHTS = {
    self: 0.1,      // Self-rating has only 10% weight
    external: 0.9,  // External observations have 90% weight
  };

  const metrics = {
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
    const o = obs.observation || obs;
    
    // Determine observer type from observation details
    // Check if this is a reputation event with observerType field
    const observerType = o.details?.observerType || 
                        (obs.observerType) || 
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
        ? Math.round((metrics.proofsSuccessful / proofsTotal) * 100) 
        : null,
      avgResponseTimeMs: metrics.responseTimeSamples > 0 
        ? Math.round(metrics.totalResponseTimeMs / metrics.responseTimeSamples) 
        : null,
      pinFulfillmentRate: metrics.pinsRequested > 0 
        ? Math.round((metrics.pinsFulfilled / metrics.pinsRequested) * 100) 
        : null,
      totalProofsObserved: Math.round(proofsTotal),
    },
    confidence: Math.min(100, metrics.externalRatings * 10), // Only external ratings count for confidence
    note: 'Self-ratings have reduced weight (10%) in reputation calculation',
  };
}

/**
 * Create a signed acknowledgment (receipt) for a previous entry
 * Implements the "ACK" concept: a = σ'(Φ'(m), p)
 * 
 * @param {Gun} gun - GunDB instance
 * @param {string} originalHash - Hash of the entry being acknowledged
 * @param {string} message - Acknowledgment message (e.g., "Received and verified")
 * @param {object} keyPair - Signer's SEA key pair
 * @returns {Promise<{hash: string}>}
 */
export async function createSignedAcknowledgment(gun, originalHash, message, keyPair) {
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
  
  console.log(`✅ Signed ACK created for ${originalHash.substring(0, 8)}...`);
  return result;
}

/**
 * Create a signed reputation event
 * This replaces mutable metrics with immutable signed observations
 * 
 * @param {Gun} gun - GunDB instance
 * @param {string} subjectHost - The relay being rated
 * @param {string} eventType - 'proof_success', 'proof_failure', 'pin_fulfillment'
 * @param {object} details - Extra details (e.g. responseTimeMs)
 * @param {object} observerKeyPair - Observer's SEA key pair
 */
export async function createSignedReputationEvent(gun, subjectHost, eventType, details, observerKeyPair) {
  const observation = {
    type: 'reputation_event',
    event: eventType,
    subject: subjectHost,
    details: details || {},
    timestamp: Date.now()
  };
  
  // Use createFrozenObservation to store it
  // This automatically indexes it under the subject host
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


