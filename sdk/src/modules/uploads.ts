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
}
