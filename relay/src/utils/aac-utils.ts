/**
 * Anna's Archive Container (AAC) Utility Functions
 * 
 * Implements the AAC standard for creating standardized releases
 * @see https://annas-archive.org/blog/annas-archive-containers.html
 */

import { v4 as uuidv4 } from 'uuid';

// AAC Format: aacid__{collection}__{timestamp}__{collection_id}__{shortuuid}
const AAC_PREFIX = 'aacid';
const COLLECTION_PREFIX = 'shogun_relay';

/**
 * Generate an ISO 8601 compact timestamp in UTC
 * Format: 20231224T143500Z
 */
export function formatAACTimestamp(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const seconds = String(date.getUTCSeconds()).padStart(2, '0');
  
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

/**
 * Generate a short UUID (base64url-like encoded)
 * Converts UUID to a shorter alphanumeric representation
 */
export function generateShortUUID(): string {
  const uuid = uuidv4().replace(/-/g, '');
  // Convert hex to base64url-like (alphanumeric only)
  const bytes = Buffer.from(uuid, 'hex');
  return bytes.toString('base64url').substring(0, 22);
}

/**
 * Sanitize a collection-specific ID for AACID
 * - Remove special characters
 * - Replace spaces with underscores
 * - Truncate if needed (max 50 chars to leave room in 150 char limit)
 */
export function sanitizeCollectionId(id: string): string {
  return id
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_|_$/g, '')
    .substring(0, 50);
}

/**
 * Generate a unique AACID (Anna's Archive Container ID)
 * 
 * Format: aacid__{collection}__{timestamp}__{collection_id}__{shortuuid}
 * 
 * @param collectionType - Type of collection: 'files', 'records', 'metadata'
 * @param collectionId - Optional collection-specific ID (e.g., filename)
 * @param timestamp - Optional timestamp (defaults to now)
 */
export function generateAACID(
  collectionType: 'files' | 'records' | 'metadata' = 'files',
  collectionId?: string,
  timestamp?: Date
): string {
  const collection = `${COLLECTION_PREFIX}_${collectionType}`;
  const ts = formatAACTimestamp(timestamp);
  const uuid = generateShortUUID();
  
  const parts = [AAC_PREFIX, collection, ts];
  
  if (collectionId) {
    parts.push(sanitizeCollectionId(collectionId));
  }
  
  parts.push(uuid);
  
  const aacid = parts.join('__');
  
  // Ensure max 150 characters
  if (aacid.length > 150) {
    // Truncate collection_id portion
    const withoutId = [AAC_PREFIX, collection, ts, uuid].join('__');
    return withoutId;
  }
  
  return aacid;
}

/**
 * Generate an AACID range notation
 * Format: aacid__{collection}__{from_timestamp}--{to_timestamp}
 */
export function generateAACIDRange(
  collectionType: 'files' | 'records' | 'metadata',
  fromTimestamp: Date,
  toTimestamp: Date
): string {
  const collection = `${COLLECTION_PREFIX}_${collectionType}`;
  const fromTs = formatAACTimestamp(fromTimestamp);
  const toTs = formatAACTimestamp(toTimestamp);
  
  return `${AAC_PREFIX}__${collection}__${fromTs}--${toTs}`;
}

/**
 * Generate metadata filename for a range
 * Format: shogun_relay_meta__aacid__collection__from--to.jsonl.zstd
 */
export function generateMetadataFilename(
  collectionType: 'files' | 'records' | 'metadata',
  fromTimestamp: Date,
  toTimestamp: Date
): string {
  const range = generateAACIDRange(collectionType, fromTimestamp, toTimestamp);
  return `shogun_relay_meta__${range}.jsonl.zstd`;
}

/**
 * Generate data folder name for a range
 * Format: shogun_relay_data__aacid__collection__from--to
 */
export function generateDataFolderName(
  collectionType: 'files' | 'records' | 'metadata',
  fromTimestamp: Date,
  toTimestamp: Date
): string {
  const range = generateAACIDRange(collectionType, fromTimestamp, toTimestamp);
  return `shogun_relay_data__${range}`;
}

/**
 * Parse an AACID into its components
 */
export function parseAACID(aacid: string): {
  prefix: string;
  collection: string;
  timestamp: string;
  collectionId?: string;
  uuid: string;
} | null {
  const parts = aacid.split('__');
  
  if (parts.length < 4 || parts[0] !== AAC_PREFIX) {
    return null;
  }
  
  if (parts.length === 4) {
    return {
      prefix: parts[0],
      collection: parts[1],
      timestamp: parts[2],
      uuid: parts[3]
    };
  }
  
  return {
    prefix: parts[0],
    collection: parts[1],
    timestamp: parts[2],
    collectionId: parts[3],
    uuid: parts[4]
  };
}

/**
 * Create an AAC metadata record
 */
export interface AACMetadataRecord {
  aacid: string;
  metadata: {
    filename: string;
    size: number;
    mimeType?: string;
    hash?: {
      md5?: string;
      sha256?: string;
    };
    source?: string;
    createdAt: string;
    [key: string]: any;
  };
  data_folder?: string;
}

export function createAACRecord(
  filename: string,
  size: number,
  options: {
    mimeType?: string;
    md5?: string;
    sha256?: string;
    source?: string;
    dataFolder?: string;
    additionalMetadata?: Record<string, any>;
  } = {}
): AACMetadataRecord {
  const aacid = generateAACID('files', filename);
  
  const record: AACMetadataRecord = {
    aacid,
    metadata: {
      filename,
      size,
      createdAt: new Date().toISOString(),
      ...(options.mimeType && { mimeType: options.mimeType }),
      ...(options.source && { source: options.source }),
      ...((options.md5 || options.sha256) && {
        hash: {
          ...(options.md5 && { md5: options.md5 }),
          ...(options.sha256 && { sha256: options.sha256 })
        }
      }),
      ...options.additionalMetadata
    }
  };
  
  if (options.dataFolder) {
    record.data_folder = options.dataFolder;
  }
  
  return record;
}
