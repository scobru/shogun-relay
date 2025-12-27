import { ApiClient } from "../client";

export interface ApiKey {
  keyId: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
}

export interface ApiKeyCreateResponse {
  success: boolean;
  keyId: string;
  token: string; // Only shown once!
  name: string;
  createdAt: number;
  expiresAt: number | null;
  message: string;
}

export interface ApiKeysListResponse {
  success: boolean;
  keys: ApiKey[];
}

export class ApiKeysModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * List all API keys
   */
  public async list(): Promise<ApiKeysListResponse> {
    return this.client.get<ApiKeysListResponse>("/api/v1/api-keys");
  }

  /**
   * Create a new API key
   */
  public async create(name: string, expiresInDays?: number): Promise<ApiKeyCreateResponse> {
    return this.client.post<ApiKeyCreateResponse>("/api/v1/api-keys", {
      name,
      expiresInDays,
    });
  }

  /**
   * Revoke an API key
   */
  public async revoke(keyId: string): Promise<{ success: boolean; message: string }> {
    return this.client.delete(`/api/v1/api-keys/${keyId}`);
  }

  /**
   * Set the API key as the authentication token for future requests
   */
  public useApiKey(apiKeyToken: string): void {
    this.client.setToken(apiKeyToken);
  }
}

