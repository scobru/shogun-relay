import WebTorrent from "webtorrent";
import fs from "fs";
import path from "path";
import { annasArchiveConfig } from "../config/env-config";
import { loggers } from "./logger";

// Catalog entry for torrents with IPFS mappings
export interface CatalogEntry {
  torrentHash: string;
  torrentName: string;
  magnetLink?: string;
  completedAt: number;
  files: {
    name: string;
    path: string;
    size: number;
    ipfsCid?: string;
  }[];
}

// Define a simple interface for the status
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
    paused: boolean;
    files: number;
  }[];
}

export class AnnasArchiveManager {
  private client: WebTorrent.Instance | null = null;
  private enabled: boolean;
  private dataDir: string;
  private torrents: string[] = []; // List of magnet links or torrent file paths
  private catalogFile: string;
  private catalog: Map<string, CatalogEntry> = new Map();

  constructor() {
    this.enabled = annasArchiveConfig.enabled;
    this.dataDir = annasArchiveConfig.dataDir;
    this.catalogFile = path.join(this.dataDir, 'catalog.json');

    // Default torrents (Placeholder for MVP)
    // Ideally this would fetch from annasArchiveConfig.torrentListUrl
    this.torrents = [
        // Example: Anna’s Archive: Sci-Hub torrent (just a placeholder magnet/hash)
        // "magnet:?xt=urn:btih:..." 
    ];
  }

  /**
   * Initialize and start the service
   */
  public async start(): Promise<void> {
    if (!this.enabled) {
      loggers.server.info("📚 Anna's Archive integration is DISABLED");
      return;
    }

    loggers.server.info("📚 Initializing Anna's Archive Manager...");
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    try {
      // Dynamic import for WebTorrent if needed, or just use the imported one
       // @ts-ignore - WebTorrent types might be tricky with ESM/CommonJS mix
      this.client = new WebTorrent({
          // @ts-ignore - Disable uTP to avoid segmentation faults on Alpine Linux (utp-native)
          utp: false
      });

      this.client.on('error', (err) => {
          loggers.server.error({ err }, "📚 Anna's Archive WebTorrent Error");
      });

      loggers.server.info(`📚 Anna's Archive Manager started. Data dir: ${this.dataDir}`);
      
      // Load existing catalog
      this.loadCatalog();
      
      // Start seeding/downloading configured torrents
      await this.loadTorrents();

    } catch (error) {
      loggers.server.error({ err: error }, "📚 Failed to start Anna's Archive Manager");
    }
  }

  /**
   * Load and start torrents
   */
  private async loadTorrents(): Promise<void> {
      if (!this.client) return;

      let allTorrents: string[] = [...this.torrents];

      // 1. Load from torrents.json
      const torrentsFile = path.join(this.dataDir, 'torrents.json');
      if (fs.existsSync(torrentsFile)) {
          try {
              const fileContent = fs.readFileSync(torrentsFile, 'utf8');
              const data = JSON.parse(fileContent);
              if (Array.isArray(data)) {
                  allTorrents = [...allTorrents, ...data];
                  loggers.server.info(`📚 Loaded ${data.length} torrents from ${torrentsFile}`);
              }
          } catch (error) {
              loggers.server.error({ err: error }, `📚 Failed to parse ${torrentsFile}`);
          }
      } else {
           // Initialize empty file if not exists
           try {
               fs.writeFileSync(torrentsFile, JSON.stringify([], null, 2));
           } catch (error) {}
      }

      // 2. Fetch dynamic torrents if maxTb is configured
      if (annasArchiveConfig.maxTb > 0) {
          try {
              const dynamicTorrents = await this.fetchDynamicTorrents();
              if (dynamicTorrents.length > 0) {
                  loggers.server.info(`📚 Loaded ${dynamicTorrents.length} dynamic torrents from Anna's Archive API`);
                  allTorrents = [...allTorrents, ...dynamicTorrents];
              }
          } catch (error) {
              loggers.server.error({ err: error }, "📚 Failed to fetch dynamic torrents");
          }
      }

      // Deduplicate
      allTorrents = [...new Set(allTorrents)];

      if (allTorrents.length === 0) {
          loggers.server.info("📚 No torrents configured for Anna's Archive yet.");
          return;
      }

      loggers.server.info(`📚 Starting ${allTorrents.length} torrents...`);

      allTorrents.forEach(torrentId => {
          this.client!.add(torrentId, { path: this.dataDir }, (torrent) => {
              loggers.server.info(`📚 Added torrent: ${torrent.name}`);
              
              torrent.on('done', () => {
                  loggers.server.info(`📚 Torrent download complete: ${torrent.name}`);
                  // Add files to IPFS and update catalog
                  this.onTorrentComplete(torrent);
              });
          });
      });
  }

  /**
   * Fetch dynamic torrent list from Anna's Archive
   */
  private async fetchDynamicTorrents(): Promise<string[]> {
      const maxTb = annasArchiveConfig.maxTb;
      const url = `${annasArchiveConfig.torrentListUrl}?max_tb=${maxTb}&format=json`;
      
      loggers.server.info({ url }, "📚 Fetching dynamic torrent list...");

      try {
          const response = await fetch(url);
          if (!response.ok) {
              throw new Error(`Failed to fetch: ${response.statusText}`);
          }

          const data: any[] = await response.json() as any[];
          
          if (!Array.isArray(data)) {
              throw new Error("Invalid response format: expected array");
          }

          // Extract magnet links
          return data
              .map(item => item.magnet_link)
              .filter(link => link && typeof link === 'string');

      } catch (error) {
          loggers.server.error({ err: error }, "📚 Error fetching dynamic torrents");
          return [];
      }
  }

  /**
   * Stop the service
   */
  public stop(): void {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      loggers.server.info("📚 Anna's Archive Manager stopped");
    }
  }

  /**
   * Add a magnet link or torrent file manually
   */
  public addTorrent(magnetOrPath: string): void {
      if (!this.enabled || !this.client) {
          throw new Error("Anna's Archive integration is not enabled");
      }

      this.client.add(magnetOrPath, { path: this.dataDir }, (torrent) => {
          loggers.server.info(`📚 Manually added torrent: ${torrent.name}`);
      });

      // Persist to torrents.json
      try {
          const torrentsFile = path.join(this.dataDir, 'torrents.json');
          if (fs.existsSync(torrentsFile)) {
              const fileContent = fs.readFileSync(torrentsFile, 'utf8');
              let existingTorrents: string[] = JSON.parse(fileContent);
              
              if (!existingTorrents.includes(magnetOrPath)) {
                  existingTorrents.push(magnetOrPath);
                  fs.writeFileSync(torrentsFile, JSON.stringify(existingTorrents, null, 2));
                  loggers.server.info("📚 Persisted new torrent to configuration");
              }
          }
      } catch (error) {
          loggers.server.error({ err: error }, "📚 Failed to persist new torrent");
      }
  }

  /**
   * Load catalog from disk
   */
  private loadCatalog(): void {
    try {
      if (fs.existsSync(this.catalogFile)) {
        const data = fs.readFileSync(this.catalogFile, 'utf8');
        const entries: CatalogEntry[] = JSON.parse(data);
        this.catalog.clear();
        entries.forEach(entry => {
          this.catalog.set(entry.torrentHash, entry);
        });
        loggers.server.info(`📚 Loaded ${entries.length} entries from catalog`);
      }
    } catch (error) {
      loggers.server.error({ err: error }, "📚 Failed to load catalog");
    }
  }

  /**
   * Save catalog to disk
   */
  private saveCatalog(): void {
    try {
      const entries = Array.from(this.catalog.values());
      fs.writeFileSync(this.catalogFile, JSON.stringify(entries, null, 2));
      loggers.server.debug(`📚 Saved ${entries.length} entries to catalog`);
    } catch (error) {
      loggers.server.error({ err: error }, "📚 Failed to save catalog");
    }
  }

  /**
   * Add a file to IPFS and pin it
   */
  private async addFileToIPFS(filePath: string): Promise<string | null> {
    try {
      const FormData = (await import('form-data')).default;
      const formData = new FormData();
      formData.append('file', fs.createReadStream(filePath));

      // Add to IPFS
      const addResponse = await fetch('http://localhost:5001/api/v0/add', {
        method: 'POST',
        body: formData as any
      });

      if (!addResponse.ok) {
        throw new Error(`IPFS add failed: ${addResponse.status}`);
      }

      const result = await addResponse.json() as { Hash: string };
      const cid = result.Hash;

      // Pin the file
      await fetch(`http://localhost:5001/api/v0/pin/add?arg=${cid}`, {
        method: 'POST'
      });

      loggers.server.info(`📚 Added to IPFS: ${path.basename(filePath)} → ${cid}`);
      return cid;
    } catch (error) {
      loggers.server.error({ err: error, filePath }, "📚 Failed to add file to IPFS");
      return null;
    }
  }

  /**
   * Handle torrent completion - add files to IPFS
   */
  private async onTorrentComplete(torrent: any): Promise<void> {
    loggers.server.info(`📚 Torrent completed: ${torrent.name}`);

    const entry: CatalogEntry = {
      torrentHash: torrent.infoHash,
      torrentName: torrent.name,
      magnetLink: torrent.magnetURI,
      completedAt: Date.now(),
      files: []
    };

    // Process each file
    for (const file of torrent.files) {
      const filePath = path.join(this.dataDir, file.path);
      
      // Check if file already has IPFS CID
      const existingEntry = this.catalog.get(torrent.infoHash);
      const existingFile = existingEntry?.files.find(f => f.path === file.path);
      
      let ipfsCid = existingFile?.ipfsCid;
      
      if (!ipfsCid) {
        // Add to IPFS if not already done
        ipfsCid = await this.addFileToIPFS(filePath) || undefined;
      }

      entry.files.push({
        name: file.name,
        path: file.path,
        size: file.length,
        ipfsCid: ipfsCid
      });
    }

    // Update catalog
    this.catalog.set(torrent.infoHash, entry);
    this.saveCatalog();

    loggers.server.info(`📚 Cataloged ${entry.files.length} files from torrent ${torrent.name}`);
  }

  /**
   * Get catalog for sharing with other relays
   */
  public getCatalog(): CatalogEntry[] {
    return Array.from(this.catalog.values());
  }

  /**
   * Pause a torrent
   */
  public pauseTorrent(infoHash: string): void {
    if (!this.enabled || !this.client) {
      throw new Error("Anna's Archive integration is not enabled");
    }

    const torrent = this.client.torrents.find(t => t.infoHash === infoHash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    torrent.pause();
    loggers.server.info(`📚 Paused torrent: ${torrent.name} (${infoHash.substring(0, 12)}...)`);
  }

  /**
   * Resume a paused torrent
   */
  public resumeTorrent(infoHash: string): void {
    if (!this.enabled || !this.client) {
      throw new Error("Anna's Archive integration is not enabled");
    }

    const torrent = this.client.torrents.find(t => t.infoHash === infoHash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    torrent.resume();
    loggers.server.info(`📚 Resumed torrent: ${torrent.name} (${infoHash.substring(0, 12)}...)`);
  }

  /**
   * Remove a torrent from the client
   * @param infoHash The torrent's info hash
   * @param deleteFiles Whether to delete files from disk (default: false)
   */
  public removeTorrent(infoHash: string, deleteFiles: boolean = false): void {
    if (!this.enabled || !this.client) {
      throw new Error("Anna's Archive integration is not enabled");
    }

    const torrent = this.client.torrents.find(t => t.infoHash === infoHash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    const torrentName = torrent.name;
    
    // Remove from WebTorrent
    torrent.destroy({ destroyStore: deleteFiles });
    loggers.server.info(`📚 Removed torrent: ${torrentName} (deleteFiles: ${deleteFiles})`);

    // Remove from torrents.json persistence
    try {
      const torrentsFile = path.join(this.dataDir, 'torrents.json');
      if (fs.existsSync(torrentsFile)) {
        const fileContent = fs.readFileSync(torrentsFile, 'utf8');
        let existingTorrents: string[] = JSON.parse(fileContent);
        
        // Filter out any magnet link that contains this infoHash
        const filtered = existingTorrents.filter(mag => !mag.includes(infoHash));
        
        if (filtered.length !== existingTorrents.length) {
          fs.writeFileSync(torrentsFile, JSON.stringify(filtered, null, 2));
          loggers.server.info("📚 Removed torrent from persistent configuration");
        }
      }
    } catch (error) {
      loggers.server.error({ err: error }, "📚 Failed to update torrents.json after removal");
    }
  }

  /**
   * Get files for a specific torrent or all torrents
   * @param infoHash Optional torrent info hash. If not provided, returns files for all torrents
   */
  public getFiles(infoHash?: string): any {
    if (!this.enabled || !this.client) {
      return { torrents: [] };
    }

    let torrents = this.client.torrents;
    
    if (infoHash) {
      const torrent = torrents.find(t => t.infoHash === infoHash);
      if (!torrent) {
        throw new Error(`Torrent not found: ${infoHash}`);
      }
      torrents = [torrent];
    }

    return {
      torrents: torrents.map(t => ({
        infoHash: t.infoHash,
        name: t.name,
        files: t.files.map(f => ({
          name: f.name,
          path: f.path,
          size: f.length,
          downloaded: f.downloaded,
          progress: f.progress
        }))
      }))
    };
  }

  /**
   * Get current status
   */
  public getStatus(): AnnasArchiveStatus {
    if (!this.client || !this.enabled) {
      return {
        enabled: this.enabled,
        activeTorrents: 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
        ratio: 0,
        torrents: []
      };
    }

    return {
      enabled: this.enabled,
      activeTorrents: this.client.torrents.length,
      downloadSpeed: this.client.downloadSpeed,
      uploadSpeed: this.client.uploadSpeed,
      ratio: this.client.ratio,
      torrents: this.client.torrents.map(t => ({
          infoHash: t.infoHash,
          name: t.name,
          progress: t.progress,
          downloadSpeed: t.downloadSpeed,
          uploadSpeed: t.uploadSpeed,
          peers: t.numPeers,
          paused: t.paused,
          files: t.files.length,
          magnetURI: t.magnetURI
      }))
    };
  }
}

// Export singleton instance
export const annasArchiveManager = new AnnasArchiveManager();
