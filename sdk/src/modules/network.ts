import { ApiClient } from "../client";
import {
  ReputationResponse,
  ReputationLeaderboardResponse,
  BestRelaysResponse,
  NetworkStatsResponse,
  RelayInfoResponse,
  RelaysListResponse,
} from "../types";

export class NetworkModule {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  public async getRelays(timeout?: number, maxAge?: number): Promise<RelaysListResponse> {
    const params: any = {};
    if (timeout) params.timeout = timeout;
    if (maxAge) params.maxAge = maxAge;

    return this.client.get("/api/v1/network/relays", { params });
  }

  public async getRelay(host: string): Promise<RelayInfoResponse> {
    return this.client.get(`/api/v1/network/relay/${host}`);
  }

  public async getStats(): Promise<NetworkStatsResponse> {
    return this.client.get("/api/v1/network/stats");
  }

  public async getProof(cid: string, challenge?: string): Promise<any> {
    const params: any = {};
    if (challenge) params.challenge = challenge;

    return this.client.get(`/api/v1/network/proof/${cid}`, { params });
  }

  public async verifyProof(proof: any): Promise<any> {
    return this.client.post("/api/v1/network/verify-proof", { proof });
  }

  public async getReputation(host: string): Promise<ReputationResponse> {
    return this.client.get(`/api/v1/network/reputation/${host}`);
  }

  public async getReputationLeaderboard(
    minScore?: number,
    limit?: number
  ): Promise<ReputationLeaderboardResponse> {
    const params: any = {};
    if (minScore) params.minScore = minScore;
    if (limit) params.limit = limit;

    return this.client.get("/api/v1/network/reputation", { params });
  }

  public async getBestRelays(
    count?: number,
    minScore?: number,
    excludeHost?: string
  ): Promise<BestRelaysResponse> {
    const params: any = {};
    if (count) params.count = count;
    if (minScore) params.minScore = minScore;
    if (excludeHost) params.exclude = excludeHost;

    return this.client.get("/api/v1/network/best-relays", { params });
  }

  // Note: On-chain endpoints are not available in the relay API
  // Use shogun-contracts-sdk for on-chain interactions instead
  // These methods are kept for backward compatibility but will throw an error
  public async getOnChainRelays(chainId?: number): Promise<any> {
    throw new Error(
      "On-chain endpoints are not available in relay API. Use shogun-contracts-sdk for on-chain interactions."
    );
  }

  public async getOnChainRelay(address: string, chainId?: number): Promise<any> {
    throw new Error(
      "On-chain endpoints are not available in relay API. Use shogun-contracts-sdk for on-chain interactions."
    );
  }

  public async getOnChainParams(chainId?: number): Promise<any> {
    throw new Error(
      "On-chain endpoints are not available in relay API. Use shogun-contracts-sdk for on-chain interactions."
    );
  }

  public async getPinRequests(maxAge?: number): Promise<any> {
    const params: any = {};
    if (maxAge) params.maxAge = maxAge;

    return this.client.get("/api/v1/network/pin-requests", { params });
  }
}
