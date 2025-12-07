# Manual Setup Guide - Starting Services Individually

This guide explains how to start the Shogun relay without Docker, by starting services individually.

## Required Services

The Shogun relay requires 2 main services:

1. **IPFS Daemon** - IPFS node for distributed storage
2. **Shogun Relay** - Node.js server that manages GunDB and APIs

## Prerequisites

- Node.js 18+ installed
- IPFS installed (see [IPFS Installation](#ipfs-installation))
- Available ports:
  - `5001` - IPFS API
  - `8080` - IPFS Gateway
  - `8765` - Shogun Relay HTTP
  - `8766` - Holster WebSocket (optional)

## IPFS Installation

### Option 1: Binary Download

```bash
# Linux/Mac
wget https://dist.ipfs.tech/kubo/v0.24.0/kubo_v0.24.0_linux-amd64.tar.gz
tar -xvzf kubo_v0.24.0_linux-amd64.tar.gz
cd kubo
sudo ./install.sh

# Verify installation
ipfs version
```

### Option 2: Using Package Manager

```bash
# Ubuntu/Debian
sudo apt-get update
sudo apt-get install ipfs

# macOS (with Homebrew)
brew install ipfs

# Windows (with Chocolatey)
choco install ipfs
```

## Initial Configuration

### 1. Configure IPFS

```bash
# Initialize IPFS (first time only)
ipfs init

# Configure API to accept external connections (if needed)
ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080

# If using JWT authentication, generate a token
# (see IPFS documentation for details)
```

### 2. Configure Shogun Relay

```bash
cd shogun-relay/relay

# Install dependencies
npm install

# Copy example file and configure
cp env.example .env

# Edit .env with your values
# MINIMUM REQUIRED:
# - ADMIN_PASSWORD (generate with: openssl rand -hex 32)
# - RELAY_HOST (your public hostname or localhost)
# - RELAY_SEA_KEYPAIR (generate with: node scripts/generate-relay-keys.js)
```

### 3. Generate Relay Keys

```bash
cd shogun-relay/relay
node scripts/generate-relay-keys.js

# This will create relay-keypair.json
# Add to .env:
# RELAY_SEA_KEYPAIR_PATH=./relay-keypair.json
# OR
# RELAY_SEA_KEYPAIR='{"pub":"...","priv":"...","epub":"...","epriv":"..."}'
```

## Starting Services

### Terminal 1: IPFS Daemon

```bash
# Start IPFS daemon
ipfs daemon

# You should see output like:
# Initializing daemon...
# Swarm listening on /ip4/127.0.0.1/tcp/4001
# API server listening on /ip4/127.0.0.1/tcp/5001
# Gateway (readonly) server listening on /ip4/127.0.0.1/tcp/8080
```

**Verify IPFS is active:**
```bash
# In another terminal
ipfs id
curl http://localhost:5001/api/v0/version
```

### Terminal 2: Shogun Relay

```bash
cd shogun-relay/relay

# Load environment variables
# On Linux/Mac:
export $(cat .env | xargs)

# On Windows PowerShell:
# Get-Content .env | ForEach-Object { if ($_ -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') } }

# Start the relay
npm start
# OR for development with auto-reload:
npm run dev

# You should see output like:
# 🚀 Shogun Relay starting...
# 📊 Reputation tracking initialized for your-hostname
# ✅ Relay listening on http://0.0.0.0:8765
```

**Verify the relay is active:**
```bash
curl http://localhost:8765/health
curl http://localhost:8765/api/v1/health
```

## Automatic Startup Scripts

You can create scripts to start everything automatically:

### Linux/Mac: `start-relay.sh`

```bash
#!/bin/bash

# Script to start Shogun Relay manually

set -e

echo "🚀 Starting Shogun Relay Services..."

# Verify IPFS is installed
if ! command -v ipfs &> /dev/null; then
    echo "❌ IPFS not found. Please install IPFS first."
    exit 1
fi

# Verify Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+ first."
    exit 1
fi

# Verify IPFS is initialized
if [ ! -d "$HOME/.ipfs" ] && [ ! -d "./ipfs-data" ]; then
    echo "📦 Initializing IPFS..."
    ipfs init
fi

# Start IPFS daemon in background
echo "🌐 Starting IPFS daemon..."
ipfs daemon &
IPFS_PID=$!
echo "IPFS daemon started with PID: $IPFS_PID"

# Wait for IPFS to be ready
echo "⏳ Waiting for IPFS to be ready..."
sleep 5

# Verify IPFS is responding
until curl -s http://localhost:5001/api/v0/version > /dev/null; do
    echo "Waiting for IPFS API..."
    sleep 2
done
echo "✅ IPFS is ready"

# Start Shogun Relay
echo "🔌 Starting Shogun Relay..."
cd relay

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Start relay
npm start &
RELAY_PID=$!
echo "Shogun Relay started with PID: $RELAY_PID"

# Save PIDs so we can stop them
echo $IPFS_PID > /tmp/shogun-ipfs.pid
echo $RELAY_PID > /tmp/shogun-relay.pid

echo ""
echo "✅ All services started!"
echo "📊 IPFS daemon PID: $IPFS_PID"
echo "🔌 Shogun Relay PID: $RELAY_PID"
echo ""
echo "To stop services:"
echo "  kill \$(cat /tmp/shogun-ipfs.pid)"
echo "  kill \$(cat /tmp/shogun-relay.pid)"
echo ""
echo "Or use: ./stop-relay.sh"
```

### Linux/Mac: `stop-relay.sh`

```bash
#!/bin/bash

echo "🛑 Stopping Shogun Relay Services..."

if [ -f /tmp/shogun-relay.pid ]; then
    RELAY_PID=$(cat /tmp/shogun-relay.pid)
    if ps -p $RELAY_PID > /dev/null; then
        echo "Stopping Shogun Relay (PID: $RELAY_PID)..."
        kill $RELAY_PID
        rm /tmp/shogun-relay.pid
    fi
fi

if [ -f /tmp/shogun-ipfs.pid ]; then
    IPFS_PID=$(cat /tmp/shogun-ipfs.pid)
    if ps -p $IPFS_PID > /dev/null; then
        echo "Stopping IPFS daemon (PID: $IPFS_PID)..."
        kill $IPFS_PID
        rm /tmp/shogun-ipfs.pid
    fi
fi

echo "✅ All services stopped"
```

### Windows: `start-relay.ps1`

```powershell
# PowerShell script to start Shogun Relay

Write-Host "🚀 Starting Shogun Relay Services..." -ForegroundColor Green

# Verify IPFS
if (-not (Get-Command ipfs -ErrorAction SilentlyContinue)) {
    Write-Host "❌ IPFS not found. Please install IPFS first." -ForegroundColor Red
    exit 1
}

# Verify Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Node.js not found. Please install Node.js 18+ first." -ForegroundColor Red
    exit 1
}

# Start IPFS daemon
Write-Host "🌐 Starting IPFS daemon..." -ForegroundColor Yellow
Start-Process -FilePath "ipfs" -ArgumentList "daemon" -WindowStyle Minimized
Start-Sleep -Seconds 5

# Verify IPFS
$maxRetries = 10
$retry = 0
while ($retry -lt $maxRetries) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:5001/api/v0/version" -UseBasicParsing -TimeoutSec 2
        Write-Host "✅ IPFS is ready" -ForegroundColor Green
        break
    } catch {
        $retry++
        if ($retry -ge $maxRetries) {
            Write-Host "❌ IPFS failed to start" -ForegroundColor Red
            exit 1
        }
        Start-Sleep -Seconds 2
    }
}

# Start Shogun Relay
Write-Host "🔌 Starting Shogun Relay..." -ForegroundColor Yellow
Set-Location relay

# Load environment variables
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
        }
    }
}

# Start relay
npm start

Write-Host "✅ All services started!" -ForegroundColor Green
```

## Verification

After starting the services, verify everything works:

```bash
# 1. Verify IPFS
curl http://localhost:5001/api/v0/version
ipfs id

# 2. Verify Shogun Relay
curl http://localhost:8765/health
curl http://localhost:8765/api/v1/health

# 3. Verify admin dashboard
# Open in browser: http://localhost:8765/
# Login with ADMIN_PASSWORD from .env
```

## Troubleshooting

### IPFS won't start

```bash
# Verify port 5001 is not in use
lsof -i :5001  # Linux/Mac
netstat -ano | findstr :5001  # Windows

# Remove lock file if IPFS crashed
rm ~/.ipfs/repo.lock  # Linux/Mac
# Windows: remove C:\Users\<user>\.ipfs\repo.lock
```

### Relay can't connect to IPFS

```bash
# Verify IPFS_API_URL in .env is correct
# Should be: http://127.0.0.1:5001

# Test the connection
curl http://127.0.0.1:5001/api/v0/version
```

### Port already in use

```bash
# Change port in .env
RELAY_PORT=8767  # instead of 8765

# Or find and kill the process using the port
lsof -ti:8765 | xargs kill  # Linux/Mac
netstat -ano | findstr :8765  # Windows (then kill with PID)
```

### Authentication errors

```bash
# Verify ADMIN_PASSWORD is configured
echo $ADMIN_PASSWORD

# Verify RELAY_SEA_KEYPAIR is configured
# If missing, generate keys:
node scripts/generate-relay-keys.js
```

## Production Deployment

For production, use a process manager like PM2:

```bash
# Install PM2
npm install -g pm2

# Start IPFS (once)
ipfs daemon

# Start relay with PM2
cd relay
pm2 start src/index.js --name shogun-relay --env production

# Save PM2 configuration
pm2 save
pm2 startup  # Follow instructions for auto-startup

# Monitor
pm2 status
pm2 logs shogun-relay
```

## Differences from Docker

When starting manually:

- ✅ You have full control over each service
- ✅ You can see logs separately
- ✅ Easier for debugging
- ❌ You must manage services manually
- ❌ No automatic auto-restart (use PM2 for this)
- ❌ You must configure IPFS manually

With Docker:
- ✅ Everything started automatically
- ✅ Auto-restart configured
- ✅ Isolation and security
- ❌ Less control over individual services

## Next Steps

After starting the services:

1. **Register the relay on-chain** (see `PROVIDER_GUIDE.md`)
2. **Configure pricing** in `.env`
3. **Access dashboards** at `http://localhost:8765/`
4. **Monitor logs** for any errors

For more information, see:
- `README.md` - Main documentation
- `PROVIDER_GUIDE.md` - Provider guide
- `relay/docs/ENVIRONMENT_VARIABLES.md` - All environment variables
