import { ApiClient, ApiClientConfig } from "./client";
import { SystemModule } from "./modules/system";
import { IpfsModule } from "./modules/ipfs";
import { X402Module } from "./modules/x402";
import { NetworkModule } from "./modules/network";
import { DealsModule } from "./modules/deals";
import { RegistryModule } from "./modules/registry";
import { UploadsModule } from "./modules/uploads";

import { AnnasArchiveModule } from "./modules/annas-archive";
import { DriveModule } from "./modules/drive";
import { ApiKeysModule } from "./modules/api-keys";
import { AuthModule } from "./modules/auth";
import { ChatModule } from "./modules/chat";
import { VisualGraphModule } from "./modules/visualGraph";

// Export types
export * from "./types";
export * from "./modules/annas-archive";
export * from "./modules/drive";
export * from "./modules/api-keys";
export * from "./modules/auth";
export * from "./modules/chat";
export * from "./modules/visualGraph";

// Export wallet utilities
export * from "./utils/wallet";

export class ShogunRelaySDK {
  private client: ApiClient;

  public system: SystemModule;
  public ipfs: IpfsModule;
  public x402: X402Module;
  public network: NetworkModule;
  public deals: DealsModule;
  public registry: RegistryModule;
  public uploads: UploadsModule;

  public annasArchive: AnnasArchiveModule;
  public drive: DriveModule;
  public apiKeys: ApiKeysModule;
  public auth: AuthModule;
  public chat: ChatModule;
  public visualGraph: VisualGraphModule;

  constructor(config: ApiClientConfig) {
    this.client = new ApiClient(config);

    this.system = new SystemModule(this.client);
    this.ipfs = new IpfsModule(this.client);
    this.x402 = new X402Module(this.client);
    this.network = new NetworkModule(this.client);
    this.deals = new DealsModule(this.client);
    this.registry = new RegistryModule(this.client);
    this.uploads = new UploadsModule(this.client);

    this.annasArchive = new AnnasArchiveModule(this.client);
    this.drive = new DriveModule(this.client);
    this.apiKeys = new ApiKeysModule(this.client);
    this.auth = new AuthModule(this.client);
    this.chat = new ChatModule(this.client);
    this.visualGraph = new VisualGraphModule(this.client);
  }

  public setToken(token: string) {
    this.client.setToken(token);
  }
}

export default ShogunRelaySDK;
