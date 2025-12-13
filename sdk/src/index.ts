import { ApiClient, ApiClientConfig } from './client';
import { SystemModule } from './modules/system';
import { IpfsModule } from './modules/ipfs';
import { X402Module } from './modules/x402';
import { NetworkModule } from './modules/network';
import { DealsModule } from './modules/deals';
import { RegistryModule } from './modules/registry';
import { UploadsModule } from './modules/uploads';
import { BridgeModule } from './modules/bridge';

// Export types
export * from './types';

export class ShogunRelaySDK {
  private client: ApiClient;

  public system: SystemModule;
  public ipfs: IpfsModule;
  public x402: X402Module;
  public network: NetworkModule;
  public deals: DealsModule;
  public registry: RegistryModule;
  public uploads: UploadsModule;
  public bridge: BridgeModule;

  constructor(config: ApiClientConfig) {
    this.client = new ApiClient(config);
    
    this.system = new SystemModule(this.client);
    this.ipfs = new IpfsModule(this.client);
    this.x402 = new X402Module(this.client);
    this.network = new NetworkModule(this.client);
    this.deals = new DealsModule(this.client);
    this.registry = new RegistryModule(this.client);
    this.uploads = new UploadsModule(this.client);
    this.bridge = new BridgeModule(this.client);
  }

  public setToken(token: string) {
    this.client.setToken(token);
  }
}

export default ShogunRelaySDK;
