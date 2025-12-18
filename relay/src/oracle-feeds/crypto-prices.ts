/**
 * Example: Crypto Price Feeds
 * 
 * This plugin fetches ETH and BTC prices from CoinGecko (free API)
 * 
 * To create your own feed:
 * 1. Copy this file
 * 2. Modify the feeds array
 * 3. Implement your getValue logic
 */

import { OracleFeedPlugin, createPriceFeed } from "./plugin-interface.js";

// CoinGecko API (free, no API key needed)
const COINGECKO_API = "https://api.coingecko.com/api/v3/simple/price";

// Cache to avoid rate limiting
let priceCache: Record<string, { price: number; timestamp: number }> = {};
const CACHE_TTL_MS = 30000; // 30 seconds

async function fetchCryptoPrice(coinId: string): Promise<number> {
    // Check cache first
    const cached = priceCache[coinId];
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.price;
    }

    try {
        const response = await fetch(`${COINGECKO_API}?ids=${coinId}&vs_currencies=usd`);
        const data = await response.json() as Record<string, { usd: number }>;

        const price = data[coinId]?.usd || 0;

        // Update cache
        priceCache[coinId] = { price, timestamp: Date.now() };

        return price;
    } catch (error) {
        console.error(`Failed to fetch ${coinId} price:`, error);
        // Return cached value if available, otherwise 0
        return cached?.price || 0;
    }
}

/**
 * Export feeds array - the loader will register all of these
 */
export const feeds: OracleFeedPlugin[] = [
    createPriceFeed(
        "ETH/USD",
        () => fetchCryptoPrice("ethereum"),
        60, // Update every 60 seconds
        0   // Free feed
    ),

    createPriceFeed(
        "BTC/USD",
        () => fetchCryptoPrice("bitcoin"),
        60,
        0
    ),

    // Add more feeds as needed:
    // createPriceFeed("SOL/USD", () => fetchCryptoPrice("solana"), 60, 0),
    // createPriceFeed("AVAX/USD", () => fetchCryptoPrice("avalanche-2"), 60, 0),
];
