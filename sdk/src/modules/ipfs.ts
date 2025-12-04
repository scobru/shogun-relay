import { ApiClient } from '../client';
import FormData from 'form-data';

export class IpfsModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  public async getStatus(): Promise<any> {
    return this.client.get('/api/v1/ipfs/status');
  }

  public async uploadFile(fileBuffer: Buffer, filename: string, contentType: string, userAddress?: string): Promise<any> {
    const form = new FormData();
    form.append('file', fileBuffer, {
      filename: filename,
      contentType: contentType,
    });

    const headers: any = form.getHeaders();
    if (userAddress) {
      headers['x-user-address'] = userAddress;
    }

    return this.client.post('/api/v1/ipfs/upload', form, {
      headers: headers,
    });
  }

  public async cat(cid: string): Promise<Buffer> {
    return this.client.get(`/api/v1/ipfs/cat/${cid}`, {
      responseType: 'arraybuffer',
    });
  }

  public async pinAdd(cid: string): Promise<any> {
    return this.client.post(`/api/v1/ipfs/pin/add?arg=${cid}`);
  }

  public async pinRm(cid: string): Promise<any> {
    return this.client.post(`/api/v1/ipfs/pin/rm?arg=${cid}`);
  }

  public async pinLs(cid?: string): Promise<any> {
    const query = cid ? `?arg=${cid}` : '';
    return this.client.post(`/api/v1/ipfs/pin/ls${query}`);
  }
}
