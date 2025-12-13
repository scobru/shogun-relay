#!/bin/sh
# Script to verify that Docker volumes are mounted correctly
# This helps prevent data loss during deploys

set -e

echo "🔍 Verifying Docker Volume Mounts"
echo "=================================="
echo ""

ERRORS=0
WARNINGS=0

# Check IPFS volume
echo "📦 Checking IPFS volume (/data/ipfs)..."
if [ ! -d "/data/ipfs" ]; then
    echo "❌ ERROR: /data/ipfs directory does not exist!"
    ERRORS=$((ERRORS + 1))
elif [ ! -f "/data/ipfs/config" ]; then
    echo "⚠️  WARNING: IPFS not initialized (config file missing)"
    echo "   This is normal on first run, but if you had pins before, they may be lost!"
    WARNINGS=$((WARNINGS + 1))
else
    echo "✅ IPFS volume mounted and initialized"
    
    # Check if it's a volume mount (not just a directory in the container)
    if mountpoint -q /data/ipfs 2>/dev/null; then
        echo "✅ IPFS is mounted as a volume (data will persist)"
    else
        echo "⚠️  WARNING: /data/ipfs is not a volume mount!"
        echo "   Data will be lost when container is removed!"
        WARNINGS=$((WARNINGS + 1))
    fi
    
    # Check for existing pins
    if [ -d "/data/ipfs/pins" ] || [ -f "/data/ipfs/pin-store" ]; then
        echo "✅ IPFS pin data found"
    fi
fi

echo ""

# Check GunDB data volume
echo "💾 Checking GunDB data volume (/app/relay/data)..."
if [ ! -d "/app/relay/data" ]; then
    echo "❌ ERROR: /app/relay/data directory does not exist!"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ GunDB data directory exists"
    
    if mountpoint -q /app/relay/data 2>/dev/null; then
        echo "✅ GunDB data is mounted as a volume (data will persist)"
    else
        echo "⚠️  WARNING: /app/relay/data is not a volume mount!"
        echo "   Data will be lost when container is removed!"
        WARNINGS=$((WARNINGS + 1))
    fi
fi

echo ""

# Check relay keys volume
echo "🔑 Checking relay keys volume (/app/keys)..."
# Check if keys are provided via env var (preferred method)
if [ -n "$RELAY_SEA_KEYPAIR" ]; then
    echo "✅ Relay keys configured via RELAY_SEA_KEYPAIR env var"
    echo "   Keys are provided via environment (no file needed)"
    # Still check if directory exists for other purposes
    if [ -d "/app/keys" ]; then
        if mountpoint -q /app/keys 2>/dev/null; then
            echo "ℹ️  /app/keys is mounted as a volume (optional, for other key files)"
        else
            echo "ℹ️  /app/keys exists but is not a volume mount (OK if using env var)"
        fi
    fi
elif [ -n "$RELAY_SEA_KEYPAIR_PATH" ]; then
    echo "✅ Relay keys configured via RELAY_SEA_KEYPAIR_PATH env var"
    echo "   Keypair path: $RELAY_SEA_KEYPAIR_PATH"
    if [ -f "$RELAY_SEA_KEYPAIR_PATH" ]; then
        echo "✅ Relay keypair file found at configured path"
    else
        echo "ℹ️  Keypair file not found (will be auto-generated if needed)"
    fi
    # Check if the path is in /app/keys and if it's a volume
    if echo "$RELAY_SEA_KEYPAIR_PATH" | grep -q "^/app/keys"; then
        if [ -d "/app/keys" ]; then
            if mountpoint -q /app/keys 2>/dev/null; then
                echo "✅ /app/keys is mounted as a volume (keys will persist)"
            else
                echo "⚠️  WARNING: /app/keys is not a volume mount!"
                echo "   Keys will be lost when container is removed!"
                WARNINGS=$((WARNINGS + 1))
            fi
        fi
    fi
else
    # No env var configured, check for default file location
    if [ ! -d "/app/keys" ]; then
        echo "⚠️  WARNING: /app/keys directory does not exist"
        echo "   Relay keys will be regenerated on each deploy"
        echo "   Consider setting RELAY_SEA_KEYPAIR or RELAY_SEA_KEYPAIR_PATH env var"
        WARNINGS=$((WARNINGS + 1))
    else
        echo "✅ Relay keys directory exists"
        
        if mountpoint -q /app/keys 2>/dev/null; then
            echo "✅ Relay keys are mounted as a volume (keys will persist)"
        else
            echo "⚠️  WARNING: /app/keys is not a volume mount!"
            echo "   Keys will be lost when container is removed!"
            echo "   Consider using RELAY_SEA_KEYPAIR env var instead"
            WARNINGS=$((WARNINGS + 1))
        fi
        
        if [ -f "/app/keys/relay-keypair.json" ]; then
            echo "✅ Relay keypair found"
        else
            echo "⚠️  WARNING: Relay keypair not found"
            echo "   Relay user will be recreated on startup"
            echo "   Consider setting RELAY_SEA_KEYPAIR or RELAY_SEA_KEYPAIR_PATH env var"
            WARNINGS=$((WARNINGS + 1))
        fi
    fi
fi

echo ""

# Check Holster data volume
echo "📡 Checking Holster data volume (/app/relay/holster-data)..."
# Check if Holster storage is enabled
if [ "$HOLSTER_RELAY_STORAGE" = "true" ] || [ "$HOLSTER_RELAY_STORAGE" = "1" ]; then
    if [ ! -d "/app/relay/holster-data" ]; then
        echo "ℹ️  Holster data directory does not exist (will be created on first use)"
    else
        echo "✅ Holster data directory exists"
        
        if mountpoint -q /app/relay/holster-data 2>/dev/null; then
            echo "✅ Holster data is mounted as a volume (data will persist)"
        else
            echo "ℹ️  INFO: /app/relay/holster-data is not a volume mount"
            echo "   Holster data will be lost when container is removed"
            echo "   This is OK for development, but consider mounting a volume for production"
        fi
    fi
else
    echo "ℹ️  Holster storage is disabled (HOLSTER_RELAY_STORAGE not set to true)"
    echo "   Volume mount check skipped"
fi

echo ""
echo "=================================="
echo "Summary:"
if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "✅ All volumes are properly mounted!"
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo "⚠️  Found $WARNINGS warning(s) - check above for details"
    exit 0
else
    echo "❌ Found $ERRORS error(s) and $WARNINGS warning(s)"
    echo ""
    echo "🔧 To fix volume issues:"
    echo "   1. Ensure docker-compose.yml has volumes defined"
    echo "   2. Use 'docker-compose up' (NOT 'docker-compose down -v')"
    echo "   3. For CapRover, configure persistent volumes in the web UI"
    exit 1
fi
