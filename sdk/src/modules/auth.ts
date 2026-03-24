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
   * Check if a username is already taken on the relay
   * @param username User alias to check
   */
  public async checkUsername(username: string): Promise<{ available: boolean; message: string }> {
    return this.client.get<{ available: boolean; message: string }>(
      `/api/v1/auth/check-username/${username}`
    );
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
