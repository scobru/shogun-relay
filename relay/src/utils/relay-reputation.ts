/**
 * Relay Reputation System
 * 
 * Tracks and calculates reputation scores for relays in the network.
 * Scores are based on:
 * - Uptime consistency
 * - Storage proof success rate (deals)
 * - Bridge proof success rate (withdrawal proofs)
 * - Batch submission success rate (bridge)
 * - Response times (combined: storage proofs + bridge proofs)
 * - Pin request fulfillment
 * - Longevity (time in network)
 * 
 * Data is stored in GunDB and synced across the network.
 * 
 * Bridge Operations Tracking:
 * - Bridge proof generation (for withdrawals) is tracked separately but included in overall proof success rate
 * - Batch submissions (success/failure) are tracked for sequencer reputation
 * - Response times for bridge proofs are combined with storage proof response times
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
  pub: string;
  priv: string;
  epub?: string;
  epriv?: string;
}

interface GunAck {
  err?: string;
  ok?: boolean;
}

interface ReputationWeights {
  uptime: number;
  proofSuccess: number;
  responseTime: number;
  pinFulfillment: number;
  longevity: number;
}

interface ReputationThresholds {
  minDataPoints: number;
  maxResponseTimeMs: number;
  idealResponseTimeMs: number;
  uptimeWindowMs: number;
  maxLongevityDays: number;
}

interface ReputationMetrics {
  host?: string;
  firstSeenTimestamp?: number;
  lastSeenTimestamp?: number;
  dataPoints?: number;
  proofsTotal?: number;
  proofsSuccessful?: number;
  proofsFailed?: number;
  avgResponseTimeMs?: number;
  responseTimeSamples?: number;
  pinRequestsReceived?: number;
  pinRequestsFulfilled?: number;
  expectedPulses?: number;
  receivedPulses?: number;
  uptimePercent?: number;
  // Bridge-specific metrics
  bridgeBatchSubmissionsTotal?: number;
  bridgeBatchSubmissionsSuccessful?: number;
  bridgeBatchSubmissionsFailed?: number;
  bridgeProofsTotal?: number;
  bridgeProofsSuccessful?: number;
  bridgeProofsFailed?: number;
  bridgeAvgProofResponseTimeMs?: number;
  bridgeProofResponseTimeSamples?: number;
  score?: number;
  tier?: string;
  lastScoreUpdate?: number;
  _lastUpdateId?: string;
  [key: string]: unknown;
}

interface ScoreBreakdown {
  uptime: number;
  proofSuccess: number;
  responseTime: number;
  pinFulfillment: number;
  longevity: number;
}

interface ReputationScore {
  total: number;
  tier: string;
  breakdown: ScoreBreakdown;
  weights: ReputationWeights;
  hasEnoughData: boolean;
}

interface LeaderboardEntry extends ReputationMetrics {
  calculatedScore: ReputationScore;
}

interface LeaderboardOptions {
  minScore?: number;
  tier?: string;
  limit?: number;
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
const updateLocks = new Map<string, number>();
const LOCK_TIMEOUT_MS = 5000;

/**
 * Acquire a lock for updating a relay's reputation
 * @param relayHost - Host identifier
 * @returns True if lock acquired
 */
function acquireLock(relayHost: string): boolean {
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
function releaseLock(relayHost: string): void {
  updateLocks.delete(relayHost);
}

// Observer type constants
export const OBSERVER_TYPE = {
  SELF: 'self' as const,           // Relay rating itself
  EXTERNAL: 'external' as const,   // External observer rating the relay
};

// Reputation calculation weights for different observer types
// Self-ratings have reduced weight to prevent manipulation
export const OBSERVER_WEIGHTS: Record<string, number> = {
  self: 0.1,      // Self-rating has only 10% weight
  external: 0.9,  // External observations have 90% weight
};

/**
 * Check if observer is rating themselves (self-rating)
 * @param relayHost - Host being rated
 * @param observerKeyPair - Observer's keypair
 * @returns True if this is self-rating
 */
export function isSelfRating(relayHost: string, observerKeyPair: SEAKeyPair): boolean {
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
export function getObserverType(relayHost: string, observerKeyPair: SEAKeyPair): string {
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
  // Combine storage proofs and bridge proofs
  const totalProofs = (metrics.proofsTotal || 0) + (metrics.bridgeProofsTotal || 0);
  const totalSuccessfulProofs = (metrics.proofsSuccessful || 0) + (metrics.bridgeProofsSuccessful || 0);
  
  if (totalProofs > 0) {
    scores.proofSuccess = (totalSuccessfulProofs / totalProofs) * 100;
  } else {
    scores.proofSuccess = 50; // Default for no data
  }

  // 3. Response Time Score (0-100)
  // Combine storage proof response time and bridge proof response time (weighted average)
  // Inverse scale: faster = higher score
  const storageSamples = metrics.responseTimeSamples || 0;
  const bridgeSamples = metrics.bridgeProofResponseTimeSamples || 0;
  const totalSamples = storageSamples + bridgeSamples;
  
  let avgResponseTime: number | undefined;
  if (totalSamples > 0) {
    const storageWeight = storageSamples / totalSamples;
    const bridgeWeight = bridgeSamples / totalSamples;
    const storageAvg = metrics.avgResponseTimeMs || 0;
    const bridgeAvg = metrics.bridgeAvgProofResponseTimeMs || 0;
    avgResponseTime = (storageAvg * storageWeight) + (bridgeAvg * bridgeWeight);
  } else if (metrics.avgResponseTimeMs !== undefined) {
    avgResponseTime = metrics.avgResponseTimeMs;
  } else if (metrics.bridgeAvgProofResponseTimeMs !== undefined) {
    avgResponseTime = metrics.bridgeAvgProofResponseTimeMs;
  }
  
  if (avgResponseTime !== undefined) {
    if (avgResponseTime <= THRESHOLDS.idealResponseTimeMs) {
      scores.responseTime = 100;
    } else if (avgResponseTime >= THRESHOLDS.maxResponseTimeMs) {
      scores.responseTime = 0;
    } else {
      // Linear interpolation
      const range = THRESHOLDS.maxResponseTimeMs - THRESHOLDS.idealResponseTimeMs;
      const excess = avgResponseTime - THRESHOLDS.idealResponseTimeMs;
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
  let tier: string;
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
export function initReputationTracking(gun: GunInstance, relayHost: string): GunNode {
  const reputationNode = gun.get('shogun-network').get('reputation').get(relayHost);

  // Check if already initialized
  reputationNode.once((data: ReputationMetrics | undefined) => {
    if (!data || !data.firstSeenTimestamp) {
      // Initialize with default metrics
      reputationNode.put({
        host: relayHost,
        firstSeenTimestamp: Date.now(),
        lastSeenTimestamp: Date.now(),
        dataPoints: 0,
        // Proof metrics (storage)
        proofsTotal: 0,
        proofsSuccessful: 0,
        proofsFailed: 0,
        // Response time (rolling average) - storage proofs
        avgResponseTimeMs: 0,
        responseTimeSamples: 0,
        // Pin fulfillment
        pinRequestsReceived: 0,
        pinRequestsFulfilled: 0,
        // Bridge-specific metrics
        bridgeProofsTotal: 0,
        bridgeProofsSuccessful: 0,
        bridgeProofsFailed: 0,
        bridgeAvgProofResponseTimeMs: 0,
        bridgeProofResponseTimeSamples: 0,
        bridgeBatchSubmissionsTotal: 0,
        bridgeBatchSubmissionsSuccessful: 0,
        bridgeBatchSubmissionsFailed: 0,
        // Uptime tracking
        expectedPulses: 0,
        receivedPulses: 0,
        uptimePercent: 100,
        // Calculated score (updated periodically)
        score: 50,
        tier: 'average',
        lastScoreUpdate: Date.now(),
      });
      log.debug(`Reputation tracking initialized for ${relayHost}`);
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
  relayHost: string,
  responseTimeMs: number = 0,
  observerKeyPair?: SEAKeyPair
): Promise<void> {
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
        node.once((data: ReputationMetrics | undefined) => {
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
      node.once((data: ReputationMetrics | undefined) => {
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
  relayHost: string,
  observerKeyPair?: SEAKeyPair
): Promise<void> {
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
        node.once((data: ReputationMetrics | undefined) => {
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
      node.once((data: ReputationMetrics | undefined) => {
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
  relayHost: string,
  fulfilled: boolean,
  observerKeyPair?: SEAKeyPair
): Promise<void> {
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
        node.once((data: ReputationMetrics | undefined) => {
          const current = data || {};
          const now = Date.now();
          const update: Record<string, any> = {
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
      node.once((data: ReputationMetrics | undefined) => {
        const current = data || {};
        const now = Date.now();
        const update: Record<string, any> = {
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
export async function recordPulse(gun: GunInstance, relayHost: string): Promise<void> {
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
      node.once((data: ReputationMetrics | undefined) => {
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
export async function getReputation(gun: GunInstance, relayHost: string): Promise<LeaderboardEntry | undefined> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(undefined), 5000);

    gun.get('shogun-network').get('reputation').get(relayHost).once((data: Record<string, any> | undefined) => {
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
): Promise<Array<LeaderboardEntry>> {
  const { minScore = 0, tier = undefined, limit = 50 } = options;

  return new Promise((resolve) => {
    const relays: Array<LeaderboardEntry> = [];
    let resolved = false; // Flag to prevent double resolution

    const finalize = (): void => {
      if (resolved) return;
      resolved = true;
      relays.sort((a, b) => b.calculatedScore.total - a.calculatedScore.total);
      resolve(relays.slice(0, limit));
    };

    // Timeout as safety net
    const timeout = setTimeout(finalize, 3000);

    gun.get('shogun-network').get('reputation').map().once((data: Record<string, any> | undefined, host: string) => {
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
 * Record a successful bridge proof generation (withdrawal proof) (Signed)
 * @param gun - GunDB instance
 * @param relayHost - Host that provided the proof
 * @param responseTimeMs - Time to generate proof
 * @param observerKeyPair - Observer's SEA key pair (REQUIRED)
 */
export async function recordBridgeProofSuccess(
  gun: GunInstance,
  relayHost: string,
  responseTimeMs: number = 0,
  observerKeyPair?: SEAKeyPair
): Promise<void> {
  // SECURITY: Prevent self-rating
  if (observerKeyPair && isSelfRating(relayHost, observerKeyPair)) {
    log.warn(`Blocked self-rating attempt: relay ${relayHost} attempted to rate itself for bridge proof`);
  }

  const maxWaitMs = 3000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) {
      log.warn(`recordBridgeProofSuccess: timeout waiting for lock on ${relayHost}`);
      break;
    }
    await new Promise(r => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn('recordBridgeProofSuccess called without keyPair - falling back to unsigned');
      const node = gun.get('shogun-network').get('reputation').get(relayHost);
      return new Promise((resolve) => {
        node.once((data: ReputationMetrics | undefined) => {
          const current = data || {};
          const now = Date.now();
          const newAvgResponseTime = (current.bridgeProofResponseTimeSamples || 0) > 0
            ? (((current.bridgeAvgProofResponseTimeMs || 0) * (current.bridgeProofResponseTimeSamples || 0)) + responseTimeMs) / ((current.bridgeProofResponseTimeSamples || 0) + 1)
            : responseTimeMs;

          node.put({
            bridgeProofsTotal: (current.bridgeProofsTotal || 0) + 1,
            bridgeProofsSuccessful: (current.bridgeProofsSuccessful || 0) + 1,
            bridgeAvgProofResponseTimeMs: Math.round(newAvgResponseTime),
            bridgeProofResponseTimeSamples: (current.bridgeProofResponseTimeSamples || 0) + 1,
            dataPoints: (current.dataPoints || 0) + 1,
            lastSeenTimestamp: now,
            _lastUpdateId: `${now}-${Math.random().toString(36).substr(2, 9)}`,
          });
          releaseLock(relayHost);
          resolve();
        });
      });
    }

    const observerType = getObserverType(relayHost, observerKeyPair);

    // Create signed reputation event for bridge proof
    await FrozenData.createSignedReputationEvent(
      gun as any,
      relayHost,
      'bridge_proof_success',
      {
        responseTimeMs,
        observerType,
      },
      observerKeyPair as SEAKeyPair
    );

    // Update optimistic cache
    const node = gun.get('shogun-network').get('reputation').get(relayHost);
    await new Promise<void>((resolve) => {
      node.once((data: ReputationMetrics | undefined) => {
        const current = data || {};
        const now = Date.now();
        const newAvgResponseTime = (current.bridgeProofResponseTimeSamples || 0) > 0
          ? (((current.bridgeAvgProofResponseTimeMs || 0) * (current.bridgeProofResponseTimeSamples || 0)) + responseTimeMs) / ((current.bridgeProofResponseTimeSamples || 0) + 1)
          : responseTimeMs;

        node.put({
          bridgeProofsTotal: (current.bridgeProofsTotal || 0) + 1,
          bridgeProofsSuccessful: (current.bridgeProofsSuccessful || 0) + 1,
          bridgeAvgProofResponseTimeMs: Math.round(newAvgResponseTime),
          bridgeProofResponseTimeSamples: (current.bridgeProofResponseTimeSamples || 0) + 1,
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
 * Record a failed bridge proof generation (Signed)
 * @param gun - GunDB instance
 * @param relayHost - Host that failed the proof
 * @param observerKeyPair - Observer's SEA key pair (REQUIRED)
 */
export async function recordBridgeProofFailure(
  gun: GunInstance,
  relayHost: string,
  observerKeyPair?: SEAKeyPair
): Promise<void> {
  // SECURITY: Prevent self-rating
  if (observerKeyPair && isSelfRating(relayHost, observerKeyPair)) {
    log.warn(`Blocked self-rating attempt: relay ${relayHost} attempted to rate itself for bridge proof failure`);
  }

  const maxWaitMs = 3000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) {
      log.warn(`recordBridgeProofFailure: timeout waiting for lock on ${relayHost}`);
      break;
    }
    await new Promise(r => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn('recordBridgeProofFailure called without keyPair - falling back to unsigned');
      const node = gun.get('shogun-network').get('reputation').get(relayHost);
      return new Promise((resolve) => {
        node.once((data: ReputationMetrics | undefined) => {
          const current = data || {};
          const now = Date.now();
          node.put({
            bridgeProofsTotal: (current.bridgeProofsTotal || 0) + 1,
            bridgeProofsFailed: (current.bridgeProofsFailed || 0) + 1,
            dataPoints: (current.dataPoints || 0) + 1,
            lastSeenTimestamp: now,
            _lastUpdateId: `${now}-${Math.random().toString(36).substr(2, 9)}`,
          });
          releaseLock(relayHost);
          resolve();
        });
      });
    }

    const observerType = getObserverType(relayHost, observerKeyPair);

    await FrozenData.createSignedReputationEvent(
      gun as any,
      relayHost,
      'bridge_proof_failure',
      {
        observerType,
      },
      observerKeyPair as SEAKeyPair
    );

    // Optimistic update
    const node = gun.get('shogun-network').get('reputation').get(relayHost);
    await new Promise<void>((resolve) => {
      node.once((data: ReputationMetrics | undefined) => {
        const current = data || {};
        const now = Date.now();
        node.put({
          bridgeProofsTotal: (current.bridgeProofsTotal || 0) + 1,
          bridgeProofsFailed: (current.bridgeProofsFailed || 0) + 1,
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
 * Record a successful batch submission (Signed)
 * @param gun - GunDB instance
 * @param relayHost - Host that submitted the batch
 * @param withdrawalCount - Number of withdrawals in the batch
 * @param observerKeyPair - Observer's SEA key pair (REQUIRED)
 */
export async function recordBatchSubmissionSuccess(
  gun: GunInstance,
  relayHost: string,
  withdrawalCount: number = 0,
  observerKeyPair?: SEAKeyPair
): Promise<void> {
  // SECURITY: Prevent self-rating
  if (observerKeyPair && isSelfRating(relayHost, observerKeyPair)) {
    log.warn(`Blocked self-rating attempt: relay ${relayHost} attempted to rate itself for batch submission`);
  }

  const maxWaitMs = 3000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) {
      log.warn(`recordBatchSubmissionSuccess: timeout waiting for lock on ${relayHost}`);
      break;
    }
    await new Promise(r => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn('recordBatchSubmissionSuccess called without keyPair - falling back to unsigned');
      const node = gun.get('shogun-network').get('reputation').get(relayHost);
      return new Promise((resolve) => {
        node.once((data: ReputationMetrics | undefined) => {
          const current = data || {};
          const now = Date.now();
          node.put({
            bridgeBatchSubmissionsTotal: (current.bridgeBatchSubmissionsTotal || 0) + 1,
            bridgeBatchSubmissionsSuccessful: (current.bridgeBatchSubmissionsSuccessful || 0) + 1,
            dataPoints: (current.dataPoints || 0) + 1,
            lastSeenTimestamp: now,
            _lastUpdateId: `${now}-${Math.random().toString(36).substr(2, 9)}`,
          });
          releaseLock(relayHost);
          resolve();
        });
      });
    }

    const observerType = getObserverType(relayHost, observerKeyPair);

    await FrozenData.createSignedReputationEvent(
      gun as any,
      relayHost,
      'bridge_batch_success',
      {
        withdrawalCount,
        observerType,
      },
      observerKeyPair as SEAKeyPair
    );

    // Optimistic update
    const node = gun.get('shogun-network').get('reputation').get(relayHost);
    await new Promise<void>((resolve) => {
      node.once((data: ReputationMetrics | undefined) => {
        const current = data || {};
        const now = Date.now();
        node.put({
          bridgeBatchSubmissionsTotal: (current.bridgeBatchSubmissionsTotal || 0) + 1,
          bridgeBatchSubmissionsSuccessful: (current.bridgeBatchSubmissionsSuccessful || 0) + 1,
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
 * Record a failed batch submission (Signed)
 * @param gun - GunDB instance
 * @param relayHost - Host that failed to submit the batch
 * @param observerKeyPair - Observer's SEA key pair (REQUIRED)
 */
export async function recordBatchSubmissionFailure(
  gun: GunInstance,
  relayHost: string,
  observerKeyPair?: SEAKeyPair
): Promise<void> {
  // SECURITY: Prevent self-rating
  if (observerKeyPair && isSelfRating(relayHost, observerKeyPair)) {
    log.warn(`Blocked self-rating attempt: relay ${relayHost} attempted to rate itself for batch submission failure`);
  }

  const maxWaitMs = 3000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) {
      log.warn(`recordBatchSubmissionFailure: timeout waiting for lock on ${relayHost}`);
      break;
    }
    await new Promise(r => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn('recordBatchSubmissionFailure called without keyPair - falling back to unsigned');
      const node = gun.get('shogun-network').get('reputation').get(relayHost);
      return new Promise((resolve) => {
        node.once((data: ReputationMetrics | undefined) => {
          const current = data || {};
          const now = Date.now();
          node.put({
            bridgeBatchSubmissionsTotal: (current.bridgeBatchSubmissionsTotal || 0) + 1,
            bridgeBatchSubmissionsFailed: (current.bridgeBatchSubmissionsFailed || 0) + 1,
            dataPoints: (current.dataPoints || 0) + 1,
            lastSeenTimestamp: now,
            _lastUpdateId: `${now}-${Math.random().toString(36).substr(2, 9)}`,
          });
          releaseLock(relayHost);
          resolve();
        });
      });
    }

    const observerType = getObserverType(relayHost, observerKeyPair);

    await FrozenData.createSignedReputationEvent(
      gun as any,
      relayHost,
      'bridge_batch_failure',
      {
        observerType,
      },
      observerKeyPair as SEAKeyPair
    );

    // Optimistic update
    const node = gun.get('shogun-network').get('reputation').get(relayHost);
    await new Promise<void>((resolve) => {
      node.once((data: ReputationMetrics | undefined) => {
        const current = data || {};
        const now = Date.now();
        node.put({
          bridgeBatchSubmissionsTotal: (current.bridgeBatchSubmissionsTotal || 0) + 1,
          bridgeBatchSubmissionsFailed: (current.bridgeBatchSubmissionsFailed || 0) + 1,
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
 * Update stored score (call periodically)
 * @param gun - GunDB instance
 * @param relayHost - Host to update
 */
export async function updateStoredScore(gun: GunInstance, relayHost: string): Promise<void> {
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
  recordBridgeProofSuccess,
  recordBridgeProofFailure,
  recordBatchSubmissionSuccess,
  recordBatchSubmissionFailure,
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
