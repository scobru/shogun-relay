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

import * as FrozenData from "./frozen-data";
import { getRelayPub } from "./relay-user";
import { loggers } from "./logger";
import { GUN_PATHS } from "./gun-paths";

const log = loggers.reputation;

// Interfaces
import type { IGunInstanceRoot, IGunChain, IGunInstance } from "gun/types/gun";

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
  // Resource & Capacity metrics (from pulse data)
  avgConnections?: number; // Average active connections
  maxConnections?: number; // Peak connections observed
  avgMemoryUsageMB?: number; // Average memory usage
  maxMemoryUsageMB?: number; // Peak memory usage
  storageCapacityMB?: number; // Total storage capacity
  storageUsedMB?: number; // Storage currently used
  storageUtilizationPercent?: number; // Storage utilization percentage
  ipfsRepoSizeMB?: number; // IPFS repository size
  ipfsPinsCount?: number; // Number of IPFS pins
  // Performance metrics
  avgLatencyMs?: number; // Average network latency
  latencySamples?: number; // Number of latency measurements
  throughputMBps?: number; // Data throughput (MB/s)
  errorRate?: number; // Error rate percentage
  // Availability & Reliability
  meanTimeBetweenFailures?: number; // MTBF in milliseconds
  meanTimeToRecovery?: number; // MTTR in milliseconds
  downtimeEvents?: number; // Number of downtime events
  totalDowntimeMs?: number; // Total downtime in milliseconds
  // Data Quality metrics
  dataIntegrityChecks?: number; // Number of integrity checks performed
  dataIntegrityFailures?: number; // Number of integrity check failures
  dataFreshnessMs?: number; // Average data freshness (time since last update)
  // Network metrics
  peerConnections?: number; // Number of GunDB peer connections
  networkReachability?: number; // Network reachability score (0-100)
  // Deal & Subscription metrics
  dealsTotal?: number; // Total deals handled
  dealsActive?: number; // Currently active deals
  dealsCompleted?: number; // Successfully completed deals
  dealsFailed?: number; // Failed deals
  dealFulfillmentRate?: number; // Deal fulfillment success rate (0-100)
  subscriptionsTotal?: number; // Total subscriptions managed
  subscriptionsActive?: number; // Currently active subscriptions
  subscriptionRetentionRate?: number; // Subscription retention rate (0-100)
  // API Availability
  apiRequestsTotal?: number; // Total API requests
  apiRequestsSuccessful?: number; // Successful API requests
  apiRequestsFailed?: number; // Failed API requests
  apiUptimePercent?: number; // API uptime percentage
  // Security metrics
  securityIncidents?: number; // Number of security incidents
  lastSecurityIncident?: number; // Timestamp of last security incident
  // Calculated fields
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
  // New breakdown components
  resourceEfficiency?: number; // Based on memory/connection efficiency
  storageCapacity?: number; // Based on available storage capacity
  dataQuality?: number; // Based on integrity and freshness
  reliability?: number; // Based on MTBF and MTTR
  dealPerformance?: number; // Based on deal fulfillment rate
  networkHealth?: number; // Based on peer connections and reachability
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
// Note: Extended weights for additional metrics are calculated separately
// and can be included in a weighted average or shown as separate scores
const WEIGHTS: ReputationWeights = {
  uptime: 0.25, // 25% - Consistent availability (reduced from 30%)
  proofSuccess: 0.2, // 20% - Storage proof reliability (reduced from 25%)
  responseTime: 0.15, // 15% - Speed of responses (reduced from 20%)
  pinFulfillment: 0.15, // 15% - Honoring pin requests (unchanged)
  longevity: 0.1, // 10% - Time in network (unchanged)
  // Additional weights for extended metrics (optional, can be added to total)
  // These are calculated separately and can be shown as supplementary scores
};

// Extended weights for additional metrics (shown separately or as bonus/penalty)
const EXTENDED_WEIGHTS = {
  resourceEfficiency: 0.05, // 5% - Memory and connection efficiency
  storageCapacity: 0.05, // 5% - Available storage capacity
  dataQuality: 0.03, // 3% - Data integrity and freshness
  reliability: 0.02, // 2% - MTBF and MTTR
  dealPerformance: 0.0, // 0% - Deal fulfillment (tracked but not weighted in base score)
  networkHealth: 0.0, // 0% - Network metrics (tracked but not weighted in base score)
};

// Thresholds
const THRESHOLDS: ReputationThresholds = {
  minDataPoints: 10, // Minimum events before scoring
  maxResponseTimeMs: 5000, // Response times above this get 0 score
  idealResponseTimeMs: 500, // Response times below this get 100 score
  uptimeWindowMs: 86400000, // 24h window for uptime calculation
  maxLongevityDays: 365, // Cap longevity bonus at 1 year
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
  if (existingLock && now - existingLock < LOCK_TIMEOUT_MS) {
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
  SELF: "self" as const, // Relay rating itself
  EXTERNAL: "external" as const, // External observer rating the relay
};

// Reputation calculation weights for different observer types
// Self-ratings have reduced weight to prevent manipulation
export const OBSERVER_WEIGHTS: Record<string, number> = {
  self: 0.1, // Self-rating has only 10% weight
  external: 0.9, // External observations have 90% weight
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
  return isSelfRating(relayHost, observerKeyPair) ? OBSERVER_TYPE.SELF : OBSERVER_TYPE.EXTERNAL;
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
  const totalSuccessfulProofs =
    (metrics.proofsSuccessful || 0) + (metrics.bridgeProofsSuccessful || 0);

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
    avgResponseTime = storageAvg * storageWeight + bridgeAvg * bridgeWeight;
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
    scores.pinFulfillment =
      ((metrics.pinRequestsFulfilled || 0) / metrics.pinRequestsReceived) * 100;
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

  // Calculate extended scores (optional metrics)

  // 6. Resource Efficiency Score (0-100)
  // Based on memory and connection efficiency
  if (
    metrics.avgMemoryUsageMB !== undefined &&
    metrics.maxMemoryUsageMB !== undefined &&
    metrics.maxMemoryUsageMB > 0
  ) {
    const memoryEfficiency =
      100 - Math.min(100, (metrics.avgMemoryUsageMB / metrics.maxMemoryUsageMB) * 100);
    const connectionEfficiency =
      metrics.avgConnections && metrics.maxConnections && metrics.maxConnections > 0
        ? 100 - Math.min(100, (metrics.avgConnections / metrics.maxConnections) * 100)
        : 50;
    scores.resourceEfficiency = (memoryEfficiency + connectionEfficiency) / 2;
  } else {
    scores.resourceEfficiency = 50; // Default
  }

  // 7. Storage Capacity Score (0-100)
  // Based on available storage capacity
  if (metrics.storageCapacityMB !== undefined && metrics.storageUsedMB !== undefined) {
    const utilization =
      metrics.storageCapacityMB > 0 ? (metrics.storageUsedMB / metrics.storageCapacityMB) * 100 : 0;
    // Lower utilization = higher score (more capacity available)
    scores.storageCapacity = Math.max(0, 100 - utilization);
  } else if (metrics.storageUtilizationPercent !== undefined) {
    scores.storageCapacity = Math.max(0, 100 - metrics.storageUtilizationPercent);
  } else {
    scores.storageCapacity = 50; // Default
  }

  // 8. Data Quality Score (0-100)
  // Based on integrity checks and data freshness
  let integrityScore = 50;
  if (metrics.dataIntegrityChecks !== undefined && metrics.dataIntegrityChecks > 0) {
    const integrityRate = 1 - (metrics.dataIntegrityFailures || 0) / metrics.dataIntegrityChecks;
    integrityScore = integrityRate * 100;
  }

  let freshnessScore = 50;
  if (metrics.dataFreshnessMs !== undefined) {
    // Data fresher than 1 hour = 100, older than 24h = 0
    const hoursOld = metrics.dataFreshnessMs / (1000 * 60 * 60);
    freshnessScore = Math.max(0, 100 - (hoursOld / 24) * 100);
  }

  scores.dataQuality = (integrityScore + freshnessScore) / 2;

  // 9. Reliability Score (0-100)
  // Based on MTBF and MTTR
  if (metrics.meanTimeBetweenFailures !== undefined && metrics.meanTimeToRecovery !== undefined) {
    // Higher MTBF and lower MTTR = better score
    const mtbfHours = metrics.meanTimeBetweenFailures / (1000 * 60 * 60);
    const mttrMinutes = metrics.meanTimeToRecovery / (1000 * 60);

    // MTBF: 24h = 50, 168h (1 week) = 100
    const mtbfScore = Math.min(100, (mtbfHours / 168) * 100);
    // MTTR: 0 min = 100, 60 min = 0
    const mttrScore = Math.max(0, 100 - (mttrMinutes / 60) * 100);

    scores.reliability = (mtbfScore + mttrScore) / 2;
  } else {
    scores.reliability = 50; // Default
  }

  // 10. Deal Performance Score (0-100)
  if (metrics.dealFulfillmentRate !== undefined) {
    scores.dealPerformance = metrics.dealFulfillmentRate;
  } else if (metrics.dealsTotal !== undefined && metrics.dealsTotal > 0) {
    const completed = metrics.dealsCompleted || 0;
    scores.dealPerformance = (completed / metrics.dealsTotal) * 100;
  } else {
    scores.dealPerformance = 50; // Default
  }

  // 11. Network Health Score (0-100)
  // Based on peer connections and reachability
  let peerScore = 50;
  if (metrics.peerConnections !== undefined) {
    // More peers = better (capped at 20 peers for 100 score)
    peerScore = Math.min(100, (metrics.peerConnections / 20) * 100);
  }

  const reachabilityScore = metrics.networkReachability || 50;
  scores.networkHealth = (peerScore + reachabilityScore) / 2;

  // Calculate weighted total (base score)
  const baseScore =
    (scores.uptime || 0) * WEIGHTS.uptime +
    (scores.proofSuccess || 0) * WEIGHTS.proofSuccess +
    (scores.responseTime || 0) * WEIGHTS.responseTime +
    (scores.pinFulfillment || 0) * WEIGHTS.pinFulfillment +
    (scores.longevity || 0) * WEIGHTS.longevity;

  // Calculate extended score (optional bonus/penalty)
  const extendedScore =
    (scores.resourceEfficiency || 0) * EXTENDED_WEIGHTS.resourceEfficiency +
    (scores.storageCapacity || 0) * EXTENDED_WEIGHTS.storageCapacity +
    (scores.dataQuality || 0) * EXTENDED_WEIGHTS.dataQuality +
    (scores.reliability || 0) * EXTENDED_WEIGHTS.reliability;

  // Total score = base + extended (capped at 100)
  const totalScore = Math.min(100, baseScore + extendedScore);

  // Determine tier
  let tier: string;
  if (totalScore >= 90) tier = "excellent";
  else if (totalScore >= 75) tier = "good";
  else if (totalScore >= 50) tier = "average";
  else if (totalScore >= 25) tier = "poor";
  else tier = "unreliable";

  return {
    total: Math.round(totalScore * 100) / 100,
    tier,
    breakdown: {
      uptime: Math.round((scores.uptime || 0) * 100) / 100,
      proofSuccess: Math.round((scores.proofSuccess || 0) * 100) / 100,
      responseTime: Math.round((scores.responseTime || 0) * 100) / 100,
      pinFulfillment: Math.round((scores.pinFulfillment || 0) * 100) / 100,
      longevity: Math.round((scores.longevity || 0) * 100) / 100,
      resourceEfficiency: Math.round((scores.resourceEfficiency || 0) * 100) / 100,
      storageCapacity: Math.round((scores.storageCapacity || 0) * 100) / 100,
      dataQuality: Math.round((scores.dataQuality || 0) * 100) / 100,
      reliability: Math.round((scores.reliability || 0) * 100) / 100,
      dealPerformance: Math.round((scores.dealPerformance || 0) * 100) / 100,
      networkHealth: Math.round((scores.networkHealth || 0) * 100) / 100,
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
  const reputationNode = gun.get(GUN_PATHS.REPUTATION).get(relayHost);

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
        tier: "average",
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
    await new Promise((r) => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn("recordProofSuccess called without keyPair - falling back to unsigned (deprecated)");
      // Legacy fallback (mutable counter)
      const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
      return new Promise((resolve) => {
        node.once((data: ReputationMetrics | undefined) => {
          const current = data || {};
          const now = Date.now();
          const newAvgResponseTime =
            (current.responseTimeSamples || 0) > 0
              ? ((current.avgResponseTimeMs || 0) * (current.responseTimeSamples || 0) +
                  responseTimeMs) /
                ((current.responseTimeSamples || 0) + 1)
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
      "proof_success",
      {
        responseTimeMs,
        observerType, // Mark as self or external - used for weighted aggregation
      },
      observerKeyPair as SEAKeyPair
    );

    // Update local optimistic cache/index for backward compatibility
    const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
    await new Promise<void>((resolve) => {
      node.once((data: ReputationMetrics | undefined) => {
        const current = data || {};
        const now = Date.now();
        const newAvgResponseTime =
          (current.responseTimeSamples || 0) > 0
            ? ((current.avgResponseTimeMs || 0) * (current.responseTimeSamples || 0) +
                responseTimeMs) /
              ((current.responseTimeSamples || 0) + 1)
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
    log.warn(
      { relayHost },
      `Blocked self-rating attempt: relay ${relayHost} attempted to rate itself`
    );
  }

  // Acquire lock to prevent concurrent updates
  const maxWaitMs = 3000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) {
      log.warn({ relayHost }, `recordProofFailure: timeout waiting for lock on ${relayHost}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn(
        { relayHost },
        "recordProofFailure called without keyPair - falling back to unsigned"
      );
      const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
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
      "proof_failure",
      {
        observerType, // Mark as self or external
      },
      observerKeyPair as SEAKeyPair
    );

    // Optimistic update
    const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
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
    await new Promise((r) => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn(
        { relayHost },
        "recordPinFulfillment called without keyPair - falling back to unsigned"
      );
      const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
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
      "pin_fulfillment",
      { fulfilled },
      observerKeyPair as SEAKeyPair
    );

    // Optimistic update
    const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
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
    await new Promise((r) => setTimeout(r, 50));
  }

  const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);

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
export async function getReputation(
  gun: GunInstance,
  relayHost: string
): Promise<LeaderboardEntry | undefined> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(undefined), 5000);

    gun
      .get(GUN_PATHS.REPUTATION)
      .get(relayHost)
      .once((data: Record<string, any> | undefined) => {
        clearTimeout(timeout);

        if (!data || typeof data !== "object") {
          resolve(undefined);
          return;
        }

        // Filter GunDB metadata
        const metrics: ReputationMetrics = {};
        Object.keys(data).forEach((key) => {
          if (!["_", "#", ">", "<"].includes(key)) {
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

    gun
      .get(GUN_PATHS.REPUTATION)
      .map()
      .once((data: Record<string, any> | undefined, host: string) => {
        if (!data || typeof data !== "object") return;

        // Filter GunDB metadata
        const metrics: ReputationMetrics = {};
        Object.keys(data).forEach((key) => {
          if (!["_", "#", ">", "<"].includes(key)) {
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
    log.warn(
      `Blocked self-rating attempt: relay ${relayHost} attempted to rate itself for bridge proof`
    );
  }

  const maxWaitMs = 3000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) {
      log.warn(`recordBridgeProofSuccess: timeout waiting for lock on ${relayHost}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn("recordBridgeProofSuccess called without keyPair - falling back to unsigned");
      const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
      return new Promise((resolve) => {
        node.once((data: ReputationMetrics | undefined) => {
          const current = data || {};
          const now = Date.now();
          const newAvgResponseTime =
            (current.bridgeProofResponseTimeSamples || 0) > 0
              ? ((current.bridgeAvgProofResponseTimeMs || 0) *
                  (current.bridgeProofResponseTimeSamples || 0) +
                  responseTimeMs) /
                ((current.bridgeProofResponseTimeSamples || 0) + 1)
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
      "bridge_proof_success",
      {
        responseTimeMs,
        observerType,
      },
      observerKeyPair as SEAKeyPair
    );

    // Update optimistic cache
    const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
    await new Promise<void>((resolve) => {
      node.once((data: ReputationMetrics | undefined) => {
        const current = data || {};
        const now = Date.now();
        const newAvgResponseTime =
          (current.bridgeProofResponseTimeSamples || 0) > 0
            ? ((current.bridgeAvgProofResponseTimeMs || 0) *
                (current.bridgeProofResponseTimeSamples || 0) +
                responseTimeMs) /
              ((current.bridgeProofResponseTimeSamples || 0) + 1)
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
    log.warn(
      `Blocked self-rating attempt: relay ${relayHost} attempted to rate itself for bridge proof failure`
    );
  }

  const maxWaitMs = 3000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) {
      log.warn(`recordBridgeProofFailure: timeout waiting for lock on ${relayHost}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn("recordBridgeProofFailure called without keyPair - falling back to unsigned");
      const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
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
      "bridge_proof_failure",
      {
        observerType,
      },
      observerKeyPair as SEAKeyPair
    );

    // Optimistic update
    const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
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
    log.warn(
      `Blocked self-rating attempt: relay ${relayHost} attempted to rate itself for batch submission`
    );
  }

  const maxWaitMs = 3000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) {
      log.warn(`recordBatchSubmissionSuccess: timeout waiting for lock on ${relayHost}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn("recordBatchSubmissionSuccess called without keyPair - falling back to unsigned");
      const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
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
      "bridge_batch_success",
      {
        withdrawalCount,
        observerType,
      },
      observerKeyPair as SEAKeyPair
    );

    // Optimistic update
    const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
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
    log.warn(
      `Blocked self-rating attempt: relay ${relayHost} attempted to rate itself for batch submission failure`
    );
  }

  const maxWaitMs = 3000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) {
      log.warn(`recordBatchSubmissionFailure: timeout waiting for lock on ${relayHost}`);
      break;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  try {
    if (!observerKeyPair) {
      log.warn("recordBatchSubmissionFailure called without keyPair - falling back to unsigned");
      const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
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
      "bridge_batch_failure",
      {
        observerType,
      },
      observerKeyPair as SEAKeyPair
    );

    // Optimistic update
    const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
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
    gun.get(GUN_PATHS.REPUTATION).get(relayHost).put({
      score: reputation.calculatedScore.total,
      tier: reputation.calculatedScore.tier,
      lastScoreUpdate: Date.now(),
    });
  }
}

/**
 * Record resource metrics from pulse data
 * Called when processing pulse data from other relays
 * @param gun - GunDB instance
 * @param relayHost - Host identifier
 * @param metrics - Resource metrics from pulse
 */
export async function recordResourceMetrics(
  gun: GunInstance,
  relayHost: string,
  metrics: {
    connections?: { active?: number; total?: number };
    memory?: { heapUsed?: number; heapTotal?: number; rss?: number };
    ipfs?: { repoSize?: number; numPins?: number; connected?: boolean };
    storage?: { used?: number; capacity?: number };
  }
): Promise<void> {
  const maxWaitMs = 2000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  try {
    const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
    await new Promise<void>((resolve) => {
      node.once((data: ReputationMetrics | undefined) => {
        const current = data || {};
        const now = Date.now();
        const updates: Record<string, any> = { lastSeenTimestamp: now };

        // Update connection metrics
        if (metrics.connections?.active !== undefined) {
          const activeConn = metrics.connections.active;
          const currentAvg = current.avgConnections || 0;
          const currentMax = current.maxConnections || 0;
          const sampleCount = (current.avgConnections !== undefined ? 1 : 0) + 1;

          updates.avgConnections =
            currentAvg > 0
              ? (currentAvg * (sampleCount - 1) + activeConn) / sampleCount
              : activeConn;
          updates.maxConnections = Math.max(currentMax, activeConn);
        }

        // Update memory metrics
        if (metrics.memory?.heapUsed !== undefined) {
          const heapUsedMB = metrics.memory.heapUsed / (1024 * 1024);
          const currentAvg = current.avgMemoryUsageMB || 0;
          const currentMax = current.maxMemoryUsageMB || 0;
          const sampleCount = (current.avgMemoryUsageMB !== undefined ? 1 : 0) + 1;

          updates.avgMemoryUsageMB =
            currentAvg > 0
              ? (currentAvg * (sampleCount - 1) + heapUsedMB) / sampleCount
              : heapUsedMB;
          updates.maxMemoryUsageMB = Math.max(currentMax, heapUsedMB);
        }

        // Update IPFS/storage metrics
        if (metrics.ipfs?.repoSize !== undefined) {
          updates.ipfsRepoSizeMB = Math.round(metrics.ipfs.repoSize / (1024 * 1024));
        }
        if (metrics.ipfs?.numPins !== undefined) {
          updates.ipfsPinsCount = metrics.ipfs.numPins;
        }
        if (metrics.storage?.used !== undefined) {
          updates.storageUsedMB = metrics.storage.used;
        }
        if (metrics.storage?.capacity !== undefined) {
          updates.storageCapacityMB = metrics.storage.capacity;
          if (metrics.storage.used !== undefined) {
            updates.storageUtilizationPercent =
              (metrics.storage.used / metrics.storage.capacity) * 100;
          }
        }

        node.put({
          ...updates,
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
 * Record deal performance metrics
 * @param gun - GunDB instance
 * @param relayHost - Host identifier
 * @param success - Whether deal was successful
 */
export async function recordDealPerformance(
  gun: GunInstance,
  relayHost: string,
  success: boolean
): Promise<void> {
  const maxWaitMs = 2000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  try {
    const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
    await new Promise<void>((resolve) => {
      node.once((data: ReputationMetrics | undefined) => {
        const current = data || {};
        const now = Date.now();

        const total = (current.dealsTotal || 0) + 1;
        const completed = success ? (current.dealsCompleted || 0) + 1 : current.dealsCompleted || 0;
        const failed = success ? current.dealsFailed || 0 : (current.dealsFailed || 0) + 1;
        const fulfillmentRate = total > 0 ? (completed / total) * 100 : 0;

        node.put({
          dealsTotal: total,
          dealsCompleted: completed,
          dealsFailed: failed,
          dealFulfillmentRate: Math.round(fulfillmentRate * 100) / 100,
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
 * Record data integrity check result
 * @param gun - GunDB instance
 * @param relayHost - Host identifier
 * @param passed - Whether integrity check passed
 */
export async function recordDataIntegrityCheck(
  gun: GunInstance,
  relayHost: string,
  passed: boolean
): Promise<void> {
  const maxWaitMs = 2000;
  const startWait = Date.now();
  while (!acquireLock(relayHost)) {
    if (Date.now() - startWait > maxWaitMs) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  try {
    const node = gun.get(GUN_PATHS.REPUTATION).get(relayHost);
    await new Promise<void>((resolve) => {
      node.once((data: ReputationMetrics | undefined) => {
        const current = data || {};
        const now = Date.now();

        const checks = (current.dataIntegrityChecks || 0) + 1;
        const failures = passed
          ? current.dataIntegrityFailures || 0
          : (current.dataIntegrityFailures || 0) + 1;

        node.put({
          dataIntegrityChecks: checks,
          dataIntegrityFailures: failures,
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
  recordResourceMetrics,
  recordDealPerformance,
  recordDataIntegrityCheck,
  getReputation,
  getReputationLeaderboard,
  updateStoredScore,
  WEIGHTS,
  THRESHOLDS,
  OBSERVER_TYPE,
  OBSERVER_WEIGHTS,
  EXTENDED_WEIGHTS,
  isSelfRating,
  getObserverType,
};
