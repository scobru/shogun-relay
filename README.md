# Shogun Relay

[![CI](https://github.com/scobru/shogun-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/scobru/shogun-relay/actions/workflows/ci.yml)
[![npm](https://img.shields.io/badge/npm-v1.9.4-blue)](https://www.npmjs.com/package/shogun-relay)
[![License](https://img.shields.io/badge/license-MIT-yellow)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3.3-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-127%20passing-brightgreen)]()
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/scobru/shogun-relay)

**Shogun Relay** is a production-ready connection hub that unifies **GunDB** and **IPFS** into a single solution.

## Features

- **GunDB Relay** — WebSocket relay with SQLite/RADISK persistence and WebRTC support
- **IPFS Integration** — Upload, pin, manage, and preview IPFS content via REST API
- **Admin Dashboards** — Real-time monitoring, visual graph explorer, and pin manager
- **x402 Subscriptions** — Paid storage subscriptions via USDC (EIP-3009)
- **L2 Bridge** — Trustless ETH bridge between L1 and GunDB L2
- **Network Federation** — Relay discovery, storage proofs, and reputation system
- **On-Chain Registry** — Staking and slashing on Base blockchain
- **Oracle System** — Decentralized price feeds with dual payment model (x402/ETH)

---

## Quick Start

### Docker

```bash
git clone <repository-url>
cd shogun-relay
./docker-start.sh

curl http://localhost:8765/health
```

### Manual

```bash
cd shogun-relay/relay
npm install
npm run dev
```

Admin dashboards: `http://localhost:8765/`

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

## Admin Interfaces

| Path | Description |
|------|-------------|
| `/admin` | Main control panel |
| `/stats` | Live metrics & charts |
| `/services-dashboard` | Service health overview |
| `/pin-manager` | IPFS pin manager |
| `/upload` | IPFS uploads |
| `/visualGraph` | GunDB explorer |
| `/registry-dashboard` | On-chain registry |
| `/oracle-dashboard` | Oracle feeds & stats |
| `/endpoints` | API documentation |

---

## Documentation

| Document | Description |
|----------|-------------|
| **[API Reference](./docs/API.md)** | Complete REST API documentation |
| **[Environment Variables](./docs/ENVIRONMENT_VARIABLES.md)** | All configuration options |
| **[Node Operator Guide](./docs/NODE_OPERATOR_GUIDE.md)** | Run your own relay |
| **[L2 Bridge](./docs/BRIDGE.md)** | ETH bridge between L1 and L2 |
| **[x402 Payments](./docs/X402_PAYMENTS.md)** | Subscription payment system |
| **[Storage Deals](./docs/STORAGE_DEALS.md)** | Per-file contracts & erasure coding |
| **[Network Federation](./docs/NETWORK_FEDERATION.md)** | Relay discovery & reputation |
| **[Oracle System](./docs/ORACLE.md)** | Paid data feeds & verification |
| **[Relay Keys](./docs/RELAY_KEYS.md)** | Keypair configuration |
| **[Roadmap](./docs/ROADMAP.md)** | Evolution path |

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
| `POST /api/v1/ipfs/upload` | Upload files |
| `GET /api/v1/ipfs/cat/:cid` | Stream content |
| `POST /api/v1/ipfs/pin/add` | Pin content |
| `GET /api/v1/ipfs/pin/ls` | List pins |

### Bridge

| Endpoint | Description |
|----------|-------------|
| `POST /api/v1/bridge/deposit` | Record L1 deposit |
| `POST /api/v1/bridge/withdraw` | Request withdrawal |
| `GET /api/v1/bridge/balance/:user` | Get L2 balance |

### Oracle

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/oracle/feeds` | List available feeds |
| `GET /api/v1/oracle/data/:feedId` | Get signed data (requires payment) |
| `GET /api/v1/oracle/stats/global` | Revenue & usage stats |

Full API documentation at `/endpoints` or see **[API Reference](./docs/API.md)**.

---

## Project Structure

```
shogun-relay/
├── relay/
│   ├── src/
│   │   ├── index.ts       # Express + Gun bootstrap
│   │   ├── routes/        # REST endpoints
│   │   └── public/        # Admin frontends
├── docs/                  # Documentation
└── docker/                # Docker utilities
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
