import { ApiClient } from "../client";

export interface AuthResponse {
  success: boolean;
  username?: string;
  pub?: string;
  alias?: string;
  message?: string;
  error?: string;
  sea?: any; // Security, Encryption, Authorization pair
}

export class AuthModule {
  private readonly client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  /**
   * Register a new user on the relay
   * @param username User alias
   * @param password User password
   */
  public async register(username: string, password: string): Promise<AuthResponse> {
    return this.client.post<AuthResponse>("/api/v1/auth/register", {
      username,
      password,
    });
  }

  /**
   * Login a user on the relay (server-side auth)
   * Note: This returns the SEA pair, which should be handled carefully
   * @param username User alias
   * @param password User password
   */
  public async login(username: string, password: string): Promise<AuthResponse> {
    return this.client.post<AuthResponse>("/api/v1/auth/login", {
      username,
      password,
    });
  }
}
