# Shogun Relay - Environment Variables Reference

This document provides a comprehensive reference of all environment variables that can be configured for Shogun Relay.

## Table of Contents

1. [Required Configuration](#required-configuration)
2. [Module Enable Flags](#module-enable-flags)
3. [Relay Identity](#relay-identity)
4. [IPFS Configuration](#ipfs-configuration)
5. [GunDB Configuration](#gundb-configuration)
6. [On-Chain Registry](#on-chain-registry)
7. [x402 Payment Configuration](#x402-payment-configuration)
8. [Pricing Configuration](#pricing-configuration)
   - [Storage Deals Pricing](#storage-deals-pricing)
   - [Subscription Pricing](#subscription-pricing)
9. [Storage Limits](#storage-limits)
10. [Network Federation](#network-federation)
11. [Holster Relay](#holster-relay)
12. [Advanced Options](#advanced-options)
13. [Quick Reference Table](#quick-reference-table)
14. [Environment File Setup](#environment-file-setup)
15. [Validation](#validation)
16. [Security Considerations](#security-considerations)
17. [Related Documentation](#related-documentation)

---

## Module Enable Flags

Shogun Relay supports modular configuration. Each module can be independently enabled or disabled via environment variables. When a module is disabled, its routes return `503 Service Unavailable`.

### `IPFS_ENABLED`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Enable IPFS integration (gateway proxy, upload, pin). When disabled, all `/api/v1/ipfs/*` routes return 503.
- **Example**: `IPFS_ENABLED=true`

### `HOLSTER_ENABLED`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Enable Holster (Nostr NIP-01 relay). When disabled, the WebSocket relay is not started.
- **Example**: `HOLSTER_ENABLED=true`

### `X402_ENABLED`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Enable x402 payment/subscription system. When disabled, all `/api/v1/x402/*` routes return 503.
- **Example**: `X402_ENABLED=true`

### `REGISTRY_ENABLED`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Enable on-chain registry functionality (staking, registration). When disabled, all `/api/v1/registry/*` routes return 503.
- **Example**: `REGISTRY_ENABLED=true`

### `DEALS_ENABLED`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Enable storage deals. When disabled, all `/api/v1/deals/*` routes return 503.
- **Example**: `DEALS_ENABLED=true`

### `WORMHOLE_ENABLED`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Enable wormhole P2P file transfer and cleanup scheduler.
- **Example**: `WORMHOLE_ENABLED=true`

### `ANNAS_ARCHIVE_ENABLED`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Enable Anna's Archive integration (torrent/preservation). When disabled, all `/api/v1/annas-archive/*` routes return 503.
- **Example**: `ANNAS_ARCHIVE_ENABLED=true`

### Module Dependencies

| Module | Dependencies |
|--------|-------------|
| IPFS | None |
| Holster | None |
| X402 | Gun (always enabled) |
| Registry | Gun |
| Deals | Gun, IPFS |
| Wormhole | Gun |
| Anna's Archive | Gun, IPFS |

---

## Required Configuration

### `ADMIN_PASSWORD`
- **Type**: String
- **Required**: Yes
- **Default**: None
- **Description**: Shared token for all admin routes and dashboards. Used for API authentication and dashboard access.
- **Example**: `ADMIN_PASSWORD=your_secure_admin_password_here`
- **Generate**: `openssl rand -hex 32`

---

## Relay Identity

### `RELAY_HOST`
- **Type**: String
- **Required**: No
- **Default**: Auto-detected IP address
- **Description**: Public hostname or IP address for the relay. Used for network discovery and peer connections. Automatically removes `http://` or `https://` prefixes if present.
- **Example**: `RELAY_HOST=relay.example.com` or `RELAY_HOST=192.168.1.100`

### `RELAY_ENDPOINT`
- **Type**: String
- **Required**: No
- **Default**: `RELAY_HOST` (if set)
- **Description**: Alternative to `RELAY_HOST`, used as fallback when `RELAY_HOST` is not set. Full endpoint URL for the relay.
- **Example**: `RELAY_ENDPOINT=https://relay.example.com:8765`

### `RELAY_PORT`
- **Type**: Integer
- **Required**: No
- **Default**: `8765`
- **Description**: HTTP port for the Shogun Relay server. Must be a valid port number (1-65535).
- **Example**: `RELAY_PORT=8765`

### `PORT`
- **Type**: Integer
- **Required**: No
- **Default**: `RELAY_PORT` (if set) or `8765`
- **Description**: Alternative to `RELAY_PORT`. Standard port environment variable, used as fallback.

### `RELAY_NAME`
- **Type**: String
- **Required**: No
- **Default**: `shogun-relay`
- **Description**: Display name for your relay. Shown in network listings, logs, and status endpoints.
- **Example**: `RELAY_NAME=MyRelay`

---

## IPFS Configuration

### `IPFS_API_URL`
- **Type**: String (URL)
- **Required**: No
- **Default**: `http://127.0.0.1:5001`
- **Description**: IPFS API endpoint. Used for all IPFS operations (pin, unpin, upload, etc.).
- **Example**: `IPFS_API_URL=http://127.0.0.1:5001` or `IPFS_API_URL=https://ipfs.example.com/api/v0`

### `IPFS_GATEWAY_URL`
- **Type**: String (URL)
- **Required**: No
- **Default**: `http://127.0.0.1:8080`
- **Description**: IPFS Gateway URL for content retrieval and preview. Used for serving IPFS content to clients.
- **Example**: `IPFS_GATEWAY_URL=http://127.0.0.1:8080` or `IPFS_GATEWAY_URL=https://ipfs.io`

### `IPFS_API_TOKEN`
- **Type**: String (JWT)
- **Required**: No
- **Default**: None
- **Description**: Optional JWT token for IPFS API authentication. Required if IPFS node has authentication enabled.
- **Example**: `IPFS_API_TOKEN=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

### `IPFS_API_KEY`
- **Type**: String
- **Required**: No
- **Default**: None
- **Description**: Optional API key for IPFS API authentication. Legacy option; prefer `IPFS_API_TOKEN` for JWT authentication.
- **Example**: `IPFS_API_KEY=your_api_key_here`

### `IPFS_PATH`
- **Type**: String (Directory Path)
- **Required**: No
- **Default**: `/data/ipfs` (Docker) or `~/.ipfs` (manual)
- **Description**: IPFS repository path. Used internally by IPFS daemon. Typically only set in Docker containers.
- **Example**: `IPFS_PATH=/data/ipfs`

### `IPFS_PIN_TIMEOUT_MS`
- **Type**: Integer
- **Required**: No
- **Default**: `120000` (120 seconds / 2 minutes)
- **Description**: Timeout in milliseconds for IPFS pin operations. When pinning a CID, IPFS may need to fetch the content from the network, which can take time. Increase this value if you frequently encounter timeout errors when pinning CIDs that need to be fetched from the network.
- **Example**: `IPFS_PIN_TIMEOUT_MS=180000` (3 minutes)

---

## GunDB Configuration

### `RELAY_SEA_KEYPAIR`
- **Type**: String (JSON)
- **Required**: Yes (unless `RELAY_SEA_KEYPAIR_PATH` is set)
- **Default**: None
- **Description**: Direct SEA (Security, Encryption, Authorization) keypair as JSON string. Used for relay authentication in GunDB and frozen data operations. Prevents "Signature did not match" errors.
- **Format**: `'{"pub":"...","priv":"...","epub":"...","epriv":"..."}'`
- **Example**: `RELAY_SEA_KEYPAIR='{"pub":"abc123...","priv":"def456...","epub":"ghi789...","epriv":"jkl012..."}'`
- **Generate**: Use `node scripts/generate-relay-keys.js` or programmatically with Gun.SEA.pair()

### `RELAY_SEA_KEYPAIR_PATH`
- **Type**: String (File Path)
- **Required**: No (alternative to `RELAY_SEA_KEYPAIR`)
- **Default**: None
- **Description**: Path to a JSON file containing the SEA keypair. If file doesn't exist, a new keypair will be generated automatically.
- **Example**: `RELAY_SEA_KEYPAIR_PATH=/path/to/relay-keypair.json` or `RELAY_SEA_KEYPAIR_PATH=./keys/relay-keypair.json`

### `RELAY_PEERS`
- **Type**: String (Comma-separated URLs)
- **Required**: No
- **Default**: None
- **Description**: Comma-separated list of upstream GunDB peers to sync with. Other relay endpoints for data replication.
- **Example**: `RELAY_PEERS=https://relay1.example.com/gun,https://relay2.example.com/gun`

### `RELAY_PROTECTED`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `true`
- **Description**: Require admin token for Gun writes. When `true`, only requests with valid `ADMIN_PASSWORD` can write to GunDB. Recommended for production.
- **Values**: `"true"` or `"false"`
- **Example**: `RELAY_PROTECTED=true`

### `STORAGE_TYPE`
- **Type**: String
- **Required**: No
- **Default**: `sqlite`
- **Description**: Storage backend for GunDB persistence. SQLite provides better performance and reliability than RADISK.
- **Values**: `"sqlite"` or `"radisk"`
- **Example**: `STORAGE_TYPE=sqlite`

### `DATA_DIR`
- **Type**: String (Directory Path)
- **Required**: No
- **Default**: `./data`
- **Description**: Data directory for GunDB persistence. SQLite database (`gun.db`) or RADISK files (`radata/`) are stored here.
- **Example**: `DATA_DIR=./data` or `DATA_DIR=/var/lib/shogun-relay/data`

### `DISABLE_RADISK`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Disable RADISK persistence (legacy storage). Only effective when `STORAGE_TYPE=radisk`. Set to `"true"` to disable for debugging.
- **Values**: `"true"` or `"false"`
- **Example**: `DISABLE_RADISK=false`

### `CLEANUP_CORRUPTED_DATA`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Auto-cleanup corrupted data on startup. When enabled, corrupted GunDB entries are automatically removed.
- **Values**: `"true"` or `"false"`
- **Example**: `CLEANUP_CORRUPTED_DATA=false`

### `RELAY_GUN_USERNAME`
- **Type**: String
- **Required**: No
- **Default**: `shogun-relay`
- **Description**: GunDB username for relay user (used for x402 subscriptions). Legacy option; direct keypair authentication is preferred.

### `RELAY_GUN_PASSWORD`
- **Type**: String
- **Required**: No
- **Default**: `ADMIN_PASSWORD` (if set)
- **Description**: GunDB password for relay user (used for x402 subscriptions). Legacy option; direct keypair authentication is preferred.

### `RELAY_QR`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Enable QR code generation for relay connection details.
- **Values**: `"true"` or `"false"`
- **Example**: `RELAY_QR=false`

### `RELAY_STORE`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `true`
- **Description**: Enable file storage functionality.
- **Values**: `"true"` or `"false"`
- **Example**: `RELAY_STORE=true`

### `RELAY_PATH`
- **Type**: String (Directory Path)
- **Required**: No
- **Default**: `public`
- **Description**: Path to public directory containing admin dashboards and static files.
- **Example**: `RELAY_PATH=public` or `RELAY_PATH=./src/public`

---

## On-Chain Registry

### `RELAY_PRIVATE_KEY`
- **Type**: String (Hex)
- **Required**: No (required for on-chain operations)
- **Default**: None
- **Description**: Your wallet private key for on-chain operations. Used for relay registration, staking, deal registration, and slashing. **WARNING**: Keep this secret! Never commit to git!
- **Example**: `RELAY_PRIVATE_KEY=0x1234567890abcdef...`
- **Generate**: `node -e "console.log(require('ethers').Wallet.createRandom().privateKey)"`

### `REGISTRY_CHAIN_ID`
- **Type**: Integer
- **Required**: No
- **Default**: `84532` (Base Sepolia)
- **Description**: Chain ID for the registry contract. Determines which blockchain network to use.
- **Values**: 
  - `84532` = Base Sepolia (testnet)
  - `8453` = Base Mainnet
- **Example**: `REGISTRY_CHAIN_ID=84532`

### `USDC_ADDRESS`
- **Type**: String (Address)
- **Required**: No
- **Default**: Network-specific (Base Sepolia: `0x036CbD53842c5426634e7929541eC2318f3dCF7e`)
- **Description**: USDC token contract address. Usually auto-detected from `REGISTRY_CHAIN_ID`, but can be overridden.
- **Example**: `USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e`

---

## x402 Payment Configuration

### `X402_PAY_TO_ADDRESS`
- **Type**: String (Address)
- **Required**: Yes (for subscriptions/deals)
- **Default**: None
- **Description**: Ethereum address to receive subscription and deal payments. This is where USDC payments are sent.
- **Example**: `X402_PAY_TO_ADDRESS=0x1234567890123456789012345678901234567890`

### `X402_PRIVATE_KEY`
- **Type**: String (Hex)
- **Required**: Yes (for direct settlement mode)
- **Default**: None
- **Description**: Private key for settling x402 payments. Can be the same as `RELAY_PRIVATE_KEY` or different. Needs ETH for gas when using `direct` settlement mode.
- **Example**: `X402_PRIVATE_KEY=0x1234567890abcdef...`

### `X402_NETWORK`
- **Type**: String
- **Required**: No
- **Default**: `base-sepolia`
- **Description**: Blockchain network for x402 payments. Determines which network to use for payment verification and settlement.
- **Values**: 
  - `base-sepolia` (testnet)
  - `base` (mainnet)
  - `polygon`
  - `polygon-amoy`
- **Example**: `X402_NETWORK=base-sepolia`

### `X402_SETTLEMENT_MODE`
- **Type**: String
- **Required**: No
- **Default**: `facilitator`
- **Description**: Payment settlement mode. Determines how x402 payments are settled on-chain.
- **Values**: 
  - `facilitator` - Uses x402.org service (no gas needed, depends on external service)
  - `direct` - Settle locally (full control, needs ETH for gas)
- **Example**: `X402_SETTLEMENT_MODE=facilitator`

### `X402_FACILITATOR_URL`
- **Type**: String (URL)
- **Required**: No
- **Default**: `https://x402.org/facilitator`
- **Description**: Custom facilitator service URL for x402 payment settlement. Only used when `X402_SETTLEMENT_MODE=facilitator`.
- **Example**: `X402_FACILITATOR_URL=https://x402.org/facilitator`

### `X402_FACILITATOR_API_KEY`
- **Type**: String
- **Required**: No
- **Default**: None
- **Description**: API key for x402 facilitator service. Required if the facilitator service requires authentication.
- **Example**: `X402_FACILITATOR_API_KEY=your_api_key_here`

### `X402_RPC_URL`
- **Type**: String (URL)
- **Required**: No
- **Default**: Public RPC (network-specific)
- **Description**: Custom RPC URL for blockchain access. Overrides default public RPC endpoints.
- **Example**: `X402_RPC_URL=https://mainnet.base.org` or `X402_RPC_URL=https://sepolia.base.org`

---

## Pricing Configuration

### Storage Deals Pricing

#### `DEAL_PRICE_STANDARD`
- **Type**: Float
- **Required**: No
- **Default**: `0.0001`
- **Description**: Standard tier price per MB per month in USDC.
- **Example**: `DEAL_PRICE_STANDARD=0.0001`

#### `DEAL_PRICE_PREMIUM`
- **Type**: Float
- **Required**: No
- **Default**: `0.0002`
- **Description**: Premium tier price per MB per month in USDC. Includes erasure coding and higher replication.
- **Example**: `DEAL_PRICE_PREMIUM=0.0002`

#### `DEAL_PRICE_ENTERPRISE`
- **Type**: Float
- **Required**: No
- **Default**: `0.0005`
- **Description**: Enterprise tier price per MB per month in USDC. Includes erasure coding, highest replication, and SLA guarantees.
- **Example**: `DEAL_PRICE_ENTERPRISE=0.0005`

#### `DEAL_MIN_SIZE_MB`
- **Type**: Float
- **Required**: No
- **Default**: `0.001` (1 KB)
- **Description**: Minimum file size for deals in MB.
- **Example**: `DEAL_MIN_SIZE_MB=0.001`

#### `DEAL_MAX_SIZE_MB`
- **Type**: Float
- **Required**: No
- **Default**: 
  - Standard: `1000`
  - Premium: `10000`
  - Enterprise: `100000`
- **Description**: Maximum file size for deals in MB (tier-specific).
- **Example**: `DEAL_MAX_SIZE_MB=1000`

#### `DEAL_MIN_DURATION_DAYS`
- **Type**: Integer
- **Required**: No
- **Default**: `7`
- **Description**: Minimum deal duration in days.
- **Example**: `DEAL_MIN_DURATION_DAYS=7`

#### `DEAL_MAX_DURATION_DAYS`
- **Type**: Integer
- **Required**: No
- **Default**: 
  - Standard: `365`
  - Premium: `730`
  - Enterprise: `1825`
- **Description**: Maximum deal duration in days (tier-specific).
- **Example**: `DEAL_MAX_DURATION_DAYS=365`

#### `DEAL_PREMIUM_REPLICATION`
- **Type**: Integer
- **Required**: No
- **Default**: `3`
- **Description**: Replication factor for premium tier deals. Number of relay replicas.
- **Example**: `DEAL_PREMIUM_REPLICATION=3`

#### `DEAL_ENTERPRISE_REPLICATION`
- **Type**: Integer
- **Required**: No
- **Default**: `5`
- **Description**: Replication factor for enterprise tier deals. Number of relay replicas.
- **Example**: `DEAL_ENTERPRISE_REPLICATION=5`

### Subscription Pricing

#### `SUB_BASIC_PRICE`
- **Type**: Float
- **Required**: No
- **Default**: `0.001`
- **Description**: Basic subscription tier price in USDC (one-time payment).
- **Example**: `SUB_BASIC_PRICE=0.001`

#### `SUB_BASIC_STORAGE_MB`
- **Type**: Integer
- **Required**: No
- **Default**: `100`
- **Description**: Storage limit for basic subscription tier in MB.
- **Example**: `SUB_BASIC_STORAGE_MB=100`

#### `SUB_STANDARD_PRICE`
- **Type**: Float
- **Required**: No
- **Default**: `0.004`
- **Description**: Standard subscription tier price in USDC (one-time payment).
- **Example**: `SUB_STANDARD_PRICE=0.004`

#### `SUB_STANDARD_STORAGE_MB`
- **Type**: Integer
- **Required**: No
- **Default**: `500`
- **Description**: Storage limit for standard subscription tier in MB.
- **Example**: `SUB_STANDARD_STORAGE_MB=500`

#### `SUB_PREMIUM_PRICE`
- **Type**: Float
- **Required**: No
- **Default**: `0.01`
- **Description**: Premium subscription tier price in USDC (one-time payment).
- **Example**: `SUB_PREMIUM_PRICE=0.01`

#### `SUB_PREMIUM_STORAGE_MB`
- **Type**: Integer
- **Required**: No
- **Default**: `2000`
- **Description**: Storage limit for premium subscription tier in MB.
- **Example**: `SUB_PREMIUM_STORAGE_MB=2000`

#### `SUB_DURATION_DAYS`
- **Type**: Integer
- **Required**: No
- **Default**: `30`
- **Description**: Subscription duration in days (applies to all tiers).
- **Example**: `SUB_DURATION_DAYS=30`

---

## Storage Limits

### `RELAY_MAX_STORAGE_GB`
- **Type**: Float
- **Required**: No
- **Default**: `0` (unlimited)
- **Description**: Maximum total IPFS storage available on this relay in GB. If set to `0` or not set, no global limit is enforced. Subscription requests are rejected if relay storage is insufficient.
- **Example**: `RELAY_MAX_STORAGE_GB=10`

### `RELAY_STORAGE_WARNING_THRESHOLD`
- **Type**: Float
- **Required**: No
- **Default**: `80`
- **Description**: Warning threshold percentage. Users and admins are warned when relay storage usage exceeds this percentage.
- **Example**: `RELAY_STORAGE_WARNING_THRESHOLD=80`

---

## Network Federation

### `AUTO_REPLICATION`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `true`
- **Description**: Automatically pin content from network pin requests. Helps with data redundancy across the network. When enabled, the relay automatically replicates content requested by other relays.
- **Values**: `"true"` or `"false"`
- **Example**: `AUTO_REPLICATION=true`

### `DEAL_SYNC_ENABLED`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `true`
- **Description**: Enable automatic near real-time synchronization of storage deals with on-chain registry. When enabled, deals are synced from blockchain to GunDB using a two-tier system: fast sync (every 2 minutes) for quick updates and full sync (every 5 minutes) for complete verification.
- **Values**: `"true"` or `"false"`
- **Example**: `DEAL_SYNC_ENABLED=true`

### `DEAL_SYNC_INTERVAL_MS`
- **Type**: Integer
- **Required**: No
- **Default**: `300000` (5 minutes)
- **Description**: Interval in milliseconds for full deal synchronization. This performs a complete sync with all checks and detailed logging. Only used when `DEAL_SYNC_ENABLED=true`.
- **Example**: `DEAL_SYNC_INTERVAL_MS=300000` (5 minutes)

### `DEAL_SYNC_FAST_INTERVAL_MS`
- **Type**: Integer
- **Required**: No
- **Default**: `120000` (2 minutes)
- **Description**: Interval in milliseconds for fast deal synchronization. This performs a lightweight sync to quickly detect and sync new deals from on-chain to GunDB with minimal logging. Only used when `DEAL_SYNC_ENABLED=true`.
- **Example**: `DEAL_SYNC_FAST_INTERVAL_MS=120000` (2 minutes)

### `DEAL_SYNC_INITIAL_DELAY_MS`
- **Type**: Integer
- **Required**: No
- **Default**: `30000` (30 seconds)
- **Description**: Delay in milliseconds before starting the initial deal synchronization after relay startup. Gives IPFS time to initialize before syncing deals.
- **Example**: `DEAL_SYNC_INITIAL_DELAY_MS=30000` (30 seconds)

### `WORMHOLE_CLEANUP_ENABLED`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `true`
- **Description**: Enable automatic cleanup of orphaned wormhole file transfers. When enabled, files uploaded via the wormhole that haven't been downloaded after the max age are automatically unpinned from IPFS.
- **Values**: `"true"` or `"false"`
- **Example**: `WORMHOLE_CLEANUP_ENABLED=true`

### `WORMHOLE_CLEANUP_INTERVAL_MS`
- **Type**: Integer
- **Required**: No
- **Default**: `3600000` (1 hour)
- **Description**: Interval in milliseconds between wormhole cleanup runs. Controls how often the relay checks for orphaned transfers.
- **Example**: `WORMHOLE_CLEANUP_INTERVAL_MS=3600000` (1 hour)

### `WORMHOLE_MAX_AGE_SECS`
- **Type**: Integer
- **Required**: No
- **Default**: `86400` (24 hours)
- **Description**: Maximum age in seconds for wormhole transfers. Transfers older than this that haven't been completed are automatically unpinned from IPFS.
- **Example**: `WORMHOLE_MAX_AGE_SECS=86400` (24 hours)

---

## Holster Relay

### `HOLSTER_RELAY_HOST`
- **Type**: String
- **Required**: No
- **Default**: `0.0.0.0`
- **Description**: Holster relay host address. Holster is a WebSocket enhancement for GunDB.
- **Example**: `HOLSTER_RELAY_HOST=0.0.0.0`

### `HOLSTER_RELAY_PORT`
- **Type**: Integer
- **Required**: No
- **Default**: `RELAY_PORT + 1` (e.g., `8766` if `RELAY_PORT=8765`)
- **Description**: Holster relay port. Typically one port higher than the main relay port.
- **Example**: `HOLSTER_RELAY_PORT=8766`

### `HOLSTER_RELAY_STORAGE`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `true`
- **Description**: Enable persistent storage for Holster relay. When enabled, Holster data is persisted to disk.
- **Values**: `"true"` or `"false"`
- **Example**: `HOLSTER_RELAY_STORAGE=true`

### `HOLSTER_RELAY_STORAGE_PATH`
- **Type**: String (Directory Path)
- **Required**: No
- **Default**: `./holster-data`
- **Description**: Path for Holster data storage. Directory where Holster persistence files are stored.
- **Example**: `HOLSTER_RELAY_STORAGE_PATH=./holster-data` or `HOLSTER_RELAY_STORAGE_PATH=/var/lib/holster`

### `HOLSTER_MAX_CONNECTIONS`
- **Type**: Integer
- **Required**: No
- **Default**: `100`
- **Description**: Maximum number of concurrent connections for Holster relay.
- **Example**: `HOLSTER_MAX_CONNECTIONS=100`

---

## Advanced Options

### `STRICT_SESSION_IP`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `true`
- **Description**: Enable strict IP validation for admin sessions. When enabled, admin sessions are tied to the IP address that created them. Set to `"false"` to allow sessions from different IPs.
- **Values**: `"true"` or `"false"`
- **Example**: `STRICT_SESSION_IP=true`

### `ENABLE_METRICS`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: Not specified (feature flag)
- **Description**: Enable metrics collection and reporting. When enabled, additional metrics endpoints and data collection are active.
- **Values**: `"true"` or `"false"`
- **Example**: `ENABLE_METRICS=true`

### `DEBUG`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: Not set
- **Description**: Enable debug logging. When set, additional debug messages are printed to console.
- **Values**: Any non-empty string enables debug mode
- **Example**: `DEBUG=1` or `DEBUG=true`

### `NODE_ENV`
- **Type**: String
- **Required**: No
- **Default**: Not set
- **Description**: Node.js environment. Affects cookie security settings and other environment-specific behavior.
- **Values**: `development`, `production`, or `test`
- **Example**: `NODE_ENV=production`

### `WELCOME_MESSAGE`
- **Type**: String
- **Required**: No
- **Default**: Built-in ASCII art
- **Description**: Custom welcome message displayed on server startup. Overrides the default ASCII art welcome message.
- **Example**: `WELCOME_MESSAGE="My Custom Relay Starting..."`

### `NODE_OPTIONS`
- **Type**: String
- **Required**: No
- **Default**: None
- **Description**: Node.js runtime options. Useful for memory tuning in containers.
- **Example**: `NODE_OPTIONS=--max-old-space-size=512` (sets max heap size to 512MB)

### `VERBOSE_LOGGING`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Enable verbose logging output. When enabled, more detailed log messages are printed.
- **Values**: `"true"` or `"false"`
- **Example**: `VERBOSE_LOGGING=true`

### `LOG_LEVEL`
- **Type**: String
- **Required**: No
- **Default**: `info`
- **Description**: Set the logging level. Controls which log messages are displayed.
- **Values**: `error`, `warn`, `info`, `debug`, `trace`
- **Example**: `LOG_LEVEL=debug`

### `CORS_ORIGINS`
- **Type**: String (Comma-separated URLs)
- **Required**: No
- **Default**: `*` (allow all origins)
- **Description**: Whitelist of allowed CORS origins. Prevents CSRF attacks by only allowing requests from specified origins. Use `*` for development, specific origins for production.
- **Example**: `CORS_ORIGINS=https://myapp.com,https://admin.myapp.com`
- **Security**: In production, always specify exact origins instead of `*`

### `CORS_CREDENTIALS`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Allow credentials (cookies, authorization headers) in CORS requests. Set to `true` if your frontend needs to send authentication headers.
- **Values**: `"true"` or `"false"`
- **Example**: `CORS_CREDENTIALS=true`

---

## LocalTunnel Server

The LocalTunnel server allows users to expose local HTTP services via public URLs through the relay.

### `TUNNEL_ENABLED`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Enable LocalTunnel server. When disabled, all `/api/v1/tunnel/*` routes return 503.
- **Example**: `TUNNEL_ENABLED=true`

### `TUNNEL_DOMAIN`
- **Type**: String
- **Required**: No
- **Default**: None (uses server host)
- **Description**: Base domain for tunnel subdomains. Requires wildcard DNS record (`*.domain.com → server IP`).
- **Example**: `TUNNEL_DOMAIN=relay.shogun.network`

### `TUNNEL_PORT`
- **Type**: Integer
- **Required**: No
- **Default**: `0` (auto-assign)
- **Description**: Port for tunnel TCP connections. Set to `0` for auto-assignment.
- **Example**: `TUNNEL_PORT=0`

### `TUNNEL_SECURE`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Use HTTPS scheme for tunnel URLs.
- **Example**: `TUNNEL_SECURE=true`

### `TUNNEL_MAX_SOCKETS`
- **Type**: Integer
- **Required**: No
- **Default**: `10`
- **Description**: Maximum TCP connections per tunnel. Higher values allow more concurrent requests through a single tunnel.
- **Example**: `TUNNEL_MAX_SOCKETS=10`

### `TUNNEL_LANDING_PAGE`
- **Type**: String (URL)
- **Required**: No
- **Default**: `https://shogun.network`
- **Description**: Redirect URL for root tunnel requests without a subdomain.
- **Example**: `TUNNEL_LANDING_PAGE=https://yourdomain.com`

### `TUNNEL_REQUIRE_AUTH`
- **Type**: Boolean (String)
- **Required**: No
- **Default**: `false`
- **Description**: Require admin authentication to create tunnels. When enabled, tunnel creation requires the admin token.
- **Example**: `TUNNEL_REQUIRE_AUTH=true`

### User Usage

Users can connect to the tunnel server using the official `localtunnel` CLI:

```bash
# Install client
npm install -g localtunnel

# Connect to your relay and expose local port 3000
lt --port 3000 --host http://your-relay.com:8765
```

---

## Quick Reference Table

| Variable | Required | Default | Category |
|----------|----------|---------|----------|
| `ADMIN_PASSWORD` | Yes | - | Required |
| `RELAY_HOST` | No | Auto-detected | Relay Identity |
| `RELAY_PORT` | No | `8765` | Relay Identity |
| `RELAY_NAME` | No | `shogun-relay` | Relay Identity |
| `IPFS_API_URL` | No | `http://127.0.0.1:5001` | IPFS |
| `IPFS_GATEWAY_URL` | No | `http://127.0.0.1:8080` | IPFS |
| `IPFS_API_TOKEN` | No | - | IPFS |
| `IPFS_API_KEY` | No | - | IPFS |
| `IPFS_PIN_TIMEOUT_MS` | No | `120000` | IPFS |
| `RELAY_SEA_KEYPAIR` | Yes* | - | GunDB |
| `RELAY_SEA_KEYPAIR_PATH` | Yes* | - | GunDB |
| `STORAGE_TYPE` | No | `sqlite` | GunDB |
| `DATA_DIR` | No | `./data` | GunDB |
| `RELAY_PROTECTED` | No | `true` | GunDB |
| `RELAY_PEERS` | No | - | GunDB |
| `RELAY_PRIVATE_KEY` | No | - | On-Chain |
| `REGISTRY_CHAIN_ID` | No | `84532` | On-Chain |
| `X402_PAY_TO_ADDRESS` | Yes** | - | x402 |
| `X402_NETWORK` | No | `base-sepolia` | x402 |
| `X402_SETTLEMENT_MODE` | No | `facilitator` | x402 |
| `RELAY_MAX_STORAGE_GB` | No | `0` (unlimited) | Storage |
| `AUTO_REPLICATION` | No | `true` | Network |
| `DEAL_SYNC_ENABLED` | No | `true` | Network |
| `DEAL_SYNC_INTERVAL_MS` | No | `300000` | Network |
| `DEAL_SYNC_FAST_INTERVAL_MS` | No | `120000` | Network |
| `HOLSTER_RELAY_HOST` | No | `0.0.0.0` | Holster |
| `HOLSTER_RELAY_PORT` | No | `RELAY_PORT + 1` | Holster |
| `HOLSTER_RELAY_STORAGE` | No | `true` | Holster |
| `NODE_ENV` | No | - | Advanced |
| `NODE_OPTIONS` | No | - | Advanced |
| `LOG_LEVEL` | No | `info` | Advanced |
| `VERBOSE_LOGGING` | No | `false` | Advanced |
| `CORS_ORIGINS` | No | `*` | Security |
| `CORS_CREDENTIALS` | No | `false` | Security |

*At least one of `RELAY_SEA_KEYPAIR` or `RELAY_SEA_KEYPAIR_PATH` is required.  
**Required if using x402 subscriptions or deals.

---

## Environment File Setup

Create a `.env` file in the `relay/` directory:

```bash
# Copy the example file
cp env.example .env

# Edit with your values
nano .env
```

For Docker deployments, set environment variables in `docker-compose.yml` or via `-e` flags:

```bash
docker run -e ADMIN_PASSWORD=secret -e RELAY_HOST=relay.example.com shogun-relay
```

### Docker Build-Time Variables

The following variables are Docker build-time only (ARG) and not runtime environment variables:
- `IPFS_VERSION` - IPFS Kubo version to install (default: 0.29.0)
- `GENERATE_RELAY_KEYS` - Generate relay SEA keypair during build (default: false)
- `CAPROVER_GIT_COMMIT_SHA` - Git commit SHA for CapRover deployments

These are set during `docker build` with `--build-arg`, not in `.env` or runtime environment.

### Docker-Only Variables

These variables are used internally by Docker scripts and typically don't need to be set manually:
- `IPFS_PATH` - IPFS repository path (default: `/data/ipfs` in Docker)
- `SKIP_VOLUME_CHECK` - Skip volume verification on container startup (default: false)

---

## Validation

When the relay starts, it validates critical configuration:

- **ADMIN_PASSWORD**: Must be set, otherwise admin routes are inaccessible
- **RELAY_SEA_KEYPAIR** or **RELAY_SEA_KEYPAIR_PATH**: Must be set, otherwise relay cannot authenticate with GunDB
- **Port**: Must be valid (1-65535), otherwise defaults to 8765

Missing or invalid values will log warnings but may prevent the relay from functioning correctly.

---

## Security Considerations

**Never commit these to version control:**
- `ADMIN_PASSWORD`
- `RELAY_PRIVATE_KEY`
- `X402_PRIVATE_KEY`
- `RELAY_SEA_KEYPAIR`
- `IPFS_API_TOKEN`
- `X402_FACILITATOR_API_KEY`

Always use `.env` files (and add `.env` to `.gitignore`) or secure environment variable management in production.

---

## Related Documentation

- [API.md](./API.md) - API endpoints reference
- [README.md](../README.md) - Main project documentation
- [env.example](../env.example) - Example environment file with all variables

