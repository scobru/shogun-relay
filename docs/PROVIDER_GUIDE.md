# Shogun Relay Provider Guide

A complete guide for running your own Shogun Relay node and joining the decentralized storage network.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Hardware Requirements](#hardware-requirements)
4. [Quick Start](#quick-start)
5. [Detailed Setup](#detailed-setup)
6. [Configuration Reference](#configuration-reference)
7. [On-Chain Registration](#on-chain-registration)
8. [Payment Setup (x402)](#payment-setup-x402)
9. [Security Best Practices](#security-best-practices)
10. [Monitoring & Maintenance](#monitoring--maintenance)
11. [Economics](#economics)
12. [Troubleshooting](#troubleshooting)
13. [FAQ](#faq)

---

## Overview

As a Relay Provider, you contribute storage and bandwidth to the Shogun network. In return, you earn USDC from:

- **Subscriptions**: Users pay monthly for storage access
- **Storage Deals**: Per-file contracts with guaranteed duration
- **Network Fees**: Transaction fees from the protocol

### What You Provide

| Resource | Description |
|----------|-------------|
| **Storage** | IPFS pinning for user files |
| **Bandwidth** | GunDB sync and IPFS retrieval |
| **Uptime** | 24/7 availability (affects reputation) |
| **Stake** | USDC collateral on Base (minimum 100 USDC) |

### What You Earn

| Source | Typical Revenue |
|--------|-----------------|
| Subscriptions | $1-5/user/month |
| Storage Deals | $0.0001-0.0005/MB/month |
| Network Tips | Variable |

---

## Prerequisites

Before starting, ensure you have:

### Required

- [ ] **Server** with public IP or domain
- [ ] **Node.js 18+** installed
- [ ] **IPFS node** running (Kubo recommended)
- [ ] **100+ USDC** on Base Sepolia (testnet) or Base (mainnet)
- [ ] **ETH** for gas fees (~0.01 ETH)
- [ ] **Wallet** with private key

### Recommended

- [ ] **Domain name** with SSL certificate
- [ ] **Docker** for easier deployment
- [ ] **Monitoring** (Grafana, Prometheus)

---

## Hardware Requirements

### Minimum (Small Relay)

| Resource | Specification |
|----------|---------------|
| CPU | 2 cores |
| RAM | 4 GB |
| Storage | 100 GB SSD |
| Bandwidth | 100 Mbps |
| Uptime | 95%+ |

### Recommended (Production)

| Resource | Specification |
|----------|---------------|
| CPU | 4+ cores |
| RAM | 8+ GB |
| Storage | 500 GB+ NVMe SSD |
| Bandwidth | 1 Gbps |
| Uptime | 99.5%+ |

### Cost Estimates

| Provider | Minimum Spec | Monthly Cost |
|----------|--------------|--------------|
| Hetzner | CX21 | ~$5 |
| DigitalOcean | Basic Droplet | ~$12 |
| AWS | t3.medium | ~$30 |
| Home Server | Raspberry Pi 4 | ~$5 (electricity) |

---

## Quick Start

### Option A: Docker (Recommended)

```bash
# 1. Clone repository
git clone https://github.com/scobru/shogun-relay.git
cd shogun-relay

# 2. Copy environment file
cp relay/env.example relay/.env

# 3. Edit configuration (see Configuration section)
nano relay/.env

# 4. Start with Docker
docker-compose up -d

# 5. Verify
curl http://localhost:8765/health
```

### Option B: Manual Setup

```bash
# 1. Clone repository
git clone https://github.com/scobru/shogun-relay.git
cd shogun-relay/relay

# 2. Install dependencies
yarn install

# 3. Copy and edit environment
cp env.example .env
nano .env

# 4. Start IPFS (in another terminal)
ipfs daemon

# 5. Start relay
yarn start

# 6. Verify
curl http://localhost:8765/health
```

---

## Detailed Setup

### Step 1: Install IPFS

```bash
# Download Kubo (IPFS implementation)
wget https://dist.ipfs.tech/kubo/v0.24.0/kubo_v0.24.0_linux-amd64.tar.gz
tar -xvzf kubo_v0.24.0_linux-amd64.tar.gz
cd kubo
sudo bash install.sh

# Initialize IPFS
ipfs init

# Configure for relay use
ipfs config Addresses.API /ip4/127.0.0.1/tcp/5001
ipfs config Addresses.Gateway /ip4/127.0.0.1/tcp/8080
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'

# Start IPFS daemon
ipfs daemon &
```

### Step 2: Install Node.js

```bash
# Using nvm (recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

### Step 3: Clone and Configure

```bash
git clone https://github.com/scobru/shogun-relay.git
cd shogun-relay/relay
yarn install
cp env.example .env
```

### Step 4: Generate Secure Credentials

```bash
# Generate admin password
openssl rand -hex 32

# Generate relay GunDB password
openssl rand -hex 32
```

### Step 5: Create Wallet

If you don't have a wallet, create one:

```bash
# Using Node.js
node -e "console.log(require('ethers').Wallet.createRandom().privateKey)"
```

**IMPORTANT**: Save this private key securely! You'll need it for:
- On-chain registration
- x402 payment settlement

### Step 6: Get Testnet Tokens

For Base Sepolia (testnet):

1. **Get ETH**: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
2. **Get USDC**: https://faucet.circle.com/ (select Base Sepolia)

### Step 7: Configure Environment

Edit `.env` with your values:

```bash
# === REQUIRED CONFIGURATION ===

# Admin password (generate with: openssl rand -hex 32)
ADMIN_PASSWORD=your_secure_admin_password_here

# Your wallet private key (starts with 0x)
RELAY_PRIVATE_KEY=0x...your_private_key...
X402_PRIVATE_KEY=0x...same_or_different_key...

# Your public wallet address
X402_PAY_TO_ADDRESS=0x...your_wallet_address...

# === NETWORK CONFIGURATION ===

# Your server's public hostname or IP
RELAY_HOST=relay.yourdomain.com
RELAY_PORT=8765
RELAY_NAME=MyRelay

# === IPFS CONFIGURATION ===

IPFS_API_URL=http://127.0.0.1:5001
IPFS_GATEWAY_URL=http://127.0.0.1:8080

# === BLOCKCHAIN CONFIGURATION ===

# Use 84532 for Base Sepolia (testnet), 8453 for Base (mainnet)
REGISTRY_CHAIN_ID=84532
X402_NETWORK=base-sepolia
```

### Step 8: Start the Relay

```bash
# Development mode (with auto-reload)
yarn dev

# Production mode
yarn start

# Or with PM2 for process management
pm2 start src/index.js --name shogun-relay
pm2 save
pm2 startup
```

### Step 9: Verify Installation

```bash
# Check health
curl http://localhost:8765/health

# Check IPFS connection
curl http://localhost:8765/api/v1/ipfs/status

# Check admin panel
open http://localhost:8765/admin
```

---

## Configuration Reference

### Core Settings

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `ADMIN_PASSWORD` | Yes | Admin authentication token | `a1b2c3d4...` |
| `RELAY_HOST` | Yes | Public hostname/IP | `relay.example.com` |
| `RELAY_PORT` | No | HTTP port | `8765` |
| `RELAY_NAME` | No | Display name | `MyRelay` |

### IPFS Settings

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `IPFS_API_URL` | No | IPFS API endpoint | `http://127.0.0.1:5001` |
| `IPFS_GATEWAY_URL` | No | IPFS Gateway | `http://127.0.0.1:8080` |
| `IPFS_API_TOKEN` | No | JWT for IPFS auth | - |

### Blockchain Settings

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `RELAY_PRIVATE_KEY` | Yes* | Wallet for on-chain ops | - |
| `REGISTRY_CHAIN_ID` | No | `84532` (testnet) or `8453` | `84532` |
| `X402_PAY_TO_ADDRESS` | Yes* | Payment receiving address | - |
| `X402_NETWORK` | No | Blockchain network | `base-sepolia` |
| `X402_PRIVATE_KEY` | Yes* | Payment settlement key | - |
| `X402_SETTLEMENT_MODE` | No | `facilitator` or `direct` | `facilitator` |

*Required for earning revenue

### Network Settings

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `RELAY_PEERS` | No | Other relays to sync with | - |
| `AUTO_REPLICATION` | No | Auto-pin network content | `true` |

---

## On-Chain Registration

To be discoverable and earn revenue, register your relay on-chain.

### Via Dashboard UI

1. Open `http://your-relay:8765/registry-dashboard`
2. Fill in:
   - **Endpoint**: `https://your-relay.com` (public URL)
   - **GunDB Public Key**: Get from `/api/v1/system/info`
   - **Stake Amount**: Minimum 100 USDC
3. Click **Register On-Chain**
4. Approve USDC spend in wallet
5. Confirm registration transaction

### Via API

```bash
# Check current status
curl http://localhost:8765/api/v1/registry/status

# Get GunDB public key
curl http://localhost:8765/api/v1/system/info | jq '.relayPub'

# Register (requires RELAY_PRIVATE_KEY in .env)
curl -X POST http://localhost:8765/api/v1/registry/register \
  -H "Content-Type: application/json" \
  -d '{
    "endpoint": "https://your-relay.com",
    "gunPubKey": "your_gun_pub_key",
    "stakeAmount": "100"
  }'
```

### Via Smart Contract Directly

```javascript
// Using ethers.js
const registry = new ethers.Contract(
  "0xb1F0a1eb9722A924F521E264Fa75243344868c4D", // Base Sepolia
  REGISTRY_ABI,
  wallet
);

// Approve USDC first
const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
await usdc.approve(registry.address, stakeAmount);

// Register
await registry.registerRelay(endpoint, gunPubKey, stakeAmount);
```

### Contract Addresses

| Network | Registry | USDC |
|---------|----------|------|
| Base Sepolia | `0xb1F0a1eb9722A924F521E264Fa75243344868c4D` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Base Mainnet | TBD | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |

---

## Payment Setup (x402)

The x402 protocol handles subscription and deal payments.

### Configuration

```bash
# In .env
X402_PAY_TO_ADDRESS=0xYourAddress      # Where payments go
X402_PRIVATE_KEY=0xYourPrivateKey      # For settling payments
X402_NETWORK=base-sepolia              # Network
X402_SETTLEMENT_MODE=direct            # 'direct' or 'facilitator'
```

### Settlement Modes

| Mode | Description | Pros | Cons |
|------|-------------|------|------|
| `facilitator` | Uses x402.org service | No gas needed | Depends on service |
| `direct` | Settle locally | Full control | Needs ETH for gas |

### Verify Payment Setup

```bash
# Check x402 configuration
curl http://localhost:8765/api/v1/x402/status

# Should return:
# {
#   "configured": true,
#   "payToAddress": "0x...",
#   "network": "base-sepolia"
# }
```

---

## Security Best Practices

### 1. SSL/TLS Certificate

```bash
# Using Let's Encrypt with Certbot
sudo apt install certbot
sudo certbot certonly --standalone -d relay.yourdomain.com

# Configure nginx reverse proxy
sudo nano /etc/nginx/sites-available/shogun-relay
```

**Nginx Configuration:**

```nginx
server {
    listen 443 ssl http2;
    server_name relay.yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/relay.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/relay.yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 2. Firewall Rules

```bash
# UFW example
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # HTTP (for Let's Encrypt)
sudo ufw allow 443/tcp     # HTTPS
sudo ufw enable
```

### 3. Secure Environment Variables

```bash
# Set restrictive permissions
chmod 600 .env

# Use secrets manager in production
# AWS: AWS Secrets Manager
# GCP: Secret Manager
# Self-hosted: HashiCorp Vault
```

### 4. Private Key Security

- **Never** commit private keys to git
- Use hardware wallets for mainnet
- Consider separate keys for registration vs payments
- Regular key rotation (update on-chain if needed)

---

## Monitoring & Maintenance

### Dashboard URLs

| URL | Purpose |
|-----|---------|
| `/admin` | Main control panel |
| `/stats` | Live metrics |
| `/services-dashboard` | Service health |
| `/registry-dashboard` | On-chain status |

### Health Checks

```bash
# Basic health
curl http://localhost:8765/health

# Detailed system info
curl -H "Authorization: Bearer $ADMIN_PASSWORD" \
  http://localhost:8765/api/v1/system/status

# IPFS status
curl http://localhost:8765/api/v1/ipfs/status

# On-chain status
curl http://localhost:8765/api/v1/registry/status
```

### Log Monitoring

```bash
# With PM2
pm2 logs shogun-relay

# Docker
docker-compose logs -f

# System logs
journalctl -u shogun-relay -f
```

### Automated Monitoring

```bash
# Simple health check script (add to crontab)
#!/bin/bash
if ! curl -sf http://localhost:8765/health > /dev/null; then
    echo "Relay down!" | mail -s "Alert" admin@example.com
    pm2 restart shogun-relay
fi
```

### Maintenance Tasks

| Task | Frequency | Command |
|------|-----------|---------|
| IPFS GC | Weekly | `curl -X POST localhost:8765/api/v1/ipfs/gc` |
| Backup data | Daily | `tar -czf backup.tar.gz ./data` |
| Update relay | Monthly | `git pull && yarn install && pm2 restart` |
| Check stake | Weekly | Check `/registry-dashboard` |

---

## Economics

### Revenue Streams

#### 1. Subscriptions

Users pay monthly for storage access:

| Plan | Price/Month | Storage | Your Share |
|------|-------------|---------|------------|
| Basic | $1 | 100 MB | ~$0.90 |
| Pro | $5 | 1 GB | ~$4.50 |
| Enterprise | $20 | 10 GB | ~$18 |

#### 2. Storage Deals

Per-file contracts:

| Tier | Price/MB/Month | Features |
|------|----------------|----------|
| Standard | $0.0001 | Basic storage |
| Premium | $0.0002 | + Erasure coding |
| Enterprise | $0.0005 | + SLA guarantee |

### Costs

| Item | Monthly Cost |
|------|--------------|
| Server | $5-30 |
| Domain + SSL | ~$1 |
| IPFS Storage | ~$0.01/GB |
| Gas fees | ~$1-5 |
| **Total** | **$7-40** |

### Break-Even Analysis

| Users | Revenue | Profit |
|-------|---------|--------|
| 10 | ~$10 | Break-even |
| 50 | ~$50 | +$30 |
| 100 | ~$100 | +$70 |

### Staking Considerations

- **Minimum Stake**: 100 USDC
- **Slashing Risk**: 1-10% for violations
- **Unstaking Delay**: 7 days
- **ROI**: Stake earns indirect value through network participation

---

## Troubleshooting

### Common Issues

#### Relay Won't Start

```bash
# Check logs
yarn start 2>&1 | head -50

# Common fixes:
# 1. Port in use
lsof -i :8765
kill -9 <PID>

# 2. Missing dependencies
yarn install

# 3. Invalid .env
cat .env | grep -v "^#" | grep -v "^$"
```

#### IPFS Connection Failed

```bash
# Check IPFS is running
ipfs id

# Check API is accessible
curl http://127.0.0.1:5001/api/v0/id

# Check firewall
sudo ufw status
```

#### Registration Failed

```bash
# Check balance
curl http://localhost:8765/api/v1/registry/balance

# Common issues:
# - Insufficient USDC for stake
# - Insufficient ETH for gas
# - Already registered (check status first)
```

#### Payments Not Working

```bash
# Check x402 config
curl http://localhost:8765/api/v1/x402/status

# Verify wallet has ETH for gas
# Check X402_PAY_TO_ADDRESS is correct
# Try X402_SETTLEMENT_MODE=direct
```

### Getting Help

- **GitHub Issues**: [Report bugs](https://github.com/scobru/shogun-relay/issues)
- **Discord**: Join the community
- **Documentation**: [Full README](./README.md)

---

## FAQ

### Q: How much can I earn?

A: Depends on users and storage. A small relay with 50 users can earn $30-50/month profit.

### Q: What happens if I go offline?

A: Your reputation score decreases. Extended downtime may result in users leaving. Critical: active storage deals have SLA requirements.

### Q: Can I run multiple relays?

A: Yes, each needs its own wallet, stake, and registration.

### Q: How do I upgrade?

```bash
git pull origin main
yarn install
pm2 restart shogun-relay  # or docker-compose restart
```

### Q: What if I'm slashed?

A: If stake falls below minimum, you're deactivated. To recover:
1. Increase stake above minimum
2. Relay automatically re-activates

### Q: Testnet vs Mainnet?

A: Start on Base Sepolia (testnet) with free tokens. Move to Base mainnet when ready for real revenue.

### Q: Minimum commitment?

A: None technically, but reputation builds over time. Recommend 3+ months for ROI.

---

## Checklist: Go Live

Before announcing your relay:

- [ ] Relay running and accessible
- [ ] SSL certificate installed
- [ ] IPFS daemon running
- [ ] Registered on-chain
- [ ] Payment setup verified
- [ ] Health monitoring active
- [ ] Backups configured
- [ ] Tested upload/download
- [ ] Tested subscription flow

**Congratulations!** You're now a Shogun Relay Provider.

---

## Support

- **Documentation**: This guide + [README.md](./README.md)
- **Issues**: https://github.com/scobru/shogun-relay/issues
- **Updates**: Watch the repository for releases

---

*Last updated: December 2024*

