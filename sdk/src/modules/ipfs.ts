import { ApiClient } from "../client";
import FormData from "form-data";

export class IpfsModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  public async getStatus(): Promise<any> {
    return this.client.get("/api/v1/ipfs/status");
  }

  public async uploadFile(
    fileBuffer: Buffer,
    filename: string,
    contentType: string,
    userAddress?: string
  ): Promise<any> {
    const form = new FormData();
    form.append("file", fileBuffer, {
      filename: filename,
      contentType: contentType,
    });

    const headers: any = form.getHeaders();
    if (userAddress) {
      headers["x-user-address"] = userAddress;
    }

    return this.client.post("/api/v1/ipfs/upload", form, {
      headers: headers,
    });
  }

  public async cat(cid: string): Promise<Buffer> {
    return this.client.get(`/api/v1/ipfs/cat/${cid}`, {
      responseType: "arraybuffer",
    });
  }

  public async pinAdd(cid: string): Promise<any> {
    return this.client.post("/api/v1/ipfs/pin/add", { cid });
  }

  public async pinRm(cid: string): Promise<any> {
    return this.client.post("/api/v1/ipfs/pin/rm", { cid });
  }

  public async pinLs(): Promise<any> {
    // Note: relay's pin/ls endpoint lists all pins and doesn't support filtering by CID
    return this.client.get("/api/v1/ipfs/pin/ls");
  }

  public async catJson(cid: string): Promise<any> {
    return this.client.get(`/api/v1/ipfs/cat/${cid}/json`);
  }

  public async catDecrypt(cid: string, token: string, userAddress?: string): Promise<Buffer> {
    const params: any = { token };
    const headers: any = {};

    if (userAddress) {
      headers["x-user-address"] = userAddress;
    }

    return this.client.get(`/api/v1/ipfs/cat/${cid}/decrypt`, {
      params,
      headers,
      responseType: "arraybuffer",
    });
  }

  public async repoGC(): Promise<any> {
    return this.client.post("/api/v1/ipfs/repo/gc");
  }

  public async repoStat(): Promise<any> {
    return this.client.get("/api/v1/ipfs/repo/stat");
  }

  public async getVersion(): Promise<any> {
    return this.client.get("/api/v1/ipfs/version");
  }
}
