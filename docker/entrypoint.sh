#!/bin/sh
set -e

# Set correct permissions on persistent data volumes
# These directories are mounted as volumes and need correct permissions

# GunDB data directory
DATA_DIR="${DATA_DIR:-/app/relay/data}"
echo "🔐 Setting permissions for GunDB data volume at ${DATA_DIR}..."
if [ -d "$DATA_DIR" ]; then
    echo "✅ GunDB data directory exists, preserving existing data"
    # Only update permissions, don't modify existing files
    chown -R node:node "$DATA_DIR" || true
    chmod 755 "$DATA_DIR" || true
    # Preserve existing files and subdirectories
    find "$DATA_DIR" -type f -exec chmod 644 {} \; 2>/dev/null || true
    find "$DATA_DIR" -type d -exec chmod 755 {} \; 2>/dev/null || true
else
    echo "📁 Creating new GunDB data directory"
    mkdir -p "$DATA_DIR"
    chown -R node:node "$DATA_DIR" || true
    chmod 755 "$DATA_DIR" || true
fi

# Relay keys directory (for SEA keypair)
KEYS_DIR="${RELAY_SEA_KEYPAIR_PATH%/*}"
if [ -z "$KEYS_DIR" ] || [ "$KEYS_DIR" = "$RELAY_SEA_KEYPAIR_PATH" ]; then
    KEYS_DIR="/app/keys"
fi
echo "🔐 Setting permissions for relay keys directory at ${KEYS_DIR}..."
mkdir -p "$KEYS_DIR"
chown -R node:node "$KEYS_DIR" || true
chmod 755 "$KEYS_DIR" || true

# Holster data directory
HOLSTER_DIR="${HOLSTER_RELAY_STORAGE_PATH:-/app/relay/holster-data}"
echo "🔐 Setting permissions for Holster data volume at ${HOLSTER_DIR}..."
if [ -d "$HOLSTER_DIR" ]; then
    echo "✅ Holster data directory exists, preserving existing data"
    chown -R node:node "$HOLSTER_DIR" || true
    chmod 755 "$HOLSTER_DIR" || true
    find "$HOLSTER_DIR" -type f -exec chmod 644 {} \; 2>/dev/null || true
    find "$HOLSTER_DIR" -type d -exec chmod 755 {} \; 2>/dev/null || true
else
    echo "📁 Creating new Holster data directory"
    mkdir -p "$HOLSTER_DIR"
    chown -R node:node "$HOLSTER_DIR" || true
    chmod 755 "$HOLSTER_DIR" || true
fi

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

# Optional: Run volume verification script (can be disabled with SKIP_VOLUME_CHECK=true)
if [ "${SKIP_VOLUME_CHECK:-false}" != "true" ] && [ -f "/app/docker/verify-volumes.sh" ]; then
    echo "🔍 Running volume verification..."
    /bin/sh /app/docker/verify-volumes.sh || {
        echo "⚠️  Volume verification found issues. Continuing anyway..."
        echo "⚠️  Set SKIP_VOLUME_CHECK=true to skip this check."
    }
    echo ""
fi

# Execute the main container command (supervisord)
exec "$@" 