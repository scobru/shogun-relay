#!/bin/bash
set -e

# Set correct permissions on the radata volume
# This ensures the node user can write to the persistent storage
echo "🔐 Setting permissions for radata volume..."
chown -R node:node /app/relay/radata

# Update Tailwind CSS to use local files instead of CDN
echo "🎨 Updating Tailwind CSS to use local files..."
if [ -f /app/update-tailwind.sh ]; then
    chmod +x /app/update-tailwind.sh
    cd /app && ./update-tailwind.sh
    echo "✅ Tailwind CSS updated successfully!"
else
    echo "⚠️  update-tailwind.sh not found, skipping Tailwind update"
fi

# Check if IPFS authentication is configured
if [ -n "$IPFS_API_TOKEN" ]; then
    echo "🔐 IPFS API authentication will be configured during initialization"
else
    echo "⚠️ IPFS_API_TOKEN not set, API will be publicly accessible"
fi

# Execute the main container command (supervisord)
exec "$@" 