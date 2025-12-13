/**
 * Erasure Coding Utility for Shogun Relay
 * 
 * Provides data redundancy through chunk splitting and parity generation.
 * Uses XOR-based parity for simplicity (can be upgraded to Reed-Solomon).
 * 
 * Features:
 * - Split files into data chunks
 * - Generate parity chunks for redundancy
 * - Recover data from partial chunks
 * - Track chunk distribution across relays
 */

import crypto from 'crypto';
import { loggers } from './logger';

const log = loggers.erasure;

// Configuration interface
interface ErasureCodingConfig {
  chunkSize: number;
  dataChunks: number;
  parityChunks: number;
  minChunksForRecovery: number;
}

// Default configuration
const DEFAULT_CONFIG: ErasureCodingConfig = {
  chunkSize: 256 * 1024,      // 256KB per chunk
  dataChunks: 10,              // Number of data chunks
  parityChunks: 4,             // Number of parity chunks (40% redundancy)
  minChunksForRecovery: 10,    // Need at least this many to recover
};

// Chunk info interface
interface ChunkInfo {
  index: number;
  type: 'data' | 'parity';
  hash: string;
  size: number;
}

// Encode result interface
interface EncodeResult {
  originalSize: number;
  chunkSize: number;
  dataChunkCount: number;
  parityChunkCount: number;
  totalChunks: number;
  minChunksForRecovery: number;
  redundancyPercent: number;
  chunks: ChunkInfo[];
  dataChunks: Buffer[];
  parityChunks: Buffer[];
}

// Distribution plan interfaces
interface ChunkAssignment extends ChunkInfo {
  assignedRelays: string[];
}

interface DistributionPlan {
  chunks: ChunkAssignment[];
  relayAssignments: Record<string, number[]>;
}

// Erasure metadata interface
interface ErasureMetadata {
  version: number;
  algorithm: string;
  originalSize: number;
  chunkSize: number;
  dataChunkCount: number;
  parityChunkCount: number;
  redundancyPercent: number;
  chunks: {
    index: number;
    type: string;
    hash: string;
    assignedRelays: string[];
  }[];
  createdAt: number;
}

// Overhead calculation interface
interface OverheadResult {
  originalSize: number;
  dataChunks: number;
  parityChunks: number;
  totalChunks: number;
  dataSize: number;
  paritySize: number;
  totalSize: number;
  overheadBytes: number;
  overheadPercent: number;
  redundancyPercent: number;
}

/**
 * Split data into fixed-size chunks
 * 
 * @param data - Data to split
 * @param chunkSize - Size of each chunk in bytes
 * @returns Array of chunks
 */
export function splitIntoChunks(data: Buffer, chunkSize: number = DEFAULT_CONFIG.chunkSize): Buffer[] {
  const chunks: Buffer[] = [];
  let offset = 0;

  while (offset < data.length) {
    const end = Math.min(offset + chunkSize, data.length);
    const chunk = Buffer.alloc(chunkSize, 0); // Pad with zeros if needed
    data.copy(chunk, 0, offset, end);
    chunks.push(chunk);
    offset = end;
  }

  return chunks;
}

/**
 * XOR two buffers together
 * 
 * @param a - First buffer
 * @param b - Second buffer
 * @returns XOR result
 */
function xorBuffers(a: Buffer, b: Buffer): Buffer {
  const length = Math.max(a.length, b.length);
  const result = Buffer.alloc(length);

  for (let i = 0; i < length; i++) {
    result[i] = (a[i] || 0) ^ (b[i] || 0);
  }

  return result;
}

/**
 * Generate parity chunks using XOR
 * 
 * Simple parity scheme:
 * - P0 = XOR(D0, D1, D2, ...)
 * - P1 = XOR(D0, D2, D4, ...) (even indices)
 * - P2 = XOR(D1, D3, D5, ...) (odd indices)
 * - P3 = XOR(all with rotation)
 * 
 * @param dataChunks - Array of data chunks
 * @param parityCount - Number of parity chunks to generate
 * @returns Array of parity chunks
 */
export function generateParityChunks(dataChunks: Buffer[], parityCount: number = DEFAULT_CONFIG.parityChunks): Buffer[] {
  if (dataChunks.length === 0) {
    return [];
  }

  const chunkSize = dataChunks[0].length;
  const parityChunks: Buffer[] = [];

  // P0: XOR of all chunks
  let p0: Buffer = Buffer.alloc(chunkSize, 0);
  for (const chunk of dataChunks) {
    p0 = xorBuffers(p0, chunk);
  }
  parityChunks.push(p0);

  if (parityCount >= 2) {
    // P1: XOR of even-indexed chunks
    let p1: Buffer = Buffer.alloc(chunkSize, 0);
    for (let i = 0; i < dataChunks.length; i += 2) {
      p1 = xorBuffers(p1, dataChunks[i]);
    }
    parityChunks.push(p1);
  }

  if (parityCount >= 3) {
    // P2: XOR of odd-indexed chunks
    let p2: Buffer = Buffer.alloc(chunkSize, 0);
    for (let i = 1; i < dataChunks.length; i += 2) {
      p2 = xorBuffers(p2, dataChunks[i]);
    }
    parityChunks.push(p2);
  }

  if (parityCount >= 4) {
    // P3: Rotated XOR (each chunk shifted by index)
    let p3: Buffer = Buffer.alloc(chunkSize, 0);
    for (let i = 0; i < dataChunks.length; i++) {
      const rotated = Buffer.alloc(chunkSize);
      const shift = i % chunkSize;
      // Copy from position 0 to (chunkSize - shift) -> destination starts at shift
      dataChunks[i].copy(rotated, shift, 0, chunkSize - shift);
      // Copy from position (chunkSize - shift) to end -> destination starts at 0
      if (shift > 0) {
        dataChunks[i].copy(rotated, 0, chunkSize - shift, chunkSize);
      }
      p3 = xorBuffers(p3, rotated);
    }
    parityChunks.push(p3);
  }

  return parityChunks;
}

/**
 * Create erasure-coded representation of data
 * 
 * @param data - Original data
 * @param config - Configuration options
 * @returns Erasure coding result
 */
export function encodeData(data: Buffer, config: Partial<ErasureCodingConfig> = {}): EncodeResult {
  const opts = { ...DEFAULT_CONFIG, ...config };

  // Split into chunks
  const dataChunks = splitIntoChunks(data, opts.chunkSize);

  // Generate parity
  const parityChunks = generateParityChunks(dataChunks, opts.parityChunks);

  // Generate hashes for each chunk
  const allChunks = [...dataChunks, ...parityChunks];
  const chunkInfos: ChunkInfo[] = allChunks.map((chunk, index) => {
    const hash = crypto.createHash('sha256').update(chunk).digest('hex');
    return {
      index,
      type: index < dataChunks.length ? 'data' : 'parity',
      hash,
      size: chunk.length,
    };
  });

  return {
    originalSize: data.length,
    chunkSize: opts.chunkSize,
    dataChunkCount: dataChunks.length,
    parityChunkCount: parityChunks.length,
    totalChunks: allChunks.length,
    minChunksForRecovery: dataChunks.length, // Need all data chunks OR use parity
    redundancyPercent: Math.round((parityChunks.length / dataChunks.length) * 100),
    chunks: chunkInfos,
    dataChunks,
    parityChunks,
  };
}

/**
 * Reconstruct data from chunks (simple case: all data chunks available)
 * 
 * @param chunks - Available chunks (in order)
 * @param originalSize - Original data size
 * @returns Reconstructed data
 */
export function reconstructData(chunks: Buffer[], originalSize: number): Buffer {
  const combined = Buffer.concat(chunks);
  return combined.slice(0, originalSize);
}

/**
 * Attempt to recover missing chunk using parity
 * 
 * @param availableChunks - Map of index -> chunk
 * @param missingIndex - Index of missing chunk
 * @param totalDataChunks - Total number of data chunks
 * @returns Recovered chunk or undefined
 */
export function recoverMissingChunk(
  availableChunks: Map<number, Buffer>,
  missingIndex: number,
  totalDataChunks: number
): Buffer | undefined {
  // Get P0 (XOR of all data chunks)
  const p0Index = totalDataChunks; // First parity chunk
  const p0 = availableChunks.get(p0Index);

  if (!p0) {
    log.warn('Cannot recover: P0 parity chunk not available');
    return undefined;
  }

  // Check if we have all other data chunks
  let canRecover = true;
  for (let i = 0; i < totalDataChunks; i++) {
    if (i !== missingIndex && !availableChunks.has(i)) {
      canRecover = false;
      break;
    }
  }

  if (!canRecover) {
    log.warn('Cannot recover: too many missing chunks');
    return undefined;
  }

  // Recover: missing = P0 XOR all_other_data_chunks
  let recovered: Buffer = Buffer.from(p0);
  for (let i = 0; i < totalDataChunks; i++) {
    if (i !== missingIndex) {
      recovered = xorBuffers(recovered, availableChunks.get(i)!);
    }
  }

  return recovered;
}

/**
 * Create chunk distribution plan for multiple relays
 * 
 * @param encoded - Result from encodeData()
 * @param relayHosts - Available relay hosts
 * @param replicationFactor - Copies per chunk
 * @returns Distribution plan
 */
export function createDistributionPlan(
  encoded: EncodeResult,
  relayHosts: string[],
  replicationFactor: number = 2
): DistributionPlan {
  if (relayHosts.length === 0) {
    throw new Error('No relays available for distribution');
  }

  const plan: DistributionPlan = {
    chunks: [],
    relayAssignments: {},
  };

  // Initialize relay assignments
  relayHosts.forEach(host => {
    plan.relayAssignments[host] = [];
  });

  // Distribute chunks round-robin with replication
  encoded.chunks.forEach((chunk, index) => {
    const assignments: string[] = [];

    for (let r = 0; r < replicationFactor; r++) {
      const relayIndex = (index + r) % relayHosts.length;
      const relay = relayHosts[relayIndex];

      if (!assignments.includes(relay)) {
        assignments.push(relay);
        plan.relayAssignments[relay].push(index);
      }
    }

    plan.chunks.push({
      ...chunk,
      assignedRelays: assignments,
    });
  });

  return plan;
}

/**
 * Verify chunk integrity using hash
 * 
 * @param chunk - Chunk data
 * @param expectedHash - Expected SHA-256 hash
 * @returns True if valid
 */
export function verifyChunk(chunk: Buffer, expectedHash: string): boolean {
  const actualHash = crypto.createHash('sha256').update(chunk).digest('hex');
  return actualHash === expectedHash;
}

/**
 * Create metadata for storing with the deal
 * 
 * @param encoded - Result from encodeData()
 * @param distributionPlan - Result from createDistributionPlan()
 * @returns Metadata for storage
 */
export function createErasureMetadata(encoded: EncodeResult, distributionPlan?: DistributionPlan): ErasureMetadata {
  return {
    version: 1,
    algorithm: 'xor-parity',
    originalSize: encoded.originalSize,
    chunkSize: encoded.chunkSize,
    dataChunkCount: encoded.dataChunkCount,
    parityChunkCount: encoded.parityChunkCount,
    redundancyPercent: encoded.redundancyPercent,
    chunks: encoded.chunks.map(c => ({
      index: c.index,
      type: c.type,
      hash: c.hash,
      assignedRelays: distributionPlan?.chunks[c.index]?.assignedRelays || [],
    })),
    createdAt: Date.now(),
  };
}

/**
 * Calculate storage overhead for erasure coding
 * 
 * @param originalSize - Original file size in bytes
 * @param config - Erasure coding configuration
 * @returns Size calculations
 */
export function calculateOverhead(originalSize: number, config: ErasureCodingConfig = DEFAULT_CONFIG): OverheadResult {
  const dataChunks = Math.ceil(originalSize / config.chunkSize);
  const parityChunks = config.parityChunks;
  const totalChunks = dataChunks + parityChunks;

  const dataSize = dataChunks * config.chunkSize;
  const paritySize = parityChunks * config.chunkSize;
  const totalSize = totalChunks * config.chunkSize;

  return {
    originalSize,
    dataChunks,
    parityChunks,
    totalChunks,
    dataSize,
    paritySize,
    totalSize,
    overheadBytes: totalSize - originalSize,
    overheadPercent: Math.round(((totalSize - originalSize) / originalSize) * 100),
    redundancyPercent: Math.round((parityChunks / dataChunks) * 100),
  };
}

export default {
  splitIntoChunks,
  generateParityChunks,
  encodeData,
  reconstructData,
  recoverMissingChunk,
  createDistributionPlan,
  verifyChunk,
  createErasureMetadata,
  calculateOverhead,
  DEFAULT_CONFIG,
};
