import { ApiClient } from "../client";

export interface AnnasArchiveStatus {
  enabled: boolean;
  activeTorrents: number;
  downloadSpeed: number;
  uploadSpeed: number;
  ratio: number;
  torrents: {
    infoHash: string;
    name: string;
    progress: number;
    downloadSpeed: number;
    uploadSpeed: number;
    peers: number;
  }[];
}

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

export interface SearchOptions {
  sources?: ('internet-archive' | 'piratebay')[];
  limit?: number;
  mediaType?: string;   // For Internet Archive: audio, video, texts, software
  category?: number;     // For PirateBay: 100=audio, 200=video, 300=apps, etc.
}

export class AnnasArchiveModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * Get Anna's Archive integration status
   */
  public async getStatus(): Promise<{ success: boolean; data: AnnasArchiveStatus }> {
    return this.client.get<{ success: boolean; data: AnnasArchiveStatus }>(
      "/api/v1/torrent/status"
    );
  }

  /**
   * Add a manual torrent
   * @param magnet Magnet link or URL
   */
  public async addTorrent(magnet: string): Promise<{ success: boolean; message: string }> {
    return this.client.post<{ success: boolean; message: string }>(
      "/api/v1/torrent/add",
      { magnet }
    );
  }

  // =========================================================================
  // SEARCH METHODS (Internet Archive + PirateBay)
  // =========================================================================

  /**
   * Unified search across Internet Archive and PirateBay
   */
  public async search(
    query: string, 
    options?: SearchOptions
  ): Promise<{ success: boolean; count: number; results: ArchiveSearchResult[] }> {
    const params = new URLSearchParams({ q: query });
    
    if (options?.sources) {
      params.set('sources', options.sources.join(','));
    }
    if (options?.limit) {
      params.set('limit', options.limit.toString());
    }
    if (options?.mediaType) {
      params.set('mediaType', options.mediaType);
    }
    if (options?.category !== undefined) {
      params.set('category', options.category.toString());
    }

    return this.client.get<{ success: boolean; count: number; results: ArchiveSearchResult[] }>(
      `/api/v1/torrent/search?${params.toString()}`
    );
  }

  /**
   * Search Internet Archive for items with BitTorrent format
   */
  public async searchInternetArchive(
    query: string,
    options?: { mediaType?: string; rows?: number; page?: number }
  ): Promise<{ success: boolean; count: number; results: ArchiveSearchResult[] }> {
    const params = new URLSearchParams({ q: query });
    
    if (options?.mediaType) {
      params.set('mediaType', options.mediaType);
    }
    if (options?.rows) {
      params.set('rows', options.rows.toString());
    }
    if (options?.page) {
      params.set('page', options.page.toString());
    }

    return this.client.get<{ success: boolean; count: number; results: ArchiveSearchResult[] }>(
      `/api/v1/torrent/search/internet-archive?${params.toString()}`
    );
  }

  /**
   * Search PirateBay via apibay.org
   */
  public async searchPirateBay(
    query: string,
    options?: { category?: number; rows?: number }
  ): Promise<{ success: boolean; count: number; results: ArchiveSearchResult[] }> {
    const params = new URLSearchParams({ q: query });
    
    if (options?.category !== undefined) {
      params.set('category', options.category.toString());
    }
    if (options?.rows) {
      params.set('rows', options.rows.toString());
    }

    return this.client.get<{ success: boolean; count: number; results: ArchiveSearchResult[] }>(
      `/api/v1/torrent/search/piratebay?${params.toString()}`
    );
  }

  /**
   * Add a torrent from search results
   */
  public async addFromSearch(
    source: 'internet-archive' | 'piratebay',
    identifier: string,
    magnetUri?: string
  ): Promise<{ success: boolean; message: string }> {
    return this.client.post<{ success: boolean; message: string }>(
      "/api/v1/torrent/add-from-search",
      { source, identifier, magnetUri }
    );
  }
}
