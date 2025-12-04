import { ApiClient } from '../client';

export class NetworkModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  public async getRelays(timeout?: number, maxAge?: number): Promise<any> {
    const params: any = {};
    if (timeout) params.timeout = timeout;
    if (maxAge) params.maxAge = maxAge;
    
    return this.client.get('/api/v1/network/relays', { params });
  }

  public async getRelay(host: string): Promise<any> {
    return this.client.get(`/api/v1/network/relay/${host}`);
  }

  public async getStats(): Promise<any> {
    return this.client.get('/api/v1/network/stats');
  }

  public async getProof(cid: string, challenge?: string): Promise<any> {
    const params: any = {};
    if (challenge) params.challenge = challenge;
    
    return this.client.get(`/api/v1/network/proof/${cid}`, { params });
  }

  public async verifyProof(proof: any): Promise<any> {
    return this.client.post('/api/v1/network/verify-proof', { proof });
  }

  public async getReputation(host: string): Promise<any> {
    return this.client.get(`/api/v1/network/reputation/${host}`);
  }

  public async getReputationLeaderboard(minScore?: number, limit?: number): Promise<any> {
    const params: any = {};
    if (minScore) params.minScore = minScore;
    if (limit) params.limit = limit;
    
    return this.client.get('/api/v1/network/reputation', { params });
  }
}
