# Shogun Relay

[![CI](https://github.com/scobru/shogun-relay/actions/workflows/ci.yml/badge.svg)](https://github.com/scobru/shogun-relay/actions/workflows/ci.yml)
[![npm](https://img.shields.io/badge/npm-v1.9.4-blue)](https://www.npmjs.com/package/shogun-relay)
[![License](https://img.shields.io/badge/license-MIT-yellow)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3.3-blue)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-127%20passing-brightgreen)]()
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/scobru/shogun-relay)

---

**Shogun Relay** is a production-ready connection hub that unifies **GunDB** and **IPFS** into a single solution.

## Features

- **GunDB Relay** — WebSocket relay with SQLite/RADISK persistence and WebRTC support
- **IPFS Integration** — Upload, pin, manage, and preview IPFS content via REST API
- **Admin Dashboard** — Modern React-based UI for monitoring and management
- **Network Federation** — Relay discovery, storage proofs, and reputation system

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
npm run start:dev
```

Admin dashboards: `http://localhost:8765/`

---

## Configuration

Create a `.env` file with essential variables:

| Variable         | Description                | Default                 |
| ---------------- | -------------------------- | ----------------------- |
| `ADMIN_PASSWORD` | Admin token for all routes | _(required)_            |
| `IPFS_API_URL`   | IPFS API endpoint          | `http://127.0.0.1:5001` |
| `RELAY_PORT`     | HTTP port                  | `8765`                  |
| `STORAGE_TYPE`   | `sqlite` or `radisk`       | `sqlite`                |

See **[Environment Variables](./docs/ENVIRONMENT_VARIABLES.md)** for complete reference.

---

| Path         | Description                       |
| ------------ | --------------------------------- |
| `/dashboard` | New React Dashboard (Recommended) |
| `/admin`     | Legacy entry (redirects)          |
| `/endpoints` | API reference explorer            |

---

## Development

| **[API Reference](./docs/API.md)** | Complete REST API documentation |
| **[Environment Variables](./docs/ENVIRONMENT_VARIABLES.md)** | All configuration options |
| **[Node Operator Guide](./docs/NODE_OPERATOR_GUIDE.md)** | Run your own relay |
| **[Network Federation](./docs/NETWORK_FEDERATION.md)** | Relay discovery & reputation |
| **[Relay Keys](./docs/RELAY_KEYS.md)** | Keypair configuration |

---

## API Overview

### Core Endpoints

| Endpoint                   | Description               |
| -------------------------- | ------------------------- |
| `GET /gun`                 | WebSocket for Gun clients |
| `GET /health`              | Health check              |
| `GET /api/v1/system/stats` | System statistics         |

### IPFS

| Endpoint                             | Description                                              |
| ------------------------------------ | -------------------------------------------------------- |
| `POST /api/v1/ipfs/upload`           | Upload single file                                       |
| `POST /api/v1/ipfs/upload-directory` | Upload multiple files as directory (maintains structure) |
| `GET /api/v1/ipfs/cat/:cid`          | Stream content                                           |
| `POST /api/v1/ipfs/pin/add`          | Pin content                                              |
| `GET /api/v1/ipfs/pin/ls`            | List pins                                                |

### User Uploads & Metadata

| Endpoint                                              | Description                    |
| ----------------------------------------------------- | ------------------------------ |
| `GET /api/v1/user-uploads/system-hashes-map`          | Get complete file metadata map |
| `POST /api/v1/user-uploads/save-system-hash`          | Save file metadata (admin)     |
| `DELETE /api/v1/user-uploads/remove-system-hash/:cid` | Remove file metadata           |

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

| Issue                       | Solution                           |
| --------------------------- | ---------------------------------- |
| Gun clients fail to connect | `wscat -c ws://localhost:8765/gun` |
| IPFS API unauthorized       | Check `IPFS_API_TOKEN`             |
| Admin UI "token required"   | Enter token at `/admin` first      |

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests when relevant
4. Submit a pull request

---

## License

MIT License © Shogun contributors. See [LICENSE](LICENSE).
