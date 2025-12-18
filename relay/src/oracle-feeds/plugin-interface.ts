/**
 * Oracle Feed Plugin Interface
 * 
 * Each plugin in the oracle-feeds/ folder should export this interface.
 * The relay will automatically load and register all feeds on startup.
 */

export interface OracleFeedPlugin {
    /** Feed name (e.g., "ETH/USD", "BTC/USD") */
    name: string;

    /** Data type: 0=PRICE, 1=STRING, 2=JSON, 3=BYTES, 4=CUSTOM */
    dataType: number;

    /** Schema for encoding (e.g., "uint256", "(uint256,uint256)") */
    schema: string;

    /** Price in USDC to access this feed (0 = free) */
    priceUSDC?: number;

    /** How often to update in seconds */
    updateIntervalSecs: number;

    /** 
     * Function that fetches the current value
     * Called periodically based on updateIntervalSecs
     */
    getValue: () => Promise<any>;

    /**
     * Optional initialization function
     * Called once when the plugin is loaded
     */
    init?: () => Promise<void>;

    /**
     * Optional cleanup function
     * Called when the relay shuts down
     */
    cleanup?: () => Promise<void>;
}

/**
 * Helper to create a price feed plugin
 */
export function createPriceFeed(
    name: string,
    fetchPrice: () => Promise<number>,
    updateIntervalSecs: number = 60,
    priceUSDC: number = 0
): OracleFeedPlugin {
    return {
        name,
        dataType: 0, // PRICE
        schema: "uint256",
        priceUSDC,
        updateIntervalSecs,
        getValue: async () => {
            const price = await fetchPrice();
            // Convert to 8 decimal places (standard for price feeds)
            return Math.floor(price * 1e8);
        }
    };
}

/**
 * Helper to create a JSON feed plugin
 */
export function createJsonFeed(
    name: string,
    fetchData: () => Promise<object>,
    updateIntervalSecs: number = 60,
    priceUSDC: number = 0
): OracleFeedPlugin {
    return {
        name,
        dataType: 2, // JSON
        schema: "string",
        priceUSDC,
        updateIntervalSecs,
        getValue: fetchData
    };
}

/**
 * Helper to create a string feed plugin
 */
export function createStringFeed(
    name: string,
    fetchString: () => Promise<string>,
    updateIntervalSecs: number = 60,
    priceUSDC: number = 0
): OracleFeedPlugin {
    return {
        name,
        dataType: 1, // STRING
        schema: "string",
        priceUSDC,
        updateIntervalSecs,
        getValue: fetchString
    };
}
