import { ApiClient } from "../client";

export class VisualGraphModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  public async getInterface(): Promise<string> {
    return this.client.get("/api/v1/visualGraph", {
      headers: { Accept: "text/html" },
      responseType: "text",
    });
  }
}
