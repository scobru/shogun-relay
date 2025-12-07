import { ApiClient } from '../client';

export class X402Module {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  public async getTiers(): Promise<any> {
    return this.client.get('/api/v1/x402/tiers');
  }

  public async getSubscription(userAddress: string): Promise<any> {
    return this.client.get(`/api/v1/x402/subscription/${userAddress}`);
  }

  public async subscribe(userAddress: string, tier: string, payment?: any): Promise<any> {
    return this.client.post('/api/v1/x402/subscribe', {
      userAddress,
      tier,
      payment,
    });
  }

  public async getPaymentRequirements(tier: string): Promise<any> {
    return this.client.get(`/api/v1/x402/payment-requirements/${tier}`);
  }

  public async canUpload(userAddress: string, sizeMB: number): Promise<any> {
    return this.client.get(`/api/v1/x402/can-upload/${userAddress}?size=${sizeMB}`);
  }

  public async getStorageUsage(userAddress: string): Promise<any> {
    return this.client.get(`/api/v1/x402/storage/${userAddress}`);
  }

  public async canUploadVerified(userAddress: string, sizeMB: number): Promise<any> {
    return this.client.get(`/api/v1/x402/can-upload-verified/${userAddress}?size=${sizeMB}`);
  }

  public async getRecommendation(fileSizeMB: number, durationDays: number, userAddress?: string): Promise<any> {
    const params: any = {
      fileSizeMB,
      durationDays,
    };
    if (userAddress) params.userAddress = userAddress;
    
    return this.client.get('/api/v1/x402/recommend', { params });
  }

  public async getConfig(): Promise<any> {
    return this.client.get('/api/v1/x402/config');
  }

  public async getRelayStorage(): Promise<any> {
    return this.client.get('/api/v1/x402/relay-storage');
  }
}
