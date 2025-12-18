# Oracle Feeds Plugin System

This folder contains **oracle feed plugins** that are automatically loaded by the Shogun Relay.

## How It Works

1. Drop your `.ts` or `.js` file in this folder
2. Export a `feeds` array of `OracleFeedPlugin` objects
3. The relay automatically loads and registers all feeds on startup
4. Each feed's `getValue()` is called periodically based on `updateIntervalSecs`

## Creating a Plugin

### 1. Simple Price Feed (Example: Crypto Prices)

```typescript
import { OracleFeedPlugin, createPriceFeed } from "./plugin-interface.js";

async function fetchMyPrice(): Promise<number> {
    const response = await fetch("https://api.example.com/price");
    const data = await response.json();
    return data.price;
}

export const feeds: OracleFeedPlugin[] = [
    createPriceFeed(
        "MY_ASSET/USD",    // Feed name
        fetchMyPrice,      // Function to get price
        60,                // Update every 60 seconds
        0                  // Free (0 USDC)
    )
];
```

### 2. JSON Data Feed

```typescript
import { createJsonFeed } from "./plugin-interface.js";

export const feeds = [
    createJsonFeed(
        "WEATHER/NYC",
        async () => {
            const res = await fetch("https://api.weather.com/nyc");
            return await res.json();
        },
        300, // Every 5 minutes
        0.01 // 0.01 USDC per request
    )
];
```

### 3. Custom Feed (Full Control)

```typescript
import { OracleFeedPlugin } from "./plugin-interface.js";

let connection: any;

export const feeds: OracleFeedPlugin[] = [{
    name: "CUSTOM/DATA",
    dataType: 4, // CUSTOM
    schema: "(uint256,bytes32,bool)",
    priceUSDC: 0.5,
    updateIntervalSecs: 30,
    
    // Called once on load
    async init() {
        connection = await connectToDataSource();
    },
    
    // Called periodically
    async getValue() {
        return [
            Date.now(),
            "0x123...",
            true
        ];
    },
    
    // Called on shutdown
    async cleanup() {
        await connection.close();
    }
}];
```

## Data Types

| Value | Name   | Schema Example          |
|-------|--------|-------------------------|
| 0     | PRICE  | `uint256`               |
| 1     | STRING | `string`                |
| 2     | JSON   | `string` (JSON encoded) |
| 3     | BYTES  | `bytes`                 |
| 4     | CUSTOM | `(uint256,bool,string)` |

## Files in This Folder

- `plugin-interface.ts` - Type definitions and helper functions
- `loader.ts` - Auto-loads all plugins
- `crypto-prices.ts` - Example: ETH/BTC prices from CoinGecko
- `index.ts` - Exports

## Adding Your Own Feeds

1. Copy `crypto-prices.ts` as a template
2. Rename to something descriptive (e.g., `defi-rates.ts`)
3. Implement your data fetching logic
4. Export your `feeds` array
5. Restart the relay - feeds are automatically registered!

## API Access

Once registered, feeds are available at:
- `GET /api/v1/oracle/feeds` - List all feeds
- `GET /api/v1/oracle/data/{feedId}` - Get signed data packet
