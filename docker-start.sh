#!/bin/bash

# Shogun Relay Docker Quick Start Script
# This script builds and starts the Shogun Relay stack using Docker

set -e

# Check for docker compose command
if docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE_CMD="docker compose"
    echo "Using modern docker compose"
elif command -v docker-compose &> /dev/null; then
    DOCKER_COMPOSE_CMD="docker-compose"
    echo "Using legacy docker-compose"
else
    echo "❌ Error: Neither 'docker compose' nor 'docker-compose' is available"
    exit 1
fi

# Parse command line arguments
PRESERVE_DATA=false
FORCE_RESTART=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --preserve-data)
            PRESERVE_DATA=true
            shift
            ;;
        --force-restart)
            FORCE_RESTART=true
            shift
            ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --preserve-data    Preserve all data (volumes, GunDB, IPFS) between restarts"
            echo "  --force-restart    Force complete restart (removes containers and volumes)"
            echo "  --help            Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                 # Normal start (preserves data by default)"
            echo "  $0 --preserve-data # Explicitly preserve data"
            echo "  $0 --force-restart # Complete reset (WARNING: loses all data)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

echo "🚀 Starting Shogun Relay Stack with Docker..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Error: Docker is not running. Start Docker Desktop and try again."
    exit 1
fi

# Check if .env file exists, if not copy from example
if [ ! -f .env ]; then
    echo "📋 Creating .env file from .env.example..."
    cp .env.example .env
    echo "⚠️  IMPORTANT: Edit the .env file to configure the admin password!"
fi

# Stop existing container based on flags
if [ "$FORCE_RESTART" = true ]; then
    echo "🔄 Force restart: Stopping containers and removing volumes..."
    $DOCKER_COMPOSE_CMD down -v 2>/dev/null || true
    echo "🗑️  All data has been removed (volumes deleted)"
else
    # Default behavior: preserve data
    echo "💾 Preserving data: Stopping containers only (volumes kept)..."
    $DOCKER_COMPOSE_CMD down 2>/dev/null || true
    echo "✅ Data preserved (volumes maintained)"
fi

# Build and start the stack
echo "🔨 Building Docker image..."
$DOCKER_COMPOSE_CMD build

echo "🐳 Starting services..."
$DOCKER_COMPOSE_CMD up -d

# Wait for services to start
echo "⏳ Waiting for services to start..."
sleep 10

# Check if services are running
if $DOCKER_COMPOSE_CMD ps | grep -q "Up"; then
    echo "✅ Shogun Relay Stack started successfully!"
    echo ""
    
    if [ "$FORCE_RESTART" = true ]; then
        echo "🔄 This was a complete reset - all data has been cleared"
    else
        echo "💾 Data persistence: ENABLED"
        echo "   📁 GunDB data:     Preserved in volume"
        echo "   🌐 IPFS data:      Preserved in volume"
        echo "   🔧 Config files:   Preserved"
    fi
    
    echo ""
    echo "🌐 Available services:"
    echo "   📡 Relay Server:    http://localhost:8765"
    echo "   🌐 IPFS API:        http://localhost:5001"
    echo "   🖥️  IPFS Gateway:    http://localhost:8080"
    echo ""
    echo "🔍 Useful commands:"
    echo "   📊 Logs:            $DOCKER_COMPOSE_CMD logs -f"
    echo "   ⏲️ Relay Logs:      docker exec shogun-relay-stack tail -f /var/log/supervisor/relay.log" 
    echo "   ⏲️ IPFS  Logs:      docker exec shogun-relay-stack tail -f /var/log/supervisor/ipfs.log"
    echo "   ⏲️ IPFS-INIT  Logs:      docker exec shogun-relay-stack tail -f /var/log/supervisor/ipfs-init.log"
    echo "   📈 Stats:           docker stats shogun-relay-stack"
    echo "   🔧 Debug:           $DOCKER_COMPOSE_CMD exec shogun-relay bash"
    echo "   🛑 Stop:            $DOCKER_COMPOSE_CMD down"
    echo "   🗑️  Reset:           $DOCKER_COMPOSE_CMD down -v"
    echo ""
    echo "🎯 Check service status:"
    echo "   curl http://localhost:8765/health"
    echo ""
    echo "💡 Data Management:"
    echo "   💾 Backup volumes:  docker run --rm -v shogun-relay_gun-data:/data -v \$(pwd):/backup alpine tar czf /backup/gun-data-backup.tar.gz -C /data ."
    echo "   📦 Restore volumes: docker run --rm -v shogun-relay_gun-data:/data -v \$(pwd):/backup alpine tar xzf /backup/gun-data-backup.tar.gz -C /data"
else
    echo "❌ Error starting services. Check logs:"
    echo "   $DOCKER_COMPOSE_CMD logs"
    exit 1
fi
