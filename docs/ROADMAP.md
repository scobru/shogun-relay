# Shogun Relay - Roadmap

The evolution path for Shogun Relay towards full decentralization.

## Version 2.0 Overview

The next major version will introduce tokenomics and decentralized governance.

---

## Native Token: $SHOGUN

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          $SHOGUN TOKEN UTILITY                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐           │
│  │    STAKING      │   │   GOVERNANCE    │   │   FEE PAYMENT   │           │
│  ├─────────────────┤   ├─────────────────┤   ├─────────────────┤           │
│  │                 │   │                 │   │                 │           │
│  │ Relay operators │   │ Vote on:        │   │ Pay fees in     │           │
│  │ stake $SHOGUN   │   │ - Parameters    │   │ $SHOGUN for     │           │
│  │ instead of USDC │   │ - Upgrades      │   │ discount        │           │
│  │                 │   │ - Treasury      │   │                 │           │
│  │ Benefits:       │   │                 │   │ Or pay in USDC  │           │
│  │ - Lower slash % │   │ Voting power =  │   │ (auto-convert)  │           │
│  │ - Fee discounts │   │ staked tokens   │   │                 │           │
│  │ - Boost rewards │   │                 │   │                 │           │
│  │                 │   │                 │   │                 │           │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Token Distribution (Proposed)

| Allocation | Percentage | Vesting |
|------------|------------|---------|
| Community & Ecosystem | 40% | 4 years linear |
| Early Relay Operators | 15% | 2 years linear |
| Team | 15% | 4 years, 1 year cliff |
| Treasury (DAO) | 20% | Controlled by governance |
| Liquidity | 10% | At launch |

---

## Protocol Fee Structure (v2)

```
User pays for storage
        │
        ▼
┌───────────────────┐
│   Protocol Fee    │ ──► 5% to DAO Treasury
│      (5%)         │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│   Relay Revenue   │ ──► 95% to Relay Operator
│      (95%)        │
└───────────────────┘
```

| Fee Type | Rate | Destination |
|----------|------|-------------|
| Storage subscription | 5% | DAO Treasury |
| Storage deals | 5% | DAO Treasury |
| Deal registration | 0.1 USDC | DAO Treasury |
| Slashing penalties | 100% | DAO Treasury |

---

## DAO Governance

**Controlled Parameters:**
- Minimum stake requirements
- Slashing percentages
- Protocol fee rates
- Relay tier thresholds
- Treasury spending

**Governance Process:**
1. Create proposal (requires 100k $SHOGUN)
2. Discussion period (7 days)
3. Voting period (7 days)
4. Timelock (2 days)
5. Execution

---

## Staking Rewards

```
┌─────────────────────────────────────────┐
│           RELAY STAKING v2              │
├─────────────────────────────────────────┤
│                                         │
│  Stake $SHOGUN → Earn rewards from:     │
│                                         │
│  1. Protocol fees (proportional)        │
│  2. Inflation rewards (APY ~5-15%)      │
│  3. Slashing penalties redistribution   │
│                                         │
│  Higher stake = Higher tier:            │
│  ┌─────────────────────────────────┐   │
│  │ Bronze:   10k $SHOGUN  (1x)     │   │
│  │ Silver:   50k $SHOGUN  (1.5x)   │   │
│  │ Gold:    100k $SHOGUN  (2x)     │   │
│  │ Diamond: 500k $SHOGUN  (3x)     │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

---

## Smart Contracts (v2)

### Core Protocol

| Contract | Purpose |
|----------|---------|
| `ShogunToken.sol` | ERC-20 token with voting |
| `ShogunStaking.sol` | Stake tokens, earn rewards |
| `ShogunGovernor.sol` | DAO governance (OpenZeppelin) |
| `ShogunTreasury.sol` | Protocol fee collection |
| `ShogunRelayRegistry.sol` | Updated for token staking |

### Extended Features

| Contract | Purpose | Status |
|----------|---------|--------|
| `GunL2Bridge.sol` | ETH bridge between L1 and L2 (GunDB) | ✅ Implemented |
| `BridgeDex.sol` | Decentralized exchange for bridge operations | ✅ Implemented |
| `DataPostRegistry.sol` | Registry for encrypted data posts | ✅ Implemented |
| `DataSaleEscrow.sol` | Escrow contract for encrypted data sales | ✅ Implemented |
| `DataSaleEscrowFactory.sol` | Factory for creating escrow contracts | ✅ Implemented |
| `StealthKeyRegistry.sol` | Registry for stealth address keys | ✅ Implemented |
| `PaymentForwarder.sol` | Stealth payment forwarding contract | ✅ Implemented |

---

## Relay Transaction Processing

Relays play a crucial role in processing on-chain transactions for various protocol features, enabling seamless user experiences and decentralized operations.

### Transaction Processing Roles

```
┌─────────────────────────────────────────────────────────────────┐
│              RELAY TRANSACTION PROCESSING                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. L2 BRIDGE                                                    │
│     ┌─────────────────────────────────────┐                     │
│     │ Batch Submission                    │                     │
│     │ - Aggregate L2 state                │                     │
│     │ - Submit Merkle roots to L1         │                     │
│     │ - Enable trustless withdrawals      │                     │
│     └─────────────────────────────────────┘                     │
│                                                                  │
│  2. DATASALES                                                    │
│     ┌─────────────────────────────────────┐                     │
│     │ Escrow Processing                   │                     │
│     │ - Monitor escrow status             │                     │
│     │ - Verify encrypted data submission  │                     │
│     │ - Sync completion to GunDB          │                     │
│     │ - Handle dispute resolution         │                     │
│     └─────────────────────────────────────┘                     │
│                                                                  │
│  3. BRIDGE DEX                                                   │
│     ┌─────────────────────────────────────┐                     │
│     │ Order Matching                      │                     │
│     │ - Monitor bridge requests           │                     │
│     │ - Match providers with bridgers     │                     │
│     │ - Process ticket submissions        │                     │
│     │ - Coordinate cross-chain swaps      │                     │
│     └─────────────────────────────────────┘                     │
│                                                                  │
│  4. STEALTH ADDRESSES                                            │
│     ┌─────────────────────────────────────┐                     │
│     │ Payment Forwarding                  │                     │
│     │ - Detect stealth payments           │                     │
│     │ - Forward to recipient addresses    │                     │
│     │ - Privacy-preserving transaction    │                     │
│     │ - Support subscriptions & deals     │                     │
│     └─────────────────────────────────────┘                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Benefits

- **Gasless User Experience**: Users can interact with protocols without paying gas fees
- **Batch Processing**: Relays batch multiple operations for efficiency
- **Network Coordination**: Relays coordinate cross-chain and cross-relay operations
- **Privacy**: Stealth address processing maintains user privacy
- **Trustless Verification**: On-chain verification ensures relay honesty

### Economic Model

Relays earn fees for processing transactions:
- Bridge batch submissions: Fee from bridge protocol
- DataSales escrow processing: Fee from escrow transactions
- Bridge DEX order matching: Fee from exchange transactions
- Stealth payment forwarding: Fee from payment transactions

This creates additional revenue streams for relay operators beyond storage subscriptions.

---

## Migration Path

### 🌴 Alabasta

#### Alabasta Testnet (Current)

**Status**: ✅ Active

The foundation phase - establishing the core infrastructure on testnet.

**Features:**
- USDC staking for relay registration
- No protocol fees
- Centralized parameters
- Base Sepolia testnet deployment
- Core functionality testing and validation
- **Storage Deals** testing and validation
- **L2 Bridge** testing and integration
- Relay transaction processing (batch submissions, deal syncing)

**Goals:**
- Stable relay operations
- Network testing and optimization
- Storage deals validation
- L2 bridge functionality testing
- Relay transaction processing validation
- Community building
- Real-world usage patterns

---

#### Alabasta Mainnet

**Status**: 🚧 Planned

The foundation goes live on mainnet.

**Features:**
- Mainnet deployment on Base
- Production-ready storage deals
- Production L2 bridge operations
- Relay transaction processing in production
- USDC staking (mainnet)
- No protocol fees
- Centralized parameters

**Goals:**
- Mainnet stability
- Production usage validation
- Network growth
- Economic model validation
- Production transaction processing reliability

---

### 💎 Dressrosa

#### Dressrosa Testnet

**Status**: 🔮 Planned

The transformation phase begins on testnet - introducing tokenomics and governance.

**Features:**
- $SHOGUN token deployment (testnet)
- Dual staking system (USDC or $SHOGUN) on testnet
- Protocol fees activated (5% to DAO treasury)
- DAO treasury live (testnet)
- Governance proposals system (testnet)
- Staking rewards begin (testnet)
- **DataSales** marketplace testing (encrypted data exchange)
- **Bridge DEX** testing (decentralized bridge exchange)
- **Stealth Addresses** testing (private payments)
- Relay transaction processing for datasales and stealth payments

**Goals:**
- Token mechanics validation
- DAO formation and early governance testing
- Economic model validation
- DataSales marketplace validation
- Bridge DEX operations testing
- Stealth payment privacy testing
- Relay transaction processing expansion
- Community participation

---

#### Dressrosa Mainnet

**Status**: 🔮 Future

Tokenomics and governance go live on mainnet.

**Features:**
- $SHOGUN token deployment (mainnet)
- Dual staking system (USDC or $SHOGUN) on mainnet
- Protocol fees activated (5% to DAO treasury)
- DAO treasury live (mainnet)
- Governance proposals system (mainnet)
- Staking rewards begin (mainnet)
- **DataSales** marketplace live (encrypted data exchange)
- **Bridge DEX** operations live (multi-chain bridge trading)
- **Stealth Addresses** live (private payments for subscriptions and deals)
- Relay transaction processing in production (datasales, stealth, bridge)

**Goals:**
- Token distribution and liquidity
- DAO operations on mainnet
- Economic sustainability
- DataSales marketplace adoption
- Bridge DEX usage growth
- Stealth payment adoption
- Relay transaction processing at scale
- Network growth and decentralization

---

### 🔬 Egghead

#### Egghead Testnet

**Status**: 🔮 Future

Testing complete decentralization on testnet.

**Features:**
- USDC staking deprecated (testnet)
- $SHOGUN-only staking (testnet)
- Full DAO control over protocol (testnet)
- Advanced governance features
- Multi-chain expansion testing
- Advanced relay transaction processing (all protocols)
- Cross-chain DataSales and Bridge DEX
- Enhanced stealth address features

**Goals:**
- Decentralization model validation
- Advanced governance testing
- Multi-chain architecture validation
- Advanced transaction processing validation
- Cross-chain functionality testing

---

#### Egghead Mainnet

**Status**: 🔮 Future

Complete decentralization achieved on mainnet.

**Features:**
- USDC staking deprecated (mainnet)
- $SHOGUN-only staking (mainnet)
- Full DAO control over protocol (mainnet)
- Multi-chain expansion
- Advanced governance features
- Self-sustaining ecosystem
- **Complete relay transaction processing**:
  - Storage deals processing
  - L2 bridge batch submissions
  - DataSales escrow processing
  - Bridge DEX order matching
  - Stealth payment forwarding
- Cross-chain DataSales and Bridge DEX
- Privacy-first ecosystem with stealth addresses

**Goals:**
- Complete decentralization
- Multi-chain presence
- Autonomous protocol operation
- Full relay transaction processing ecosystem
- Privacy-preserving infrastructure
- Global network expansion

---

## Timeline (Estimated)

| Milestone | Target | Phase |
|-----------|--------|-------|
| Alabasta Testnet (current) | Q4 2024 | ✅ Active |
| Alabasta Mainnet | Q1 2025 | Alabasta |
| Token design finalized | Q1 2025 | Alabasta → Dressrosa |
| Dressrosa Testnet | Q2 2025 | Dressrosa |
| Dressrosa Mainnet | Q3 2025 | Dressrosa |
| DAO governance live | Q4 2025 | Dressrosa |
| DataSales & Bridge DEX testnet | Q4 2025 | Dressrosa |
| DataSales & Bridge DEX mainnet | Q1 2026 | Dressrosa → Egghead |
| Stealth addresses mainnet | Q1 2026 | Dressrosa → Egghead |
| Egghead Testnet | 2026 | Egghead |
| Egghead Mainnet | 2026+ | Egghead |
| Multi-chain expansion | 2026+ | Egghead |
| Full relay transaction processing | 2026+ | Egghead |

---

## Related Documentation

- [Node Operator Guide](./NODE_OPERATOR_GUIDE.md) - How to run a relay
- [README.md](../README.md) - Main project documentation
- [Environment Variables](./ENVIRONMENT_VARIABLES.md) - Configuration reference

