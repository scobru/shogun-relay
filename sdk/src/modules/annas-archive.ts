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
      "/api/v1/annas-archive/status"
    );
  }

  /**
   * Add a manual torrent
   * @param magnet Magnet link or URL
   */
  public async addTorrent(magnet: string): Promise<{ success: boolean; message: string }> {
    return this.client.post<{ success: boolean; message: string }>(
      "/api/v1/annas-archive/add",
      { magnet }
    );
  }
}
