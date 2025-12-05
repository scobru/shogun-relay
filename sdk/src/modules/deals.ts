import { ApiClient } from '../client';
import FormData from 'form-data';

export class DealsModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  public async getPricing(sizeMB?: number, durationDays?: number, tier?: string): Promise<any> {
    const params: any = {};
    if (sizeMB) params.sizeMB = sizeMB;
    if (durationDays) params.durationDays = durationDays;
    if (tier) params.tier = tier;
    
    return this.client.get('/api/v1/deals/pricing', { params });
  }

  public async uploadForDeal(fileBuffer: Buffer, filename: string, contentType: string, walletAddress: string): Promise<any> {
    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: filename,
      contentType: contentType,
    });

    return this.client.post('/api/v1/deals/upload', form, {
      headers: {
        ...form.getHeaders(),
        'x-wallet-address': walletAddress,
      },
    });
  }

  public async createDeal(dealParams: {
    cid: string;
    clientAddress: string;
    sizeMB: number;
    durationDays: number;
    tier?: string;
  }): Promise<any> {
    return this.client.post('/api/v1/deals/create', dealParams);
  }

  public async activateDeal(dealId: string, payment: any): Promise<any> {
    return this.client.post(`/api/v1/deals/${dealId}/activate`, { payment });
  }

  public async getDealsByCid(cid: string): Promise<any> {
    return this.client.get(`/api/v1/deals/by-cid/${cid}`);
  }

  public async getDealsByClient(address: string): Promise<any> {
    return this.client.get(`/api/v1/deals/by-client/${address}`);
  }

  public async grief(dealId: string, slashAmount: string, reason: string): Promise<any> {
    return this.client.post('/api/v1/registry/deal/grief', {
      dealId,
      slashAmount,
      reason,
    });
  }
}

