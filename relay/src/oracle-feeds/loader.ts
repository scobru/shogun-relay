/**
 * Oracle Feed Loader
 * 
 * Automatically loads all feed plugins from the oracle-feeds/ folder
 * and registers them with the oracle system.
 */

import { readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { registerFeed } from "../routes/oracle.js";
import { loggers } from "../utils/logger.js";
import type { OracleFeedPlugin } from "./plugin-interface.js";
import { syncFeedPrices } from "../utils/price-sync-manager.js";
import { oracleConfig } from "../config/index.js";

const log = loggers.server;

// Store active intervals for cleanup
const activeIntervals: Map<string, NodeJS.Timeout> = new Map();

/**
 * Load all feed plugins from the oracle-feeds folder
 */
export async function loadOracleFeeds(): Promise<void> {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);

    // Get all .ts/.js files in this directory (except loader and interface)
    const files = readdirSync(__dirname).filter(file =>
        (file.endsWith(".ts") || file.endsWith(".js")) &&
        !file.includes("loader") &&
        !file.includes("interface") &&
        !file.includes("index")
    );

    log.info({ files }, "Loading oracle feed plugins...");

    for (const file of files) {
        try {
            // Dynamic import
            const modulePath = join(__dirname, file);
            const module = await import(modulePath.replace(/\.ts$/, ".js"));

            // Check if module exports a feeds array
            const feeds: OracleFeedPlugin[] = module.feeds || [];

            if (feeds.length === 0) {
                log.warn({ file }, "Plugin has no feeds exported");
                continue;
            }

            // Register each feed
            for (const feed of feeds) {
                await registerAndScheduleFeed(feed, file);
            }

            log.info({ file, feedCount: feeds.length }, "Loaded feed plugin");

            // Sync on-chain prices (fire and forget)
            syncFeedPrices(feeds, oracleConfig.chainId).catch(err => {
                log.warn({ err, file }, "Price sync failed");
            });

        } catch (error) {
            log.error({ error, file }, "Failed to load feed plugin");
        }
    }
}

/**
 * Register a feed and schedule periodic updates
 */
async function registerAndScheduleFeed(feed: OracleFeedPlugin, sourceFile: string): Promise<void> {
    try {
        // Call init if provided
        if (feed.init) {
            await feed.init();
        }

        // Create getValue wrapper that fetches and stores value
        let cachedValue: any = null;

        const fetchAndCache = async () => {
            try {
                cachedValue = await feed.getValue();
                log.debug({ feed: feed.name, value: cachedValue }, "Feed value updated");
            } catch (error) {
                log.error({ error, feed: feed.name }, "Failed to fetch feed value");
            }
        };

        // Initial fetch
        await fetchAndCache();

        // Register with local oracle system (in-memory)
        registerFeed(feed.name, {
            dataType: feed.dataType,
            schema: feed.schema,
            priceUSDC: feed.priceUSDC || 0,
            updateFreqSecs: feed.updateIntervalSecs,
            active: true,
            getValue: async () => cachedValue
        });

        // Schedule periodic updates
        const interval = setInterval(fetchAndCache, feed.updateIntervalSecs * 1000);
        activeIntervals.set(feed.name, interval);

        log.info({
            feed: feed.name,
            source: sourceFile,
            interval: feed.updateIntervalSecs
        }, "Feed registered locally and scheduled");

        // Register on-chain (async, non-blocking)
        registerOnChainAsync(feed);
    } catch (error) {
        log.error({ error, feed: feed.name }, "Failed to register feed");
    }
}

/**
 * Register feed on-chain asynchronously (non-blocking)
 */
async function registerOnChainAsync(feed: OracleFeedPlugin): Promise<void> {
    try {
        const { oracleConfig } = await import("../config/env-config.js");
        const { registerFeedOnChain, canRegisterOnChain } = await import("./on-chain-registration.js");

        const chainId = oracleConfig.chainId;
        const { ready, reason } = canRegisterOnChain(chainId);

        if (!ready) {
            log.debug({ feed: feed.name, reason }, "Skipping on-chain registration");
            return;
        }

        const success = await registerFeedOnChain(feed, chainId);
        if (success) {
            log.info({ feed: feed.name }, "Feed registered on-chain");
        }
    } catch (error) {
        log.warn({ error, feed: feed.name }, "On-chain registration failed (non-critical)");
    }
}

/**
 * Cleanup all feed intervals (call on shutdown)
 */
export function cleanupOracleFeeds(): void {
    for (const [name, interval] of activeIntervals) {
        clearInterval(interval);
        log.debug({ feed: name }, "Feed interval cleared");
    }
    activeIntervals.clear();
}

/**
 * Get list of loaded feeds
 */
export function getLoadedFeeds(): string[] {
    return Array.from(activeIntervals.keys());
}
