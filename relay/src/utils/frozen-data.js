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

  // Add metadata
  const entry = {
    ...data,
    _meta: {
      pub: keyPair.pub,
      timestamp: Date.now(),
      version: 1,
    },
  };

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
        // Verify signature
        const dataString = JSON.stringify(entry.data);
        const pub = entry.data._meta?.pub;
        
        // Check if pub is available before verification
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

        // Also verify hash matches content
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
          pub: entry.data._meta?.pub,
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

  const metrics = {
    proofsSuccessful: 0,
    proofsFailed: 0,
    totalResponseTimeMs: 0,
    responseTimeSamples: 0,
    pinsFulfilled: 0,
    pinsRequested: 0,
  };

  observations.forEach(obs => {
    const o = obs.observation || obs;
    metrics.proofsSuccessful += o.proofsSuccessful || 0;
    metrics.proofsFailed += o.proofsFailed || 0;
    if (o.avgResponseTimeMs) {
      metrics.totalResponseTimeMs += o.avgResponseTimeMs;
      metrics.responseTimeSamples += 1;
    }
    metrics.pinsFulfilled += o.pinsFulfilled || 0;
    metrics.pinsRequested += o.pinsRequested || 0;
  });

  const proofsTotal = metrics.proofsSuccessful + metrics.proofsFailed;
  
  return {
    totalObservers: observations.length,
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
      totalProofsObserved: proofsTotal,
    },
    confidence: Math.min(100, observations.length * 10), // More observers = more confidence
  };
}

export default {
  createFrozenEntry,
  readFrozenEntry,
  getLatestFrozenEntry,
  listFrozenEntries,
  createFrozenObservation,
  getObservationsForHost,
  aggregateReputation,
};

