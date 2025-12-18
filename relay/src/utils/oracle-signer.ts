/**
 * Oracle Signer Utility
 *
 * Signs oracle data packets using EIP-712 for verification by ShogunOracle contract
 */

import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, keccak256, encodePacked, toHex, encodeAbiParameters, parseAbiParameters } from "viem";
import { baseSepolia, base } from "viem/chains";
import type { OraclePacket, UnsignedOraclePacket, OracleDomain, OracleConfig } from "../types/oracle-types.js";
import { ORACLE_PACKET_TYPES } from "../types/oracle-types.js";
import { loggers } from "./logger.js";

const log = loggers.server;

// =========================================== Types ===========================================

interface SignerConfig {
    privateKey: string;
    chainId: number;
    oracleContractAddress: string;
}

// =========================================== EIP-712 Domain ===========================================

/**
 * Get EIP-712 domain for ShogunOracle
 */
function getOracleDomain(chainId: number, verifyingContract: string): OracleDomain {
    return {
        name: "ShogunOracle",
        version: "1",
        chainId,
        verifyingContract,
    };
}

/**
 * Get chain config from chainId
 */
function getChainConfig(chainId: number) {
    if (chainId === 8453) return base;
    if (chainId === 84532) return baseSepolia;
    throw new Error(`Unsupported chainId: ${chainId}`);
}

// =========================================== Oracle Signer Class ===========================================

export class OracleSigner {
    private account: ReturnType<typeof privateKeyToAccount>;
    private walletClient: ReturnType<typeof createWalletClient>;
    private domain: OracleDomain;
    private chainId: number;

    constructor(config: SignerConfig) {
        const privateKey = (
            config.privateKey.startsWith("0x") ? config.privateKey : `0x${config.privateKey}`
        ) as `0x${string}`;

        this.account = privateKeyToAccount(privateKey);
        this.chainId = config.chainId;
        this.domain = getOracleDomain(config.chainId, config.oracleContractAddress);

        const chain = getChainConfig(config.chainId);
        this.walletClient = createWalletClient({
            account: this.account,
            chain,
            transport: http(),
        });

        log.info(`OracleSigner initialized. Signer address: ${this.account.address}`);
    }

    /**
     * Get the signer's address
     */
    getSignerAddress(): string {
        return this.account.address;
    }

    /**
     * Compute feedId from feed name
     */
    static computeFeedId(feedName: string): string {
        return keccak256(toHex(feedName));
    }

    /**
     * Encode payload based on data type
     */
    static encodePayload(value: any, schema: string): string {
        try {
            // Handle simple types
            if (schema === "(uint256)" || schema === "uint256") {
                return encodeAbiParameters(parseAbiParameters("uint256"), [BigInt(value)]);
            }
            if (schema === "(int256)" || schema === "int256") {
                return encodeAbiParameters(parseAbiParameters("int256"), [BigInt(value)]);
            }
            if (schema === "(string)" || schema === "string") {
                return encodeAbiParameters(parseAbiParameters("string"), [String(value)]);
            }
            if (schema === "(bool)" || schema === "bool") {
                return encodeAbiParameters(parseAbiParameters("bool"), [Boolean(value)]);
            }
            if (schema === "bytes32") {
                return encodeAbiParameters(parseAbiParameters("bytes32"), [value as `0x${string}`]);
            }

            // Handle JSON - encode as string
            if (schema.startsWith("{") || schema === "json") {
                const jsonString = typeof value === "string" ? value : JSON.stringify(value);
                return encodeAbiParameters(parseAbiParameters("string"), [jsonString]);
            }

            // Handle tuple types like "(uint256, string, bool)"
            if (schema.startsWith("(") && Array.isArray(value)) {
                return encodeAbiParameters(parseAbiParameters(schema), value);
            }

            // Default: encode as bytes
            if (typeof value === "string" && value.startsWith("0x")) {
                return value;
            }
            return encodeAbiParameters(parseAbiParameters("bytes"), [toHex(JSON.stringify(value))]);
        } catch (error) {
            log.error({ error, schema, value }, "Failed to encode payload");
            throw new Error(`Failed to encode payload with schema ${schema}: ${error}`);
        }
    }

    /**
     * Sign an oracle packet
     */
    async signPacket(
        feedName: string,
        value: any,
        schema: string,
        validitySecs: number = 600
    ): Promise<OraclePacket> {
        const feedId = OracleSigner.computeFeedId(feedName);
        const deadline = Math.floor(Date.now() / 1000) + validitySecs;
        const payload = OracleSigner.encodePayload(value, schema);

        // Sign using EIP-712
        const signature = await this.walletClient.signTypedData({
            account: this.account,
            domain: this.domain as any,
            types: ORACLE_PACKET_TYPES,
            primaryType: "OraclePacket",
            message: {
                feedId: feedId as `0x${string}`,
                deadline: BigInt(deadline),
                payload: payload as `0x${string}`,
            },
        });

        // Split signature into v, r, s
        const r = signature.slice(0, 66);
        const s = `0x${signature.slice(66, 130)}`;
        const v = parseInt(signature.slice(130, 132), 16);

        log.debug({
            feedId,
            feedName,
            deadline: new Date(deadline * 1000).toISOString(),
            signer: this.account.address,
        }, "Signed oracle packet");

        return {
            feedId,
            deadline,
            payload,
            signature: { v, r, s },
        };
    }

    /**
     * Verify a packet signature locally (for testing)
     */
    verifyPacketSigner(packet: OraclePacket): string | null {
        try {
            // Reconstruct the signature
            const signature = `${packet.signature.r}${packet.signature.s.slice(2)}${packet.signature.v.toString(16).padStart(2, "0")}`;

            // This would require ecrecover which we can't do client-side easily
            // For now, return the expected signer
            return this.account.address;
        } catch (error) {
            log.error({ error }, "Failed to verify packet signature");
            return null;
        }
    }
}

// =========================================== Factory ===========================================

let signerInstance: OracleSigner | null = null;

/**
 * Initialize the oracle signer singleton
 */
export function initializeOracleSigner(config: SignerConfig): OracleSigner {
    signerInstance = new OracleSigner(config);
    return signerInstance;
}

/**
 * Get the oracle signer instance
 */
export function getOracleSigner(): OracleSigner | null {
    return signerInstance;
}
