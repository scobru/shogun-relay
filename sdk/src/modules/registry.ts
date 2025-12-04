import { ApiClient } from '../client';

export class RegistryModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  public async getStatus(): Promise<any> {
    return this.client.get('/api/v1/registry/status');
  }

  public async getBalance(): Promise<any> {
    return this.client.get('/api/v1/registry/balance');
  }

  public async registerRelay(endpoint: string, gunPubKey: string, stakeAmount: string): Promise<any> {
    return this.client.post('/api/v1/registry/register', {
      endpoint,
      gunPubKey,
      stakeAmount,
    });
  }

  public async updateRelay(newEndpoint?: string, newGunPubKey?: string): Promise<any> {
    return this.client.post('/api/v1/registry/update', {
      newEndpoint,
      newGunPubKey,
    });
  }

  public async increaseStake(amount: string): Promise<any> {
    return this.client.post('/api/v1/registry/stake/increase', { amount });
  }

  public async requestUnstake(): Promise<any> {
    return this.client.post('/api/v1/registry/stake/unstake');
  }

  public async withdrawStake(): Promise<any> {
    return this.client.post('/api/v1/registry/stake/withdraw');
  }

  public async getDeals(): Promise<any> {
    return this.client.get('/api/v1/registry/deals');
  }
}
