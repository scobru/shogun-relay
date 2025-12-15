/**
 * Type definitions for Shogun Relay SDK
 */

/**
 * Reputation Score Breakdown
 */
export interface ReputationScoreBreakdown {
  uptime: number;
  proofSuccess: number;
  responseTime: number;
  pinFulfillment: number;
  longevity: number;
  resourceEfficiency?: number;
  storageCapacity?: number;
  dataQuality?: number;
  reliability?: number;
  dealPerformance?: number;
  networkHealth?: number;
}

/**
 * Reputation Weights
 */
export interface ReputationWeights {
  uptime: number;
  proofSuccess: number;
  responseTime: number;
  pinFulfillment: number;
  longevity: number;
}

/**
 * Calculated Reputation Score
 */
export interface ReputationScore {
  total: number;
  tier: "excellent" | "good" | "average" | "poor" | "unreliable";
  breakdown: ReputationScoreBreakdown;
  weights: ReputationWeights;
  hasEnoughData: boolean;
}

/**
 * Reputation Metrics
 */
export interface ReputationMetrics {
  host?: string;
  firstSeenTimestamp?: number;
  lastSeenTimestamp?: number;
  dataPoints?: number;

  // Proof metrics
  proofsTotal?: number;
  proofsSuccessful?: number;
  proofsFailed?: number;
  avgResponseTimeMs?: number;
  responseTimeSamples?: number;

  // Pin fulfillment
  pinRequestsReceived?: number;
  pinRequestsFulfilled?: number;

  // Uptime tracking
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
  avgConnections?: number;
  maxConnections?: number;
  avgMemoryUsageMB?: number;
  maxMemoryUsageMB?: number;
  storageCapacityMB?: number;
  storageUsedMB?: number;
  storageUtilizationPercent?: number;
  ipfsRepoSizeMB?: number;
  ipfsPinsCount?: number;

  // Performance metrics
  avgLatencyMs?: number;
  latencySamples?: number;
  throughputMBps?: number;
  errorRate?: number;

  // Availability & Reliability
  meanTimeBetweenFailures?: number; // MTBF in milliseconds
  meanTimeToRecovery?: number; // MTTR in milliseconds
  downtimeEvents?: number;
  totalDowntimeMs?: number;

  // Data Quality metrics
  dataIntegrityChecks?: number;
  dataIntegrityFailures?: number;
  dataFreshnessMs?: number;

  // Network metrics
  peerConnections?: number;
  networkReachability?: number;

  // Deal & Subscription metrics
  dealsTotal?: number;
  dealsActive?: number;
  dealsCompleted?: number;
  dealsFailed?: number;
  dealFulfillmentRate?: number;
  subscriptionsTotal?: number;
  subscriptionsActive?: number;
  subscriptionRetentionRate?: number;

  // API Availability
  apiRequestsTotal?: number;
  apiRequestsSuccessful?: number;
  apiRequestsFailed?: number;
  apiUptimePercent?: number;

  // Security metrics
  securityIncidents?: number;
  lastSecurityIncident?: number;

  // Calculated fields
  score?: number;
  tier?: string;
  lastScoreUpdate?: number;
  proofSuccessRate?: number;
}

/**
 * Leaderboard Entry with calculated score
 */
export interface ReputationLeaderboardEntry extends ReputationMetrics {
  calculatedScore: ReputationScore;
}

/**
 * Reputation API Response
 */
export interface ReputationResponse {
  success: boolean;
  host?: string;
  reputation?: ReputationLeaderboardEntry;
  error?: string;
}

/**
 * Reputation Leaderboard Response
 */
export interface ReputationLeaderboardResponse {
  success: boolean;
  count: number;
  leaderboard: ReputationLeaderboardEntry[];
  filters?: {
    minScore?: number;
    tier?: string;
    limit?: number;
  };
  error?: string;
}

/**
 * Best Relays Response
 */
export interface BestRelaysResponse {
  success: boolean;
  count: number;
  relays: Array<{
    host: string;
    score: number;
    tier: string;
    uptime: number;
    lastSeen: number;
  }>;
  error?: string;
}

/**
 * Network Stats Response
 */
export interface NetworkStatsResponse {
  success: boolean;
  stats: {
    totalRelays: number;
    activeRelays: number;
    totalConnections: number;
    totalStorageBytes: number;
    totalStorageMB: number;
    totalStorageGB: string;
    totalPins: number;
    totalActiveDeals: number;
    totalActiveSubscriptions: number;
    totalDealStorageMB: number;
    totalSubscriptionStorageMB: number;
  };
  timestamp: number;
  debug?: {
    relaysFound: number;
    relaysWithPulse: number;
    sources: {
      pulse: string;
      deals: string;
      subscriptions: string;
      ipfsDirect: string;
    };
  };
  error?: string;
}

/**
 * Relay Info Response
 */
export interface RelayInfoResponse {
  success: boolean;
  host: string;
  endpoint?: string;
  lastSeen?: number;
  uptime?: number;
  connections?: {
    active?: number;
    total?: number;
  };
  memory?: {
    heapUsed?: number;
    heapTotal?: number;
    rss?: number;
  };
  ipfs?: {
    connected: boolean;
    repoSize?: number;
    repoSizeMB?: number;
    numPins?: number;
    numObjects?: number;
  };
  storage?: {
    used?: number;
    capacity?: number;
  };
  error?: string;
}

/**
 * Relays List Response
 */
export interface RelaysListResponse {
  success: boolean;
  count: number;
  relays: Array<{
    host: string;
    endpoint: string | null;
    lastSeen: number;
    uptime?: number;
    connections?: {
      active?: number;
      total?: number;
    };
    memory?: {
      heapUsed?: number;
      heapTotal?: number;
    };
    ipfs?: {
      connected: boolean;
      repoSize?: number;
      numPins?: number;
    };
    storage?: {
      used?: number;
      capacity?: number;
    };
  }>;
  error?: string;
}
