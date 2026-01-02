#!/bin/sh

# Shogun Relay - srv.us SSH Tunnel Script
# Establishes a reverse SSH tunnel to srv.us for public exposure

echo "Starting srv.us SSH tunnel setup..."

# Check if we should run the tunnel
if [ "$TUNNEL_ENABLED" != "true" ]; then
    echo "Tunnel is disabled (TUNNEL_ENABLED != true). Exiting."
    # We exit with 0 so supervisor doesn't keep restarting it if we used autorestart=false,
    # but with autorestart=true we might want to just sleep or exit.
    # If we exit, supervisor will try to restart. 
    # Better to just sleep forever if disabled, or let supervisor configuration handle it.
    # For now, let's sleep forever to avoid restart loop noise if disabled but included in supervisor.
    while true; do sleep 3600; done
fi

# Ensure persistent SSH directory exists
SSH_DIR="/app/keys/ssh"
mkdir -p "$SSH_DIR"
chmod 700 "$SSH_DIR"

# Generate key if it doesn't exist
if [ ! -f "$SSH_DIR/id_ed25519" ]; then
    echo "Generating SSH key..."
    ssh-keygen -t ed25519 -f "$SSH_DIR/id_ed25519" -N ''
    echo "Key generated."
    
    echo "IMPORTANT: You need to add this public key to your srv.us account:"
    cat "$SSH_DIR/id_ed25519.pub"
fi

# Add srv.us to known_hosts if missing
if [ ! -f "$SSH_DIR/known_hosts" ]; then
    echo "Adding srv.us to known_hosts..."
    ssh-keyscan srv.us >> "$SSH_DIR/known_hosts"
fi

echo "Starting tunnel to srv.us..."
echo "Forwarding localhost:${RELAY_PORT:-8765} to srv.us"
echo "Public Key (add to srv.us):"
cat "$SSH_DIR/id_ed25519.pub"

# Start the tunnel loop
while true; do
    # Use -N (no remote command) -R (remote port forwarding)
    # We forward remote (srv.us) port to local RELAY_PORT
    
    ssh -N -R 1:localhost:${RELAY_PORT:-8765} \
        -o ServerAliveInterval=60 \
        -o UserKnownHostsFile="$SSH_DIR/known_hosts" \
        -o ExitOnForwardFailure=yes \
        -i "$SSH_DIR/id_ed25519" \
        srv.us
        
    echo "Tunnel lost. Reconnecting in 5s..."
    sleep 5
done
