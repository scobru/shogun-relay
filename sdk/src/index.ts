import { ApiClient, ApiClientConfig } from "./client";
import { SystemModule } from "./modules/system";
import { IpfsModule } from "./modules/ipfs";
import { UploadsModule } from "./modules/uploads";

import { DriveModule } from "./modules/drive";
import { ApiKeysModule } from "./modules/api-keys";
import { AuthModule } from "./modules/auth";
import { ChatModule } from "./modules/chat";
import { VisualGraphModule } from "./modules/visualGraph";

export * from "./modules/drive";
export * from "./modules/api-keys";
export * from "./modules/auth";
export * from "./modules/chat";
export * from "./modules/visualGraph";


export class DelaySDK {
  private client: ApiClient;

  public system: SystemModule;
  public ipfs: IpfsModule;
  public uploads: UploadsModule;

  public drive: DriveModule;
  public apiKeys: ApiKeysModule;
  public auth: AuthModule;
  public chat: ChatModule;
  public visualGraph: VisualGraphModule;

  constructor(config: ApiClientConfig) {
    this.client = new ApiClient(config);

    this.system = new SystemModule(this.client);
    this.ipfs = new IpfsModule(this.client);
    this.uploads = new UploadsModule(this.client);

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

export default DelaySDK;
