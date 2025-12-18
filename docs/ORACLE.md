# Shogun Oracle System

The Shogun Oracle is a decentralized, cryptographically secured data feed system that allows relays to monetize data distribution through a dual payment model (Off-Chain x402 and On-Chain ETH).

## Overview

Unlike traditional oracles that push data on-chain (expensive), Shogun uses a **Pull Model**:
1. Relays sign data packets (prices, strings, JSON) off-chain.
2. Consumers request these packets via API.
3. Consumers submit the packets on-chain to the `ShogunOracle` contract only when needed.

## Dual Payment Model

Shogun supports two simultaneous revenue streams for relay operators:

### 1. Off-Chain API Access (x402)
- **Currency:** USDC (or any ERC-20 supported by x402)
- **Mechanism:** Users pay for the API call itself.
- **Access:** The relay returns the signed packet *only* after verifying the x402 payment header.
- **Contract:** The user can then submit this packet to `ShogunPriceOracle` (free update).

### 2. On-Chain Update (Contract)
- **Currency:** ETH (native)
- **Mechanism:** Users pay `msg.value` when calling `updatePrice()` on the smart contract.
- **Access:** The relay receives the ETH payment directly to its signer address.
- **Contract:** Handled by `ShogunPaidOracle`.

## Architecture

| Component | Description |
|-----------|-------------|
| **OracleFeedRegistry** | On-chain registry of available feeds and their metadata. |
| **ShogunPaidOracle** | Contract that verifies signatures and routes ETH payments to relays. |
| **PriceSyncManager** | Relay module that syncs off-chain USD prices to on-chain ETH prices. |
| **Oracle Feeds Plugin** | Modular system in `src/oracle-feeds/` to define data sources. |

## For Relay Operators

### 1. Enabling the Oracle
Set `ORACLE_ENABLED=true` in your `.env` file.

### 2. Creating Feeds
Feeds are defined as plugins in `relay/src/oracle-feeds/`.
Example `premium-feed.ts`:

```typescript
import { createPriceFeed } from "./plugin-interface.js";

export const feeds = [
    createPriceFeed(
        "PREMIUM/ETH", 
        async () => fetchEthPrice(), 
        60,  // Update every 60s
        1.0  // Price: 1.0 USDC
    )
];
```

The relay will automatically:
1. Load the plugin.
2. Register the feed in the local system.
3. Register the feed on-chain (if `RELAY_PRIVATE_KEY` is set).
4. Sync the on-chain ETH price to match the 1.0 USDC value.

### 3. Monitoring
Visit `/oracle-dashboard` to see:
- Active feeds
- Global revenue and access stats
- Per-feed usage metrics

## For Consumers

### API Usage
To get data for a premium feed:

1. **Check Price:**
   `GET /api/v1/oracle/feeds` - Look for `priceUSDC`.

2. **Generate Payment:**
   Create an x402 payment for the required amount.

3. **Request Data:**
   `GET /api/v1/oracle/data/:feedId`
   Header: `X-Payment: <x402-payment-string>`

4. **Submit On-Chain:**
   Use the returned packet to call `ShogunPriceOracle.updatePrice(packet)`.

### On-Chain Usage
Alternatively, simply call the contract with ETH:

```solidity
// Check price
uint256 cost = oracle.getFeedPrice(feedId);

// Update and get value
uint256 value = oracle.updateAndGetPrice{value: cost}(packet);
```
