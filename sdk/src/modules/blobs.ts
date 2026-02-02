
import { ApiClient } from "../client";

export interface BlobRecord {
    txHash: string;
    magnetURI?: string;
    blobHash?: string;
    timestamp?: number;
    size?: number;
}

export interface ArchiveBlobResponse {
    success: boolean;
    message: string;
    data?: {
        txHash: string;
        magnetURI: string;
        infoHash: string;
        size: number;
    };
    error?: string;
}

export interface ListBlobsResponse {
    success: boolean;
    count: number;
    data: BlobRecord[];
    error?: string;
}

export class BlobsModule {
    private client: ApiClient;

    constructor(client: ApiClient) {
        this.client = client;
    }

    /**
     * Archive an Ethereum Blob by Transaction Hash
     * @param txHash Ethereum Transaction Hash (Type 3)
     */
    async archive(txHash: string): Promise<ArchiveBlobResponse> {
        return this.client.post<ArchiveBlobResponse>("/blobs/archive", { txHash });
    }

    /**
     * List all archived blobs
     */
    async list(): Promise<ListBlobsResponse> {
        return this.client.get<ListBlobsResponse>("/blobs/list");
    }
}
