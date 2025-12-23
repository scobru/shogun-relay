import WebTorrent from 'webtorrent';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { loggers } from './logger';
import { annasArchiveConfig, relayConfig, ipfsConfig } from '../config/env-config';

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
  private relayKey: string = '';

  constructor() {
    this.enabled = annasArchiveConfig.enabled;
    this.dataDir = annasArchiveConfig.dataDir;
    this.catalogFile = path.join(this.dataDir, 'catalog.json');
    
    // Initialize GunDB for decentralized catalog
    if (this.enabled) {
      try {
        // Use gun/gun.js directly to avoid bullet-catcher's isValid requirement
        // This is a client Gun instance, not the main server
        const Gun = require('gun/gun.js');
        require('gun/lib/radix.js');
        require('gun/lib/radisk.js');
        require('gun/lib/store.js');
        
        // Create an isValid function that allows all messages
        // This is needed because bullet-catcher modifies Gun globally
        const isValidAllowAll = () => true;
        
        this.gun = Gun({
          peers: relayConfig.peers,
          localStorage: false,
          radisk: false,
          isValid: isValidAllowAll // Required by bullet-catcher
        });
        
        // Initialize with temporary key - will be updated with real pub key via setRelayPubKey()
        this.relayKey = `relay-temp-${Date.now()}`;
        
        loggers.server.info(`📚 GunDB initialized with temporary key: ${this.relayKey}`);
        loggers.server.info(`📚 GunDB peers: ${relayConfig.peers.join(', ')}`);
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
   * @param relayPubKey The relay's public key for GunDB catalog publishing
   * @param gunInstance Optional: main Gun instance from relay for network sync
   */
  public async start(relayPubKey?: string, gunInstance?: any): Promise<void> {
    if (!this.enabled) {
      loggers.server.info("📚 Anna's Archive integration is DISABLED");
      return;
    }

    // Use main Gun instance if provided (better network sync)
    if (gunInstance) {
      this.gun = gunInstance;
      loggers.server.info("📚 Using main relay Gun instance for network sync");
    }

    // Set relay key from the provided pub key
    if (relayPubKey) {
      this.relayKey = relayPubKey;
      loggers.server.info(`📚 Using relay public key: ${relayPubKey.substring(0, 20)}...`);
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
          utp: false,
          // Enable DHT for distributed peer discovery (essential for seeding)
          dht: true,
          // Enable Local Service Discovery for LAN peers
          lsd: true,
          // Enable Peer Exchange
          webSeeds: true,
          // Use fixed port for Docker port mapping (must match EXPOSE in Dockerfile)
          // @ts-ignore
          torrentPort: 6881
      });

      this.client.on('error', (err) => {
          loggers.server.error({ err }, "📚 Anna's Archive WebTorrent Error");
      });

      loggers.server.info(`📚 Anna's Archive Manager started. Data dir: ${this.dataDir}`);
      // Load existing catalog
      this.loadCatalog();
      
      // Subscribe to GunDB network
      this.subscribeToNetwork();
      
      // Always publish catalog to GunDB so we are discoverable (even if empty)
      this.publishCatalog();
      
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
      loggers.server.info(`📚 maxTb config value: ${annasArchiveConfig.maxTb}`);
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
        // Seed the files - prioritize WebSocket trackers for Docker compatibility
        this.client!.seed(filePaths, {
          announce: [
            // WebSocket trackers work better in Docker/NAT environments
            'wss://tracker.openwebtorrent.com',
            'wss://tracker.btorrent.xyz',
            'wss://tracker.webtorrent.dev',
            'wss://tracker.files.fm:7073/announce',
            // UDP trackers as fallback
            'udp://tracker.opentrackr.org:1337/announce',
            'udp://tracker.openbittorrent.com:6969/announce',
            'udp://open.stealth.si:80/announce',
            'udp://exodus.desync.com:6969/announce',
            'udp://tracker.torrent.eu.org:451/announce',
            'udp://opentracker.i2p.rocks:6969/announce'
          ]
        }, (torrent) => {
          try {
            loggers.server.info(`📚 Seed callback fired for: ${torrent.name}`);
            loggers.server.info(`📚 InfoHash: ${torrent.infoHash}`);
            loggers.server.info(`📚 Magnet: ${torrent.magnetURI.substring(0, 80)}...`);

            // Log tracker events for debugging
            torrent.on('warning', (warn: any) => {
              loggers.server.warn({ warn }, `📚 Torrent warning: ${torrent.name}`);
            });

            torrent.on('noPeers', (announceType: string) => {
              loggers.server.debug(`📚 No peers found via ${announceType} for ${torrent.name}`);
            });

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

            // For seeded torrents - add to catalog (use .then() since this is not async)
            loggers.server.info(`📚 Adding torrent ${torrent.name} to catalog...`);
            this.onTorrentComplete(torrent)
              .then(() => {
                loggers.server.info(`📚 Catalog updated, now has ${this.catalog.size} entries`);
              })
              .catch((err) => {
                loggers.server.error({ err }, `📚 Failed to add to catalog`);
              });

            resolve({
              magnetURI: torrent.magnetURI,
              infoHash: torrent.infoHash,
              name: torrent.name
            });
          } catch (callbackError: any) {
            loggers.server.error({ err: callbackError }, `📚 Error in seed callback`);
            reject(callbackError);
          }
        });
      } catch (error) {
        loggers.server.error({ err: error }, `📚 Error calling seed()`);
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
      // Build public relay URL from endpoint config
      // Strip /gun suffix if present (RELAY_ENDPOINT is for GunDB, not HTTP)
      let relayEndpoint = relayConfig.endpoint || process.env.PUBLIC_URL || 'http://localhost:3000';
      if (relayEndpoint.endsWith('/gun')) {
        relayEndpoint = relayEndpoint.slice(0, -4);
      }
      // Ensure URL has protocol
      const relayUrl = relayEndpoint.startsWith('http') ? relayEndpoint : `https://${relayEndpoint}`;
      
      // Build IPFS gateway URL - use configured gateway or derive from relay URL
      const ipfsGateway = ipfsConfig.gatewayUrl || `${relayUrl}/ipfs`;
      
      const catalogData: any = {
        relayUrl: relayUrl,
        ipfsGateway: ipfsGateway,
        lastUpdated: Date.now(),
        torrentCount: this.catalog.size,
        torrents: {}
      };

      // Convert catalog Map to object
      // NOTE: GunDB doesn't support arrays natively, so we store fileCount instead of files array
      this.catalog.forEach((entry, hash) => {
        catalogData.torrents[hash] = {
          name: entry.torrentName,
          magnetURI: entry.magnetLink,
          completedAt: entry.completedAt,
          fileCount: Array.isArray(entry.files) ? entry.files.length : 0
        };
      });

      // Publish under the same "relays" path that network-stats uses
      // This makes Anna's Archive catalogs discoverable alongside relay info
      this.gun.get('relays')
        .get(this.relayKey)
        .get('annasArchive')
        .put(catalogData);
      
      // Also publish to the dedicated annas-archive path for backward compatibility
      this.gun.get('annas-archive')
        .get('catalog')
        .get(this.relayKey)
        .put(catalogData);

      loggers.server.info(`📚 Published ${this.catalog.size} torrents to GunDB (relays/${this.relayKey?.substring(0)}/annasArchive)`);
      loggers.server.info(`📚 Relay URL: ${relayUrl}, IPFS Gateway: ${ipfsGateway}`);
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
    if (!this.gun) {
      loggers.server.warn("📚 GunDB not initialized for network catalog");
      return [];
    }

    loggers.server.info(`📚 Fetching network catalog... (own key: ${this.relayKey?.substring(0, 20)}...)`);

    return new Promise((resolve) => {
      const relays: Map<string, any> = new Map();
      const timeout = setTimeout(() => {
        loggers.server.info(`📚 Network catalog timeout. Found ${relays.size} relays`);
        resolve(Array.from(relays.values()));
      }, 8000);

      // Search in BOTH paths: relays/{host}/annasArchive AND annas-archive/catalog
      
      // Path 1: Check under relays path (same as network-stats)
      this.gun.get('relays')
        .map()
        .once((relayData: any, host: string) => {
          if (!relayData || host === this.relayKey) return;
          
          // Check if this relay has annasArchive data
          this.gun.get('relays')
            .get(host)
            .get('annasArchive')
            .once((annasData: any) => {
              if (annasData && annasData.relayUrl) {
                loggers.server.debug(`📚 Found relay via relays path: ${host?.substring(0, 20)}...`);
                relays.set(host, {
                  relayKey: host,
                  ...annasData
                });
              }
            });
        });

      // Path 2: Legacy annas-archive/catalog path
      this.gun.get('annas-archive')
        .get('catalog')
        .map()
        .once((relayData: any, relayKey: string) => {
          if (relayData && relayKey !== this.relayKey && !relays.has(relayKey)) {
            loggers.server.debug(`📚 Found relay via legacy path: ${relayKey?.substring(0, 20)}...`);
            relays.set(relayKey, {
              relayKey,
              ...relayData
            });
          }
        });

      // Give it 5 seconds to collect from both paths
      setTimeout(() => {
        clearTimeout(timeout);
        loggers.server.info(`📚 Network discovery complete. Found ${relays.size} other relays`);
        resolve(Array.from(relays.values()));
      }, 5000);
    });
  }

  /**
   * Add a file to IPFS and pin it using the IPFS HTTP API
   */
  private async addFileToIPFS(filePath: string): Promise<string | null> {
    try {
      const { execSync } = await import('child_process');
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        loggers.server.warn(`📚 File not found: ${filePath}`);
        return null;
      }

      const ipfsHost = process.env.IPFS_HOST || '127.0.0.1';
      const ipfsPort = process.env.IPFS_API_PORT || '5001';

      // Use curl to POST file to IPFS API (more reliable multipart handling)
      const curlCmd = `curl -s -X POST "http://${ipfsHost}:${ipfsPort}/api/v0/add?pin=true&quiet=true" -F "file=@${filePath}"`;
      const result = execSync(curlCmd, {
        encoding: 'utf8',
        timeout: 120000 // 2 minute timeout
      }).trim();

      // Parse JSON response to get hash
      const response = JSON.parse(result);
      const cid = response.Hash;

      if (cid) {
        loggers.server.info(`📚 Added to IPFS: ${path.basename(filePath)} → ${cid}`);
        return cid;
      }
      return null;
    } catch (error: any) {
      // Check if IPFS is running
      if (error.code === 'ECONNREFUSED') {
        loggers.server.warn(`📚 IPFS daemon not running - cannot pin ${path.basename(filePath)}`);
      } else {
        loggers.server.error({ err: error, filePath }, `📚 Failed to add file to IPFS`);
      }
      return null;
    }
  }

  /**
   * Manually pin a file from a torrent to IPFS
   * Returns the CID if successful
   */
  public async pinFile(infoHash: string, filePath: string): Promise<{ success: boolean; cid?: string; error?: string }> {
    // Normalize infoHash to lowercase for consistent lookup
    const normalizedHash = infoHash.toLowerCase();
    
    loggers.server.info(`📚 Pin request: infoHash=${infoHash} (normalized: ${normalizedHash}), filePath=${filePath}`);
    loggers.server.info(`📚 Catalog has ${this.catalog.size} entries: ${Array.from(this.catalog.keys()).join(', ')}`);
    
    const entry = this.catalog.get(normalizedHash);
    if (!entry) {
      loggers.server.warn(`📚 Torrent ${normalizedHash} not found in catalog`);
      return { success: false, error: `Torrent not found in catalog. Available: ${Array.from(this.catalog.keys()).join(', ')}` };
    }

    const file = entry.files.find(f => f.path === filePath);
    if (!file) {
      return { success: false, error: 'File not found in torrent' };
    }

    if (file.ipfsCid) {
      return { success: true, cid: file.ipfsCid }; // Already pinned
    }

    // Try multiple possible locations for the file
    const possiblePaths = [
      path.join(this.dataDir, filePath),                    // Standard WebTorrent path
      path.join(this.dataDir, 'uploads', filePath),         // User uploads path
      path.join(this.dataDir, path.basename(filePath)),     // Just the filename in root
      path.join(this.dataDir, 'uploads', path.basename(filePath))  // Just filename in uploads
    ];
    
    let fullPath: string | null = null;
    for (const p of possiblePaths) {
      loggers.server.debug(`📚 Checking path: ${p}`);
      if (fs.existsSync(p)) {
        fullPath = p;
        loggers.server.info(`📚 Found file at: ${p}`);
        break;
      }
    }
    
    if (!fullPath) {
      loggers.server.warn(`📚 File not found in any location. Tried: ${possiblePaths.join(', ')}`);
      return { success: false, error: `File not found. Searched: ${possiblePaths.map(p => path.basename(p)).join(', ')}` };
    }
    
    const cid = await this.addFileToIPFS(fullPath);
    
    if (cid) {
      // Update catalog with CID
      file.ipfsCid = cid;
      this.saveCatalog();
      return { success: true, cid };
    }
    
    return { success: false, error: 'Failed to add to IPFS - check if daemon is running' };
  }

  /**
   * Handle torrent completion - catalog files

   */
  private async onTorrentComplete(torrent: any): Promise<void> {
    try {
      loggers.server.info(`📚 onTorrentComplete called for: ${torrent.name}`);
      loggers.server.info(`📚 Torrent has ${torrent.files?.length || 0} files`);

      // Normalize infoHash to lowercase
      const normalizedHash = torrent.infoHash.toLowerCase();
      loggers.server.info(`📚 Normalized hash: ${normalizedHash}`);
      
      const entry: CatalogEntry = {
        torrentHash: normalizedHash,
        torrentName: torrent.name,
        magnetLink: torrent.magnetURI,
        completedAt: Date.now(),
        files: []
      };

      // Catalog each file (no auto-pin - user can pin manually via dashboard)
      if (torrent.files && torrent.files.length > 0) {
        for (const file of torrent.files) {
          // Check if file already has IPFS CID from previous pin (use normalized hash)
          const existingEntry = this.catalog.get(normalizedHash);
          const existingFile = existingEntry?.files.find(f => f.path === file.path);
          
          entry.files.push({
            name: file.name,
            path: file.path,
            size: file.length,
            ipfsCid: existingFile?.ipfsCid // Preserve existing CID if any
          });
        }
      } else {
        loggers.server.warn(`📚 Torrent ${torrent.name} has no files! Cannot catalog.`);
      }

      // Update catalog
      loggers.server.info(`📚 Saving to catalog: ${normalizedHash} with ${entry.files.length} files`);
      this.catalog.set(normalizedHash, entry);
      this.saveCatalog();

      loggers.server.info(`📚 Cataloged ${entry.files.length} files from torrent ${torrent.name}`);
      loggers.server.info(`📚 Catalog now has ${this.catalog.size} entries`);
    } catch (error: any) {
      loggers.server.error({ err: error }, `📚 ERROR in onTorrentComplete: ${error.message}`);
    }
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
