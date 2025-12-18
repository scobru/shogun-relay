
import { ApiClient } from "../client";
import {
    OracleFeedsResponse,
    OracleDataResponse,
    OracleGlobalStatsResponse
} from "../types";

export class OracleModule {
    private client: ApiClient;

    constructor(client: ApiClient) {
        this.client = client;
    }

    /**
     * Get list of available oracle feeds
     */
    public async getFeeds(): Promise<OracleFeedsResponse> {
        return this.client.get<OracleFeedsResponse>("/api/v1/oracle/feeds");
    }

    /**
     * Get signed oracle data
     * @param feedId Feed ID
     * @param payment Optional x402 payment string (if feed is paid)
     */
    public async getData(feedId: string, payment?: string): Promise<OracleDataResponse> {
        const config: any = {};
        if (payment) {
            config.headers = {
                "X-Payment": payment
            };
        }

        return this.client.get<OracleDataResponse>(`/api/v1/oracle/data/${feedId}`, config);
    }

    /**
     * Get global oracle stats
     */
    public async getGlobalStats(): Promise<OracleGlobalStatsResponse> {
        return this.client.get<OracleGlobalStatsResponse>("/api/v1/oracle/stats/global");
    }
}
