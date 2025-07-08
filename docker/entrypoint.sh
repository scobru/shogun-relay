#!/bin/bash
set -e

# Set correct permissions on the radata volume
# This ensures the node user can write to the persistent storage
echo "🔐 Setting permissions for radata volume..."
chown -R node:node /app/relay/radata

# Execute the main container command (supervisord)
exec "$@" 