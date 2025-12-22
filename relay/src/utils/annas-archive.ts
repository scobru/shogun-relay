import WebTorrent from "webtorrent";
import fs from "fs";
import path from "path";
import { annasArchiveConfig } from "../config/env-config";
import { loggers } from "./logger";

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
  }[];
}

export class AnnasArchiveManager {
  private client: WebTorrent.Instance | null = null;
  private enabled: boolean;
  private dataDir: string;
  private torrents: string[] = []; // List of magnet links or torrent file paths

  constructor() {
    this.enabled = annasArchiveConfig.enabled;
    this.dataDir = annasArchiveConfig.dataDir;

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
      this.client = new WebTorrent();

      this.client.on('error', (err) => {
          loggers.server.error({ err }, "📚 Anna's Archive WebTorrent Error");
      });

      loggers.server.info(`📚 Anna's Archive Manager started. Data dir: ${this.dataDir}`);
      
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
                  // Continues seeding...
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
          peers: t.numPeers
      }))
    };
  }
}

// Export singleton instance
export const annasArchiveManager = new AnnasArchiveManager();
