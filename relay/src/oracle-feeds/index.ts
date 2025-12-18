/**
 * Oracle Feeds Plugin System
 * 
 * Drop your custom feed plugins in this folder!
 * Each plugin should export a `feeds` array of OracleFeedPlugin objects.
 * 
 * See crypto-prices.ts for an example.
 */

export type { OracleFeedPlugin } from "./plugin-interface.js";
export { createPriceFeed, createJsonFeed, createStringFeed } from "./plugin-interface.js";
export { loadOracleFeeds, cleanupOracleFeeds, getLoadedFeeds } from "./loader.js";
