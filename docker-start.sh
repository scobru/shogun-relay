#!/bin/bash

# Shogun Relay Docker Quick Start Script
# This script builds and starts the Shogun Relay stack using Docker

set -e

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

# Stop existing container if running
echo "🛑 Stopping existing containers..."
docker-compose down 2>/dev/null || true

# Build and start the stack
echo "🔨 Building Docker image..."
docker-compose build

echo "🐳 Starting services..."
docker-compose up -d

# Wait for services to start
echo "⏳ Waiting for services to start..."
sleep 10

# Check if services are running
if docker-compose ps | grep -q "Up"; then
    echo "✅ Shogun Relay Stack started successfully!"
    echo ""
    echo "🌐 Available services:"
    echo "   📡 Relay Server:    http://localhost:8765"
    echo "   🌐 IPFS API:        http://localhost:5001"
    echo "   🖥️  IPFS Gateway:    http://localhost:8080"
    echo ""
    echo "🔍 Useful commands:"
    echo "   📊 Logs:            docker-compose logs -f"
    echo "   ⏲️ Relay Logs:      docker exec shogun-relay-stack tail -f /var/log/supervisor/relay.log" 
    echo "   ⏲️ IPFS  Logs:      docker exec shogun-relay-stack tail -f /var/log/supervisor/ipfs.log"
    echo "   📈 Stats:           docker stats shogun-relay-stack"
    echo "   🔧 Debug:           docker-compose exec shogun-relay bash"
    echo "   🛑 Stop:            docker-compose down"
    echo ""
    echo "🎯 Check service status:"
    echo "   curl http://localhost:8765/health"
else
    echo "❌ Error starting services. Check logs:"
    echo "   docker-compose logs"
    exit 1
fi
