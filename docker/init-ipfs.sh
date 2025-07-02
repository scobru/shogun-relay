#!/bin/bash

# IPFS Initialization Script for Docker Container

export IPFS_PATH=/data/ipfs

echo "🔧 Initializing IPFS..."
echo "IPFS_PATH: $IPFS_PATH"
echo "Current user: $(whoami)"
echo "IPFS binary location: $(which ipfs || echo 'not found')"

# Create and set proper permissions for IPFS directory
mkdir -p $IPFS_PATH
chown -R ipfs:ipfs $IPFS_PATH 2>/dev/null || true
chmod -R 755 $IPFS_PATH

# Verify IPFS binary
if [ ! -x "/usr/local/bin/ipfs" ]; then
    echo "❌ IPFS binary not found or not executable"
    exit 1
fi

ls -la /usr/local/bin/ipfs || echo "IPFS binary not found"

# Create denylists directories for both root and current user
echo "📁 Creating denylists directories..."
mkdir -p /root/.config/ipfs/denylists 2>/dev/null || true
mkdir -p /home/ipfs/.config/ipfs/denylists
chmod -R 755 /root/.config/ipfs /home/ipfs/.config/ipfs 2>/dev/null || true
chown -R ipfs:ipfs /home/ipfs/.config 2>/dev/null || true

# Check if IPFS is already initialized
if [ ! -f "$IPFS_PATH/config" ]; then
    echo "📦 IPFS not initialized. Initializing now..."
    
    # Initialize IPFS with minimal profile for containers
    /usr/local/bin/ipfs init --profile=server,lowpower
    
    # Configure IPFS for container environment
    echo "⚙️ Configuring IPFS..."
    
    # Set API and Gateway addresses to bind to all interfaces
    /usr/local/bin/ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
    /usr/local/bin/ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080
    
    # Configure swarm addresses
    /usr/local/bin/ipfs config --json Addresses.Swarm '[
        "/ip4/0.0.0.0/tcp/4001",
        "/ip6/::/tcp/4001",
        "/ip4/0.0.0.0/udp/4001/quic",
        "/ip6/::/udp/4001/quic"
    ]'
    
    # Enable routing and performance features (updated for Kubo 0.21+)
    /usr/local/bin/ipfs config --json Routing.AcceleratedDHTClient true
    /usr/local/bin/ipfs config --json Routing.OptimisticProvide true
    
    # Configure CORS for web access
    /usr/local/bin/ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["*"]'
    /usr/local/bin/ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT", "POST", "GET"]'
    /usr/local/bin/ipfs config --json API.HTTPHeaders.Access-Control-Allow-Headers '["Authorization"]'
    
    # Set resource limits for container environment
    /usr/local/bin/ipfs config Swarm.ResourceMgr.MaxMemory 512MB
    /usr/local/bin/ipfs config Swarm.ResourceMgr.MaxFileDescriptors 1024
    
    # Configure garbage collection
    /usr/local/bin/ipfs config Datastore.GCPeriod 1h
    /usr/local/bin/ipfs config Datastore.StorageMax 10GB
    
    echo "✅ IPFS initialization completed"
else
    echo "✅ IPFS already initialized"
    
    # Update configuration for container environment
    /usr/local/bin/ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
    /usr/local/bin/ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080
fi

echo "🚀 IPFS ready to start" 