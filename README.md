# Shogun Relay

[![CI](https://github.com/scobru/shogun-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/scobru/shogun-relay/actions/workflows/ci.yml)
[![npm](https://img.shields.io/badge/npm-v1.9.4-blue)](https://www.npmjs.com/package/shogun-relay)
[![License](https://img.shields.io/badge/license-MIT-yellow)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3.3-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-127%20passing-brightgreen)]()
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/scobru/shogun-relay) 

***

**Shogun Relay** is a production-ready connection hub that unifies **GunDB** and **IPFS** into a single solution.

## Features

- **GunDB Relay** — WebSocket relay with SQLite/RADISK persistence and WebRTC support
- **IPFS Integration** — Upload, pin, manage, and preview IPFS content via REST API
- **Torrent Manager** — Download, seed, and stream torrents; built-in search (Internet Archive)
- **Admin Dashboards** — Real-time monitoring, visual graph explorer, file manager, and config editor
- **x402 Subscriptions** — Paid storage subscriptions via USDC (EIP-3009)
- **Network Federation** — Relay discovery, storage proofs, and reputation system
- **On-Chain Registry** — Staking and slashing on Base blockchain
- **Anna's Archive** — Automated mirroring and indexing of scientific/cultural content

---

## Quick Start

### Docker

```bash
git clone https://github.com/scobru/shogun-relay.git
cd shogun-relay
docker-compose up -d

curl http://localhost:8765/health
```

### Manual

```bash
cd shogun-relay/relay
npm install
npm run build:dashboard   # opzionale: per la UI del dashboard
npm start
```

Per sviluppo con hot-reload: `npm run start:dev`

Dashboard: `http://localhost:8765/dashboard/` (anche `http://localhost:8765/admin` reindirizza qui)

---

## Configuration

Create a `.env` file with essential variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `ADMIN_PASSWORD` | Admin token for all routes | _(required)_ |
| `IPFS_API_URL` | IPFS API endpoint | `http://127.0.0.1:5001` |
| `RELAY_PORT` | HTTP port | `8765` |
| `STORAGE_TYPE` | `sqlite` or `radisk` | `sqlite` |

See **[Environment Variables](./docs/ENVIRONMENT_VARIABLES.md)** for complete reference.

---

## Dashboard

L’interfaccia di amministrazione è una SPA React in **`/dashboard/`**. Anche **`/admin`** e **`/`** reindirizzano a `/dashboard/`.

| Path | Descrizione |
|------|-------------|
| `/dashboard/` | Status e panoramica |
| `/dashboard/stats` | Metriche e grafici in tempo reale |
| `/dashboard/services` | Stato dei servizi |
| `/dashboard/files` | File manager |
| `/dashboard/drive` | Drive / browser file |
| `/dashboard/explore` | Esplora storage |
| `/dashboard/network` | Rete e connessioni |
| `/dashboard/chat` | Chat |
| `/dashboard/torrents` | Torrent manager e ricerca (Anna's Archive) |
| `/dashboard/deals` | Storage deals |
| `/dashboard/x402` | Abbonamenti x402 |
| `/dashboard/registry` | Registry on-chain |
| `/dashboard/api-keys` | Gestione API keys |
| `/dashboard/charts` | Grafici |
| `/dashboard/visual-graph` | Esploratore grafo GunDB |
| `/dashboard/graph-explorer` | Navigatore grafo avanzato |
| `/dashboard/rpc-console` | Console RPC |
| `/dashboard/api-docs` | Documentazione API |
| `/dashboard/settings` | Impostazioni e autenticazione admin |

---

## Documentazione

Indice completo in **[docs/README.md](./docs/README.md)**.

| Documento | Descrizione |
|-----------|-------------|
| **[API Reference](./docs/API.md)** | Documentazione REST API |
| **[Environment Variables](./docs/ENVIRONMENT_VARIABLES.md)** | Variabili d’ambiente e configurazione |
| **[Node Operator Guide](./docs/NODE_OPERATOR_GUIDE.md)** | Guida per operatori di nodi |
| **[x402 Payments](./docs/X402_PAYMENTS.md)** | Pagamenti e abbonamenti x402 |
| **[Storage Deals](./docs/STORAGE_DEALS.md)** | Contratti per file ed erasure coding |
| **[Network Federation](./docs/NETWORK_FEDERATION.md)** | Federazione rete e reputazione |
| **[Relay Keys](./docs/RELAY_KEYS.md)** | Configurazione keypair SEA |
| **[Drive SDK Example](./docs/DRIVE_SDK_EXAMPLE.md)** | Esempio uso Drive API |

---

## API Overview

### Core Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /gun` | WebSocket for Gun clients |
| `GET /health` | Health check |
| `GET /api/v1/system/stats` | System statistics |

### IPFS

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/ipfs/upload` | Upload single file |
| `POST /api/v1/ipfs/upload-directory` | Upload multiple files as directory (maintains structure) |
| `GET /api/v1/ipfs/cat/:cid` | Stream content |
| `POST /api/v1/ipfs/pin/add` | Pin content |
| `GET /api/v1/ipfs/pin/ls` | List pins |

### Torrents

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/torrent/status` | List active torrents |
| `POST /api/v1/torrent/add` | Add magnet/torrent |
| `POST /api/v1/torrent/control` | Pause/Resume/Remove |
| `GET /api/v1/torrent/search/internet-archive` | Search Internet Archive |
| `GET /api/v1/torrent/search` | Unified search |

### Drive & Graph

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/drive/*` | Admin file browser API |
| `GET /api/v1/graph/*` | GunDB visual graph explorer |

Documentazione API completa: **[API Reference](./docs/API.md)** o `/dashboard/api-docs` nel dashboard.

---

## Project Structure

```
shogun-relay/
├── relay/
│   ├── src/
│   │   ├── index.ts           # Express + Gun bootstrap
│   │   ├── routes/            # REST endpoints
│   │   └── public/dashboard/  # Dashboard React SPA (build → dist)
├── docs/                      # Documentazione (vedi docs/README.md)
├── sdk/                       # Shogun Relay SDK
└── docker/                    # Docker e utilità
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Gun clients fail to connect | `wscat -c ws://localhost:8765/gun` |
| IPFS API unauthorized | Check `IPFS_API_TOKEN` |
| Admin UI "token required" | Enter token at `/admin` first |

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests when relevant
4. Submit a pull request

---

## License

MIT License © Shogun contributors. See [LICENSE](LICENSE).
