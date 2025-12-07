/**
 * Relay Reputation System
 * 
 * Tracks and calculates reputation scores for relays in the network.
 * Scores are based on:
 * - Uptime consistency
 * - Storage proof success rate
 * - Response times
 * - Pin request fulfillment
 * 
 * Data is stored in GunDB and synced across the network.
 */

// Reputation weights (must sum to 1.0)
const WEIGHTS = {
  uptime: 0.30,           // 30% - Consistent availability
  proofSuccess: 0.25,     // 25% - Storage proof reliability
  responseTime: 0.20,     // 20% - Speed of responses
  pinFulfillment: 0.15,   // 15% - Honoring pin requests
  longevity: 0.10,        // 10% - Time in network
};

// Thresholds
const THRESHOLDS = {
  minDataPoints: 10,              // Minimum events before scoring
  maxResponseTimeMs: 5000,        // Response times above this get 0 score
  idealResponseTimeMs: 500,       // Response times below this get 100 score
  uptimeWindowMs: 86400000,       // 24h window for uptime calculation
  maxLongevityDays: 365,          // Cap longevity bonus at 1 year
};

import * as FrozenData from './frozen-data.js';


/**
 * Calculate reputation score from metrics
 * @param {object} metrics - Relay metrics
 * @returns {object} - Score breakdown and total
 */
export function calculateReputationScore(metrics) {
  const scores = {};
  
  // 1. Uptime Score (0-100)
  // Based on pulse consistency in last 24h
  if (metrics.uptimePercent !== undefined) {
    scores.uptime = Math.min(100, metrics.uptimePercent);
  } else if (metrics.expectedPulses && metrics.receivedPulses) {
    scores.uptime = Math.min(100, (metrics.receivedPulses / metrics.expectedPulses) * 100);
  } else {
    scores.uptime = 50; // Default for unknown
  }

  // 2. Proof Success Score (0-100)
  if (metrics.proofsTotal > 0) {
    scores.proofSuccess = (metrics.proofsSuccessful / metrics.proofsTotal) * 100;
  } else {
    scores.proofSuccess = 50; // Default for no data
  }

  // 3. Response Time Score (0-100)
  // Inverse scale: faster = higher score
  if (metrics.avgResponseTimeMs !== undefined) {
    if (metrics.avgResponseTimeMs <= THRESHOLDS.idealResponseTimeMs) {
      scores.responseTime = 100;
    } else if (metrics.avgResponseTimeMs >= THRESHOLDS.maxResponseTimeMs) {
      scores.responseTime = 0;
    } else {
      // Linear interpolation
      const range = THRESHOLDS.maxResponseTimeMs - THRESHOLDS.idealResponseTimeMs;
      const excess = metrics.avgResponseTimeMs - THRESHOLDS.idealResponseTimeMs;
      scores.responseTime = 100 - (excess / range) * 100;
    }
  } else {
    scores.responseTime = 50; // Default
  }

  // 4. Pin Fulfillment Score (0-100)
  if (metrics.pinRequestsReceived > 0) {
    scores.pinFulfillment = (metrics.pinRequestsFulfilled / metrics.pinRequestsReceived) * 100;
  } else {
    scores.pinFulfillment = 50; // Default
  }

  // 5. Longevity Score (0-100)
  // Based on how long relay has been in network
  if (metrics.firstSeenTimestamp) {
    const daysInNetwork = (Date.now() - metrics.firstSeenTimestamp) / (1000 * 60 * 60 * 24);
    scores.longevity = Math.min(100, (daysInNetwork / THRESHOLDS.maxLongevityDays) * 100);
  } else {
    scores.longevity = 0;
  }

  // Calculate weighted total
  const totalScore = 
    scores.uptime * WEIGHTS.uptime +
    scores.proofSuccess * WEIGHTS.proofSuccess +
    scores.responseTime * WEIGHTS.responseTime +
    scores.pinFulfillment * WEIGHTS.pinFulfillment +
    scores.longevity * WEIGHTS.longevity;

  // Determine tier
  let tier;
  if (totalScore >= 90) tier = 'excellent';
  else if (totalScore >= 75) tier = 'good';
  else if (totalScore >= 50) tier = 'average';
  else if (totalScore >= 25) tier = 'poor';
  else tier = 'unreliable';

  return {
    total: Math.round(totalScore * 100) / 100,
    tier,
    breakdown: {
      uptime: Math.round(scores.uptime * 100) / 100,
      proofSuccess: Math.round(scores.proofSuccess * 100) / 100,
      responseTime: Math.round(scores.responseTime * 100) / 100,
      pinFulfillment: Math.round(scores.pinFulfillment * 100) / 100,
      longevity: Math.round(scores.longevity * 100) / 100,
    },
    weights: WEIGHTS,
    hasEnoughData: (metrics.dataPoints || 0) >= THRESHOLDS.minDataPoints,
  };
}

/**
 * Initialize reputation tracking for a relay
 * @param {Gun} gun - GunDB instance
 * @param {string} relayHost - Host identifier
 */
export function initReputationTracking(gun, relayHost) {
  const reputationNode = gun.get('shogun-network').get('reputation').get(relayHost);
  
  // Check if already initialized
  reputationNode.once((data) => {
    if (!data || !data.firstSeenTimestamp) {
      // Initialize with default metrics
      reputationNode.put({
        host: relayHost,
        firstSeenTimestamp: Date.now(),
        lastSeenTimestamp: Date.now(),
        dataPoints: 0,
        // Proof metrics
        proofsTotal: 0,
        proofsSuccessful: 0,
        proofsFailed: 0,
        // Response time (rolling average)
        avgResponseTimeMs: 0,
        responseTimeSamples: 0,
        // Pin fulfillment
        pinRequestsReceived: 0,
        pinRequestsFulfilled: 0,
        // Uptime tracking
        expectedPulses: 0,
        receivedPulses: 0,
        uptimePercent: 100,
        // Calculated score (updated periodically)
        score: 50,
        tier: 'average',
        lastScoreUpdate: Date.now(),
      });
      console.log(`📊 Reputation tracking initialized for ${relayHost}`);
    }
  });
  
  return reputationNode;
}

/**
 * Record a successful storage proof (Signed)
 * @param {Gun} gun - GunDB instance
 * @param {string} relayHost - Host that provided the proof
 * @param {number} responseTimeMs - Time to generate proof
 * @param {object} observerKeyPair - Observer's SEA key pair (REQUIRED)
 */
export async function recordProofSuccess(gun, relayHost, responseTimeMs = 0, observerKeyPair) {
  if (!observerKeyPair) {
    console.warn('⚠️ recordProofSuccess called without keyPair - falling back to unsigned (deprecated)');
    // Legacy fallback (mutable counter)
    const node = gun.get('shogun-network').get('reputation').get(relayHost);
    return new Promise((resolve) => {
      node.once((data) => {
        const current = data || {};
        const newAvgResponseTime = current.responseTimeSamples > 0
          ? ((current.avgResponseTimeMs * current.responseTimeSamples) + responseTimeMs) / (current.responseTimeSamples + 1)
          : responseTimeMs;
        
        node.put({
          proofsTotal: (current.proofsTotal || 0) + 1,
          proofsSuccessful: (current.proofsSuccessful || 0) + 1,
          avgResponseTimeMs: Math.round(newAvgResponseTime),
          responseTimeSamples: (current.responseTimeSamples || 0) + 1,
          dataPoints: (current.dataPoints || 0) + 1,
          lastSeenTimestamp: Date.now(),
        });
        resolve();
      });
    });
  }

  // New Signed Path
  await FrozenData.createSignedReputationEvent(
    gun, 
    relayHost, 
    'proof_success', 
    { responseTimeMs }, 
    observerKeyPair
  );
  
  // Update local optimistic cache/index for backward compatibility
  // (We still write to generic node for non-validating clients, but truth is in frozen-data)
  const node = gun.get('shogun-network').get('reputation').get(relayHost);
  node.once((data) => {
    const current = data || {};
    const newAvgResponseTime = current.responseTimeSamples > 0
      ? ((current.avgResponseTimeMs * current.responseTimeSamples) + responseTimeMs) / (current.responseTimeSamples + 1)
      : responseTimeMs;
    
    node.put({
      proofsTotal: (current.proofsTotal || 0) + 1,
      proofsSuccessful: (current.proofsSuccessful || 0) + 1,
      avgResponseTimeMs: Math.round(newAvgResponseTime),
      responseTimeSamples: (current.responseTimeSamples || 0) + 1,
      dataPoints: (current.dataPoints || 0) + 1,
      lastSeenTimestamp: Date.now(),
    });
  });
}

/**
 * Record a failed storage proof (Signed)
 * @param {Gun} gun - GunDB instance
 * @param {string} relayHost - Host that failed the proof
 * @param {object} observerKeyPair - Observer's SEA key pair (REQUIRED)
 */
export async function recordProofFailure(gun, relayHost, observerKeyPair) {
  if (!observerKeyPair) {
    console.warn('⚠️ recordProofFailure called without keyPair - falling back to unsigned');
    const node = gun.get('shogun-network').get('reputation').get(relayHost);
    return new Promise((resolve) => {
      node.once((data) => {
        const current = data || {};
        node.put({
          proofsTotal: (current.proofsTotal || 0) + 1,
          proofsFailed: (current.proofsFailed || 0) + 1,
          dataPoints: (current.dataPoints || 0) + 1,
          lastSeenTimestamp: Date.now(),
        });
        resolve();
      });
    });
  }

  // New Signed Path
  await FrozenData.createSignedReputationEvent(
    gun, 
    relayHost, 
    'proof_failure', 
    {}, 
    observerKeyPair
  );
  
  // Optimistic update
  const node = gun.get('shogun-network').get('reputation').get(relayHost);
  node.once((data) => {
    const current = data || {};
    node.put({
      proofsTotal: (current.proofsTotal || 0) + 1,
      proofsFailed: (current.proofsFailed || 0) + 1,
      dataPoints: (current.dataPoints || 0) + 1,
      lastSeenTimestamp: Date.now(),
    });
  });
}

/**
 * Record pin request fulfillment (Signed)
 * @param {Gun} gun - GunDB instance
 * @param {string} relayHost - Host that fulfilled the request
 * @param {boolean} fulfilled - Whether the request was fulfilled
 * @param {object} observerKeyPair - Observer's SEA key pair (REQUIRED)
 */
export async function recordPinFulfillment(gun, relayHost, fulfilled, observerKeyPair) {
  if (!observerKeyPair) {
    console.warn('⚠️ recordPinFulfillment called without keyPair - falling back to unsigned');
    const node = gun.get('shogun-network').get('reputation').get(relayHost);
    return new Promise((resolve) => {
      node.once((data) => {
        const current = data || {};
        const update = {
          pinRequestsReceived: (current.pinRequestsReceived || 0) + 1,
          dataPoints: (current.dataPoints || 0) + 1,
          lastSeenTimestamp: Date.now(),
        };
        if (fulfilled) {
          update.pinRequestsFulfilled = (current.pinRequestsFulfilled || 0) + 1;
        }
        node.put(update);
        resolve();
      });
    });
  }

  // New Signed Path
  await FrozenData.createSignedReputationEvent(
    gun, 
    relayHost, 
    'pin_fulfillment', 
    { fulfilled }, 
    observerKeyPair
  );
  
  // Optimistic update
  const node = gun.get('shogun-network').get('reputation').get(relayHost);
  node.once((data) => {
    const current = data || {};
    const update = {
      pinRequestsReceived: (current.pinRequestsReceived || 0) + 1,
      dataPoints: (current.dataPoints || 0) + 1,
      lastSeenTimestamp: Date.now(),
    };
    if (fulfilled) {
      update.pinRequestsFulfilled = (current.pinRequestsFulfilled || 0) + 1;
    }
    node.put(update);
  });
}

/**
 * Record relay pulse (for uptime tracking)
 * @param {Gun} gun - GunDB instance
 * @param {string} relayHost - Host that sent the pulse
 */
export async function recordPulse(gun, relayHost) {
  const node = gun.get('shogun-network').get('reputation').get(relayHost);
  
  return new Promise((resolve) => {
    node.once((data) => {
      const current = data || {};
      const received = (current.receivedPulses || 0) + 1;
      
      // Calculate expected pulses since first seen
      // Assuming 30s pulse interval
      const timeSinceFirstSeen = Date.now() - (current.firstSeenTimestamp || Date.now());
      const expected = Math.max(1, Math.floor(timeSinceFirstSeen / 30000));
      
      // Calculate uptime percentage (capped at 100%)
      const uptimePercent = Math.min(100, (received / expected) * 100);
      
      node.put({
        receivedPulses: received,
        expectedPulses: expected,
        uptimePercent: Math.round(uptimePercent * 100) / 100,
        lastSeenTimestamp: Date.now(),
      });
      
      resolve();
    });
  });
}

/**
 * Get reputation data for a relay
 * @param {Gun} gun - GunDB instance
 * @param {string} relayHost - Host to query
 * @returns {Promise<object>} - Reputation data with calculated score
 */
export async function getReputation(gun, relayHost) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 5000);
    
    gun.get('shogun-network').get('reputation').get(relayHost).once((data) => {
      clearTimeout(timeout);
      
      if (!data || typeof data !== 'object') {
        resolve(null);
        return;
      }
      
      // Filter GunDB metadata
      const metrics = {};
      Object.keys(data).forEach(key => {
        if (!['_', '#', '>', '<'].includes(key)) {
          metrics[key] = data[key];
        }
      });
      
      // Calculate current score
      const score = calculateReputationScore(metrics);
      
      resolve({
        ...metrics,
        calculatedScore: score,
      });
    });
  });
}

/**
 * Get all relays sorted by reputation
 * @param {Gun} gun - GunDB instance
 * @param {object} options - Filter options
 * @returns {Promise<array>} - Sorted relay list
 */
export async function getReputationLeaderboard(gun, options = {}) {
  const { minScore = 0, tier = null, limit = 50 } = options;
  
  return new Promise((resolve) => {
    const relays = [];
    const timeout = setTimeout(() => {
      // Sort and return
      relays.sort((a, b) => b.calculatedScore.total - a.calculatedScore.total);
      resolve(relays.slice(0, limit));
    }, 3000);
    
    gun.get('shogun-network').get('reputation').map().once((data, host) => {
      if (!data || typeof data !== 'object') return;
      
      // Filter GunDB metadata
      const metrics = {};
      Object.keys(data).forEach(key => {
        if (!['_', '#', '>', '<'].includes(key)) {
          metrics[key] = data[key];
        }
      });
      
      const score = calculateReputationScore(metrics);
      
      // Apply filters
      if (score.total < minScore) return;
      if (tier && score.tier !== tier) return;
      
      relays.push({
        host,
        ...metrics,
        calculatedScore: score,
      });
    });
    
    // Allow time for GunDB to collect
    setTimeout(() => {
      clearTimeout(timeout);
      relays.sort((a, b) => b.calculatedScore.total - a.calculatedScore.total);
      resolve(relays.slice(0, limit));
    }, 2500);
  });
}

/**
 * Update stored score (call periodically)
 * @param {Gun} gun - GunDB instance
 * @param {string} relayHost - Host to update
 */
export async function updateStoredScore(gun, relayHost) {
  const reputation = await getReputation(gun, relayHost);
  
  if (reputation) {
    gun.get('shogun-network').get('reputation').get(relayHost).put({
      score: reputation.calculatedScore.total,
      tier: reputation.calculatedScore.tier,
      lastScoreUpdate: Date.now(),
    });
  }
}

export default {
  calculateReputationScore,
  initReputationTracking,
  recordProofSuccess,
  recordProofFailure,
  recordPinFulfillment,
  recordPulse,
  getReputation,
  getReputationLeaderboard,
  updateStoredScore,
  WEIGHTS,
  THRESHOLDS,
};

