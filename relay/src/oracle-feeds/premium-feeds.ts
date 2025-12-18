/**
 * Example: Premium Data Feeds (Paid)
 * 
 * Demonstrates feeds that require x402 payment or on-chain payment.
 */

import { OracleFeedPlugin, createJsonFeed, createPriceFeed } from "./plugin-interface.js";

/**
 * A "Premium" market insight feed
 * Cost: 1.0 USDC
 */
function createPremiumInsightFeed(): OracleFeedPlugin {
    return createJsonFeed(
        "PREMIUM/INSIGHT",
        async () => {
            return {
                sentiment: "Bullish",
                volatility: "High",
                recommendation: "HODL",
                confidence: 0.85 + (Math.random() * 0.1), // Random variation
                generatedAt: new Date().toISOString()
            };
        },
        300, // Update every 5 mins
        1.0  // Cost: 1 USDC
    );
}

/**
 * High-frequency proprietary trading signal
 * Cost: 0.1 USDC
 */
function createAlphaSignalFeed(): OracleFeedPlugin {
    return createPriceFeed(
        "ALPHA/SIGNAL",
        async () => {
            // Simulate complex calculation
            return 1000 + (Math.sin(Date.now() / 10000) * 100);
        },
        10,  // Fast updates
        0.1  // Cost: 0.1 USDC
    );
}

export const feeds: OracleFeedPlugin[] = [
    // Premium feeds temporarily disabled
    // createPremiumInsightFeed(),
    // createAlphaSignalFeed()
];
