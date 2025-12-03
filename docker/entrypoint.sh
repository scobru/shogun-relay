#!/bin/sh
set -e

# Set correct permissions on the data volume
# Prefer DATA_DIR env var (matches server default), fall back to /app/relay/data
DATA_DIR="${DATA_DIR:-/app/relay/data}"
echo "🔐 Setting permissions for data volume at ${DATA_DIR}..."
mkdir -p "$DATA_DIR"
chown -R node:node "$DATA_DIR"

# Backwards compatibility: handle legacy radata directory if it exists
LEGACY_RADATA_DIR="/app/relay/radata"
if [ -d "$LEGACY_RADATA_DIR" ]; then
    echo "🔐 Updating permissions for legacy radata directory..."
    chown -R node:node "$LEGACY_RADATA_DIR" || true
else
    echo "ℹ️ Legacy radata directory not found, skipping."
fi

# Check if IPFS authentication is configured
if [ -n "$IPFS_API_TOKEN" ]; then
    echo "🔐 IPFS API authentication will be configured during initialization"
else
    echo "⚠️ IPFS_API_TOKEN not set, API will be publicly accessible"
fi

# Execute the main container command (supervisord)
exec "$@" 