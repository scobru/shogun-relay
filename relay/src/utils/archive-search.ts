/**
 * Archive Search Service
 *
 * Provides unified search across:
 * - Internet Archive (archive.org) - Official Advanced Search API
 * - PirateBay (apibay.org) - Public JSON API
 */

import { loggers } from "./logger";

// ============================================================================
// TYPES
// ============================================================================

export interface ArchiveSearchResult {
  source: "internet-archive";
  identifier: string;
  title: string;
  description?: string;
  creator?: string;
  date?: string;
  mediaType?: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  torrentUrl?: string;
  magnetUri?: string;
  itemUrl: string;
  category?: string;
}

export interface InternetArchiveSearchOptions {
  mediaType?: string; // audio, video, texts, software, etc.
  rows?: number;
  page?: number;
  sort?: string;
}

export interface PirateBaySearchOptions {
  category?: number; // 0=all, 100=audio, 200=video, 300=apps, 400=games, 500=xxx, 600=other
  rows?: number;
}

// ============================================================================
// INTERNET ARCHIVE API
// ============================================================================

interface IASearchDoc {
  identifier: string;
  title?: string;
  description?: string | string[];
  creator?: string | string[];
  date?: string;
  mediatype?: string;
  format?: string[];
  item_size?: number;
}

interface IASearchResponse {
  responseHeader?: { status: number };
  response?: {
    numFound: number;
    start: number;
    docs: IASearchDoc[];
  };
}

/**
 * Search Internet Archive for items with BitTorrent format
 */
export async function searchInternetArchive(
  query: string,
  options: InternetArchiveSearchOptions = {}
): Promise<ArchiveSearchResult[]> {
  const { mediaType, rows = 50, page = 1, sort = "downloads desc" } = options;

  try {
    // Build query - search all formats (torrent is available for most items anyway)
    let q = `(${encodeURIComponent(query)})`;

    if (mediaType) {
      q += ` AND mediatype:${encodeURIComponent(mediaType)}`;
    }

    const url = `https://archive.org/advancedsearch.php?q=${q}&output=json&rows=${rows}&page=${page}&sort[]=${encodeURIComponent(sort)}`;

    loggers.server.debug({ url, query, mediaType }, "🔍 Searching Internet Archive");

    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as IASearchResponse;

    if (!data.response?.docs) {
      return [];
    }

    return data.response.docs.map((doc): ArchiveSearchResult => {
      const identifier = doc.identifier;
      return {
        source: "internet-archive",
        identifier,
        title: doc.title || identifier,
        description: Array.isArray(doc.description) ? doc.description[0] : doc.description,
        creator: Array.isArray(doc.creator) ? doc.creator.join(", ") : doc.creator,
        date: doc.date,
        mediaType: doc.mediatype,
        size: doc.item_size,
        // Torrent URL is always at this path for archive.org items
        torrentUrl: `https://archive.org/download/${identifier}/${identifier}_archive.torrent`,
        itemUrl: `https://archive.org/details/${identifier}`,
        category: doc.mediatype,
      };
    });
  } catch (error: any) {
    loggers.server.error({ err: error, query }, "🔍 Internet Archive search failed");
    return [];
  }
}

// ============================================================================
// UNIFIED SEARCH
// ============================================================================

export interface UnifiedSearchOptions {
  sources?: "internet-archive"[];
  rows?: number;
  // Internet Archive specific
  mediaType?: string;
}

/**
 * Search across multiple archive sources
 */
export async function searchArchives(
  query: string,
  options: UnifiedSearchOptions = {}
): Promise<ArchiveSearchResult[]> {
  const { sources = ["internet-archive"], rows = 25, mediaType } = options;

  const results: ArchiveSearchResult[] = [];
  const searchPromises: Promise<ArchiveSearchResult[]>[] = [];

  if (sources.includes("internet-archive")) {
    searchPromises.push(searchInternetArchive(query, { rows, mediaType }));
  }

  const searchResults = await Promise.allSettled(searchPromises);

  for (const result of searchResults) {
    if (result.status === "fulfilled") {
      results.push(...result.value);
    }
  }

  // Sort by seeders (for TPB) or keep original order
  return results.sort((a, b) => {
    // Prioritize items with more seeders
    const aSeeds = a.seeders || 0;
    const bSeeds = b.seeders || 0;
    return bSeeds - aSeeds;
  });
}

/**
 * Get torrent/magnet for a specific item
 */
export async function getTorrentForItem(
  source: "internet-archive",
  identifier: string
): Promise<{ torrentUrl?: string; magnetUri?: string } | null> {
  try {
    if (source === "internet-archive") {
      // For Internet Archive, torrent URL follows a predictable pattern
      const torrentUrl = `https://archive.org/download/${identifier}/${identifier}_archive.torrent`;

      // Verify it exists
      const response = await fetch(torrentUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        return { torrentUrl };
      }
      return null;
    }

    return null;
  } catch (error: any) {
    loggers.server.error({ err: error, source, identifier }, "🔍 Failed to get torrent for item");
    return null;
  }
}

// Export default search class for convenience
export class ArchiveSearchService {
  async searchInternetArchive(query: string, options?: InternetArchiveSearchOptions) {
    return searchInternetArchive(query, options);
  }

  async search(query: string, options?: UnifiedSearchOptions) {
    return searchArchives(query, options);
  }

  async getTorrent(source: "internet-archive", identifier: string) {
    return getTorrentForItem(source, identifier);
  }
}

export const archiveSearch = new ArchiveSearchService();
