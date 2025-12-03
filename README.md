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
✅ **Production-ready** with RADISK persistence, rate limiting, and built-in security

In practice, instead of orchestrating 3-4 different services, you start a single server and have everything you need to manage your decentralized infrastructure.

---

## Table of Contents

1. [Highlights](#highlights)
2. [Architecture at a Glance](#architecture-at-a-glance)
3. [Getting Started](#getting-started)
4. [Configuration](#configuration)
5. [Admin Authentication](#admin-authentication)
6. [Admin Interfaces](#admin-interfaces)
7. [API Overview](#api-overview)
8. [Key Tools](#key-tools)
9. [Development Notes](#development-notes)
10. [Troubleshooting](#troubleshooting)
11. [Contributing](#contributing)
12. [License](#license)

---

## Highlights

- **GunDB Relay Core**
  - WebSocket relay with RADISK persistence and WebRTC support.
  - Drop-in peer for any Gun client.

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

Create a `.env` file or export the variables below:

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
| `DATA_DIR`         | RADISK data directory                                    | `./data`               |
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
| `X402_RPC_URL` | RPC URL for blockchain access | _(optional)_ |
| `RELAY_GUN_USERNAME` | GunDB username for relay user (x402 subscriptions) | `shogun-relay` |
| `RELAY_GUN_PASSWORD` | GunDB password for relay user (x402 subscriptions) | `ADMIN_PASSWORD` |

Additional switches (Radisk toggle, cleanup, peers, etc.) are documented inside `index.js`.

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
| `/endpoints`           | Complete API endpoints documentation       | ❌   |
| `/visualGraph`        | GunDB visual explorer (public reads)       | ⚠️*  |
| `/graph`              | Alternate Gun graph viewer                 | ⚠️*  |
| `/charts`             | Charts and analytics dashboard             | ✅   |
| `/chat`               | Demo public chat                           | ❌   |
| `/notes`              | Notes interface                            | ✅   |
| `/subscription`       | x402 subscription management               | ❌   |

`⚠️` The explorers browse public coordinates without a token but prompt for the admin token when write access is required.

---

## API Overview

### GunDB Core
- `GET /gun` – WebSocket endpoint for Gun clients.
- `GET|POST|DELETE /api/v1/system/node/*` – Inspect or update nodes via REST.

### Holster Relay
- `GET /holster-status` – Check Holster relay status and configuration.

### IPFS Management
- `POST /api/v1/ipfs/upload` – Upload files to IPFS (admin, supports multipart/form-data with optional encryption).
- `GET /api/v1/ipfs/cat/:cid` – Stream IPFS content (aligned with Kubo's `/api/v0/cat`).
- `GET /api/v1/ipfs/cat/:cid/json` – Get IPFS content as JSON (automatically parses JSON).
- `GET /api/v1/ipfs/cat/:cid/decrypt` – Get and decrypt SEA-encrypted IPFS content (requires token query param).
- `POST /api/v1/ipfs/pin/add` – Pin content to IPFS (admin, aligned with Kubo's `/api/v0/pin/add`).
- `POST /api/v1/ipfs/pin/rm` – Remove a pin from IPFS (admin, aligned with Kubo's `/api/v0/pin/rm`).
- `GET /api/v1/ipfs/pin/ls` – List all pinned content (admin, aligned with Kubo's `/api/v0/pin/ls`).
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
- `GET /api/v1/x402/tiers` – List all available subscription tiers (public).
- `GET /api/v1/x402/subscription/:userAddress` – Get subscription status for a user (public).
- `POST /api/v1/x402/subscribe` – Purchase or renew subscription with x402 payment (public).
- `GET /api/v1/x402/payment-requirements/:tier` – Get x402 payment requirements for a specific tier (public).
- `GET /api/v1/x402/can-upload/:userAddress` – Check if user can upload based on subscription (public).
- `GET /api/v1/x402/can-upload-verified/:userAddress` – Check if user can upload with verified subscription status (public).
- `POST /api/v1/x402/update-usage/:userAddress` – Update storage usage for a user (admin).
- `GET /api/v1/x402/storage/:userAddress` – Get storage information for a user (public).
- `POST /api/v1/x402/storage/sync/:userAddress` – Sync storage usage from actual uploads (admin).
- `GET /api/v1/x402/config` – Get x402 configuration (public).

### Visual Graph
- `GET /api/v1/visualGraph` – Visual graph explorer endpoint.
- `/visualGraph/*` – Static assets backing the D3.js explorer.

### Notes
- `GET /api/v1/notes` – Notes endpoint.
- `GET /api/v1/notes/regular` – Regular notes endpoint.

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
