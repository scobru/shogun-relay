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
    // Use /api/v1/system/health (the correct endpoint in the relay)
    return this.client.get<HealthResponse>('/api/v1/system/health');
  }

  public async getStats(): Promise<any> {
    return this.client.get('/api/v1/system/stats');
  }
}
