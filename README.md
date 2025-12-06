# Shogun Relay

[![npm](https://img.shields.io/badge/npm-v1.9.4-blue)](https://www.npmjs.com/package/shogun-relay)
[![License](https://img.shields.io/badge/license-MIT-yellow)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3.3-blue)](https://www.typescriptlang.org/)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/scobru/shogun-relay)

**Shogun Relay** is a production-ready connection hub that unifies **GunDB** and **IPFS** into a single solution. If you're building decentralized applications and need a centralized control point to manage your distributed data, this is the tool for you.

## Why Shogun Relay?

As an independent developer, you've likely faced these challenges:

- **Complex management**: You need to configure and maintain separately a GunDB relay, IPFS node, monitoring dashboards, and management APIs
- **Lack of visibility**: You don't have a simple way to see what's happening in your distributed data or IPFS storage
- **Manual operations**: Managing IPFS pins, running garbage collection, monitoring system health requires too many manual commands
- **Fragmented integration**: Your applications need to talk to different services, each with its own authentication and configuration

**Shogun Relay solves all of this** by providing:

✅ **A single access point** for GunDB relay, IPFS management, and administrative dashboards  
✅ **Complete web interface** to monitor, manage, and inspect your data in real-time  
✅ **Unified REST APIs** with centralized authentication (one token for everything)  
✅ **Instant deployment** with Docker or manual setup in minutes  
✅ **Production-ready** with SQLite/RADISK persistence, rate limiting, and built-in security

In practice, instead of orchestrating 3-4 different services, you start a single server and have everything you need to manage your decentralized infrastructure.

---

## Table of Contents

1. [Highlights](#highlights)
2. [Architecture at a Glance](#architecture-at-a-glance)
3. [Getting Started](#getting-started)
4. [Configuration](#configuration)
5. [Docker Persistence](#docker-persistence)
6. [Admin Authentication](#admin-authentication)
7. [Admin Interfaces](#admin-interfaces)
8. [API Overview](#api-overview)
9. [Key Tools](#key-tools)
10. [Development Notes](#development-notes)
11. [Troubleshooting](#troubleshooting)
12. [Contributing](#contributing)
13. [License](#license)

---

## Provider Guide

**Want to run your own relay and earn revenue?**

See the complete **[Provider Guide](./PROVIDER_GUIDE.md)** for:
- Step-by-step setup instructions
- On-chain registration walkthrough
- Payment configuration
- Security best practices
- Economics and earnings potential

---

## Highlights

- **GunDB Relay Core**
  - WebSocket relay with SQLite or RADISK persistence and WebRTC support.
  - Drop-in peer for any Gun client.
  - SQLite storage backend for improved performance and reliability (default).

- **Holster Relay Integration**
  - Built-in Holster relay with WebSocket server and connection management.
  - Persistent storage support and configurable connection limits.

- **Integrated IPFS Control**
  - Authenticated API proxy (JWT support) and content preview.
  - Upload files, manage pins, run garbage collection.

- **Operational Dashboards**
  - Admin panel with stats, service status, charts, and a Gun visual explorer.
  - Modern IPFS Pin Manager with batch operations and inline preview.

- **Security First**
  - Single admin token reused across APIs and dashboards.
  - Rate limiting and protected static routes.

---

## Architecture at a Glance

```
┌──────────────┐      ┌──────────────┐        ┌───────────────┐
│  Gun Clients │◀────▶│ Shogun Relay │◀──────▶│   IPFS Node   │
└──────────────┘      └──────────────┘        └───────────────┘
       ▲                     ▲                           ▲
       │                     │                           │
       │             Admin Dashboards & APIs             │
       └─────────────────────────────────────────────────┘
```

- `relay/src/index.js` boots Gun, Express, and the admin routes.
- `relay/src/routes/` contains modular REST endpoints (system, IPFS, uploads, notes, debug, services).
- `relay/src/public/` hosts the admin web applications.

---

## Getting Started

### Requirements

- Node.js 18+
- IPFS node (local or remote) with API access
- `ADMIN_PASSWORD` and (optionally) `IPFS_API_TOKEN`

### Quick Start (Docker)

```bash
git clone <repository-url>
cd shogun-relay
./docker-start.sh

# verify the relay is alive
curl http://localhost:8765/health
# or
curl http://localhost:8765/api/v1/health
```

### Manual Setup

```bash
cd shogun-relay/relay
npm install

# start in development mode
npm run dev
```

Admin dashboards live at `http://localhost:8765/`.

---

## Configuration

Create a `.env` file or export environment variables. For a complete reference of all available environment variables, see **[Environment Variables Documentation](./relay/docs/ENVIRONMENT_VARIABLES.md)**.

### Quick Reference

| Variable           | Description                                              | Default                |
|--------------------|----------------------------------------------------------|------------------------|
| `ADMIN_PASSWORD`   | Shared token for all admin routes and dashboards         | _(required)_           |
| `IPFS_API_URL`     | IPFS API endpoint                                        | `http://127.0.0.1:5001`|
| `IPFS_API_TOKEN`   | JWT token for IPFS API                                   | _(optional)_           |
| `IPFS_GATEWAY_URL` | Gateway used for content preview / proxy                 | `http://127.0.0.1:8080`|
| `RELAY_PORT`       | HTTP port for Shogun Relay                               | `8765`                 |
| `RELAY_HOST`       | Advertised host                                          | auto-detected          |
| `RELAY_PEERS`      | Comma-separated list of upstream GunDB peers to sync with| _(optional)_           |
| `RELAY_NAME`       | Name of the relay node (visible in logs/status)          | `shogun-relay`         |
| `STORAGE_TYPE`     | Storage backend: "sqlite" (default) or "radisk"         | `sqlite`               |
| `DATA_DIR`         | Data directory (SQLite DB or RADISK files)               | `./data`               |
| `RELAY_PROTECTED`  | Require admin token for Gun writes                       | `true`                 |
| `HOLSTER_RELAY_HOST` | Holster relay host address                              | `0.0.0.0`              |
| `HOLSTER_RELAY_PORT` | Holster relay port                                      | `RELAY_PORT + 1` (8766)|
| `HOLSTER_RELAY_STORAGE` | Enable Holster persistent storage                      | `true`                 |
| `HOLSTER_RELAY_STORAGE_PATH` | Path for Holster data storage                         | `./holster-data`       |
| `HOLSTER_MAX_CONNECTIONS` | Maximum connections for Holster relay                  | `100`                  |
| `X402_PAY_TO_ADDRESS` | Ethereum address for receiving x402 subscription payments | _(optional)_ |
| `X402_NETWORK` | Blockchain network for x402 (e.g., 'base-sepolia') | `base-sepolia` |
| `X402_FACILITATOR_URL` | x402 facilitator service URL | _(optional)_ |
| `X402_FACILITATOR_API_KEY` | API key for x402 facilitator | _(optional)_ |
| `X402_SETTLEMENT_MODE` | x402 settlement mode ('facilitator' or 'direct') | `facilitator` |
| `X402_PRIVATE_KEY` | Private key for x402 transactions | _(optional)_ |
| `RELAY_PRIVATE_KEY` | Private key for on-chain registry operations | _(optional)_ |
| `REGISTRY_CHAIN_ID` | Chain ID for registry (84532=Base Sepolia, 8453=Base) | `84532` |
| `X402_RPC_URL` | RPC URL for blockchain access | _(optional)_ |
| `RELAY_GUN_USERNAME` | GunDB username for relay user (x402 subscriptions) | `shogun-relay` |
| `RELAY_GUN_PASSWORD` | GunDB password for relay user (x402 subscriptions) | `ADMIN_PASSWORD` |
| `AUTO_REPLICATION` | Auto-pin content from network pin requests | `true` |

**Storage Configuration:**
- `STORAGE_TYPE=sqlite` (default) - Uses SQLite database for better performance and reliability
- `STORAGE_TYPE=radisk` - Uses file-based RADISK storage (legacy)
- SQLite database is stored at `DATA_DIR/gun.db`
- RADISK files are stored in `DATA_DIR/radata/` directory

**See [Environment Variables Documentation](./relay/docs/ENVIRONMENT_VARIABLES.md) for complete reference including:**
- All pricing configuration variables (deals and subscriptions)
- Storage limits configuration
- Network federation settings
- Advanced options and debugging flags
- Security considerations and best practices

---

## Admin Authentication

Every privileged action uses the same administrator token.

```http
Authorization: Bearer <ADMIN_PASSWORD>
# or
token: <ADMIN_PASSWORD>
```

The admin dashboards rely on `lib/admin-auth.js` to sync the token across tabs. Use HTTPS in production to protect the credential.

---

## Admin Interfaces

| Path                  | Description                                | Auth |
|-----------------------|--------------------------------------------|------|
| `/admin`              | Main control panel (navigation & shortcuts)| ✅   |
| `/stats`              | Live metrics & charts                      | ✅   |
| `/services-dashboard` | Service health overview                    | ✅   |
| `/pin-manager`        | IPFS pin manager with preview & batch ops  | ✅   |
| `/upload`             | Direct IPFS uploads                        | ✅   |
| `/endpoints`          | Complete API endpoints documentation       | ❌   |
| `/visualGraph`        | GunDB visual explorer (public reads)       | ⚠️*  |
| `/graph`              | Alternate Gun graph viewer                 | ⚠️*  |
| `/charts`             | Charts and analytics dashboard             | ✅   |
| `/registry-dashboard` | On-chain registry management dashboard     | ✅   |

`⚠️` The explorers browse public coordinates without a token but prompt for the admin token when write access is required.

---

## API Overview

### GunDB Core
- `GET /gun` – WebSocket endpoint for Gun clients.
- `GET|POST|DELETE /api/v1/system/node/*` – Inspect or update nodes via REST.

### Holster Relay
- `GET /holster-status` – Check Holster relay status and configuration.

### Blockchain RPC
- `GET /rpc-status` – Check status of all configured blockchain RPC endpoints (public).

### IPFS Management
- `POST /api/v1/ipfs/upload` – Upload files to IPFS (admin, supports multipart/form-data with optional encryption).
- `GET /api/v1/ipfs/cat/:cid` – Stream IPFS content (aligned with Kubo's `/api/v0/cat`).
- `GET /api/v1/ipfs/cat/:cid/json` – Get IPFS content as JSON (automatically parses JSON).
- `GET /api/v1/ipfs/cat/:cid/decrypt` – Get and decrypt SEA-encrypted IPFS content (requires token query param).
- `POST /api/v1/ipfs/pin/add` – Pin content to IPFS (admin, aligned with Kubo's `/api/v0/pin/add`).
- `POST /api/v1/ipfs/pin/rm` – Remove a pin from IPFS (admin, aligned with Kubo's `/api/v0/pin/rm`).
- `POST /api/v1/ipfs/pins/rm` – Batch remove multiple pins from IPFS (admin).
- `GET /api/v1/ipfs/pin/ls` – List all pinned content (admin, aligned with Kubo's `/api/v0/pin/ls`).
- `GET /api/v1/ipfs/stat/:cid` – Get IPFS object/block statistics for a CID (public).
- `GET /api/v1/ipfs/test` – Test IPFS API connectivity (admin).
- `POST /api/v1/ipfs/api/:endpoint(*)` – Generic IPFS API proxy endpoint (admin).
- `GET /api/v1/ipfs/status` – Check IPFS node connectivity and status (public).
- `GET /api/v1/ipfs/version` – Get IPFS version information (public).
- `GET /api/v1/ipfs/repo/stat` – Get IPFS repository statistics (admin).
- `POST /api/v1/ipfs/repo/gc` – Run garbage collection to remove unpinned content (admin).
- `GET /api/v1/ipfs/user-uploads/:userAddress` – Get user uploads list for x402 subscription users.
- `DELETE /api/v1/ipfs/user-uploads/:userAddress/:hash` – Delete/unpin user file (for x402 subscription users).
- `GET /ipfs/:cid` – IPFS Gateway proxy (public, direct access via CID).
- `GET /ipns/:name` – IPNS Gateway proxy (public, resolve IPNS names).
- `POST /api/v0/*` – Raw Kubo IPFS API proxy (admin, forwards requests to IPFS node API).

### System & Debug
- `GET /health` – Simple health check (public).
- `GET /api/v1/system/health` – Detailed health report with system information (public).
- `GET /api/v1/system/relay-info` – Get relay server information (public).
- `GET /api/v1/system/stats` – Get system statistics and metrics (public).
- `POST /api/v1/system/stats/update` – Update system statistics (admin).
- `GET /api/v1/system/stats.json` – Get system statistics as JSON (public).
- `GET /api/v1/system/alldata` – Dump all data from the 'shogun' namespace in GunDB (admin).
- `GET /api/v1/system/node/*` – Inspect GunDB nodes via REST API (optional auth, wildcard path).
- `POST /api/v1/system/node/*` – Update or create GunDB nodes via REST API (admin).
- `DELETE /api/v1/system/node/*` – Delete GunDB nodes via REST API (admin).
- `GET /api/v1/system/logs` – Get system logs (admin).
- `DELETE /api/v1/system/logs` – Clear system logs (admin).
- `GET /api/v1/system/peers` – List all GunDB peers (public).
- `POST /api/v1/system/peers/add` – Add a GunDB peer (admin).
- `GET /api/v1/services/status` – Get status of all services (IPFS, Relay, etc.) (public).
- `POST /api/v1/services/:service/restart` – Restart a specific service (stub endpoint, admin).
- `GET /rpc-status` – Check status of all configured blockchain RPC endpoints (public).
- `GET /ipfs-status` – Check IPFS node status (public, legacy endpoint).
- `GET /metrics` – Get detailed metrics and statistics (admin).
- `GET /api/v1/contracts` – Get smart contract configuration for all chains (public).
- `GET /api/v1/debug/mb-usage/:userAddress` – Get storage usage in MB for a specific user address (admin).
- `GET /api/v1/debug/user-mb-usage/:identifier` – Get storage usage for a user identifier (admin).
- `POST /api/v1/debug/user-mb-usage/:identifier/reset` – Reset storage usage counter for a user (admin).
- `GET /api/v1/debug/user-uploads/:identifier` – Get detailed upload information for debugging (admin).


### User Uploads
- `GET /api/v1/user-uploads/system-hashes` – Get system hash registry (protected hashes that won't be garbage collected) (public).
- `GET /api/v1/user-uploads/system-hashes-map` – Get system hash registry as a map for quick lookups (public).
- `POST /api/v1/user-uploads/save-system-hash` – Save a hash to the system registry to protect it from garbage collection (admin).
- `DELETE /api/v1/user-uploads/remove-system-hash/:hash` – Remove a hash from the system registry (admin).
- `GET /api/v1/user-uploads/:identifier` – Get all uploads for a specific user identifier (public).
- `GET /api/v1/user-uploads/:identifier/:hash` – Get specific upload information for a user (public).
- `DELETE /api/v1/user-uploads/:identifier/:hash` – Delete a specific upload for a user (admin).

### x402 Subscriptions
- `GET /api/v1/x402/tiers` – List all available subscription tiers with relay storage availability (public).
- `GET /api/v1/x402/subscription/:userAddress` – Get subscription status for a user (public).
- `POST /api/v1/x402/subscribe` – Purchase or renew subscription with x402 payment (public).
- `GET /api/v1/x402/payment-requirements/:tier` – Get x402 payment requirements for a specific tier (public).
- `GET /api/v1/x402/can-upload/:userAddress` – Check if user can upload based on subscription (public).
- `GET /api/v1/x402/can-upload-verified/:userAddress` – Check if user can upload with verified subscription status (public).
- `POST /api/v1/x402/update-usage/:userAddress` – Update storage usage for a user (admin).
- `GET /api/v1/x402/storage/:userAddress` – Get storage information for a user (public).
- `POST /api/v1/x402/storage/sync/:userAddress` – Sync storage usage from actual uploads (admin).
- `GET /api/v1/x402/config` – Get x402 configuration (public).
- `GET /api/v1/x402/relay-storage` – Get relay's global storage status (public).
- `GET /api/v1/x402/relay-storage/detailed` – Get all IPFS pins with sizes (admin).
- `GET /api/v1/x402/recommend` – Get subscription tier recommendation based on usage (public).

### Network Federation & Storage Proofs
- `GET /api/v1/network/relays` – Discover all relays in the network (public).
- `GET /api/v1/network/relay/:host` – Get specific relay info (public).
- `GET /api/v1/network/stats` – Network-wide aggregated statistics (public).
- `GET /api/v1/network/proof/:cid` – Generate storage proof for a CID (public).
- `POST /api/v1/network/verify-proof` – Verify a storage proof from another relay (public).
- `POST /api/v1/network/pin-request` – Request other relays to pin a CID (admin).
- `GET /api/v1/network/pin-requests` – List pending pin requests from network (public).
- `POST /api/v1/network/pin-response` – Respond to a pin request (public).
- `GET /api/v1/network/reputation` – Get reputation leaderboard of all relays (public).
- `GET /api/v1/network/reputation/:host` – Get reputation score for a specific relay (public).
- `POST /api/v1/network/reputation/record-proof` – Record a proof event for reputation (public).
- `GET /api/v1/network/best-relays` – Get best relays for replication by score (public).
- `GET /api/v1/network/verified/relays` – List cryptographically verified relay announcements (public).
- `GET /api/v1/network/verified/relay/:host` – Get verified announcement for a specific relay (public).
- `POST /api/v1/network/verified/observation` – Create a signed observation about another relay (public).
- `GET /api/v1/network/verified/observations/:host` – Get all verified observations for a relay (public).
- `GET /api/v1/network/verified/entry/:namespace/:hash` – Read and verify any frozen entry by hash (public).

### On-Chain Registry (Base Sepolia/Mainnet)
- `GET /api/v1/network/onchain/relays` – Get all registered relays from smart contract (public).
- `GET /api/v1/network/onchain/relay/:address` – Get relay details by wallet address (public).
- `GET /api/v1/network/onchain/deals/relay/:address` – Get all storage deals for a relay (public).
- `GET /api/v1/network/onchain/deals/client/:address` – Get all storage deals for a client (public).
- `GET /api/v1/network/onchain/params` – Get registry parameters (min stake, delay, etc.) (public).

### Registry Management (Relay Operator)
- `GET /api/v1/registry/status` – Get this relay's on-chain registration status.
- `GET /api/v1/registry/balance` – Get wallet balances (ETH for gas, USDC for stake).
- `GET /api/v1/registry/params` – Get registry parameters.
- `GET /api/v1/registry/config` – Get registry configuration (addresses, chain).
- `POST /api/v1/registry/register` – Register this relay on-chain (requires stake).
- `POST /api/v1/registry/update` – Update relay endpoint or pubkey.
- `POST /api/v1/registry/stake/increase` – Increase stake amount.
- `POST /api/v1/registry/stake/unstake` – Request unstake (starts delay).
- `POST /api/v1/registry/stake/withdraw` – Withdraw stake after delay.
- `POST /api/v1/registry/deal/register` – Register storage deal on-chain.
- `POST /api/v1/registry/deal/complete` – Mark deal as completed.
- `GET /api/v1/registry/deals` – Get all on-chain deals for this relay.
- `POST /api/v1/registry/grief/missed-proof` – Report missed proof for slashing (admin).
- `POST /api/v1/registry/grief/data-loss` – Report data loss for slashing (admin).
- `POST /api/v1/registry/deal/grief` – Report deal griefing (admin).

### Storage Deals (Per-File Contracts)
- `GET /api/v1/deals/pricing` – Get pricing tiers and calculate quotes (public).
- `GET /api/v1/deals/overhead` – Calculate erasure coding overhead (public).
- `POST /api/v1/deals/create` – Create a new storage deal (returns payment requirements).
- `GET /api/v1/deals/:dealId` – Get deal information (public).
- `POST /api/v1/deals/upload` – Upload file and create deal in one step (admin).
- `POST /api/v1/deals/:dealId/activate` – Activate deal after payment (public).
- `POST /api/v1/deals/:dealId/renew` – Renew an existing deal (public).
- `POST /api/v1/deals/:dealId/terminate` – Terminate a deal early (admin).
- `POST /api/v1/deals/:dealId/cancel` – Cancel a deal before activation (public).
- `POST /api/v1/deals/:dealId/report` – Report deal issues or violations (public).
- `GET /api/v1/deals/:dealId/verify` – Verify deal status and payment (public).
- `GET /api/v1/deals/:dealId/verify-proof` – Verify storage proof for a deal (public).
- `GET /api/v1/deals/by-cid/:cid` – Get all deals for a CID (public).
- `GET /api/v1/deals/by-client/:address` – Get all deals for a client (public).
- `GET /api/v1/deals/relay/active` – Get active deals for this relay (admin).

### Visual Graph
- `GET /api/v1/visualGraph` – Visual graph explorer endpoint.
- `/visualGraph/*` – Static assets backing the D3.js explorer.

### Admin Pages
- `GET /endpoints` – API endpoints documentation page (public).

Full endpoint definitions live in `relay/src/routes/`. See `/endpoints` for interactive API documentation.

---

## Key Tools

### IPFS Pin Manager (`/pin-manager`)
- Single-CID operations plus batch unpin with throttled progress.
- System hash preservation to avoid deleting user uploads.
- Inline content preview (images, video, audio, text, JSON) with gateway and download shortcuts.

### Upload Interface (`/upload`)
- Drag & drop uploads with optional encryption.
- Tracks IPFS hashes in GunDB and the system hash registry.
- Provides quick links to local, relay, and public gateways.

### Visual Graph Explorer (`/visualGraph`)
- Depth-first navigation across Gun nodes.
- Live editing (set/delete) when authenticated.
- Peer status indicators and root navigation helpers.

---

## x402 Payment Implementation

Shogun Relay implements the [x402 payment protocol](https://x402.org) to enable paid IPFS storage subscriptions. Users can purchase subscriptions using USDC (EIP-3009) payments directly from their wallet without requiring approval transactions.

### Architecture Overview

The x402 implementation consists of three main components:

1. **X402Merchant** (`relay/src/utils/x402-merchant.js`) - Core business logic for payment processing
2. **x402 Routes** (`relay/src/routes/x402.js`) - REST API endpoints for subscription management
3. **Relay User** (`relay/src/utils/relay-user.js`) - GunDB user space management for subscription data

### How It Works

#### 1. Payment Flow

```
User → Request Subscription → Get Payment Requirements → Sign Authorization → Submit Payment → Verify → Settle → Activate Subscription
```

1. **Payment Requirements**: Client requests subscription and receives x402 payment requirements (amount, recipient, time window)
2. **Authorization Signing**: User signs an EIP-3009 `transferWithAuthorization` message with their wallet (no gas required)
3. **Payment Submission**: Signed authorization is sent to `/api/v1/x402/subscribe`
4. **Verification**: Server verifies the signature, amount, timing, and recipient
5. **Settlement**: Payment is settled on-chain via facilitator or direct settlement
6. **Storage Activation**: Subscription is saved to GunDB in the relay's user space

#### 2. Subscription Tiers

Three subscription tiers are available:

| Tier | Storage | Price (USDC) | Duration |
|------|---------|--------------|----------|
| Basic | 100 MB | 0.001 | 30 days |
| Standard | 500 MB | 0.004 | 30 days |
| Premium | 2000 MB | 0.01 | 30 days |

#### 3. Settlement Modes

The system supports two settlement modes:

**Facilitator Mode** (default):
- Uses x402.org facilitator service to settle payments
- Requires `X402_FACILITATOR_URL` (optional API key)
- Falls back to direct settlement if facilitator fails

**Direct Mode**:
- Relay settles payments directly on-chain
- Requires `X402_PRIVATE_KEY` configured
- Wallet must have ETH for gas fees
- More control but requires managing gas costs

The settlement mode is determined by `X402_SETTLEMENT_MODE` environment variable.

#### 4. Data Storage Architecture

Subscription data is stored in GunDB using the relay's dedicated user account:

```
relayUser.x402.subscriptions[userAddress] = {
  tier: 'basic',
  storageMB: 100,
  storageUsedMB: 45.2,
  expiresAt: timestamp,
  purchasedAt: timestamp,
  paymentTx: '0x...',
  paymentNetwork: 'base-sepolia'
}

relayUser.x402.uploads[userAddress][hash] = {
  hash: 'Qm...',
  name: 'file.pdf',
  size: bytes,
  sizeMB: 1.5,
  uploadedAt: timestamp
}
```

This architecture ensures:
- Only the relay can modify subscription data (ownership model)
- Subscription data is synced across all GunDB peers
- Users cannot manipulate their own subscription status
- Upload tracking is automatically maintained

#### 5. Storage Verification

The system includes two verification mechanisms:

**Basic Check** (`/can-upload/:userAddress`):
- Uses recorded storage usage from GunDB
- Fast but may have discrepancies

**Verified Check** (`/can-upload-verified/:userAddress`):
- Queries IPFS API to get actual file sizes
- Automatically syncs discrepancies to GunDB
- More accurate but slower (requires IPFS API calls)

**Storage Sync** (`/storage/sync/:userAddress`):
- Admin endpoint to manually sync storage
- Compares GunDB records with actual IPFS pins
- Updates `storageUsedMB` if discrepancy > 0.1MB

#### 6. Payment Verification Details

The merchant verifies payments by checking:

1. **Recipient**: `authorization.to` must match `X402_PAY_TO_ADDRESS`
2. **Amount**: `authorization.value` must be >= tier price (in USDC atomic units)
3. **Timing**: Current time must be between `validAfter` and `validBefore`
4. **Signature**: EIP-712 signature validation (via facilitator or on-chain)
5. **Nonce**: Prevents replay attacks (handled by USDC contract)

#### 7. Subscription Renewals

When a user purchases a subscription while an active subscription exists:
- **Same/Higher Tier**: Remaining time is added to new expiration date
- **Lower Tier**: New subscription starts immediately (downgrade)
- **Storage Usage**: Preserved when upgrading, reset when downgrading

#### 8. Supported Networks

| Network | Chain ID | USDC Contract | Explorer |
|---------|----------|---------------|----------|
| Base | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | basescan.org |
| Base Sepolia | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | sepolia.basescan.org |
| Polygon | 137 | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` | polygonscan.com |
| Polygon Amoy | 80002 | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` | amoy.polygonscan.com |

#### 9. Global Relay Storage Management

The relay can be configured with a maximum storage limit to prevent running out of disk space. When storage limits are configured:

**Configuration**:
- `RELAY_MAX_STORAGE_GB`: Maximum total IPFS storage in GB (0 = unlimited)
- `RELAY_STORAGE_WARNING_THRESHOLD`: Percentage at which warnings are shown (default: 80%)

**Behavior**:
1. Before accepting a new subscription, the relay checks if it has enough global storage
2. If storage is insufficient, the subscription is rejected with HTTP 503
3. The `/api/v1/x402/tiers` endpoint shows tier availability based on storage
4. Warnings are logged when storage exceeds the threshold

**Storage Calculation**:
- Uses IPFS `repo/stat` API to get actual disk usage
- Includes ALL pinned content (user uploads + admin pins)
- Storage is checked in real-time before each subscription

**Endpoints**:
- `GET /api/v1/x402/relay-storage` - Get global storage status (public)
- `GET /api/v1/x402/relay-storage/detailed` - Get all pins with sizes (admin)

**Example Response** (`/relay-storage`):
```json
{
  "success": true,
  "storage": {
    "unlimited": false,
    "usedGB": 5.23,
    "maxStorageGB": 10,
    "remainingGB": 4.77,
    "percentUsed": 52.3,
    "warning": false,
    "full": false,
    "numObjects": 1523
  },
  "message": "Relay storage OK"
}
```

### Configuration Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `X402_PAY_TO_ADDRESS` | Ethereum address to receive payments | Yes (for subscriptions) |
| `X402_NETWORK` | Blockchain network (base-sepolia, base, polygon, polygon-amoy) | Yes |
| `X402_SETTLEMENT_MODE` | Settlement mode: 'facilitator' or 'direct' | No (default: facilitator) |
| `X402_FACILITATOR_URL` | x402 facilitator service URL | No (default: https://x402.org/facilitator) |
| `X402_FACILITATOR_API_KEY` | API key for facilitator service | No |
| `X402_PRIVATE_KEY` | Private key for direct settlement (must have ETH for gas) | Required for direct mode |
| `X402_RPC_URL` | Custom RPC URL for blockchain access | No (uses public RPC) |
| `RELAY_GUN_USERNAME` | GunDB username for relay user | No (default: shogun-relay) |
| `RELAY_GUN_PASSWORD` | GunDB password for relay user | No (default: ADMIN_PASSWORD) |
| `RELAY_MAX_STORAGE_GB` | Maximum total IPFS storage in GB (0 = unlimited) | No (default: 0) |
| `RELAY_STORAGE_WARNING_THRESHOLD` | Percentage at which storage warnings appear | No (default: 80) |

### API Usage Examples

#### Get Available Tiers
```bash
curl http://localhost:8765/api/v1/x402/tiers
```

#### Get Payment Requirements
```bash
curl http://localhost:8765/api/v1/x402/payment-requirements/basic
```

#### Check Subscription Status
```bash
curl http://localhost:8765/api/v1/x402/subscription/0x1234...
```

#### Purchase Subscription (with signed payment)
```bash
curl -X POST http://localhost:8765/api/v1/x402/subscribe \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "0x1234...",
    "tier": "basic",
    "payment": {
      "x402Version": 1,
      "scheme": "exact",
      "network": "base-sepolia",
      "payload": {
        "authorization": { ... },
        "signature": "0x..."
      }
    }
  }'
```

#### Check Storage Usage
```bash
curl http://localhost:8765/api/v1/x402/storage/0x1234...
```

#### Check Relay Global Storage
```bash
curl http://localhost:8765/api/v1/x402/relay-storage
```

#### Check Relay Storage Detailed (admin)
```bash
curl -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  http://localhost:8765/api/v1/x402/relay-storage/detailed
```

### Security Considerations

1. **Relay User Isolation**: Subscription data is stored in relay's user space, preventing users from modifying their own subscriptions
2. **Payment Verification**: All payments are verified before subscription activation
3. **Storage Limits**: Uploads are checked against subscription limits before allowing storage
4. **Time Windows**: Payment authorizations have expiration times to prevent stale payments
5. **On-Chain Settlement**: Actual USDC transfer happens on-chain, providing cryptographic proof

### Integration with IPFS Uploads

When users upload files via `/api/v1/ipfs/upload`:
1. System checks subscription status before accepting upload
2. File is pinned to IPFS and hash is saved to GunDB
3. Storage usage is automatically tracked in `storageUsedMB`
4. Upload record is stored in `relayUser.x402.uploads[userAddress][hash]`
5. Files are protected from garbage collection while subscription is active

---

## Network Federation & Storage Proofs

Shogun Relay supports decentralized storage protocol features inspired by Swarm and Filecoin:

### Architecture Overview

```
┌────────────────┐      GunDB Sync      ┌────────────────┐
│   Relay A      │◀────────────────────▶│   Relay B      │
│   (IPFS Node)  │                      │   (IPFS Node)  │
└───────┬────────┘                      └───────┬────────┘
        │                                       │
        │         Pin Coordination              │
        └───────────────────────────────────────┘
                         │
                    ┌────┴────┐
                    │ Relay C │
                    └─────────┘
```

### Relay Discovery

Relays automatically announce themselves to the network via GunDB's native sync:

```bash
# List all active relays
curl http://localhost:8765/api/v1/network/relays

# Get specific relay info
curl http://localhost:8765/api/v1/network/relay/192.168.1.100

# Network-wide statistics
curl http://localhost:8765/api/v1/network/stats
```

**Response Example** (`/network/relays`):
```json
{
  "success": true,
  "count": 3,
  "relays": [
    {
      "host": "192.168.1.100",
      "endpoint": "http://192.168.1.100:8765",
      "lastSeen": 1701234567890,
      "uptime": 86400,
      "connections": { "total": 150, "active": 12 },
      "ipfs": {
        "connected": true,
        "repoSizeMB": 512,
        "numPins": 234
      }
    }
  ]
}
```

### Storage Proofs

Verify that a relay actually stores specific content:

```bash
# Generate storage proof for a CID
curl http://localhost:8765/api/v1/network/proof/QmHash123

# Verify a proof from another relay
curl -X POST http://localhost:8765/api/v1/network/verify-proof \
  -H "Content-Type: application/json" \
  -d '{"proof": {...}}'
```

**Proof Response**:
```json
{
  "success": true,
  "proof": {
    "cid": "QmHash123",
    "challenge": "a1b2c3d4...",
    "timestamp": 1701234567890,
    "proofHash": "sha256...",
    "block": { "size": 1048576, "key": "QmHash123" },
    "isPinned": true,
    "verification": {
      "method": "sha256(cid:challenge:timestamp:size)",
      "validFor": 300000,
      "expiresAt": 1701234867890
    }
  }
}
```

### Pin Coordination

Request other relays to replicate content:

```bash
# Request network to pin a CID (admin)
curl -X POST http://localhost:8765/api/v1/network/pin-request \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"cid": "QmHash123", "replicationFactor": 3}'

# List pending pin requests
curl http://localhost:8765/api/v1/network/pin-requests

# Respond to a pin request
curl -X POST http://localhost:8765/api/v1/network/pin-response \
  -H "Content-Type: application/json" \
  -d '{"requestId": "abc123", "status": "completed"}'
```

### GunDB Data Structure

Network data is stored in GunDB's native sync namespace:

```javascript
// Relay registry (auto-synced between peers)
gun.get('relays').get(host) = {
  pulse: {
    timestamp, uptime, memory, connections,
    relay: { host, port, name, version },
    ipfs: { connected, repoSizeMB, numPins }
  }
}

// Pin coordination (message bus)
gun.get('shogun-network').get('pin-requests').get(requestId) = {
  cid, requester, replicationFactor, priority, timestamp, status
}
```

### Key Points

1. **No Replication Duplication**: Uses GunDB's native sync, not custom replication
2. **IPFS Independent**: Storage proofs verify IPFS content separately from GunDB
3. **Decentralized Coordination**: Pin requests propagate via GunDB pub/sub
4. **Challenge-Response Proofs**: Simple SHA256-based proofs with expiration

---

## Reputation System

The relay reputation system tracks and scores relays based on their reliability, helping choose the best nodes for data replication.

### Score Components

| Component | Weight | Description |
|-----------|--------|-------------|
| Uptime | 30% | Pulse consistency over time |
| Proof Success | 25% | Storage proof reliability |
| Response Time | 20% | Speed of proof generation |
| Pin Fulfillment | 15% | Honoring replication requests |
| Longevity | 10% | Time in network (max 1 year) |

### Reputation Tiers

| Tier | Score Range | Description |
|------|-------------|-------------|
| Excellent | 90-100 | Highly reliable, preferred for critical data |
| Good | 75-89 | Reliable, suitable for most replication |
| Average | 50-74 | Acceptable, may have occasional issues |
| Poor | 25-49 | Unreliable, avoid for important data |
| Unreliable | 0-24 | Do not use for replication |

### API Usage

```bash
# Get reputation leaderboard
curl http://localhost:8765/api/v1/network/reputation

# Get specific relay reputation
curl http://localhost:8765/api/v1/network/reputation/192.168.1.100

# Get best relays for replication
curl "http://localhost:8765/api/v1/network/best-relays?count=3&minScore=70"

# Record a proof event (when verifying other relays)
curl -X POST http://localhost:8765/api/v1/network/reputation/record-proof \
  -H "Content-Type: application/json" \
  -d '{"host": "192.168.1.100", "success": true, "responseTimeMs": 150}'
```

### Response Example (`/network/reputation/:host`)

```json
{
  "success": true,
  "host": "192.168.1.100",
  "reputation": {
    "host": "192.168.1.100",
    "firstSeenTimestamp": 1700000000000,
    "lastSeenTimestamp": 1701234567890,
    "dataPoints": 1523,
    "proofsTotal": 456,
    "proofsSuccessful": 450,
    "proofsFailed": 6,
    "avgResponseTimeMs": 234,
    "pinRequestsReceived": 89,
    "pinRequestsFulfilled": 85,
    "uptimePercent": 98.5,
    "calculatedScore": {
      "total": 87.3,
      "tier": "good",
      "breakdown": {
        "uptime": 98.5,
        "proofSuccess": 98.7,
        "responseTime": 75.2,
        "pinFulfillment": 95.5,
        "longevity": 45.2
      },
      "hasEnoughData": true
    }
  }
}
```

### GunDB Data Structure

```javascript
gun.get('shogun-network').get('reputation').get(host) = {
  host: '192.168.1.100',
  firstSeenTimestamp: timestamp,
  lastSeenTimestamp: timestamp,
  dataPoints: 1523,
  // Proof metrics
  proofsTotal: 456,
  proofsSuccessful: 450,
  proofsFailed: 6,
  // Response time
  avgResponseTimeMs: 234,
  responseTimeSamples: 456,
  // Pin fulfillment
  pinRequestsReceived: 89,
  pinRequestsFulfilled: 85,
  // Uptime
  expectedPulses: 2880,
  receivedPulses: 2837,
  uptimePercent: 98.5,
  // Cached score
  score: 87.3,
  tier: 'good',
  lastScoreUpdate: timestamp
}
```

### Auto-Tracking

The relay automatically:
- Records its own pulse every 30 seconds
- Updates its reputation score periodically
- Initializes reputation tracking on startup

When verifying proofs from other relays, call `/reputation/record-proof` to track their reliability.

---

## Verified (Frozen) Data System

The relay supports immutable, cryptographically verified data using GunDB's SEA (Security, Encryption, Authorization) and content-addressed storage.

### Why Frozen Data?

Regular GunDB nodes can be modified by anyone. Frozen data solves this by:

1. **Content-Addressed Storage**: Data is stored at a hash derived from its content
2. **Cryptographic Signatures**: Each entry is signed by its author using SEA
3. **Verification**: Anyone can verify authenticity without trusting the source

### How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    FROZEN DATA FLOW                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. Relay creates announcement                               │
│     { host, port, ipfs: {...}, capabilities: [...] }        │
│                                                              │
│  2. Sign with SEA keypair                                    │
│     signature = SEA.sign(data, keypair)                     │
│                                                              │
│  3. Create content hash                                      │
│     hash = SHA-256(data)                                    │
│                                                              │
│  4. Store in frozen space                                    │
│     gun.get('#relay-announcements').get(hash).put({         │
│       data, sig, hash                                       │
│     })                                                       │
│                                                              │
│  5. Update index                                             │
│     gun.get('shogun-index').get('relay-announcements')      │
│        .get(host).put({ latestHash, pub })                  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Verification Process

```javascript
// Anyone can verify:
const entry = await gun.get('#relay-announcements').get(hash);

// 1. Verify signature matches claimed author
const signatureValid = await SEA.verify(entry.sig, entry.data._meta.pub);

// 2. Verify hash matches content
const expectedHash = SHA256(entry.data);
const hashValid = (expectedHash === hash);

// Entry is authentic only if BOTH checks pass
const verified = signatureValid && hashValid;
```

### API Usage

```bash
# List verified relay announcements
curl http://localhost:8765/api/v1/network/verified/relays

# Get verified announcement for specific relay
curl http://localhost:8765/api/v1/network/verified/relay/192.168.1.100

# Create signed observation about another relay
curl -X POST http://localhost:8765/api/v1/network/verified/observation \
  -H "Content-Type: application/json" \
  -d '{
    "observedHost": "192.168.1.200",
    "observation": {
      "proofsSuccessful": 45,
      "proofsFailed": 2,
      "avgResponseTimeMs": 150
    }
  }'

# Get aggregated reputation from verified observations
curl http://localhost:8765/api/v1/network/verified/observations/192.168.1.200

# Verify any frozen entry by hash
curl http://localhost:8765/api/v1/network/verified/entry/relay-announcements/abc123...
```

### Response Example (`/verified/relay/:host`)

```json
{
  "success": true,
  "host": "192.168.1.100",
  "verified": true,
  "verificationDetails": {
    "signatureValid": true,
    "hashValid": true
  },
  "data": {
    "type": "relay-announcement",
    "host": "192.168.1.100",
    "port": 8765,
    "ipfs": { "connected": true, "repoSizeMB": 512 },
    "capabilities": ["ipfs-pin", "storage-proof", "x402-subscription"],
    "_meta": {
      "pub": "relay_public_key...",
      "timestamp": 1701234567890,
      "version": 1
    }
  },
  "hash": "abc123...",
  "pub": "relay_public_key..."
}
```

### GunDB Data Structure

```javascript
// Frozen space (content-addressed, immutable)
gun.get('#relay-announcements').get(hash) = {
  data: { host, port, ipfs, _meta: { pub, timestamp } },
  sig: 'SEA_signature...',
  hash: 'content_hash...'
}

// Index (points to latest frozen entry)
gun.get('shogun-index').get('relay-announcements').get(host) = {
  latestHash: 'abc123...',
  pub: 'relay_public_key...',
  updatedAt: timestamp
}

// Observations index
gun.get('shogun-index').get('observations-by-host').get(observedHost).get(observerPub) = {
  hash: 'observation_hash...',
  updatedAt: timestamp
}
```

### Security Guarantees

| Threat | Protection |
|--------|------------|
| Data tampering | Content hash changes if data modified |
| Impersonation | Signature verification requires private key |
| Replay attacks | Timestamps in signed data |
| Spam | Entries are traceable to public keys |

### Comparison: Regular vs Frozen Data

| Aspect | Regular GunDB | Frozen Data |
|--------|---------------|-------------|
| Modifiable | Anyone | Only author (via new entry) |
| Verifiable | No | Yes (signature + hash) |
| Immutable | No | Yes (content-addressed) |
| Discovery | Direct key | Index lookup |
| Storage | Key-value | Hash-addressed |

---

## On-Chain Relay Registry

The ShogunRelayRegistry smart contract provides on-chain relay discovery, staking, and slashing on **Base Sepolia** (testnet) and **Base** (mainnet).

### Contract Addresses

| Network | Chain ID | Registry | USDC |
|---------|----------|----------|------|
| Base Sepolia | 84532 | `0x412D3Cf47907C231EE26D261714D2126eb3735e6` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Base Mainnet | 8453 | TBD | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

### Features

- **Relay Registration**: Operators register with endpoint URL, GunDB pubkey, and USDC stake
- **Staking**: Minimum 100 USDC stake (anti-spam, skin-in-the-game)
- **Storage Deals**: On-chain deal registration for dispute resolution
- **Slashing**: Economic penalties for missed proofs (1%) and data loss (10%)
- **Discovery**: Query active relays directly from the blockchain

### API Usage

```bash
# Get all registered relays from on-chain registry
curl "http://localhost:8765/api/v1/network/onchain/relays"

# With specific chain (default: 84532 = Base Sepolia)
curl "http://localhost:8765/api/v1/network/onchain/relays?chainId=84532"

# Get relay info by wallet address
curl "http://localhost:8765/api/v1/network/onchain/relay/0xYourRelayAddress"

# Get registry parameters
curl "http://localhost:8765/api/v1/network/onchain/params"

# Get deals for a relay
curl "http://localhost:8765/api/v1/network/onchain/deals/relay/0xRelayAddress"

# Get deals for a client
curl "http://localhost:8765/api/v1/network/onchain/deals/client/0xClientAddress"
```

### Response Example (`/onchain/relays`)

```json
{
  "success": true,
  "chainId": 84532,
  "registryAddress": "0x412D3Cf47907C231EE26D261714D2126eb3735e6",
  "relayCount": 3,
  "relays": [
    {
      "address": "0x1234...",
      "owner": "0x1234...",
      "endpoint": "https://relay1.shogun.network",
      "gunPubKey": "abc123...",
      "stakedAmount": "100.00",
      "registeredAt": "2024-01-15T10:30:00.000Z",
      "status": "Active",
      "totalDeals": 42,
      "totalSlashed": "0.00"
    }
  ],
  "registryParams": {
    "minStake": "100.00",
    "unstakingDelay": 604800,
    "unstakingDelayDays": 7
  }
}
```

### Why On-Chain Registry?

1. **Bootstrap Problem Solved**: New users can discover relays without knowing any relay first
2. **Trustless Discovery**: Anyone can read from the blockchain
3. **Economic Security**: Staking provides skin-in-the-game
4. **Slashing**: Bad actors lose their stake
5. **Deal Protection**: On-chain deals enable dispute resolution

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│              CLIENT APP (New User)                          │
├─────────────────────────────────────────────────────────────┤
│  1. Query ShogunRelayRegistry on Base                       │
│     → getActiveRelays()                                     │
│                                                              │
│  2. Receive list of relays with endpoints                   │
│     → [{address, endpoint, stake, gunPubKey}, ...]          │
│                                                              │
│  3. Connect to relay via endpoint                           │
│     → GunDB sync, IPFS storage                              │
│                                                              │
│  4. Create storage deal (optional)                          │
│     → Relay registers deal on-chain for protection          │
└─────────────────────────────────────────────────────────────┘
```

---

## Storage Deals

Storage Deals provide per-file contracts as an alternative/complement to subscriptions. They offer:
- Per-file pricing and duration
- Erasure coding for redundancy
- Multi-relay replication
- Payment via x402

### Pricing Tiers

| Tier | Price/MB/Month | Features |
|------|----------------|----------|
| Standard | $0.0001 | Basic storage, 1x replication |
| Premium | $0.0002 | Erasure coding, 3x replication |
| Enterprise | $0.0005 | Erasure coding, 5x replication, SLA |

### Deal Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      DEAL LIFECYCLE                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. CREATE DEAL                                              │
│     POST /deals/create                                       │
│     → Returns dealId + x402 payment requirements            │
│                                                              │
│  2. PAY                                                      │
│     User signs x402 payment with wallet                     │
│                                                              │
│  3. ACTIVATE                                                 │
│     POST /deals/:dealId/activate                            │
│     → Verifies payment, activates deal                      │
│                                                              │
│  4. STORE                                                    │
│     Upload file to IPFS                                     │
│     (optionally with erasure coding)                        │
│                                                              │
│  5. RENEW (optional)                                         │
│     POST /deals/:dealId/renew                               │
│     → Extends deal duration                                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### API Usage

```bash
# Get pricing quote
curl "http://localhost:8765/api/v1/deals/pricing?sizeMB=100&durationDays=30&tier=premium"

# Calculate erasure overhead
curl "http://localhost:8765/api/v1/deals/overhead?sizeMB=100"

# Create deal (returns payment requirements)
curl -X POST http://localhost:8765/api/v1/deals/create \
  -H "Content-Type: application/json" \
  -d '{
    "cid": "QmYourCid...",
    "clientAddress": "0xYourAddress",
    "sizeMB": 100,
    "durationDays": 30,
    "tier": "premium"
  }'

# Activate deal with payment
curl -X POST http://localhost:8765/api/v1/deals/deal_xyz/activate \
  -H "Content-Type: application/json" \
  -d '{"payment": {...x402PaymentPayload...}}'

# Check deal status
curl http://localhost:8765/api/v1/deals/deal_xyz

# Get all deals for a client
curl http://localhost:8765/api/v1/deals/by-client/0xYourAddress
```

### Deals vs Subscriptions

| Aspect | Subscriptions | Deals |
|--------|---------------|-------|
| Model | Monthly quota | Per-file contract |
| Pricing | Fixed tiers | Dynamic (size + duration) |
| Duration | 30 days rolling | Custom per deal |
| Erasure Coding | No | Optional (Premium+) |
| Multi-Relay | No | Yes (replication factor) |
| Use Case | General storage | Critical files |

---

## Erasure Coding

Erasure coding provides data redundancy by splitting files into chunks with parity data.

### How It Works

```
Original File (10MB)
        │
        ▼
┌───────────────────────────────────────┐
│  Split into 10 data chunks            │
│  Generate 4 parity chunks (40% extra) │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│  14 total chunks distributed across   │
│  multiple relays                      │
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────┐
│  Recovery: Need only 10 of 14 chunks  │
│  Can lose up to 4 chunks/relays       │
└───────────────────────────────────────┘
```

### Configuration

```javascript
const DEFAULT_CONFIG = {
  chunkSize: 256 * 1024,    // 256KB per chunk
  dataChunks: 10,            // Number of data chunks
  parityChunks: 4,           // 40% redundancy
};
```

### Overhead Calculation

```bash
curl "http://localhost:8765/api/v1/deals/overhead?sizeMB=100"

# Response:
{
  "overhead": {
    "originalSize": 104857600,
    "dataChunks": 400,
    "parityChunks": 4,
    "totalChunks": 404,
    "overheadPercent": 1,
    "redundancyPercent": 1
  }
}
```

### Recovery Process

If chunks are lost:
1. Collect available chunks from relays
2. If >= 10 chunks available, reconstruct data
3. Use parity chunks to recover missing data chunks
4. Rebuild original file

---

## Roadmap: Version 2.0

The next major version will introduce tokenomics and decentralized governance.

### Native Token: $SHOGUN

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

### Protocol Fee Structure (v2)

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

### DAO Governance

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

### Staking Rewards

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

### Smart Contracts (v2)

| Contract | Purpose |
|----------|---------|
| `ShogunToken.sol` | ERC-20 token with voting |
| `ShogunStaking.sol` | Stake tokens, earn rewards |
| `ShogunGovernor.sol` | DAO governance (OpenZeppelin) |
| `ShogunTreasury.sol` | Protocol fee collection |
| `ShogunRelayRegistry.sol` | Updated for token staking |

### Migration Path

**Phase 1: Testnet (Current)**
- USDC staking
- No protocol fees
- Centralized parameters

**Phase 2: Token Launch**
- $SHOGUN token deployed
- Dual staking (USDC or $SHOGUN)
- Protocol fees activated
- DAO treasury live

**Phase 3: Full Decentralization**
- USDC staking deprecated
- $SHOGUN-only staking
- Full DAO control
- Multi-chain expansion

### Timeline (Estimated)

| Milestone | Target |
|-----------|--------|
| Token design finalized | Q1 2025 |
| Testnet with token | Q2 2025 |
| Mainnet token launch | Q3 2025 |
| DAO governance live | Q4 2025 |

---

## Development Notes

Project structure:

```
shogun-relay/
├── relay/
│   ├── src/
│   │   ├── index.js          # Express + Gun bootstrap
│   │   ├── routes/           # REST endpoints
│   │   └── public/           # Admin & utility frontends
├── docker/                   # Compose utilities and helper scripts
└── README.md
```

Recommended workflow:
1. Run `npm run dev` while editing frontends (refresh browser to reload).
2. Use the Pin Manager and Upload UI to exercise the IPFS endpoints.
3. Tail the server logs or hit `/api/v1/system/logs` for debugging.

---

## Troubleshooting

| Issue | Command / Tip |
|-------|---------------|
| Gun clients fail to connect | `wscat -c ws://localhost:8765/gun` |
| IPFS API unauthorized | Ensure `IPFS_API_TOKEN` matches the daemon JWT (`cat /tmp/ipfs-jwt-token`). |
| Admin UI shows “token required” | Visit `/admin`, enter the token once, then reload the target page. |
| Batch pin removal slow | The Pin Manager intentionally throttles requests (`100ms`) to avoid overloading IPFS. |

---

## Contributing

1. Fork the repository.
2. Create a branch for your feature or fix.
3. Add tests or sample scripts when relevant.
4. Submit a pull request describing the change and testing steps.

Community feedback is welcome via issues or discussions.

---

## License

MIT License © Shogun contributors. See [LICENSE](LICENSE) for details.
