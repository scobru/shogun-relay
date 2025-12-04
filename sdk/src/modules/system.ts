import { ApiClient } from '../client';

export interface HealthResponse {
  success: boolean;
  message: string;
  data: {
    timestamp: string;
    version: string;
    uptime: number;
  };
}

export class SystemModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  public async getHealth(): Promise<HealthResponse> {
    return this.client.get<HealthResponse>('/api/v1/health');
  }

  public async getStats(): Promise<any> {
    return this.client.get('/stats'); // Note: /stats is a root level endpoint in some configs, but let's check routes
    // Based on routes/index.js: app.get("/stats", ...) serves HTML.
    // app.get(`${baseRoute}/system/stats`) is the API one.
    // Let's use the API one.
    return this.client.get('/api/v1/system/stats');
  }
}
