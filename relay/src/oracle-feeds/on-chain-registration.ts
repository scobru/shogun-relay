/**
 * On-Chain Feed Registration
 * 
 * Registers feeds on the OracleFeedRegistry contract to make them
 * discoverable by consumers across the network.
 */

import { JsonRpcProvider, Wallet } from "ethers";
import { OracleFeedRegistry, OracleDataType, getContractDeployment } from "shogun-contracts-sdk";
import { loggers } from "../utils/logger.js";
import { blockchainConfig, bridgeConfig } from "../config/index.js";
import type { OracleFeedPlugin } from "./plugin-interface.js";

const log = loggers.server;

// Track which feeds have been registered on-chain
const registeredOnChain: Set<string> = new Set();

/**
 * Register a feed on-chain in the OracleFeedRegistry
 */
export async function registerFeedOnChain(
    feed: OracleFeedPlugin,
    chainId: number
): Promise<boolean> {
    const feedId = computeFeedId(feed.name);

    // Check if already registered this session
    if (registeredOnChain.has(feedId)) {
        log.debug({ feed: feed.name }, "Feed already registered this session");
        return true;
    }

    // Get relay private key
    const privateKey = blockchainConfig.relayPrivateKey;
    if (!privateKey) {
        log.warn("Cannot register feed on-chain: RELAY_PRIVATE_KEY not set");
        return false;
    }

    // Get registry deployment
    const registryDeployment = getContractDeployment(chainId, "OracleFeedRegistry");
    if (!registryDeployment?.address) {
        log.warn({ chainId }, "OracleFeedRegistry not deployed on this chain");
        return false;
    }

    try {
        // Create provider and signer - use bridge RPC URL
        const rpcUrl = bridgeConfig.rpcUrl;
        if (!rpcUrl) {
            log.warn("Cannot register feed on-chain: RPC URL not configured (BRIDGE_RPC_URL)");
            return false;
        }

        const provider = new JsonRpcProvider(rpcUrl);
        const wallet = new Wallet(privateKey, provider);

        // Create registry instance
        const registry = new OracleFeedRegistry(provider, wallet, chainId);

        // Check if feed already exists on-chain
        const signerAddress = wallet.address;
        const { exists, active } = await registry.isFeedActive(signerAddress, feedId);

        if (exists && active) {
            log.info({ feed: feed.name, feedId }, "Feed already registered on-chain");
            registeredOnChain.add(feedId);
            return true;
        }

        // Register the feed
        // Convert USDC price to atomic units (6 decimals for USDC)
        const priceAtomic = BigInt(Math.floor((feed.priceUSDC || 0) * 1e6));

        log.info({
            feed: feed.name,
            dataType: feed.dataType,
            price: feed.priceUSDC || 0,
        }, "Registering feed on-chain...");

        const tx = await registry.registerFeed(
            feed.name,
            feed.dataType as OracleDataType,
            feed.schema,
            priceAtomic,
            feed.updateIntervalSecs
        );

        await tx.wait();

        log.info({ feed: feed.name, txHash: tx.hash }, "Feed registered on-chain successfully");
        registeredOnChain.add(feedId);
        return true;

    } catch (error: any) {
        // Check for common errors
        if (error.message?.includes("execution reverted")) {
            // Feed might already exist or relay not registered
            log.warn({
                feed: feed.name,
                error: error.message
            }, "Feed registration reverted - might already exist or relay not registered");
        } else {
            log.error({ error, feed: feed.name }, "Failed to register feed on-chain");
        }
        return false;
    }
}

/**
 * Register multiple feeds on-chain
 */
export async function registerFeedsOnChain(
    feeds: OracleFeedPlugin[],
    chainId: number
): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    for (const feed of feeds) {
        const result = await registerFeedOnChain(feed, chainId);
        if (result) {
            success++;
        } else {
            failed++;
        }
    }

    return { success, failed };
}

/**
 * Compute feedId from name (same as contract)
 */
function computeFeedId(name: string): string {
    const { keccak256, toUtf8Bytes } = require("ethers");
    return keccak256(toUtf8Bytes(name));
}

/**
 * Check if all prerequisites are met for on-chain registration
 */
export function canRegisterOnChain(chainId: number): {
    ready: boolean;
    reason?: string;
} {
    if (!blockchainConfig.relayPrivateKey) {
        return { ready: false, reason: "RELAY_PRIVATE_KEY not configured" };
    }

    if (!bridgeConfig.rpcUrl) {
        return { ready: false, reason: "RPC URL not configured (BRIDGE_RPC_URL)" };
    }

    const registryDeployment = getContractDeployment(chainId, "OracleFeedRegistry");
    if (!registryDeployment?.address) {
        return { ready: false, reason: `OracleFeedRegistry not deployed on chain ${chainId}` };
    }

    return { ready: true };
}
