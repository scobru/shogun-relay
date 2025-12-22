import WebTorrent from 'webtorrent';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { loggers } from './logger';
import { annasArchiveConfig } from '../config/env-config';

// Create require for CJS modules
const require = createRequire(import.meta.url);

interface TorrentInfo {
  magnetURI?: string;
  torrentPath?: string;
}
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
  private gun: any;
  private relayKey: string;

  constructor() {
    this.enabled = annasArchiveConfig.enabled;
    this.dataDir = annasArchiveConfig.dataDir;
    this.catalogFile = path.join(this.dataDir, 'catalog.json');
    
    // Initialize GunDB for decentralized catalog
    if (this.enabled) {
      try {
        const Gun = require('gun');
        this.gun = Gun({
          peers: process.env.GUN_PEERS?.split(',') || [
            'https://gun-relay.scobrudot.dev/gun',
            'http://localhost:8765/gun'
          ]
        });
        
        // Generate or load relay key
        this.relayKey = process.env.RELAY_PUBLIC_KEY || 
                        `relay-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        loggers.server.info(`📚 GunDB initialized for relay: ${this.relayKey}`);
      } catch (error) {
        loggers.server.error({ err: error }, "📚 Failed to initialize GunDB");
        this.gun = null;
      }
    }

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
      
      // Subscribe to GunDB network
      this.subscribeToNetwork();
      
      // Publish current catalog if we have any
      if (this.catalog.size > 0) {
        this.publishCatalog();
      }
      
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
   * Create a torrent from files and start seeding
   */
  public async createTorrent(filePaths: string[]): Promise<{magnetURI: string, infoHash: string, name: string}> {
    if (!this.enabled || !this.client) {
      throw new Error("Anna's Archive integration is not enabled");
    }

    return new Promise((resolve, reject) => {
      try {
        // Seed the files
        this.client!.seed(filePaths, {
          announce: [
            'udp://tracker.opentrackr.org:1337/announce',
            'udp://tracker.openbittorrent.com:6969/announce',
            'udp://open.stealth.si:80/announce',
            'udp://exodus.desync.com:6969/announce'
          ]
        }, (torrent) => {
          loggers.server.info(`📚 Created and seeding torrent: ${torrent.name}`);
          loggers.server.info(`📚 Magnet: ${torrent.magnetURI.substring(0, 80)}...`);

          // Save to torrents.json for persistence
          const torrentsFile = path.join(this.dataDir, 'torrents.json');
          let savedTorrents: string[] = [];
          if (fs.existsSync(torrentsFile)) {
            savedTorrents = JSON.parse(fs.readFileSync(torrentsFile, 'utf8'));
          }
          if (!savedTorrents.includes(torrent.magnetURI)) {
            savedTorrents.push(torrent.magnetURI);
            fs.writeFileSync(torrentsFile, JSON.stringify(savedTorrents, null, 2));
          }

          // Trigger catalog update when done
          torrent.on('done', () => {
            this.onTorrentComplete(torrent);
          });

          resolve({
            magnetURI: torrent.magnetURI,
            infoHash: torrent.infoHash,
            name: torrent.name
          });
        });
      } catch (error) {
        reject(error);
      }
    });
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
      
      // Publish to GunDB network
      this.publishCatalog();
      
      loggers.server.debug(`📚 Saved ${entries.length} entries locally and to network`);
    } catch (error) {
      loggers.server.error({ err: error }, "📚 Failed to save catalog");
    }
  }

  /**
   * Publish catalog to GunDB network
   */
  private publishCatalog(): void {
    if (!this.gun) return;

    try {
      const catalogData: any = {
        relayUrl: process.env.PUBLIC_URL || 'http://localhost:3000',
        ipfsGateway: process.env.IPFS_GATEWAY || 'http://localhost:8080/ipfs',
        lastUpdated: Date.now(),
        torrents: {}
      };

      // Convert catalog Map to object
      this.catalog.forEach((entry, hash) => {
        catalogData.torrents[hash] = {
          name: entry.torrentName,
          magnetURI: entry.magnetLink,
          completedAt: entry.completedAt,
          files: entry.files
        };
      });

      // Publish to GunDB
      this.gun.get('annas-archive')
        .get('catalog')
        .get(this.relayKey)
        .put(catalogData);

      loggers.server.info(`📚 Published ${this.catalog.size} torrents to GunDB network`);
    } catch (error) {
      loggers.server.error({ err: error }, "📚 Failed to publish to GunDB");
    }
  }

  /**
   * Subscribe to network catalog updates
   */
  private subscribeToNetwork(): void {
    if (!this.gun) return;

    try {
      this.gun.get('annas-archive')
        .get('catalog')
        .map()
        .on((relayData: any, relayKey: string) => {
          if (relayKey === this.relayKey) return; // Skip own data
          if (!relayData || !relayData.torrents) return;

          const torrentCount = Object.keys(relayData.torrents).length;
          loggers.server.info(`📚 Discovered relay: ${relayKey} with ${torrentCount} torrents`);
        });

      loggers.server.info("📚 Subscribed to GunDB network catalog");
    } catch (error) {
      loggers.server.error({ err: error}, "📚 Failed to subscribe to GunDB");
    }
  }

  /**
   * Get network catalog from all relays
   */
  public async getNetworkCatalog(): Promise<any[]> {
    if (!this.gun) return [];

    return new Promise((resolve) => {
      const relays: any[] = [];
      const timeout = setTimeout(() => resolve(relays), 5000);

      this.gun.get('annas-archive')
        .get('catalog')
        .map()
        .once((relayData: any, relayKey: string) => {
          if (relayData && relayKey !== this.relayKey) {
            relays.push({
              relayKey,
              ...relayData
            });
          }
        });

      // Give it 2 seconds to collect
      setTimeout(() => {
        clearTimeout(timeout);
        resolve(relays);
      }, 2000);
    });
  }

  /**
   * Add a file to IPFS and pin it using CLI
   */
  private async addFileToIPFS(filePath: string): Promise<string | null> {
    try {
      const { execSync } = await import('child_process');
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        loggers.server.warn(`📚 File not found: ${filePath}`);
        return null;
      }

      // Use IPFS CLI to add and pin in one command
      // Set IPFS_PATH to point to correct repo location
      const result = execSync(`ipfs add -Q --pin "${filePath}"`, {
        encoding: 'utf8',
        timeout: 60000, // 60 second timeout
        env: { ...process.env, IPFS_PATH: '/data/ipfs' }
      }).trim();

      if (result) {
        loggers.server.info(`📚 Added to IPFS: ${path.basename(filePath)} → ${result}`);
        return result;
      }
      return null;
    } catch (error: any) {
      // Check if IPFS is running
      if (error.code === 'ECONNREFUSED') {
        loggers.server.warn(`📚 IPFS daemon not running - cannot pin ${path.basename(filePath)}`);
      } else {
        loggers.server.error({ err: error, filePath }, "📚 Failed to add file to IPFS");
      }
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
  public async removeTorrent(infoHash: string, deleteFiles: boolean = false): Promise<void> {
    if (!this.enabled || !this.client) {
      throw new Error("Anna's Archive integration is not enabled");
    }

    const torrent = this.client.torrents.find(t => t.infoHash === infoHash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    const torrentName = torrent.name;
    
    // Unpin files from IPFS and remove from catalog
    const catalogEntry = this.catalog.get(infoHash);
    if (catalogEntry && catalogEntry.files.length > 0) {
      for (const file of catalogEntry.files) {
        if (file.ipfsCid) {
          try {
            await this.unpinFromIPFS(file.ipfsCid);
            loggers.server.info(`📚 Unpinned IPFS: ${file.ipfsCid}`);
          } catch (error) {
            loggers.server.error({ err: error }, `📚 Failed to unpin ${file.ipfsCid}`);
          }
        }
      }
      // Remove from catalog
      this.catalog.delete(infoHash);
      this.saveCatalog();
      loggers.server.info(`📚 Removed ${infoHash} from catalog`);
    }
    
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
   * Unpin a CID from IPFS
   */
  private async unpinFromIPFS(cid: string): Promise<void> {
    const ipfsHost = process.env.IPFS_HOST || 'localhost';
    const ipfsPort = process.env.IPFS_API_PORT || '5001';

    await fetch(`http://${ipfsHost}:${ipfsPort}/api/v0/pin/rm?arg=${cid}`, {
      method: 'POST'
    });
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
