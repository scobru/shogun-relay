# Storage Deals

Storage Deals provide per-file contracts as an alternative/complement to subscriptions.

## Features

- Per-file pricing and duration
- Erasure coding for redundancy
- Multi-relay replication
- Payment via x402

## Pricing Tiers

| Tier | Price/MB/Month | Features |
|------|----------------|----------|
| Standard | $0.0001 | Basic storage, 1x replication |
| Premium | $0.0002 | Erasure coding, 3x replication |
| Enterprise | $0.0005 | Erasure coding, 5x replication, SLA |

## Deal Lifecycle

```
1. CREATE DEAL     → POST /deals/create (returns dealId + payment requirements)
2. PAY             → User signs x402 payment with wallet
3. ACTIVATE        → POST /deals/:dealId/activate (verifies payment)
4. STORE           → Upload file to IPFS (optionally with erasure coding)
5. RENEW (optional)→ POST /deals/:dealId/renew
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/deals/pricing` | GET | Get pricing and quotes |
| `/api/v1/deals/create` | POST | Create new storage deal |
| `/api/v1/deals/:dealId` | GET | Get deal information |
| `/api/v1/deals/:dealId/activate` | POST | Activate after payment |
| `/api/v1/deals/:dealId/renew` | POST | Renew existing deal |
| `/api/v1/deals/by-client/:address` | GET | Get all deals for client |

## Deals vs Subscriptions

| Aspect | Subscriptions | Deals |
|--------|---------------|-------|
| Model | Monthly quota | Per-file contract |
| Pricing | Fixed tiers | Dynamic (size + duration) |
| Erasure Coding | No | Optional (Premium+) |
| Multi-Relay | No | Yes (replication factor) |
| Use Case | General storage | Critical files |

---

# Erasure Coding

Provides data redundancy by splitting files into chunks with parity data.

## How It Works

```
Original File (10MB)
        ↓
Split into 10 data chunks + 4 parity chunks (40% extra)
        ↓
14 total chunks distributed across multiple relays
        ↓
Recovery: Need only 10 of 14 chunks (can lose up to 4)
```

## Configuration

```javascript
const DEFAULT_CONFIG = {
  chunkSize: 256 * 1024,  // 256KB per chunk
  dataChunks: 10,
  parityChunks: 4,        // 40% redundancy
};
```

## Overhead Calculation

```bash
curl "http://localhost:8765/api/v1/deals/overhead?sizeMB=100"
```

---

# On-Chain Relay Registry

The ShogunRelayRegistry smart contract provides on-chain relay discovery on **Base**.

## Contract Addresses

| Network | Chain ID | Registry |
|---------|----------|----------|
| Base Sepolia | 84532 | `0x412D3Cf47907C231EE26D261714D2126eb3735e6` |
| Base Mainnet | 8453 | TBD |

## Features

- **Registration**: Operators register with endpoint, pubkey, and USDC stake (min 100 USDC)
- **Staking**: Anti-spam with skin-in-the-game
- **Slashing**: Penalties for missed proofs (1%) and data loss (10%)
- **Discovery**: Query active relays from blockchain

## API

```bash
# Get all registered relays
curl "http://localhost:8765/api/v1/network/onchain/relays"

# Get registry parameters
curl "http://localhost:8765/api/v1/network/onchain/params"
```

## Why On-Chain?

1. **Bootstrap Problem Solved**: Discover relays without knowing any first
2. **Trustless Discovery**: Anyone can read from blockchain
3. **Economic Security**: Staking provides incentives
4. **Slashing**: Bad actors lose their stake
