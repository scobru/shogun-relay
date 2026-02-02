# Shogun Relay - Node Operator Guide

Essential guide to run a Shogun Relay node and earn revenue.

## Prerequisites

- **Server**: Public IP/domain, 24/7 uptime recommended
- **Hardware**: 2+ CPU cores, 4GB+ RAM, 100GB+ SSD storage
- **Software**: Node.js 18+, Docker (recommended), or manual IPFS setup
- **Blockchain**: 0.01 USDC for staking, 0.01+ ETH for gas (Base Sepolia testnet or Base mainnet)

## Quick Start

### Option 1: Docker (Recommended)

```bash
git clone https://github.com/scobru/shogun-relay.git
cd shogun-relay

# Configure environment
cp relay/env.example relay/.env
nano relay/.env  # Edit required variables (see below)

# Start
docker-compose up -d

# Verify
curl http://localhost:8765/health
```

### Option 2: Manual

```bash
git clone https://github.com/scobru/shogun-relay.git
cd shogun-relay/relay

# Install IPFS (if not installed)
wget https://dist.ipfs.tech/kubo/v0.29.0/kubo_v0.29.0_linux-amd64.tar.gz
tar -xzf kubo_v0.29.0_linux-amd64.tar.gz
sudo ./kubo/install.sh

# Initialize IPFS
ipfs init
ipfs daemon &

# Install relay
npm install
cp env.example .env
nano .env  # Edit configuration

# (Optional) Build dashboard UI
npm run build:dashboard

# Start relay
npm start
```

## Required Configuration

Edit `relay/.env` with these minimum settings:

```bash
# Admin authentication
ADMIN_PASSWORD=$(openssl rand -hex 32)

# Relay identity
RELAY_HOST=your-relay.com  # Your public domain/IP
RELAY_PORT=8765
RELAY_NAME=MyRelay

# Relay SEA keypair (REQUIRED - prevents signature errors)
# Generate: node scripts/generate-relay-keys.js
RELAY_SEA_KEYPAIR='{"pub":"...","priv":"...","epub":"...","epriv":"..."}'

# IPFS
IPFS_API_URL=http://127.0.0.1:5001
IPFS_GATEWAY_URL=http://127.0.0.1:8080

# On-chain registration (required for revenue)
RELAY_PRIVATE_KEY=0x...your_private_key...
REGISTRY_CHAIN_ID=84532  # 84532=testnet, 8453=mainnet

# Payment setup (required for revenue)
X402_PAY_TO_ADDRESS=0x...your_wallet_address...
X402_PRIVATE_KEY=0x...your_private_key...
X402_NETWORK=base-sepolia  # or 'base' for mainnet
X402_SETTLEMENT_MODE=direct  # or 'facilitator'
```

## Generate Relay Keypair

The relay requires a GunDB SEA keypair for proper operation:

```bash
cd relay
node scripts/generate-relay-keys.js
```

Add output to `.env` as `RELAY_SEA_KEYPAIR='{...}'` or save to file and use `RELAY_SEA_KEYPAIR_PATH=/path/to/keypair.json`

## On-Chain Registration

To be discoverable and earn revenue, register on-chain:

### Via Dashboard

1. Open `http://your-relay:8765/dashboard/` and go to **Registry** (`/dashboard/registry`)
2. Enter:
   - **Endpoint**: `https://your-relay.com`
   - **Stake Amount**: Minimum 100 USDC
3. Approve USDC spend and confirm transaction

### Via API

```bash
# Get GunDB public key
curl http://localhost:8765/api/v1/system/info | jq '.relayPub'

# Register
curl -X POST http://localhost:8765/api/v1/registry/register \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "https://your-relay.com",
    "stakeAmount": "100"
  }'
```

## Contract Addresses

| Network | Chain ID | Registry | USDC |
|---------|----------|----------|------|
| Base Sepolia | 84532 | `0x412D3Cf47907C231EE26D261714D2126eb3735e6` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Base Mainnet | 8453 | TBD | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

## Verify Setup

```bash
# Health check
curl http://localhost:8765/health

# IPFS status
curl http://localhost:8765/api/v1/ipfs/status

# Registry status
curl http://localhost:8765/api/v1/registry/status

# Payment config
curl http://localhost:8765/api/v1/x402/config
```

## Security

### SSL Certificate (Production)

```bash
sudo apt install certbot
sudo certbot certonly --standalone -d your-relay.com
```

Configure nginx reverse proxy with SSL.

### Firewall

```bash
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### Secure Secrets

- Never commit `.env` to git
- Use `chmod 600 .env`
- Consider hardware wallet for mainnet
- Use separate keys for registration vs payments

## Monitoring

### Dashboards

- `/dashboard/` - Status e panoramica
- `/dashboard/stats` - Metriche in tempo reale
- `/dashboard/services` - Stato servizi
- `/dashboard/registry` - Registry on-chain
- `/dashboard/settings` - Autenticazione admin e configurazione (sola lettura)

### Health Monitoring

```bash
# Simple health check script
#!/bin/bash
if ! curl -sf http://localhost:8765/health > /dev/null; then
  pm2 restart shogun-relay  # or docker-compose restart
fi
```

## Maintenance

| Task | Frequency | Command |
|------|-----------|---------|
| IPFS GC | Weekly | `curl -X POST -H "Authorization: Bearer $ADMIN_PASSWORD" localhost:8765/api/v1/ipfs/repo/gc` |
| Backup data | Daily | `tar -czf backup.tar.gz ./data` |
| Update relay | Monthly | `git pull && yarn install && pm2 restart` |

## Economics

### Revenue Streams

- **Subscriptions**: Users pay monthly for storage ($1-5/user/month)
- **Storage Deals**: Per-file contracts ($0.0001-0.0005/MB/month)

### Costs

- Server: $5-30/month
- Domain + SSL: ~$1/month
- Gas fees: ~$1-5/month

### Staking

- **Minimum**: 0.01 USDC
- **Unstaking delay**: 7 days
- **Slashing**: 1-10% for violations (missed proofs, data loss)

## Troubleshooting

### Relay won't start

- Check port 8765 is free: `lsof -i :8765`
- Verify `.env` syntax: `cat .env | grep -v "^#" | grep -v "^$"`
- Check logs: `docker-compose logs` or `pm2 logs`

### IPFS connection failed

```bash
ipfs id  # Check IPFS is running
curl http://127.0.0.1:5001/api/v0/id  # Check API accessible
```

### "Signature did not match" errors

Generate and configure `RELAY_SEA_KEYPAIR` in `.env` (see above).

### Registration failed

```bash
# Check balances
curl http://localhost:8765/api/v1/registry/balance

# Verify you have:
# - 100+ USDC for stake
# - 0.01+ ETH for gas
```

## Important Files

- `relay/.env` - Configuration (keep secret)
- `relay/data/` - GunDB data (backup regularly)
- `/data/ipfs/` - IPFS repository (backup regularly)
- `relay/relay-keypair.json` - Relay keypair (if using file path)

## Support

- **Keypair Configuration**: See [RELAY_KEYS.md](./RELAY_KEYS.md) for detailed keypair setup
- **Issues**: https://github.com/scobru/shogun-relay/issues
- **Main README**: [../README.md](../README.md)

