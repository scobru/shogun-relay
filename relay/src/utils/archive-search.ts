/**
 * Archive Search Service
 * 
 * Provides unified search across:
 * - Internet Archive (archive.org) - Official Advanced Search API
 * - PirateBay (apibay.org) - Public JSON API
 */

import { loggers } from './logger';

// ============================================================================
// TYPES
// ============================================================================

export interface ArchiveSearchResult {
  source: 'internet-archive' | 'piratebay';
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
  const { mediaType, rows = 50, page = 1, sort = 'downloads desc' } = options;

  try {
    // Build query - search all formats (torrent is available for most items anyway)
    let q = `(${encodeURIComponent(query)})`;
    
    if (mediaType) {
      q += ` AND mediatype:${encodeURIComponent(mediaType)}`;
    }

    const url = `https://archive.org/advancedsearch.php?q=${q}&output=json&rows=${rows}&page=${page}&sort[]=${encodeURIComponent(sort)}`;
    
    loggers.server.debug({ url, query, mediaType }, '🔍 Searching Internet Archive');

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as IASearchResponse;
    
    if (!data.response?.docs) {
      return [];
    }

    return data.response.docs.map((doc): ArchiveSearchResult => {
      const identifier = doc.identifier;
      return {
        source: 'internet-archive',
        identifier,
        title: doc.title || identifier,
        description: Array.isArray(doc.description) ? doc.description[0] : doc.description,
        creator: Array.isArray(doc.creator) ? doc.creator.join(', ') : doc.creator,
        date: doc.date,
        mediaType: doc.mediatype,
        size: doc.item_size,
        // Torrent URL is always at this path for archive.org items
        torrentUrl: `https://archive.org/download/${identifier}/${identifier}_archive.torrent`,
        itemUrl: `https://archive.org/details/${identifier}`,
        category: doc.mediatype
      };
    });

  } catch (error: any) {
    loggers.server.error({ err: error, query }, '🔍 Internet Archive search failed');
    return [];
  }
}

// ============================================================================
// PIRATEBAY API (via apibay.org)
// ============================================================================

interface TPBResult {
  id: string;
  name: string;
  info_hash: string;
  leechers: string;
  seeders: string;
  num_files: string;
  size: string;
  username: string;
  added: string;
  status: string;
  category: string;
  imdb?: string;
}

// TPB category mapping
const TPB_CATEGORIES: Record<number, string> = {
  100: 'Audio',
  101: 'Audio - Music',
  102: 'Audio - Audio Books',
  103: 'Audio - Sound Clips',
  104: 'Audio - FLAC',
  199: 'Audio - Other',
  200: 'Video',
  201: 'Video - Movies',
  202: 'Video - Movies DVDR',
  203: 'Video - Music Videos',
  204: 'Video - Movie Clips',
  205: 'Video - TV Shows',
  206: 'Video - Handheld',
  207: 'Video - HD Movies',
  208: 'Video - HD TV Shows',
  209: 'Video - 3D',
  299: 'Video - Other',
  300: 'Applications',
  301: 'Applications - Windows',
  302: 'Applications - Mac',
  303: 'Applications - Unix',
  304: 'Applications - Handheld',
  305: 'Applications - iOS',
  306: 'Applications - Android',
  399: 'Applications - Other',
  400: 'Games',
  401: 'Games - PC',
  402: 'Games - Mac',
  403: 'Games - PSx',
  404: 'Games - Xbox',
  405: 'Games - Wii',
  406: 'Games - Handheld',
  407: 'Games - iOS',
  408: 'Games - Android',
  499: 'Games - Other',
  600: 'Other',
  601: 'Other - E-books',
  602: 'Other - Comics',
  603: 'Other - Pictures',
  604: 'Other - Covers',
  605: 'Other - Physibles',
  699: 'Other - Other'
};

/**
 * Search PirateBay via apibay.org API
 */
export async function searchPirateBay(
  query: string,
  options: PirateBaySearchOptions = {}
): Promise<ArchiveSearchResult[]> {
  const { category, rows = 50 } = options;

  try {
    // apibay.org search endpoint
    let url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}`;
    if (category !== undefined) {
      url += `&cat=${category}`;
    }

    loggers.server.debug({ url, query, category }, '🔍 Searching PirateBay');

    const response = await fetch(url, {
      headers: { 
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://thepiratebay.org/',
        'Origin': 'https://thepiratebay.org'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as TPBResult[];

    // apibay returns [{"id":"0","name":"No results..."}] when no results
    if (!Array.isArray(data) || data.length === 0 || data[0].id === '0') {
      return [];
    }

    return data.slice(0, rows).map((item): ArchiveSearchResult => {
      const infoHash = item.info_hash.toLowerCase();
      const catId = parseInt(item.category);
      
      // Build magnet URI with trackers
      const trackers = [
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://tracker.openbittorrent.com:6969/announce',
        'udp://open.stealth.si:80/announce',
        'udp://exodus.desync.com:6969/announce',
        'udp://tracker.torrent.eu.org:451/announce'
      ];
      
      const magnetUri = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(item.name)}&tr=${trackers.map(t => encodeURIComponent(t)).join('&tr=')}`;

      return {
        source: 'piratebay',
        identifier: item.id,
        title: item.name,
        size: parseInt(item.size) || undefined,
        seeders: parseInt(item.seeders) || 0,
        leechers: parseInt(item.leechers) || 0,
        magnetUri,
        itemUrl: `https://thepiratebay.org/description.php?id=${item.id}`,
        category: TPB_CATEGORIES[catId] || `Category ${catId}`,
        date: new Date(parseInt(item.added) * 1000).toISOString(),
        creator: item.username
      };
    });

  } catch (error: any) {
    loggers.server.error({ err: error, query }, '🔍 PirateBay search failed');
    return [];
  }
}

// ============================================================================
// UNIFIED SEARCH
// ============================================================================

export interface UnifiedSearchOptions {
  sources?: ('internet-archive' | 'piratebay')[];
  rows?: number;
  // Internet Archive specific
  mediaType?: string;
  // PirateBay specific
  category?: number;
}

/**
 * Search across multiple archive sources
 */
export async function searchArchives(
  query: string,
  options: UnifiedSearchOptions = {}
): Promise<ArchiveSearchResult[]> {
  const { 
    sources = ['internet-archive', 'piratebay'],
    rows = 25,
    mediaType,
    category
  } = options;

  const results: ArchiveSearchResult[] = [];
  const searchPromises: Promise<ArchiveSearchResult[]>[] = [];

  if (sources.includes('internet-archive')) {
    searchPromises.push(
      searchInternetArchive(query, { rows, mediaType })
    );
  }

  if (sources.includes('piratebay')) {
    searchPromises.push(
      searchPirateBay(query, { rows, category })
    );
  }

  const searchResults = await Promise.allSettled(searchPromises);
  
  for (const result of searchResults) {
    if (result.status === 'fulfilled') {
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
  source: 'internet-archive' | 'piratebay',
  identifier: string
): Promise<{ torrentUrl?: string; magnetUri?: string } | null> {
  try {
    if (source === 'internet-archive') {
      // For Internet Archive, torrent URL follows a predictable pattern
      const torrentUrl = `https://archive.org/download/${identifier}/${identifier}_archive.torrent`;
      
      // Verify it exists
      const response = await fetch(torrentUrl, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        return { torrentUrl };
      }
      return null;
    }

    if (source === 'piratebay') {
      // For PirateBay, we need to fetch the item details to get info_hash
      const url = `https://apibay.org/t.php?id=${identifier}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      
      if (!response.ok) {
        return null;
      }

      const data = await response.json() as TPBResult;
      if (!data.info_hash || data.id === '0') {
        return null;
      }

      const trackers = [
        'udp://tracker.opentrackr.org:1337/announce',
        'udp://tracker.openbittorrent.com:6969/announce',
        'udp://open.stealth.si:80/announce'
      ];

      const magnetUri = `magnet:?xt=urn:btih:${data.info_hash.toLowerCase()}&dn=${encodeURIComponent(data.name)}&tr=${trackers.map(t => encodeURIComponent(t)).join('&tr=')}`;

      return { magnetUri };
    }

    return null;
  } catch (error: any) {
    loggers.server.error({ err: error, source, identifier }, '🔍 Failed to get torrent for item');
    return null;
  }
}

// Export default search class for convenience
export class ArchiveSearchService {
  async searchInternetArchive(query: string, options?: InternetArchiveSearchOptions) {
    return searchInternetArchive(query, options);
  }

  async searchPirateBay(query: string, options?: PirateBaySearchOptions) {
    return searchPirateBay(query, options);
  }

  async search(query: string, options?: UnifiedSearchOptions) {
    return searchArchives(query, options);
  }

  async getTorrent(source: 'internet-archive' | 'piratebay', identifier: string) {
    return getTorrentForItem(source, identifier);
  }
}

export const archiveSearch = new ArchiveSearchService();
