/**
 * Price Sync Manager
 * 
 * Automatically updates ShogunPaidOracle on-chain prices (in ETH) based on:
 * 1. Feed configurations (USD price)
 * 2. Current ETH/USD exchange rate
 * 
 * This ensures that on-chain users pay the correct ETH equivalent of the USD price.
 */

import { JsonRpcProvider, Wallet, Contract, parseUnits, keccak256, toUtf8Bytes } from "ethers";
import { parseEther } from "ethers";
import { getContractDeployment, ShogunPaidOracle } from "shogun-contracts-sdk";
import { loggers } from "./logger.js";
import { blockchainConfig, bridgeConfig } from "../config/index.js";
import type { OracleFeedPlugin } from "../oracle-feeds/plugin-interface.js";

const log = loggers.server;

// Cache ETH price to avoid spamming APIs
let cachedEthPrice = 0;
let lastEthPriceUpdate = 0;
const ETH_PRICE_TTL = 300000; // 5 minutes

/**
 * Fetch current ETH price in USD
 */
async function getEthPrice(): Promise<number> {
    if (Date.now() - lastEthPriceUpdate < ETH_PRICE_TTL && cachedEthPrice > 0) {
        return cachedEthPrice;
    }

    try {
        // Try CoinGecko first
        const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
        const data = await response.json() as any;

        if (data?.ethereum?.usd) {
            cachedEthPrice = data.ethereum.usd;
            lastEthPriceUpdate = Date.now();
            log.info({ price: cachedEthPrice }, "Updated ETH price from CoinGecko");
            return cachedEthPrice;
        }
    } catch (error) {
        log.warn({ error }, "Failed to fetch ETH price from CoinGecko");
    }

    // Fallback: Fixed safe price if API fails (e.g. 2000 USD)
    // In production, use multiple sources or Chainlink
    if (cachedEthPrice === 0) {
        return 2000;
    }

    return cachedEthPrice;
}

/**
 * Sync prices for a list of feeds
 */
export async function syncFeedPrices(
    feeds: OracleFeedPlugin[],
    chainId: number
): Promise<void> {
    // 1. Check prerequisites
    if (!blockchainConfig.relayPrivateKey || !bridgeConfig.rpcUrl) {
        log.warn("Cannot sync prices: Missing private key or RPC URL");
        return;
    }

    const paidOracleDeployment = getContractDeployment(chainId, "ShogunPaidOracle");
    if (!paidOracleDeployment?.address) {
        log.warn({ chainId }, "ShogunPaidOracle not deployed, skipping price sync");
        return;
    }

    const ethPrice = await getEthPrice();
    if (ethPrice <= 0) {
        log.error("Invalid ETH price, skipping sync");
        return;
    }

    // 2. Setup contract interaction
    const provider = new JsonRpcProvider(bridgeConfig.rpcUrl);
    const wallet = new Wallet(blockchainConfig.relayPrivateKey, provider);
    const paidOracle = new ShogunPaidOracle(provider, wallet, chainId);

    // We need raw contract for admin functions not yet in SDK wrapper or use raw calls
    // Using raw Contract instance for setFeedPriceByName which might be simpler
    const abi = [
        "function setFeedPriceByName(string calldata feedName, uint256 price) external",
        "function feedPriceOverride(bytes32) public view returns (uint256)"
    ];
    const contract = new Contract(paidOracleDeployment.address, abi, wallet);

    // 3. Sync each paid feed
    for (const feed of feeds) {
        if (!feed.priceUSDC || feed.priceUSDC <= 0) continue;

        try {
            // Calculate required ETH (wei)
            // priceETH = priceUSD / ethPriceUSD
            // wei = (priceUSD / ethPriceUSD) * 1e18
            const priceWei = parseEther((feed.priceUSDC / ethPrice).toFixed(18));

            // Minimal check to avoid spamming txs
            // In a real system, check current on-chain price first
            const feedId = keccak256(toUtf8Bytes(feed.name));
            const currentPriceWei = await contract.feedPriceOverride(feedId);

            // Allow 5% deviation before updating
            const diff = priceWei > currentPriceWei
                ? priceWei - currentPriceWei
                : currentPriceWei - priceWei;

            const deviation = Number(diff) / Number(priceWei); // Approximate

            if (deviation > 0.05) { // Update if > 5% diference
                log.info({
                    feed: feed.name,
                    priceUSDC: feed.priceUSDC,
                    currentEthPrice: ethPrice,
                    newPriceWei: priceWei.toString()
                }, "Updating on-chain feed price...");

                const tx = await contract.setFeedPriceByName(feed.name, priceWei);
                await tx.wait();
                log.info({ feed: feed.name, tx: tx.hash }, "On-chain price updated");
            } else {
                log.debug({ feed: feed.name }, "On-chain price deviation < 5%, skipping update");
            }

        } catch (error: any) {
            log.error({ feed: feed.name, error: error.message }, "Failed to sync feed price");
        }
    }
}
