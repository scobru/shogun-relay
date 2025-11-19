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

![Shogun Relay Admin Panel](image.png)

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
| `DATA_DIR`         | RADISK data directory                                    | `./data`               |
| `RELAY_PROTECTED`  | Require admin token for Gun writes                       | `true`                 |
| `HOLSTER_RELAY_HOST` | Holster relay host address                              | `0.0.0.0`              |
| `HOLSTER_RELAY_PORT` | Holster relay port                                      | `RELAY_PORT + 1` (8766)|
| `HOLSTER_RELAY_STORAGE` | Enable Holster persistent storage                      | `true`                 |
| `HOLSTER_RELAY_STORAGE_PATH` | Path for Holster data storage                         | `./holster-data`       |
| `HOLSTER_MAX_CONNECTIONS` | Maximum connections for Holster relay                  | `100`                  |
| `NEXASDK_API_URL`  | Nexasdk API endpoint (for AI services proxy)             | `http://127.0.0.1:18181`|
| `OLLAMA_API_URL`   | Ollama API endpoint (for AI services proxy)              | `http://127.0.0.1:11434`|

Additional switches (Radisk toggle, cleanup, peers, etc.) are documented inside `index.js`.

### Configuring External Services (Nexasdk, Ollama)

When running Shogun Relay in Docker, external services like Nexasdk or Ollama running on the host machine need special configuration to be accessible from within the container.

#### Nexasdk Configuration

To keep Nexasdk secure (listening only on localhost) while allowing access from Docker containers:

1. **Start Nexasdk on localhost:**
   ```bash
   nexa serve --host 127.0.0.1 --port 18181
   ```

2. **Configure port forwarding on the host (iptables):**
   ```bash
   # Forward port 18181 from Docker gateway to VM host
   sudo iptables -t nat -A PREROUTING -p tcp -d 172.18.0.1 --dport 18181 -j DNAT --to-destination 127.0.0.1:18181
   sudo iptables -A FORWARD -p tcp -d 127.0.0.1 --dport 18181 -j ACCEPT
   ```

   **Note:** Replace `172.18.0.1` with your Docker gateway IP. Find it with:
   ```bash
   docker exec <container-id> ip route | grep default
   ```

3. **Configure the relay to use the Docker gateway:**
   ```bash
   NEXASDK_API_URL=http://172.18.0.1:18181
   ```

   Or set it in your `.env` file or Docker environment variables.

#### Ollama Configuration

Similar configuration applies to Ollama if running on the host:

1. **Start Ollama on localhost:**
   ```bash
   ollama serve
   ```

2. **Configure port forwarding (if needed):**
   ```bash
   sudo iptables -t nat -A PREROUTING -p tcp -d 172.18.0.1 --dport 11434 -j DNAT --to-destination 127.0.0.1:11434
   sudo iptables -A FORWARD -p tcp -d 127.0.0.1 --dport 11434 -j ACCEPT
   ```

3. **Configure the relay:**
   ```bash
   OLLAMA_API_URL=http://172.18.0.1:11434
   ```

**Alternative:** If you prefer to expose services publicly (less secure), you can start them on `0.0.0.0` and use the host's public IP, but ensure proper firewall rules are in place.

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
| `/visualGraph`        | GunDB visual explorer (public reads)       | ⚠️*  |
| `/graph`              | Alternate Gun graph viewer                 | ⚠️*  |
| `/charts`             | Charts and analytics dashboard             | ✅   |
| `/chat`               | Demo public chat                           | ❌   |

`⚠️` The explorers browse public coordinates without a token but prompt for the admin token when write access is required.

---

## API Overview

### GunDB Core
- `GET /gun` – WebSocket endpoint for Gun clients.
- `GET|POST|DELETE /api/v1/system/node/*` – Inspect or update nodes via REST.

### Holster Relay
- `GET /holster-status` – Check Holster relay status and configuration.

### IPFS Management
- `POST /api/v1/ipfs/upload` – Upload streams (admin).
- `GET /api/v1/ipfs/content/:cid` – Stream IPFS content (used by preview panel).
- `GET /api/v1/ipfs/content-json/:cid` – Get IPFS content as JSON.
- `POST /api/v1/ipfs/pins/add` – Add pin.
- `POST /api/v1/ipfs/pins/rm` – Remove pin.
- `POST /api/v1/ipfs/pins/ls` – List pins.
- `GET /api/v1/ipfs/status` – Connectivity check.
- `GET /api/v1/ipfs/repo/stat` – Repository statistics.
- `POST /api/v1/ipfs/repo/gc` – Garbage collection.
- `POST /api/v0/*` – Raw IPFS API proxy (admin).

### AI Services Proxy
- `GET /ollama-status` – Check Ollama service status.
- `GET /nexasdk-status` – Check Nexasdk service status.
- `POST /ollama/*` – Proxy endpoint for Ollama API (admin auth required).
- `POST /nexasdk/*` – Proxy endpoint for Nexasdk API (admin auth required).

### System & Debug
- `GET /health` – Simple health check.
- `GET /api/v1/system/health` – Detailed health report.
- `GET /api/v1/system/relay-info` – Relay information.
- `GET /api/v1/system/alldata` – Dump `shogun` namespace (admin use).
- `GET /api/v1/system/stats` – System statistics.
- `GET /api/v1/system/logs` / `DELETE /api/v1/system/logs` – Log management.
- `GET /api/v1/system/peers` – List Gun peers.
- `POST /api/v1/system/peers/add` – Add Gun peer.
- `GET /api/v1/services/status` – Service snapshot.
- `POST /api/v1/services/:service/restart` – Restart stub.
- `GET /api/v1/debug/mb-usage/:userAddress` – Storage usage by user.
- `GET /api/v1/debug/user-uploads/:identifier` – User uploads info.


### User Uploads
- `GET /api/v1/user-uploads/system-hashes` – System hash registry.
- `GET /api/v1/user-uploads/:identifier` – Get user uploads.
- `GET /api/v1/user-uploads/:identifier/:hash` – Get specific upload.

### Visual Graph
- `/visualGraph/*` – Static assets backing the D3.js explorer.

Full endpoint definitions live in `relay/src/routes/`.

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
