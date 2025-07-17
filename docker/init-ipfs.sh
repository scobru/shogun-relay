#!/bin/bash

# IPFS Initialization Script for Docker Container
set -e  # Exit on error

export IPFS_PATH=/data/ipfs

# Clean up any previous lock files
rm -f "$IPFS_PATH/repo.lock"

# Enhanced debugging information
echo "🔍 Environment Information:"
echo "- IPFS_PATH: $IPFS_PATH"
echo "- Current user: $(whoami)"
echo "- User ID: $(id)"
echo "- Working directory: $(pwd)"
echo "- System architecture: $(uname -m)"
echo "- IPFS binary location: $(which ipfs 2>/dev/null || echo 'not found')"
echo "- IPFS binary permissions: $(ls -l $(which ipfs 2>/dev/null) 2>/dev/null || echo 'not accessible')"
echo "- Library dependencies: $(ldd $(which ipfs 2>/dev/null) 2>/dev/null || echo 'unable to check')"

# Create and set proper permissions for IPFS directory
echo "📁 Setting up IPFS directory..."
if ! mkdir -p "$IPFS_PATH"; then
    echo "❌ Failed to create IPFS directory at $IPFS_PATH"
    exit 1
fi

if ! chown -R ipfs:ipfs "$IPFS_PATH" 2>/dev/null; then
    echo "⚠️ Warning: Could not set IPFS directory ownership"
fi

if ! chmod -R 755 "$IPFS_PATH"; then
    echo "❌ Failed to set IPFS directory permissions"
    exit 1
fi

# Verify IPFS binary
echo "🔍 Verifying IPFS binary..."
if [ ! -x "/usr/local/bin/ipfs" ]; then
    echo "❌ IPFS binary not found or not executable at /usr/local/bin/ipfs"
    ls -la /usr/local/bin/ipfs 2>/dev/null || echo "IPFS binary does not exist"
    exit 1
fi

# Test IPFS binary
echo "🧪 Testing IPFS binary..."
if ! /usr/local/bin/ipfs version; then
    echo "❌ IPFS binary test failed"
    ldd /usr/local/bin/ipfs 2>/dev/null || echo "Unable to check dependencies"
    exit 1
fi

# Create denylists directories for the ipfs user
echo "📁 Creating denylists directories..."
if ! mkdir -p /home/ipfs/.config/ipfs/denylists; then
    echo "⚠️ Warning: Failed to create denylist directory for ipfs user"
fi

if ! chown -R ipfs:ipfs /home/ipfs/.config 2>/dev/null; then
    echo "⚠️ Warning: Could not set config directory ownership for ipfs user"
fi

# Check if IPFS is already initialized
if [ ! -f "$IPFS_PATH/config" ]; then
    echo "📦 IPFS not initialized. Initializing now..."
    
    # Initialize IPFS with minimal profile for containers
    if ! /usr/local/bin/ipfs init --profile=server,lowpower; then
        echo "❌ IPFS initialization failed"
        exit 1
    fi
    
    echo "⚙️ Configuring IPFS..."
    
    # Configure IPFS settings with error checking
    /usr/local/bin/ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
    /usr/local/bin/ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080
    /usr/local/bin/ipfs config --json Addresses.Swarm '[
        "/ip4/0.0.0.0/tcp/4001",
        "/ip6/::/tcp/4001",
        "/ip4/0.0.0.0/udp/4001/quic",
        "/ip6/::/udp/4001/quic"
    ]'
    /usr/local/bin/ipfs config --json Routing.AcceleratedDHTClient true
    /usr/local/bin/ipfs config --json Routing.OptimisticProvide true
    /usr/local/bin/ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
    /usr/local/bin/ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT", "POST", "GET"]'
    /usr/local/bin/ipfs config --json API.HTTPHeaders.Access-Control-Allow-Headers '["Authorization"]'
    /usr/local/bin/ipfs config Datastore.GCPeriod '"1h"'
    /usr/local/bin/ipfs config Datastore.StorageMax '"10GB"'
    
    echo "✅ IPFS initialization completed"
else
    echo "✅ IPFS already initialized"
    
    # Update critical configuration
    echo "🔄 Updating critical configuration..."
    if ! /usr/local/bin/ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001 || \
       ! /usr/local/bin/ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080; then
        echo "❌ Failed to update critical configuration"
        exit 1
    fi
fi

# Verify configuration
echo "🔍 Verifying IPFS configuration..."
if ! /usr/local/bin/ipfs config show; then
    echo "❌ Failed to verify IPFS configuration"
    exit 1
fi

echo "🚀 IPFS initialization successful"
exit 0 