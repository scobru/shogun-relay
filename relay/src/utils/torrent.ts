import WebTorrent from 'webtorrent';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';
import { loggers } from './logger';
import { torrentConfig, relayConfig, ipfsConfig } from '../config/env-config';
import { generateAACID, createAACRecord, generateDataFolderName, AACMetadataRecord } from './aac-utils';

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
    aacid?: string;
  }[];
}

// Define a simple interface for the status
export interface TorrentStatus {
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
    state?: 'downloading' | 'seeding' | 'paused' | 'queued' | 'checking' | 'error';
    files: number;
  }[];
}

export class TorrentManager {
  private client: WebTorrent.Instance | null = null;
  private enabled: boolean;
  private dataDir: string;
  private torrents: string[] = []; // List of magnet links or torrent file paths
  private catalogFile: string;
  private catalog: Map<string, CatalogEntry> = new Map();
  private gun: any;
  private relayKey: string = '';

  constructor() {
    this.enabled = torrentConfig.enabled;
    this.dataDir = torrentConfig.dataDir;
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
    // Ideally this would fetch from torrentConfig.annasArchiveUrl
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
      loggers.server.info("📚 Torrent integration is DISABLED");
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

    loggers.server.info("📚 Initializing Torrent Manager...");
    
    // Ensure data directory exists
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    try {
      // Dynamic import for WebTorrent if needed, or just use the imported one
       // @ts-ignore - WebTorrent types might be tricky with ESM/CommonJS mix
      this.client = new WebTorrent({
          // @ts-ignore - Enable uTP for better compatibility with traditional clients (safe on Debian)
          utp: true,
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
          loggers.server.error({ err }, "📚 Torrent WebTorrent Error");
      });

      loggers.server.info(`📚 Torrent Manager started. Data dir: ${this.dataDir}`);
      // Load existing catalog
      this.loadCatalog();
      
      // Subscribe to GunDB network
      this.subscribeToNetwork();
      
      // Always publish catalog to GunDB so we are discoverable (even if empty)
      this.publishCatalog();
      
      // Start seeding/downloading configured torrents
      await this.loadTorrents();

    } catch (error) {
      loggers.server.error({ err: error }, "📚 Failed to start Torrent Manager");
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

      // Auto-fetch removed - users can manually fetch Anna's Archive torrents via dashboard
      // This is now just a normal torrent client

      // Deduplicate
      allTorrents = [...new Set(allTorrents)];

      if (allTorrents.length === 0) {
          loggers.server.info("📚 No torrents configured yet.");
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
  private async fetchDynamicTorrents(maxTbOverride?: number): Promise<string[]> {
      const maxTb = maxTbOverride !== undefined ? maxTbOverride : torrentConfig.maxTb;
      const url = `${torrentConfig.annasArchiveUrl}?max_tb=${maxTb}&format=json`;
      
      loggers.server.info({ url, maxTb }, "📚 Fetching dynamic torrent list...");

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
   * Helper to persist a torrent magnet to torrents.json
   */
  private persistTorrent(magnetOrPath: string): void {
      try {
          const torrentsFile = path.join(this.dataDir, 'torrents.json');
          let existingTorrents: string[] = [];
          
          if (fs.existsSync(torrentsFile)) {
              const fileContent = fs.readFileSync(torrentsFile, 'utf8');
              existingTorrents = JSON.parse(fileContent);
          }
          
          if (!existingTorrents.includes(magnetOrPath)) {
              existingTorrents.push(magnetOrPath);
              fs.writeFileSync(torrentsFile, JSON.stringify(existingTorrents, null, 2));
              loggers.server.info(`📚 Persisted new torrent to configuration: ${magnetOrPath.substring(0, 50)}...`);
          }
      } catch (error) {
          loggers.server.error({ err: error }, "📚 Failed to persist new torrent");
      }
  }

  /**
   * Re-fetch and add dynamic torrents from Anna's Archive
   * @param maxTb Optional: Override the max TB parameter
   */
  public async refetchDynamicTorrents(maxTb?: number): Promise<{ added: number; skipped: number; total: number }> {
    if (!this.enabled || !this.client) {
      throw new Error("Torrent integration is not enabled");
    }

    loggers.server.info(`📚 Refetching torrents from Anna's Archive (maxTb: ${maxTb || torrentConfig.maxTb})...`);
    
    const magnets = await this.fetchDynamicTorrents(maxTb);
    
    if (magnets.length === 0) {
      return { added: 0, skipped: 0, total: 0 };
    }

    // Get existing torrent hashes to avoid duplicates
    const existingHashes = new Set(this.client.torrents.map(t => t.infoHash.toLowerCase()));
    
    let added = 0;
    let skipped = 0;

    for (const magnet of magnets) {
      // Extract infoHash from magnet to check for duplicates
      const hashMatch = magnet.match(/xt=urn:btih:([a-fA-F0-9]+)/i);
      if (hashMatch) {
        const hash = hashMatch[1].toLowerCase();
        if (existingHashes.has(hash)) {
          skipped++;
          continue;
        }
      }
      
      // Add the torrent
      this.client.add(magnet, { path: this.dataDir }, (torrent) => {
        loggers.server.info(`📚 Added torrent from refetch: ${torrent.name}`);
        
        torrent.on('done', () => {
          this.onTorrentComplete(torrent);
        });
      });
      
      // Persist the torrent so it survives restarts
      this.persistTorrent(magnet);
      
      added++;
    }

    loggers.server.info(`📚 Refetch complete: ${added} added, ${skipped} skipped (duplicates), ${magnets.length} total from API`);
    
    return { added, skipped, total: magnets.length };
  }

  /**
   * Stop the service
   */
  public stop(): void {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      loggers.server.info("📚 Torrent Manager stopped");
    }
  }

  /**
   * Add a magnet link or torrent file manually
   */
  public addTorrent(magnetOrPath: string): void {
      if (!this.enabled || !this.client) {
          throw new Error("Torrent integration is not enabled");
      }

      this.client.add(magnetOrPath, { path: this.dataDir }, (torrent) => {
          loggers.server.info(`📚 Manually added torrent: ${torrent.name}`);
          
          // Register done event to catalog torrent when complete
          torrent.on('done', () => {
              loggers.server.info(`📚 Torrent download complete: ${torrent.name}`);
              // Add files to catalog
              this.onTorrentComplete(torrent);
              
              // Publish to global registry for network discovery
              this.publishToGlobalRegistry(torrent.infoHash, torrent.magnetURI, torrent.name, {
                size: torrent.length,
                files: torrent.files?.length || 0
              });
          });
          
          // If already done (e.g., seeding or instant resume), catalog immediately
          if (torrent.done) {
              loggers.server.info(`📚 Torrent already complete, cataloging: ${torrent.name}`);
              this.onTorrentComplete(torrent);
              
              // Publish to global registry
              this.publishToGlobalRegistry(torrent.infoHash, torrent.magnetURI, torrent.name, {
                size: torrent.length,
                files: torrent.files?.length || 0
              });
          }
      });

      // Persist to torrents.json
      this.persistTorrent(magnetOrPath);
  }

  /**
   * Create a torrent from files and start seeding
   * Uses AAC (Anna's Archive Container) format for metadata
   */
  public async createTorrent(filePaths: string[]): Promise<{magnetURI: string, infoHash: string, name: string, aacMetadata?: AACMetadataRecord[]}> {
    if (!this.enabled || !this.client) {
      throw new Error("Torrent integration is not enabled");
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

            // Generate AAC metadata for each file
            const aacRecords: AACMetadataRecord[] = [];
            torrent.files.forEach((file: any) => {
              const record = createAACRecord(file.name, file.length, {
                source: 'shogun_relay',
                additionalMetadata: {
                  torrentHash: torrent.infoHash,
                  torrentName: torrent.name,
                  filePath: file.path
                }
              });
              aacRecords.push(record);
              loggers.server.debug(`📚 Generated AACID for ${file.name}: ${record.aacid}`);
            });

            // Save AAC metadata to file
            if (aacRecords.length > 0) {
              const metadataFile = path.join(this.dataDir, `${torrent.infoHash}_aac_metadata.jsonl`);
              const jsonlContent = aacRecords.map(r => JSON.stringify(r)).join('\n');
              fs.writeFileSync(metadataFile, jsonlContent);
              loggers.server.info(`📚 AAC metadata saved to: ${metadataFile}`);
            }

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
                
                // Publish to global registry for network discovery
                this.publishToGlobalRegistry(torrent.infoHash, torrent.magnetURI, torrent.name, {
                  size: torrent.length,
                  files: torrent.files?.length || 0,
                  aacMetadata: aacRecords[0] // Include first AAC record
                });
              })
              .catch((err) => {
                loggers.server.error({ err }, `📚 Failed to add to catalog`);
              });

            resolve({
              magnetURI: torrent.magnetURI,
              infoHash: torrent.infoHash,
              name: torrent.name,
              aacMetadata: aacRecords
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
   * Publish relay info to GunDB for network discovery
   * Only stores relay URL - actual catalog is fetched via HTTP
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
      
      // Only publish relay metadata for discovery - catalog fetched via HTTP
      const relayInfo = {
        relayUrl: relayUrl,
        ipfsGateway: ipfsGateway,
        lastUpdated: Date.now(),
        torrentCount: this.catalog.size,
        annasArchiveEnabled: true
      };

      // Publish to both paths for discovery
      this.gun.get('relays').get(this.relayKey).get('annasArchive').put(relayInfo);
      this.gun.get('annas-archive').get('catalog').get(this.relayKey).put(relayInfo);

      loggers.server.info(`📚 Published relay info to GunDB for discovery: ${relayUrl}`);
    } catch (error) {
      loggers.server.error({ err: error }, "📚 Failed to publish to GunDB");
    }
  }

  /**
   * Get the relay's public key
   */
  public getRelayKey(): string {
    return this.relayKey;
  }

  /**
   * Public method to manually refresh/publish the catalog
   * Syncs the catalog with active torrents in the client and publishes to GunDB
   * @param force Force republishing to global registry even if already exists
   */
  public async refreshCatalog(force: boolean = false): Promise<{ catalogSize: number; published: boolean; removed: number }> {
    try {
      let removedCount = 0;

      // Get active torrent hashes from client
      if (this.client) {
        const activeTorrentHashes = new Set(
          this.client.torrents.map((t: any) => t.infoHash?.toLowerCase())
        );

        // Remove catalog entries for torrents that are no longer active
        const entriesToRemove: string[] = [];
        for (const [hash, entry] of this.catalog) {
          const normalizedHash = hash.toLowerCase();
          if (!activeTorrentHashes.has(normalizedHash)) {
            entriesToRemove.push(hash);
            loggers.server.info(`📚 Removing inactive torrent from catalog: ${entry.torrentName || hash}`);
          }
        }

        for (const hash of entriesToRemove) {
          this.catalog.delete(hash);
          removedCount++;
        }

        if (removedCount > 0) {
          loggers.server.info(`📚 Removed ${removedCount} inactive torrents from catalog`);
          this.saveCatalog();
        }

        // If force is true, iterate all active torrents and force publish to registry
        if (force) {
            loggers.server.info(`📚 Forcing republish of ${this.client.torrents.length} torrents to global registry...`);
            for (const torrent of this.client.torrents) {
                // Determine sizes/files from catalog if available, or torrent object
                const entry = this.catalog.get(torrent.infoHash.toLowerCase());
                const size = entry ? entry.files.reduce((acc, f) => acc + f.size, 0) : torrent.length;
                const fileCount = entry ? entry.files.length : (torrent.files?.length || 0);

                await this.publishToGlobalRegistry(torrent.infoHash, torrent.magnetURI, torrent.name, {
                    size,
                    files: fileCount,
                    force: true
                });
            }
        }
      }

      this.publishCatalog();
      return { catalogSize: this.catalog.size, published: true, removed: removedCount };
    } catch (error) {
      loggers.server.error({ err: error }, "Failed to refresh catalog");
      return { catalogSize: this.catalog.size, published: false, removed: 0 };
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
   * Uses HTTP to fetch actual catalog data from each relay's API endpoint
   */
  public async getNetworkCatalog(): Promise<any[]> {
    if (!this.gun) {
      loggers.server.warn("📚 GunDB not initialized for network catalog");
      return [];
    }

    loggers.server.info(`📚 Fetching network catalog...`);

    // Step 1: Collect relay URLs from GunDB
    const relayUrls: Set<string> = new Set();
    
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 3000);

      // Check relays path for relay URLs
      this.gun.get('relays')
        .map()
        .once((relayData: any, host: string) => {
          if (!relayData || host === this.relayKey) return;
          
          // Get the relay URL from annasArchive or from host info
          this.gun.get('relays')
            .get(host)
            .get('annasArchive')
            .once((annasData: any) => {
              if (annasData?.relayUrl) {
                relayUrls.add(annasData.relayUrl);
              }
            });
          
          // Also check for host info
          if (relayData.host) {
            const hostUrl = relayData.host.startsWith('http') ? relayData.host : `https://${relayData.host}`;
            relayUrls.add(hostUrl);
          }
        });

      // Also check legacy path
      this.gun.get('annas-archive')
        .get('catalog')
        .map()
        .once((relayData: any, relayKey: string) => {
          if (relayData?.relayUrl && relayKey !== this.relayKey) {
            relayUrls.add(relayData.relayUrl);
          }
        });

      setTimeout(() => {
        clearTimeout(timeout);
        resolve();
      }, 2000);
    });

    loggers.server.info(`📚 Found ${relayUrls.size} relay URLs to query`);

    // Step 2: Fetch actual catalog from each relay via HTTP
    const results: any[] = [];
    
    for (const relayUrl of relayUrls) {
      try {
        // Skip our own relay
        let ownUrl = relayConfig.endpoint || process.env.PUBLIC_URL || '';
        if (ownUrl.endsWith('/gun')) ownUrl = ownUrl.slice(0, -4);
        if (relayUrl === ownUrl) continue;

        const catalogUrl = `${relayUrl}/api/v1/torrent/catalog`;
        loggers.server.info(`📚 Fetching catalog from ${catalogUrl}`);
        
        const response = await fetch(catalogUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(5000) // 5 second timeout per relay
        });

        if (response.ok) {
          const data = await response.json() as any;
          
          if (data.success && data.catalog) {
            // Convert catalog array to torrents object format expected by frontend
            const torrents: any = {};
            data.catalog.forEach((entry: any) => {
              torrents[entry.torrentHash] = {
                name: entry.torrentName,
                magnetURI: entry.magnetLink,
                completedAt: entry.completedAt,
                fileCount: entry.files?.length || 0,
                files: entry.files // Include full files array
              };
            });

            results.push({
              relayUrl: data.relay?.url || relayUrl,
              ipfsGateway: data.relay?.ipfsGateway,
              relayKey: data.relay?.key || null, // Capture relay key for chat
              lastUpdated: Date.now(),
              torrentCount: data.count || 0,
              torrents: torrents
            });

            loggers.server.info(`📚 Got ${data.count || 0} torrents from ${relayUrl}`);
          }
        } else {
          loggers.server.warn(`📚 Failed to fetch from ${relayUrl}: ${response.status}`);
        }
      } catch (error: any) {
        loggers.server.warn(`📚 Error fetching from ${relayUrl}: ${error.message}`);
      }
    }

    loggers.server.info(`📚 Network discovery complete. Found ${results.length} active relays`);
    return results;
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

      // Use centralized IPFS config
      const ipfsApiUrl = ipfsConfig.apiUrl || 'http://127.0.0.1:5001';
      const ipfsApiToken = ipfsConfig.apiToken;

      // Build curl command with optional authentication
      let curlCmd = `curl -s -X POST "${ipfsApiUrl}/api/v0/add?pin=true&quiet=true"`;
      
      // Add Authorization header if token is configured
      if (ipfsApiToken) {
        curlCmd += ` -H "Authorization: Bearer ${ipfsApiToken}"`;
      }
      
      curlCmd += ` -F "file=@${filePath}"`;
      
      loggers.server.debug(`📚 Running IPFS add: ${curlCmd.replace(ipfsApiToken || '', '***')}`);
      
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
   * Manually pin all files in a torrent to IPFS
   */
  public async pinTorrent(infoHash: string): Promise<{ success: boolean; pinned: number; total: number; errors: string[] }> {
    // Normalize infoHash to lowercase for consistent lookup
    const normalizedHash = infoHash.toLowerCase();
    
    const entry = this.catalog.get(normalizedHash);
    if (!entry) {
      return { success: false, pinned: 0, total: 0, errors: [`Torrent not found in catalog`] };
    }
    
    let pinned = 0;
    const errors: string[] = [];
    
    loggers.server.info(`📚 Pinning all ${entry.files.length} files for torrent ${normalizedHash}`);
    
    for (const file of entry.files) {
      // Skip if already pinned
      if (file.ipfsCid) {
        pinned++;
        continue;
      }
      
      const result = await this.pinFile(infoHash, file.path);
      if (result.success) {
        pinned++;
      } else {
        errors.push(`${file.name}: ${result.error}`);
      }
    }
    
    return { 
      success: errors.length === 0, 
      pinned, 
      total: entry.files.length, 
      errors 
    };
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
          
          // Generate AACID for this file
          const aacid = generateAACID('files', file.name);
          
          entry.files.push({
            name: file.name,
            path: file.path,
            size: file.length,
            ipfsCid: existingFile?.ipfsCid, // Preserve existing CID if any
            aacid: existingFile?.aacid || aacid // Preserve existing AACID or generate new
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

    // Normalize to lowercase for consistent matching
    const normalizedHash = infoHash.toLowerCase();
    const torrent = this.client.torrents.find(t => t.infoHash.toLowerCase() === normalizedHash);
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

    // Normalize to lowercase for consistent matching
    const normalizedHash = infoHash.toLowerCase();
    const torrent = this.client.torrents.find(t => t.infoHash.toLowerCase() === normalizedHash);
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

    // Normalize to lowercase for consistent matching
    const normalizedHash = infoHash.toLowerCase();
    const torrent = this.client.torrents.find(t => t.infoHash.toLowerCase() === normalizedHash);
    if (!torrent) {
      throw new Error(`Torrent not found: ${infoHash}`);
    }

    const torrentName = torrent.name;
    
    // normalizedHash already declared above
    
    // Unpin files from IPFS if any
    const catalogEntry = this.catalog.get(normalizedHash);
    if (catalogEntry) {
      // Unpin any files that have IPFS CIDs
      if (catalogEntry.files && catalogEntry.files.length > 0) {
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
      }
      // Always remove from catalog
      this.catalog.delete(normalizedHash);
      this.saveCatalog();
      loggers.server.info(`📚 Removed ${normalizedHash} from catalog`);
    } else {
      loggers.server.warn(`📚 Torrent ${normalizedHash} not found in catalog, skipping catalog cleanup`);
    }
    
    // Remove from WebTorrent
    try {
      torrent.destroy({ destroyStore: deleteFiles }, (err) => {
        if (err) {
           loggers.server.error({ err }, `📚 Error destroying torrent ${torrentName}`);
        }
      });
      loggers.server.info(`📚 Removed torrent: ${torrentName} (deleteFiles: ${deleteFiles})`);
    } catch (error) {
      loggers.server.error({ err: error }, `📚 Exception destroying torrent ${torrentName}`);
    }

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
   * Calculate total storage used by torrents
   * Returns size in bytes from catalog (fast) and optionally from disk (accurate)
   */
  public getStorageStats(): {
    totalBytes: number;
    totalMB: number;
    totalGB: number;
    fileCount: number;
    torrentCount: number;
    catalogBytes: number;
    diskBytes?: number;
  } {
    if (!this.enabled) {
      return {
        totalBytes: 0,
        totalMB: 0,
        totalGB: 0,
        fileCount: 0,
        torrentCount: 0,
        catalogBytes: 0,
      };
    }

    // Calculate from catalog (fast)
    let catalogBytes = 0;
    let fileCount = 0;
    const catalog = this.getCatalog();
    
    for (const entry of catalog) {
      for (const file of entry.files) {
        catalogBytes += file.size || 0;
        fileCount++;
      }
    }

    // Try to calculate from disk (more accurate but slower)
    let diskBytes: number | undefined;
    try {
      if (fs.existsSync(this.dataDir)) {
        diskBytes = this.calculateDirectorySize(this.dataDir);
      }
    } catch (error) {
      // Ignore errors calculating disk size
      loggers.server.debug({ err: error }, "Failed to calculate torrent directory size");
    }

    // Use disk size if available, otherwise use catalog size
    const totalBytes = diskBytes !== undefined ? diskBytes : catalogBytes;
    const totalMB = totalBytes / (1024 * 1024);
    const totalGB = totalBytes / (1024 * 1024 * 1024);

    return {
      totalBytes,
      totalMB,
      totalGB,
      fileCount,
      torrentCount: catalog.length,
      catalogBytes,
      diskBytes,
    };
  }

  /**
   * Calculate directory size recursively
   */
  private calculateDirectorySize(dirPath: string): number {
    let totalSize = 0;
    
    try {
      const items = fs.readdirSync(dirPath, { withFileTypes: true });
      
      for (const item of items) {
        const fullPath = path.join(dirPath, item.name);
        
        // Skip catalog.json and other metadata files
        if (item.name === 'catalog.json' || item.name === 'torrents.json' || item.name === 'uploads') {
          continue;
        }
        
        if (item.isDirectory()) {
          totalSize += this.calculateDirectorySize(fullPath);
        } else if (item.isFile()) {
          try {
            const stats = fs.statSync(fullPath);
            totalSize += stats.size;
          } catch (error) {
            // Ignore errors reading individual files
          }
        }
      }
    } catch (error) {
      // Ignore errors reading directory
    }
    
    return totalSize;
  }

  /**
   * Get current status
   */
  public getStatus(): TorrentStatus {
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
          state: t.paused ? 'paused' : (t.progress === 1 ? 'seeding' : 'downloading'),
          magnetURI: t.magnetURI
      }))
    };
  }

  // ============================================================================
  // GLOBAL TORRENT REGISTRY ON GUNDB
  // ============================================================================

  /**
   * Publish a torrent to the global registry on GunDB
   * This makes the torrent discoverable by all relays in the network
   */
  public async publishToGlobalRegistry(
    infoHash: string,
    magnetURI: string,
    name: string,
    options: {
      size?: number;
      files?: number;
      aacMetadata?: any;
      force?: boolean;
    } = {}
  ): Promise<{ success: boolean; alreadyExists?: boolean }> {
    if (!this.gun) {
      loggers.server.warn('📚 GunDB not available, cannot publish to global registry');
      return { success: false };
    }

    const normalizedHash = infoHash.toLowerCase();
    
    return new Promise((resolve) => {
      // Check if torrent already exists in registry
      this.gun.get('shogun').get('torrents').get('registry').get(normalizedHash).once((existing: any) => {
        // If force is true, we proceed regardless of existing
        if (existing && existing.magnetURI && !options.force) {
          loggers.server.info(`📚 Torrent ${normalizedHash} already in global registry`);
          resolve({ success: true, alreadyExists: true });
          return;
        }

        // Build registry entry
        const entry = {
          magnetURI,
          name,
          size: options.size || 0,
          files: options.files || 0,
          addedAt: Date.now(),
          addedBy: relayConfig.endpoint || 'unknown',
          aacid: options.aacMetadata?.aacid || null
        };

        // Publish to registry
        this.gun.get('shogun').get('torrents').get('registry').get(normalizedHash).put(entry, (ack: any) => {
          if (ack.err) {
            loggers.server.error({ err: ack.err }, '📚 Failed to publish to global registry');
            resolve({ success: false });
          } else {
            loggers.server.info(`📚 Published torrent to global registry: ${name} (${normalizedHash})`);
            
            // Also add to search index (keywords from name)
            this.addToSearchIndex(normalizedHash, name);
            
            resolve({ success: true, alreadyExists: false });
          }
        });
      });
    });
  }

  /**
   * Add torrent to search index for keyword-based discovery
   */
  private addToSearchIndex(infoHash: string, name: string): void {
    if (!this.gun) return;

    // Extract keywords from name (lowercase, split by non-alphanumeric)
    const keywords = name.toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(k => k.length >= 3); // Only keywords with 3+ chars

    for (const keyword of keywords) {
      this.gun.get('shogun').get('torrents').get('search').get(keyword).get(infoHash).put(true);
    }
    
    loggers.server.debug(`📚 Added ${keywords.length} keywords to search index for ${infoHash}`);
  }

  /**
   * Check if a torrent exists in the global registry
   */
  public async checkTorrentInRegistry(infoHash: string): Promise<any | null> {
    if (!this.gun) return null;

    const normalizedHash = infoHash.toLowerCase();
    
    return new Promise((resolve) => {
      this.gun.get('shogun').get('torrents').get('registry').get(normalizedHash).once((data: any) => {
        if (data && data.magnetURI) {
          resolve(data);
        } else {
          resolve(null);
        }
      });
      
      // Timeout after 5 seconds
      setTimeout(() => resolve(null), 5000);
    });
  }

  /**
   * Search the global registry by keyword
   */
  public async searchGlobalRegistry(query: string, limit: number = 50): Promise<any[]> {
    if (!this.gun) return [];

    const keywords = query.toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(k => k.length >= 3);

    if (keywords.length === 0) return [];

    const results = new Map<string, any>();
    
    return new Promise((resolve) => {
      let pending = keywords.length;
      
      for (const keyword of keywords) {
        this.gun.get('shogun').get('torrents').get('search').get(keyword).map().once((val: any, hash: string) => {
          if (val === true && !results.has(hash)) {
            // Fetch full entry from registry
            this.gun.get('shogun').get('torrents').get('registry').get(hash).once((entry: any) => {
              if (entry && entry.magnetURI) {
                results.set(hash, {
                  infoHash: hash,
                  ...entry
                });
              }
            });
          }
        });
        
        // Decrement pending count after initial scan
        setTimeout(() => {
          pending--;
          if (pending <= 0) {
            // Wait a bit more for fetches to complete, then resolve
            setTimeout(() => {
              const arr = Array.from(results.values()).slice(0, limit);
              loggers.server.info(`📚 Search "${query}" returned ${arr.length} results`);
              resolve(arr);
            }, 500);
          }
        }, 1000);
      }
      
      // Fallback timeout
      setTimeout(() => resolve(Array.from(results.values()).slice(0, limit)), 6000);
    });
  }

  /**
   * Browse all torrents in the global registry
   */
  public async browseGlobalRegistry(limit: number = 100): Promise<any[]> {
    if (!this.gun) return [];

    const results: any[] = [];
    
    return new Promise((resolve) => {
      this.gun.get('shogun').get('torrents').get('registry').map().once((entry: any, hash: string) => {
        if (entry && entry.magnetURI && results.length < limit) {
          results.push({
            infoHash: hash,
            ...entry
          });
        }
      });
      
      // Wait for results then resolve
      setTimeout(() => {
        loggers.server.info(`📚 Browse returned ${results.length} torrents from global registry`);
        resolve(results);
      }, 3000);
    });
  }
}

// Export singleton instance
export const torrentManager = new TorrentManager();
