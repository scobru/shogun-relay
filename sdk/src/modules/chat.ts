import { ApiClient } from "../client";

export class ChatModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  public async getPeers(): Promise<any> {
    return this.client.get("/api/v1/chat/peers");
  }

  public async getConversations(): Promise<any> {
    return this.client.get("/api/v1/chat/conversations");
  }

  public async getMessages(pub: string): Promise<any> {
    return this.client.get(`/api/v1/chat/messages/${pub}`);
  }

  public async sendMessage(pub: string, text: string): Promise<any> {
    return this.client.post(`/api/v1/chat/messages/${pub}`, { text });
  }

  public async syncMessages(pub: string): Promise<any> {
    return this.client.post(`/api/v1/chat/sync/${pub}`);
  }

  public async sendConsoleCommand(command: string): Promise<any> {
    return this.client.post("/api/v1/chat/console", { command });
  }

  public async getLobbyMessages(limit: number = 50): Promise<any> {
    return this.client.get("/api/v1/chat/lobby", { params: { limit } });
  }

  public async sendLobbyMessage(text: string): Promise<any> {
    return this.client.post("/api/v1/chat/lobby", { text });
  }

  public async deleteConversation(pub: string): Promise<any> {
    return this.client.delete(`/api/v1/chat/conversations/${pub}`);
  }

  public async deleteMessage(pub: string, messageId: string): Promise<any> {
    return this.client.delete(`/api/v1/chat/messages/${pub}/${messageId}`);
  }
}
