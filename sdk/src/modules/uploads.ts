import { ApiClient } from "../client";

export class UploadsModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  public async getUserUploads(identifier: string): Promise<any> {
    return this.client.get(`/api/v1/user-uploads/${identifier}`);
  }

  public async deleteUpload(identifier: string, hash: string): Promise<any> {
    return this.client.delete(`/api/v1/user-uploads/${identifier}/${hash}`);
  }

  public async getSystemHashes(): Promise<any> {
    return this.client.get("/api/v1/user-uploads/system-hashes");
  }

  /**
   * Get the complete system hashes map with metadata for all files
   * @returns Promise with system hashes map object
   */
  public async getSystemHashesMap(): Promise<any> {
    return this.client.get("/api/v1/user-uploads/system-hashes-map");
  }

  /**
   * Save file metadata to system hash map
   * @param metadata Metadata object containing hash, userAddress, fileName, etc.
   * @returns Promise with save result
   */
  public async saveSystemHash(metadata: {
    hash: string;
    userAddress?: string;
    fileName?: string;
    displayName?: string;
    originalName?: string;
    fileSize?: number;
    contentType?: string;
    isEncrypted?: boolean;
    isDirectory?: boolean;
    fileCount?: number;
    files?: Array<{
      name: string;
      path?: string;
      size?: number;
      mimetype?: string;
      originalName?: string;
      isEncrypted?: boolean;
    }>;
    relayUrl?: string;
    uploadedAt?: number;
    timestamp?: number;
    [key: string]: any;
  }): Promise<any> {
    return this.client.post("/api/v1/user-uploads/save-system-hash", metadata);
  }

  /**
   * Remove a hash from system hash map
   * @param cid The CID/hash to remove
   * @param userAddress User address (defaults to "drive-user")
   * @returns Promise with removal result
   */
  public async removeSystemHash(
    cid: string,
    userAddress: string = "drive-user"
  ): Promise<any> {
    return this.client.delete(`/api/v1/user-uploads/remove-system-hash/${cid}`, {
      data: { userAddress },
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
