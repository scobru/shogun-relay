#!/bin/bash

# Shogun Relay Docker Quick Start Script
# This script builds and starts the Shogun Relay stack using Docker

set -e

echo "🚀 Avviando Shogun Relay Stack con Docker..."

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Errore: Docker non è in esecuzione. Avvia Docker Desktop e riprova."
    exit 1
fi

# Check if .env file exists, if not copy from example
if [ ! -f .env ]; then
    echo "📋 Creando file .env da .env.example..."
    cp .env.example .env
    echo "⚠️  IMPORTANTE: Modifica il file .env per configurare la password admin!"
fi

# Stop existing container if running
echo "🛑 Fermando container esistenti..."
docker-compose down 2>/dev/null || true

# Build and start the stack
echo "🔨 Building immagine Docker..."
docker-compose build

echo "🐳 Avviando i servizi..."
docker-compose up -d

# Wait for services to start
echo "⏳ Aspettando che i servizi si avviino..."
sleep 10

# Check if services are running
if docker-compose ps | grep -q "Up"; then
    echo "✅ Shogun Relay Stack avviato con successo!"
    echo ""
    echo "🌐 Servizi disponibili:"
    echo "   📡 Relay Server:    http://localhost:8765"
    echo "   📁 FakeS3:          http://localhost:4569"
    echo "   🌐 IPFS API:        http://localhost:5001"
    echo "   🖥️  IPFS Gateway:    http://localhost:8080"
    echo ""
    echo "🔍 Comandi utili:"
    echo "   📊 Logs:            docker-compose logs -f"
    echo "   📈 Stats:           docker stats shogun-relay-stack"
    echo "   🔧 Debug:           docker-compose exec shogun-relay bash"
    echo "   🛑 Stop:            docker-compose down"
    echo ""
    echo "🎯 Controlla lo stato dei servizi:"
    echo "   curl http://localhost:8765/health"
else
    echo "❌ Errore nell'avvio dei servizi. Controlla i log:"
    echo "   docker-compose logs"
    exit 1
fi
