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
 * 
 * SECURITY: Anti-Self-Rating Protection
 * - Self-ratings (relay rating itself) are detected and marked with observerType='self'
 * - Self-ratings have reduced weight (10%) in reputation calculation
 * - External observations have full weight (90%) in reputation calculation
 * - All reputation events are stored as signed, immutable frozen observations
 * - The cache is optimistic but frozen observations are the source of truth
 */

import * as FrozenData from './frozen-data';
import { getRelayPub } from './relay-user';
import { loggers } from './logger';

const log = loggers.reputation;

// Interfaces
import type { IGunInstanceRoot, IGunChain, IGunInstance } from 'gun/types/gun';

type GunInstance = IGunInstanceRoot<any, any>;
type GunNode = IGunChain<any, any, any, any>;

interface SEAKeyPair {
  pub: str;
  priv: str;
  epub?: str;
  epriv?: str;
}

interface GunAck {
  err?: str;
  ok?: bool;
}

interface ReputationWeights {
  uptime: num;
  proofSuccess: num;
  responseTime: num;
  pinFulfillment: num;
  longevity: num;
}

interface ReputationThresholds {
  minDataPoints: num;
  maxResponseTimeMs: num;
  idealResponseTimeMs: num;
  uptimeWindowMs: num;
  maxLongevityDays: num;
}

interface ReputationMetrics {
  host?: str;
  firstSeenTimestamp?: num;
  lastSeenTimestamp?: num;
  dataPoints?: num;
  proofsTotal?: num;
  proofsSuccessful?: num;
  proofsFailed?: num;
  avgResponseTimeMs?: num;
  responseTimeSamples?: num;
  pinRequestsReceived?: num;
  pinRequestsFulfilled?: num;
  expectedPulses?: num;
  receivedPulses?: num;
  uptimePercent?: num;
  score?: num;
  tier?: str;
  lastScoreUpdate?: num;
  _lastUpdateId?: str;
  [key: str]: unknown;
}

interface ScoreBreakdown {
  uptime: num;
  proofSuccess: num;
  responseTime: num;
  pinFulfillment: num;
  longevity: num;
}

interface ReputationScore {
  total: num;
  tier: str;
  breakdown: ScoreBreakdown;
  weights: ReputationWeights;
  hasEnoughData: bool;
}

interface LeaderboardEntry extends ReputationMetrics {
  calculatedScore: ReputationScore;
}

interface LeaderboardOptions {
  minScore?: num;
  tier?: mb<str>;
  limit?: num;
}

// Reputation weights (must sum to 1.0)
const WEIGHTS: ReputationWeights = {
  uptime: 0.30,           // 30% - Consistent availability
  proofSuccess: 0.25,     // 25% - Storage proof reliability
  responseTime: 0.20,     // 20% - Speed of responses
  pinFulfillment: 0.15,   // 15% - Honoring pin requests
  longevity: 0.10,        // 10% - Time in network
};

// Thresholds
const THRESHOLDS: ReputationThresholds = {
  minDataPoints: 10,              // Minimum events before scoring
  maxResponseTimeMs: 5000,        // Response times above this get 0 score
  idealResponseTimeMs: 500,       // Response times below this get 100 score
  uptimeWindowMs: 86400000,       // 24h window for uptime calculation
  maxLongevityDays: 365,          // Cap longevity bonus at 1 year
};

// Simple mutex-like lock for preventing concurrent counter updates
// Key = relayHost, Value = timestamp of lock acquisition
const updateLocks = new Map<str, num>();
const LOCK_TIMEOUT_MS = 5000;

/**
 * Acquire a lock for updating a relay's reputation
 * @param relayHost - Host identifier
 * @returns True if lock acquired
 */
function acquireLock(relayHost: str): bool {
  const now = Date.now();
  const existingLock = updateLocks.get(relayHost);

  // Check if existing lock has expired
  if (existingLock && (now - existingLock) < LOCK_TIMEOUT_MS) {
    return false; // Lock held by another operation
  }

  updateLocks.set(relayHost, now);
  return true;
}

/**
 * Release a lock for a relay
 * @param relayHost - Host identifier
 */
function releaseLock(relayHost: str): void {
  updateLocks.delete(relayHost);
}

// Observer type constants
export const OBSERVER_TYPE = {
  SELF: 'self' as const,           // Relay rating itself
  EXTERNAL: 'external' as const,   // External observer rating the relay
};

// Reputation calculation weights for different observer types
// Self-ratings have reduced weight to prevent manipulation
export const OBSERVER_WEIGHTS: Record<str, num> = {
  self: 0.1,      // Self-rating has only 10% weight
  external: 0.9,  // External observations have 90% weight
};

/**
 * Check if observer is rating themselves (self-rating)
 * @param relayHost - Host being rated
 * @param observerKeyPair - Observer's keypair
 * @returns True if this is self-rating
 */
export function isSelfRating(relayHost: str, observerKeyPair: mb<SEAKeyPair>): bool {
  if (!observerKeyPair || !observerKeyPair.pub) {
    return false; // Can't determine without keypair
  }

  const currentRelayPub = getRelayPub();
  if (!currentRelayPub) {
    return false; // Can't determine without current relay pub
  }

  // Check if observer's pub matches current relay's pub
  // This indicates the relay is rating itself
  return observerKeyPair.pub === currentRelayPub;
}

/**
 * Get observer type for reputation event
 * @param relayHost - Host being rated
 * @param observerKeyPair - Observer's keypair
 * @returns 'self' or 'external'
 */
export function getObserverType(relayHost: str, observerKeyPair: mb<SEAKeyPair>): str {
  return isSelfRating(relayHost, observerKeyPair)
    ? OBSERVER_TYPE.SELF
    : OBSERVER_TYPE.EXTERNAL;
}

/**
 * Calculate reputation score from metrics
 * @param metrics - Relay metrics
 * @returns Score breakdown and total
 */
export function calculateReputationScore(metrics: ReputationMetrics): ReputationScore {
  const scores: Partial<ScoreBreakdown> = {};

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
  if (metrics.proofsTotal && metrics.proofsTotal > 0) {
    scores.proofSuccess = ((metrics.proofsSuccessful || 0) / metrics.proofsTotal) * 100;
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
  if (metrics.pinRequestsReceived && metrics.pinRequestsReceived > 0) {
    scores.pinFulfillment = ((metrics.pinRequestsFulfilled || 0) / metrics.pinRequestsReceived) * 100;
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
    (scores.uptime || 0) * WEIGHTS.uptime +
    (scores.proofSuccess || 0) * WEIGHTS.proofSuccess +
    (scores.responseTime || 0) * WEIGHTS.responseTime +
    (scores.pinFulfillment || 0) * WEIGHTS.pinFulfillment +
    (scores.longevity || 0) * WEIGHTS.longevity;

  // Determine tier
  let tier: str;
  if (totalScore >= 90) tier = 'excellent';
  else if (totalScore >= 75) tier = 'good';
  else if (totalScore >= 50) tier = 'average';
  else if (totalScore >= 25) tier = 'poor';
  else tier = 'unreliable';

  return {
    total: Math.round(totalScore * 100) / 100,
    tier,
    breakdown: {
      uptime: Math.round((scores.uptime || 0) * 100) / 100,
      proofSuccess: Math.round((scores.proofSuccess || 0) * 100) / 100,
      responseTime: Math.round((scores.responseTime || 0) * 100) / 100,
      pinFulfillment: Math.round((scores.pinFulfillment || 0) * 100) / 100,
      longevity: Math.round((scores.longevity || 0) * 100) / 100,
    },
    weights: WEIGHTS,
    hasEnoughData: (metrics.dataPoints || 0) >= THRESHOLDS.minDataPoints,
  };
}

/**
 * Initialize reputation tracking for a relay
 * @param gun - GunDB instance
 * @param relayHost - Host identifier
 */
export function initReputationTracking(gun: GunInstance, relayHost: str): GunNode {
  const reputationNode = gun.get('shogun-network').get('reputation').get(relayHost);

  // Check if already initialized
  reputationNode.once((data: mb<ReputationMetrics>) => {
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
      log.info(`Reputation tracking initialized for ${relayHost}`);
    }
  });

  return reputationNode;
}

/**
 * Record a successful storage proof (Signed)
 * Uses lock to prevent race conditions on counter updates.
 * @param gun - GunDB instance
 * @param relayHost - Host that provided the proof
 * @param responseTimeMs - Time to generate proof
 * @param observerKeyPair - Observer's SEA key pair (REQUIRED)
 */
export async function recordProofSuccess(
  gun: GunInstance,
  relayHost: str,
  responseTimeMs: num = 0,
  observerKeyPair?: SEAKeyPair
): prm<void> {
  // SECURITY: Prevent self-rating (relay rating itself)
  if (observerKeyPair && isSelfRating(relayHost, observerKeyPair)) {
    log.warn(`Blocked self-rating attempt: relay ${relayHost} attempted to rate itself`);
    // Still allow the event to be recorded but mark it as self-rating
  }

  // Acquire lock to prevent concurrent updates
  const maxWaitMs = 3000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) {
      log.warn(`recordProofSuccess: timeout waiting for lock on ${relayHost}`);
      break; // Proceed anyway after timeout
    }
    await new Promise(r => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn('recordProofSuccess called without keyPair - falling back to unsigned (deprecated)');
      // Legacy fallback (mutable counter)
      const node = gun.get('shogun-network').get('reputation').get(relayHost);
      return new Promise((resolve) => {
        node.once((data: mb<ReputationMetrics>) => {
          const current = data || {};
          const now = Date.now();
          const newAvgResponseTime = (current.responseTimeSamples || 0) > 0
            ? (((current.avgResponseTimeMs || 0) * (current.responseTimeSamples || 0)) + responseTimeMs) / ((current.responseTimeSamples || 0) + 1)
            : responseTimeMs;

          node.put({
            proofsTotal: (current.proofsTotal || 0) + 1,
            proofsSuccessful: (current.proofsSuccessful || 0) + 1,
            avgResponseTimeMs: Math.round(newAvgResponseTime),
            responseTimeSamples: (current.responseTimeSamples || 0) + 1,
            dataPoints: (current.dataPoints || 0) + 1,
            lastSeenTimestamp: now,
            _lastUpdateId: `${now}-${Math.random().toString(36).substr(2, 9)}`, // Conflict resolution
          });
          releaseLock(relayHost);
          resolve();
        });
      });
    }

    // Get observer type (self or external)
    const observerType = getObserverType(relayHost, observerKeyPair);

    // New Signed Path - include observer type in details
    await FrozenData.createSignedReputationEvent(
      gun as IGunInstance,
      relayHost,
      'proof_success',
      {
        responseTimeMs,
        observerType, // Mark as self or external - used for weighted aggregation
      },
      observerKeyPair as SEAKeyPair
    );

    // Update local optimistic cache/index for backward compatibility
    const node = gun.get('shogun-network').get('reputation').get(relayHost);
    await new Promise<void>((resolve) => {
      node.once((data: mb<ReputationMetrics>) => {
        const current = data || {};
        const now = Date.now();
        const newAvgResponseTime = (current.responseTimeSamples || 0) > 0
          ? (((current.avgResponseTimeMs || 0) * (current.responseTimeSamples || 0)) + responseTimeMs) / ((current.responseTimeSamples || 0) + 1)
          : responseTimeMs;

        node.put({
          proofsTotal: (current.proofsTotal || 0) + 1,
          proofsSuccessful: (current.proofsSuccessful || 0) + 1,
          avgResponseTimeMs: Math.round(newAvgResponseTime),
          responseTimeSamples: (current.responseTimeSamples || 0) + 1,
          dataPoints: (current.dataPoints || 0) + 1,
          lastSeenTimestamp: now,
          _lastUpdateId: `${now}-${Math.random().toString(36).substr(2, 9)}`,
        });
        resolve();
      });
    });
  } finally {
    releaseLock(relayHost);
  }
}

/**
 * Record a failed storage proof (Signed)
 * Uses lock to prevent race conditions on counter updates.
 * @param gun - GunDB instance
 * @param relayHost - Host that failed the proof
 * @param observerKeyPair - Observer's SEA key pair (REQUIRED)
 */
export async function recordProofFailure(
  gun: GunInstance,
  relayHost: str,
  observerKeyPair?: SEAKeyPair
): prm<void> {
  // SECURITY: Prevent self-rating (relay rating itself)
  if (observerKeyPair && isSelfRating(relayHost, observerKeyPair)) {
    log.warn({ relayHost }, `Blocked self-rating attempt: relay ${relayHost} attempted to rate itself`);
  }

  // Acquire lock to prevent concurrent updates
  const maxWaitMs = 3000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) {
      log.warn({ relayHost }, `recordProofFailure: timeout waiting for lock on ${relayHost}`);
      break;
    }
    await new Promise(r => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn({ relayHost }, 'recordProofFailure called without keyPair - falling back to unsigned');
      const node = gun.get('shogun-network').get('reputation').get(relayHost);
      return new Promise((resolve) => {
        node.once((data: mb<ReputationMetrics>) => {
          const current = data || {};
          const now = Date.now();
          node.put({
            proofsTotal: (current.proofsTotal || 0) + 1,
            proofsFailed: (current.proofsFailed || 0) + 1,
            dataPoints: (current.dataPoints || 0) + 1,
            lastSeenTimestamp: now,
            _lastUpdateId: `${now}-${Math.random().toString(36).substr(2, 9)}`,
          });
          releaseLock(relayHost);
          resolve();
        });
      });
    }

    // Get observer type (self or external)
    const observerType = getObserverType(relayHost, observerKeyPair);

    // New Signed Path - include observer type in details
    await FrozenData.createSignedReputationEvent(
      gun as IGunInstance,
      relayHost,
      'proof_failure',
      {
        observerType, // Mark as self or external
      },
      observerKeyPair as SEAKeyPair
    );

    // Optimistic update
    const node = gun.get('shogun-network').get('reputation').get(relayHost);
    await new Promise<void>((resolve) => {
      node.once((data: mb<ReputationMetrics>) => {
        const current = data || {};
        const now = Date.now();
        node.put({
          proofsTotal: (current.proofsTotal || 0) + 1,
          proofsFailed: (current.proofsFailed || 0) + 1,
          dataPoints: (current.dataPoints || 0) + 1,
          lastSeenTimestamp: now,
          _lastUpdateId: `${now}-${Math.random().toString(36).substr(2, 9)}`,
        });
        resolve();
      });
    });
  } finally {
    releaseLock(relayHost);
  }
}

/**
 * Record pin request fulfillment (Signed)
 * Uses lock to prevent race conditions on counter updates.
 * @param gun - GunDB instance
 * @param relayHost - Host that fulfilled the request
 * @param fulfilled - Whether the request was fulfilled
 * @param observerKeyPair - Observer's SEA key pair (REQUIRED)
 */
export async function recordPinFulfillment(
  gun: GunInstance,
  relayHost: str,
  fulfilled: bool,
  observerKeyPair?: SEAKeyPair
): prm<void> {
  // Acquire lock to prevent concurrent updates
  const maxWaitMs = 3000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) {
      log.warn({ relayHost }, `recordPinFulfillment: timeout waiting for lock on ${relayHost}`);
      break;
    }
    await new Promise(r => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn({ relayHost }, 'recordPinFulfillment called without keyPair - falling back to unsigned');
      const node = gun.get('shogun-network').get('reputation').get(relayHost);
      return new Promise((resolve) => {
        node.once((data: mb<ReputationMetrics>) => {
          const current = data || {};
          const now = Date.now();
          const update: obj = {
            pinRequestsReceived: (current.pinRequestsReceived || 0) + 1,
            dataPoints: (current.dataPoints || 0) + 1,
            lastSeenTimestamp: now,
            _lastUpdateId: `${now}-${Math.random().toString(36).substr(2, 9)}`,
          };
          if (fulfilled) {
            update.pinRequestsFulfilled = (current.pinRequestsFulfilled || 0) + 1;
          }
          node.put(update);
          releaseLock(relayHost);
          resolve();
        });
      });
    }

    // New Signed Path
    await FrozenData.createSignedReputationEvent(
      gun as IGunInstance,
      relayHost,
      'pin_fulfillment',
      { fulfilled },
      observerKeyPair as SEAKeyPair
    );

    // Optimistic update
    const node = gun.get('shogun-network').get('reputation').get(relayHost);
    await new Promise<void>((resolve) => {
      node.once((data: mb<ReputationMetrics>) => {
        const current = data || {};
        const now = Date.now();
        const update: obj = {
          pinRequestsReceived: (current.pinRequestsReceived || 0) + 1,
          dataPoints: (current.dataPoints || 0) + 1,
          lastSeenTimestamp: now,
          _lastUpdateId: `${now}-${Math.random().toString(36).substr(2, 9)}`,
        };
        if (fulfilled) {
          update.pinRequestsFulfilled = (current.pinRequestsFulfilled || 0) + 1;
        }
        node.put(update);
        resolve();
      });
    });
  } finally {
    releaseLock(relayHost);
  }
}

/**
 * Record relay pulse (for uptime tracking)
 * Uses lock to prevent race conditions on counter updates.
 * @param gun - GunDB instance
 * @param relayHost - Host that sent the pulse
 */
export async function recordPulse(gun: GunInstance, relayHost: str): prm<void> {
  // Acquire lock to prevent concurrent updates
  const maxWaitMs = 2000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) {
      // Don't warn for pulses as they're frequent
      break;
    }
    await new Promise(r => setTimeout(r, 50));
  }

  const node = gun.get('shogun-network').get('reputation').get(relayHost);

  try {
    return new Promise((resolve) => {
      node.once((data: mb<ReputationMetrics>) => {
        const current = data || {};
        const now = Date.now();
        const received = (current.receivedPulses || 0) + 1;

        // Calculate expected pulses since first seen
        // Assuming 30s pulse interval
        const timeSinceFirstSeen = now - (current.firstSeenTimestamp || now);
        const expected = Math.max(1, Math.floor(timeSinceFirstSeen / 30000));

        // Calculate uptime percentage (capped at 100%)
        const uptimePercent = Math.min(100, (received / expected) * 100);

        node.put({
          receivedPulses: received,
          expectedPulses: expected,
          uptimePercent: Math.round(uptimePercent * 100) / 100,
          lastSeenTimestamp: now,
          _lastUpdateId: `${now}-${Math.random().toString(36).substr(2, 9)}`,
        });

        releaseLock(relayHost);
        resolve();
      });
    });
  } catch (e) {
    releaseLock(relayHost);
    throw e;
  }
}

/**
 * Get reputation data for a relay
 * @param gun - GunDB instance
 * @param relayHost - Host to query
 * @returns Reputation data with calculated score
 */
export async function getReputation(gun: GunInstance, relayHost: str): prm<mb<LeaderboardEntry>> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(undefined), 5000);

    gun.get('shogun-network').get('reputation').get(relayHost).once((data: mb<obj>) => {
      clearTimeout(timeout);

      if (!data || typeof data !== 'object') {
        resolve(undefined);
        return;
      }

      // Filter GunDB metadata
      const metrics: ReputationMetrics = {};
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
 * @param gun - GunDB instance
 * @param options - Filter options
 * @returns Sorted relay list
 */
export async function getReputationLeaderboard(
  gun: GunInstance,
  options: LeaderboardOptions = {}
): prm<arr<LeaderboardEntry>> {
  const { minScore = 0, tier = undefined, limit = 50 } = options;

  return new Promise((resolve) => {
    const relays: arr<LeaderboardEntry> = [];
    let resolved = false; // Flag to prevent double resolution

    const finalize = (): void => {
      if (resolved) return;
      resolved = true;
      relays.sort((a, b) => b.calculatedScore.total - a.calculatedScore.total);
      resolve(relays.slice(0, limit));
    };

    // Timeout as safety net
    const timeout = setTimeout(finalize, 3000);

    gun.get('shogun-network').get('reputation').map().once((data: mb<obj>, host: str) => {
      if (!data || typeof data !== 'object') return;

      // Filter GunDB metadata
      const metrics: ReputationMetrics = {};
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

    // Allow time for GunDB to collect, then finalize
    setTimeout(() => {
      clearTimeout(timeout);
      finalize();
    }, 2500);
  });
}


/**
 * Update stored score (call periodically)
 * @param gun - GunDB instance
 * @param relayHost - Host to update
 */
export async function updateStoredScore(gun: GunInstance, relayHost: str): prm<void> {
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
  OBSERVER_TYPE,
  OBSERVER_WEIGHTS,
  isSelfRating,
  getObserverType,
};
