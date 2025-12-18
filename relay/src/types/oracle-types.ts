/**
 * Oracle Types for Shogun Relay
 *
 * Types for oracle data feeds and EIP-712 signed packets
 */

// =========================================== Data Types ===========================================

/**
 * Supported data types for feed payloads
 * Must match OracleFeedRegistry.DataType enum
 */
export enum DataType {
    PRICE = 0,
    STRING = 1,
    JSON = 2,
    BYTES = 3,
    CUSTOM = 4,
}

/**
 * Feed configuration stored in relay
 */
export interface FeedConfig {
    name: string;
    dataType: DataType;
    schema: string; // ABI or JSON schema
    priceUSDC: number; // Cost per request
    updateFreqSecs: number;
    active: boolean;
    getValue: () => Promise<any>; // Function to get current value
}

/**
 * Feed info from on-chain registry
 */
export interface FeedInfo {
    name: string;
    dataType: DataType;
    schema: string;
    priceAtomic: bigint;
    updateFreqSecs: number;
    createdAt: number;
    active: boolean;
}

// =========================================== Oracle Packet ===========================================

/**
 * EIP-712 signed oracle packet
 * Used to transmit signed data from relay to smart contract
 */
export interface OraclePacket {
    feedId: string; // bytes32 hex
    deadline: number; // Unix timestamp
    payload: string; // ABI-encoded data (hex)
    signature: {
        v: number;
        r: string;
        s: string;
    };
}

/**
 * Unsigned packet for signing
 */
export interface UnsignedOraclePacket {
    feedId: string;
    deadline: number;
    payload: string;
}

// =========================================== API Types ===========================================

/**
 * Response from GET /api/v1/oracle/feeds
 */
export interface OracleFeedsResponse {
    success: boolean;
    feeds: Array<{
        feedId: string;
        name: string;
        dataType: DataType;
        dataTypeName: string;
        schema: string;
        priceUSDC: number;
        updateFreqSecs: number;
        active: boolean;
    }>;
    relay: string;
}

/**
 * Response from GET /api/v1/oracle/data/:feedId
 */
export interface OracleDataResponse {
    success: boolean;
    packet: OraclePacket;
    data: {
        feedId: string;
        feedName: string;
        value: any;
        timestamp: number;
    };
}

/**
 * Request body for POST /api/v1/oracle/feeds
 */
export interface RegisterFeedRequest {
    name: string;
    dataType: DataType;
    schema: string;
    priceUSDC: number;
    updateFreqSecs: number;
}

// =========================================== EIP-712 ===========================================

/**
 * EIP-712 domain for ShogunOracle
 */
export interface OracleDomain {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
}

/**
 * EIP-712 types for OraclePacket
 */
export const ORACLE_PACKET_TYPES = {
    OraclePacket: [
        { name: "feedId", type: "bytes32" },
        { name: "deadline", type: "uint256" },
        { name: "payload", type: "bytes" },
    ],
};

// =========================================== Config ===========================================

/**
 * Oracle configuration for relay
 */
export interface OracleConfig {
    enabled: boolean;
    signerPrivateKey?: string; // ETH private key for signing
    chainId: number;
    oracleContractAddress?: string; // For EIP-712 domain
    feedRegistryAddress?: string;
    defaultValiditySecs: number; // Default packet validity (e.g., 600 = 10 minutes)
    feeds: Record<string, FeedConfig>;
}
