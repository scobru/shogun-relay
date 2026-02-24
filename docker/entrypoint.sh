#!/bin/sh
set -e

# Set correct permissions on persistent data volumes
# These directories are mounted as volumes and need correct permissions

# IPFS data directory (must be done first, before IPFS init)
IPFS_DIR="${IPFS_PATH:-/data/ipfs}"
echo "🔐 Setting permissions for IPFS data volume at ${IPFS_DIR}..."
if [ -d "$IPFS_DIR" ]; then
    echo "✅ IPFS data directory exists, setting ownership and permissions"
    # Set ownership to ipfs user (entrypoint runs as root, so this should work)
    chown -R ipfs:ipfs "$IPFS_DIR" 2>/dev/null || {
        echo "⚠️  Warning: Could not set IPFS directory ownership (may need manual fix)"
    }
    # Set directory permissions
    chmod 755 "$IPFS_DIR" 2>/dev/null || true
    # Set file permissions (config should be readable)
    if [ -f "$IPFS_DIR/config" ]; then
        chmod 644 "$IPFS_DIR/config" 2>/dev/null || true
        chown ipfs:ipfs "$IPFS_DIR/config" 2>/dev/null || true
    fi
    # Set permissions for all files and directories recursively
    find "$IPFS_DIR" -type d -exec chmod 755 {} \; 2>/dev/null || true
    find "$IPFS_DIR" -type f -exec chmod 644 {} \; 2>/dev/null || true
    # Ensure ipfs user owns everything
    chown -R ipfs:ipfs "$IPFS_DIR" 2>/dev/null || true
else
    echo "📁 Creating new IPFS data directory"
    mkdir -p "$IPFS_DIR"
    chown -R ipfs:ipfs "$IPFS_DIR" 2>/dev/null || true
    chmod 755 "$IPFS_DIR" 2>/dev/null || true
fi

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

# Auto-generate SEA keypair if not configured and keypair file doesn't exist
KEYPAIR_FILE="${RELAY_SEA_KEYPAIR_PATH:-/app/keys/relay-keypair.json}"

# If RELAY_SEA_KEYPAIR_PATH points to a directory, append default filename
if [ -n "$RELAY_SEA_KEYPAIR_PATH" ] && [ -d "$RELAY_SEA_KEYPAIR_PATH" ]; then
    echo "📁 RELAY_SEA_KEYPAIR_PATH is a directory, using default filename"
    KEYPAIR_FILE="${RELAY_SEA_KEYPAIR_PATH}/relay-keypair.json"
elif [ -n "$RELAY_SEA_KEYPAIR_PATH" ]; then
    # Handle case where path ends with / (directory notation) - POSIX compliant
    case "$RELAY_SEA_KEYPAIR_PATH" in
        */)
            KEYPAIR_FILE="${RELAY_SEA_KEYPAIR_PATH}relay-keypair.json"
            ;;
    esac
fi

if [ -z "$RELAY_SEA_KEYPAIR" ] && [ ! -f "$KEYPAIR_FILE" ]; then
    echo "🔑 No SEA keypair found, generating new one at ${KEYPAIR_FILE}..."
    # Ensure directory exists
    KEYPAIR_DIR=$(dirname "$KEYPAIR_FILE")
    if [ "$KEYPAIR_DIR" != "." ] && [ "$KEYPAIR_DIR" != "/" ]; then
        mkdir -p "$KEYPAIR_DIR"
        chown node:node "$KEYPAIR_DIR" || true
        chmod 755 "$KEYPAIR_DIR" || true
    fi
    
    # Use the standalone script to generate keypair
    if [ -f "/app/relay/scripts/generate-relay-keys-standalone.cjs" ]; then
        node /app/relay/scripts/generate-relay-keys-standalone.cjs "$KEYPAIR_FILE" && \
        echo "✅ SEA keypair generated successfully!" && \
        chown node:node "$KEYPAIR_FILE" && \
        chmod 600 "$KEYPAIR_FILE"
    else
        # Fallback: generate inline with Node.js
        echo "⚠️  Standalone script not found, using inline generation..."
        node -e "
            const Gun = require('gun');
            require('gun/sea');
            Gun.SEA.pair().then(pair => {
                require('fs').writeFileSync('$KEYPAIR_FILE', JSON.stringify(pair, null, 2));
                console.log('✅ SEA keypair generated at $KEYPAIR_FILE');
            });
        " && chown node:node "$KEYPAIR_FILE" && chmod 600 "$KEYPAIR_FILE"
    fi
    # Set the environment variable for this session
    export RELAY_SEA_KEYPAIR_PATH="$KEYPAIR_FILE"
else
    if [ -n "$RELAY_SEA_KEYPAIR" ]; then
        echo "✅ Using SEA keypair from RELAY_SEA_KEYPAIR environment variable"
    elif [ -f "$KEYPAIR_FILE" ]; then
        echo "✅ Using existing SEA keypair from ${KEYPAIR_FILE}"
    fi
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

# Verify dashboard files exist at runtime
DASHBOARD_PATH="/app/relay/src/public/dashboard/dist/index.html"
echo "🔍 Verifying dashboard at runtime..."
if [ -f "$DASHBOARD_PATH" ]; then
    echo "✅ Dashboard found at $DASHBOARD_PATH"
    ls -la /app/relay/src/public/dashboard/dist/
else
    echo "❌ Dashboard NOT found at $DASHBOARD_PATH"
    echo "📁 Checking parent directories..."
    ls -la /app/relay/src/public/ 2>/dev/null || echo "  /app/relay/src/public/ does not exist"
    ls -la /app/relay/src/public/dashboard/ 2>/dev/null || echo "  /app/relay/src/public/dashboard/ does not exist"
    ls -la /app/relay/src/public/dashboard/dist/ 2>/dev/null || echo "  /app/relay/src/public/dashboard/dist/ does not exist"
fi

# Execute the main container command (supervisord)
exec "$@" 