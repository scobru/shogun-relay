#!/bin/bash

# Configuration
KEY_path="/root/.ssh/id_ed25519"
KNOWN_HOSTS_PATH="/root/.ssh/known_hosts"

# Ensure .ssh directory exists
mkdir -p /root/.ssh
chmod 700 /root/.ssh

# Generate SSH key if it doesn't exist
if [ ! -f "$KEY_path" ]; then
    echo "Files key not found, generating..."
    ssh-keygen -t ed25519 -f "$KEY_path" -N ""
    echo "Key generated."
fi

# Add srv.us to known_hosts to avoid interactive prompt
if [ ! -f "$KNOWN_HOSTS_PATH" ] || ! grep -q "srv.us" "$KNOWN_HOSTS_PATH"; then
    echo "Adding srv.us to known_hosts..."
    ssh-keyscan srv.us >> "$KNOWN_HOSTS_PATH"
fi

echo "Starting tunnel to srv.us..."
echo "Forwarding localhost:8765 (relay) to public internet..."

# Loop to keep the tunnel alive
while true; do
    # -N: Do not execute a remote command
    # -R 1:localhost:8765: Request remote forwarding for port 8765. 
    #    '1' requests a stable alias if available/supported, or just the first available slot.
    #    srv.us uses this to map to your key.
    # -o ServerAliveInterval=60: Keep connection alive
    # -o ExitOnForwardFailure=yes: Exit if forwarding fails so we can restart
    
    ssh -N -R 1:relay:8765 -o ServerAliveInterval=60 -o ExitOnForwardFailure=yes -i "$KEY_path" srv.us
    
    echo "Tunnel connection lost. Reconnecting in 5 seconds..."
    sleep 5
done
