# Shogun Relay Full Stack Container
# Includes: IPFS, Relay Server

FROM node:20-slim
# delete cache
ARG CACHEBUST=1

# =============================================================================
# BUILD ARGUMENTS (passed by CapRover or docker build)
# =============================================================================

# --- Build/Deploy ---
ARG CAPROVER_GIT_COMMIT_SHA
ARG IPFS_VERSION=0.29.0

# --- Module Enable Flags ---
ARG IPFS_ENABLED
ARG HOLSTER_ENABLED
ARG X402_ENABLED
ARG REGISTRY_ENABLED
ARG DEALS_ENABLED
ARG DEAL_SYNC_ENABLED
ARG WORMHOLE_ENABLED
ARG TORRENT_ENABLED
ARG ANNAS_ARCHIVE_ENABLED
ARG BRIDGE_ENABLED

# --- Server/Relay Identity ---
ARG RELAY_HOST
ARG RELAY_PORT
ARG RELAY_NAME
ARG RELAY_ENDPOINT
ARG RELAY_PROTECTED
ARG WELCOME_MESSAGE
ARG NODE_ENV
ARG LOG_LEVEL
ARG DEBUG

# --- Authentication ---
ARG ADMIN_PASSWORD
ARG RELAY_SEA_KEYPAIR
ARG RELAY_SEA_KEYPAIR_PATH
ARG GENERATE_RELAY_KEYS=false

# --- GunDB/Storage ---
ARG RELAY_PEERS
ARG GUN_PEERS
ARG STORAGE_TYPE
ARG DISABLE_RADISK
ARG CLEANUP_CORRUPTED_DATA
ARG DATA_DIR

# --- IPFS ---
ARG IPFS_API_URL
ARG IPFS_API_KEY
ARG IPFS_API_TOKEN
ARG IPFS_GATEWAY_URL
ARG IPFS_PIN_TIMEOUT_MS

# --- Holster ---
ARG HOLSTER_RELAY_HOST
ARG HOLSTER_RELAY_PORT
ARG HOLSTER_RELAY_STORAGE
ARG HOLSTER_RELAY_STORAGE_PATH
ARG HOLSTER_MAX_CONNECTIONS

# --- Blockchain/Wallet (shared) ---
ARG PRIVATE_KEY
ARG RELAY_PRIVATE_KEY

# --- Global RPC Configuration ---
ARG BASE_SEPOLIA_RPC
ARG BASE_RPC
ARG SEPOLIA_RPC
ARG MAINNET_RPC
ARG ARBITRUM_RPC
ARG ARBITRUM_SEPOLIA_RPC
ARG OPTIMISM_RPC
ARG OPTIMISM_SEPOLIA_RPC
ARG POLYGON_RPC
ARG POLYGON_AMOY_RPC

# --- X402 Payment ---
ARG X402_PAY_TO_ADDRESS
ARG X402_PRIVATE_KEY
ARG X402_SETTLEMENT_MODE
ARG X402_FACILITATOR_URL
ARG X402_FACILITATOR_API_KEY
ARG X402_NETWORKS
ARG X402_DEFAULT_NETWORK

# --- Registry ---
ARG REGISTRY_CHAIN_ID
ARG REGISTRY_NETWORKS
ARG REGISTRY_DEFAULT_NETWORK

# --- Deals ---
ARG DEALS_NETWORKS
ARG DEALS_DEFAULT_NETWORK
ARG DEAL_SYNC_INTERVAL_MS
ARG DEAL_SYNC_FAST_INTERVAL_MS
ARG DEAL_SYNC_INITIAL_DELAY_MS

# --- Torrent Manager ---
ARG TORRENT_ANNAS_ARCHIVE_URL
ARG TORRENT_DATA_DIR
ARG TORRENT_MAX_TB

# --- Wormhole ---
ARG WORMHOLE_CLEANUP_ENABLED
ARG WORMHOLE_CLEANUP_INTERVAL_MS
ARG WORMHOLE_MAX_AGE_SECS

# --- Storage Limits ---
ARG RELAY_MAX_STORAGE_GB
ARG RELAY_STORAGE_WARNING_THRESHOLD

# --- Drive ---
ARG DRIVE_DATA_DIR

# --- Network/Security ---
ARG AUTO_REPLICATION
ARG CORS_ORIGINS
ARG CORS_CREDENTIALS
ARG STRICT_SESSION_IP

# --- LocalTunnel Server ---


# =============================================================================
# ENVIRONMENT VARIABLES (Persist ARGs to Runtime)
# =============================================================================

ENV IPFS_ENABLED=${IPFS_ENABLED} \
    HOLSTER_ENABLED=${HOLSTER_ENABLED} \
    X402_ENABLED=${X402_ENABLED} \
    REGISTRY_ENABLED=${REGISTRY_ENABLED} \
    DEALS_ENABLED=${DEALS_ENABLED} \
    DEAL_SYNC_ENABLED=${DEAL_SYNC_ENABLED} \
    WORMHOLE_ENABLED=${WORMHOLE_ENABLED} \
    TORRENT_ENABLED=${TORRENT_ENABLED} \
    ANNAS_ARCHIVE_ENABLED=${ANNAS_ARCHIVE_ENABLED} \
    BRIDGE_ENABLED=${BRIDGE_ENABLED}

ENV RELAY_HOST=${RELAY_HOST} \
    RELAY_PORT=${RELAY_PORT} \
    RELAY_NAME=${RELAY_NAME} \
    RELAY_ENDPOINT=${RELAY_ENDPOINT} \
    RELAY_PROTECTED=${RELAY_PROTECTED} \
    WELCOME_MESSAGE=${WELCOME_MESSAGE} \
    NODE_ENV=${NODE_ENV} \
    LOG_LEVEL=${LOG_LEVEL} \
    DEBUG=${DEBUG}

ENV ADMIN_PASSWORD=${ADMIN_PASSWORD}

ENV RELAY_SEA_KEYPAIR=${RELAY_SEA_KEYPAIR} \
    RELAY_SEA_KEYPAIR_PATH=${RELAY_SEA_KEYPAIR_PATH}

ENV RELAY_PEERS=${RELAY_PEERS} \
    GUN_PEERS=${GUN_PEERS} \
    STORAGE_TYPE=${STORAGE_TYPE} \
    DISABLE_RADISK=${DISABLE_RADISK} \
    CLEANUP_CORRUPTED_DATA=${CLEANUP_CORRUPTED_DATA} \
    DATA_DIR=${DATA_DIR}

ENV IPFS_API_URL=${IPFS_API_URL} \
    IPFS_API_KEY=${IPFS_API_KEY} \
    IPFS_API_TOKEN=${IPFS_API_TOKEN} \
    IPFS_GATEWAY_URL=${IPFS_GATEWAY_URL} \
    IPFS_PIN_TIMEOUT_MS=${IPFS_PIN_TIMEOUT_MS}

ENV HOLSTER_RELAY_HOST=${HOLSTER_RELAY_HOST} \
    HOLSTER_RELAY_PORT=${HOLSTER_RELAY_PORT} \
    HOLSTER_RELAY_STORAGE=${HOLSTER_RELAY_STORAGE} \
    HOLSTER_RELAY_STORAGE_PATH=${HOLSTER_RELAY_STORAGE_PATH} \
    HOLSTER_MAX_CONNECTIONS=${HOLSTER_MAX_CONNECTIONS}

ENV RELAY_PRIVATE_KEY=${RELAY_PRIVATE_KEY} \
    PRIVATE_KEY=${PRIVATE_KEY}

# Global RPC
ENV BASE_SEPOLIA_RPC=${BASE_SEPOLIA_RPC} \
    BASE_RPC=${BASE_RPC} \
    SEPOLIA_RPC=${SEPOLIA_RPC} \
    MAINNET_RPC=${MAINNET_RPC} \
    ARBITRUM_RPC=${ARBITRUM_RPC} \
    ARBITRUM_SEPOLIA_RPC=${ARBITRUM_SEPOLIA_RPC} \
    OPTIMISM_RPC=${OPTIMISM_RPC} \
    OPTIMISM_SEPOLIA_RPC=${OPTIMISM_SEPOLIA_RPC} \
    POLYGON_RPC=${POLYGON_RPC} \
    POLYGON_AMOY_RPC=${POLYGON_AMOY_RPC}

ENV X402_PAY_TO_ADDRESS=${X402_PAY_TO_ADDRESS} \
    X402_PRIVATE_KEY=${X402_PRIVATE_KEY} \
    X402_SETTLEMENT_MODE=${X402_SETTLEMENT_MODE} \
    X402_FACILITATOR_URL=${X402_FACILITATOR_URL} \
    X402_FACILITATOR_API_KEY=${X402_FACILITATOR_API_KEY} \
    X402_NETWORKS=${X402_NETWORKS} \
    X402_DEFAULT_NETWORK=${X402_DEFAULT_NETWORK}

ENV REGISTRY_CHAIN_ID=${REGISTRY_CHAIN_ID} \
    REGISTRY_NETWORKS=${REGISTRY_NETWORKS} \
    REGISTRY_DEFAULT_NETWORK=${REGISTRY_DEFAULT_NETWORK}

ENV DEALS_NETWORKS=${DEALS_NETWORKS} \
    DEALS_DEFAULT_NETWORK=${DEALS_DEFAULT_NETWORK} \
    DEAL_SYNC_INTERVAL_MS=${DEAL_SYNC_INTERVAL_MS} \
    DEAL_SYNC_FAST_INTERVAL_MS=${DEAL_SYNC_FAST_INTERVAL_MS} \
    DEAL_SYNC_INITIAL_DELAY_MS=${DEAL_SYNC_INITIAL_DELAY_MS}

ENV TORRENT_ANNAS_ARCHIVE_URL=${TORRENT_ANNAS_ARCHIVE_URL} \
    TORRENT_DATA_DIR=${TORRENT_DATA_DIR} \
    TORRENT_MAX_TB=${TORRENT_MAX_TB}

ENV WORMHOLE_CLEANUP_ENABLED=${WORMHOLE_CLEANUP_ENABLED} \
    WORMHOLE_CLEANUP_INTERVAL_MS=${WORMHOLE_CLEANUP_INTERVAL_MS} \
    WORMHOLE_MAX_AGE_SECS=${WORMHOLE_MAX_AGE_SECS}

ENV RELAY_MAX_STORAGE_GB=${RELAY_MAX_STORAGE_GB} \
    RELAY_STORAGE_WARNING_THRESHOLD=${RELAY_STORAGE_WARNING_THRESHOLD}

ENV DRIVE_DATA_DIR=${DRIVE_DATA_DIR}

ENV AUTO_REPLICATION=${AUTO_REPLICATION} \
    CORS_ORIGINS=${CORS_ORIGINS} \
    CORS_CREDENTIALS=${CORS_CREDENTIALS} \
    STRICT_SESSION_IP=${STRICT_SESSION_IP}




# Install required system packages
# Using apt-get for Debian-based image
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    dos2unix \
    supervisor \
    build-essential \
    python3 \
    cmake \
    libssl-dev \
    openssh-client \
    && rm -rf /var/lib/apt/lists/* 

# Download and install IPFS Kubo (separate step for better caching and retry)
# Note: Debian-based image uses glibc, so IPFS binary works natively
RUN set -ex \
    && ARCH=$(uname -m) \
    && case $ARCH in \
    x86_64) ARCH_NAME="amd64" ;; \
    aarch64) ARCH_NAME="arm64" ;; \
    *) echo "Unsupported architecture: $ARCH"; exit 1 ;; \
    esac \
    && IPFS_URL="https://dist.ipfs.tech/kubo/v${IPFS_VERSION}/kubo_v${IPFS_VERSION}_linux-${ARCH_NAME}.tar.gz" \
    && echo "Downloading IPFS Kubo v${IPFS_VERSION} for ${ARCH_NAME}..." \
    && echo "URL: ${IPFS_URL}" \
    && mkdir -p /tmp/ipfs-install \
    && cd /tmp/ipfs-install \
    # Use curl with retry and better error handling
    && for i in 1 2 3 4 5; do \
    echo "Download attempt $i..." && \
    curl -fsSL --retry 3 --retry-delay 5 -o kubo.tar.gz "${IPFS_URL}" && break || \
    (echo "Attempt $i failed, waiting..." && sleep 10); \
    done \
    && test -f kubo.tar.gz || (echo "ERROR: Failed to download IPFS after 5 attempts" && exit 1) \
    && ls -lh kubo.tar.gz \
    && echo "Extracting IPFS..." \
    && tar -xzf kubo.tar.gz \
    && test -d kubo && test -f kubo/ipfs || (echo "ERROR: Extraction failed" && ls -la && exit 1) \
    && chmod +x kubo/ipfs \
    && install -m 755 kubo/ipfs /usr/local/bin/ipfs \
    && echo "Testing IPFS binary..." \
    && /usr/local/bin/ipfs version \
    && cd / \
    && rm -rf /tmp/ipfs-install \
    && echo "IPFS installation successful!"

# Create symlink for Node.js (supervisord expects it in /usr/bin)
RUN ln -sf /usr/local/bin/node /usr/bin/node

# Create users and set up directories (Debian syntax)
# Note: These directories will be preserved if volumes are mounted
RUN useradd -m -s /bin/bash ipfs \
    && mkdir -p /data/ipfs \
    && mkdir -p /app/relay \
    && mkdir -p /app/relay/data \
    && mkdir -p /app/relay/holster-data \
    && mkdir -p /app/keys \
    && mkdir -p /var/log/supervisor \
    && mkdir -p /home/ipfs/.config/ipfs/denylists \
    && mkdir -p /root/.config/ipfs/denylists \
    && chown -R ipfs:ipfs /data/ipfs /home/ipfs/.config || true \
    && chmod -R 755 /home/ipfs/.config /root/.config || true

# Set up relay application
WORKDIR /app

# Copy configuration files first
COPY docker/ /app/docker/

# Convert line endings and set permissions in single layer (better cache)
RUN dos2unix /app/docker/init-ipfs.sh \
    && dos2unix /app/docker/entrypoint.sh \
    && dos2unix /app/docker/verify-volumes.sh || true \
    && dos2unix /app/docker/tunnel.sh \
    && chmod +x /app/docker/init-ipfs.sh \
    && chmod +x /app/docker/entrypoint.sh \
    && chmod +x /app/docker/verify-volumes.sh || true \
    && chmod +x /app/docker/tunnel.sh \
    && cp /app/docker/entrypoint.sh /usr/local/bin/entrypoint.sh \
    && chmod +x /usr/local/bin/entrypoint.sh \
    && cp /app/docker/relay.env /app/relay/.env

# Copy package files and scripts (needed for postinstall)
COPY relay/package*.json /app/relay/
COPY relay/scripts/ /app/relay/scripts/
WORKDIR /app/relay

# Install ALL dependencies first (including devDependencies for dashboard build)
RUN npm install

# Build shogun-contracts SDK if needed (for local installations)
# This ensures the SDK is compiled even if shogun-contracts is installed locally
RUN if [ -d "node_modules/shogun-contracts/sdk" ] && [ ! -f "node_modules/shogun-contracts/sdk/dist/index.js" ]; then \
    echo "🔨 Building shogun-contracts SDK..." && \
    cd node_modules/shogun-contracts && \
    npm run build:sdk 2>/dev/null || echo "⚠️  SDK build skipped (may already be compiled)"; \
    fi

# Copy the rest of the application
COPY relay/ /app/relay/

# Build React Dashboard (SPA) using relay's package.json
# Vite and TypeScript are in devDependencies, so we need them installed
RUN echo "🔨 Building React Dashboard..." && \
    npm run build:dashboard && \
    echo "✅ Dashboard built successfully" || \
    echo "⚠️ Dashboard build failed - check logs"

# Prune devDependencies to reduce image size
RUN npm prune --omit=dev

# Optionally generate relay SEA keypair if requested
# This creates the keypair during build time
RUN if [ "$GENERATE_RELAY_KEYS" = "true" ] && [ -z "$RELAY_SEA_KEYPAIR" ] && [ -z "$RELAY_SEA_KEYPAIR_PATH" ]; then \
    echo "🔑 Generating relay SEA keypair..." && \
    mkdir -p /app/keys && \
    node /app/relay/scripts/generate-relay-keys-standalone.cjs /app/keys/relay-keypair.json && \
    echo "✅ Keypair generated at /app/keys/relay-keypair.json" && \
    echo "⚠️  IMPORTANT: Mount this file or copy it to a secure location!"; \
    else \
    echo "⏭️  Skipping keypair generation (use GENERATE_RELAY_KEYS=true to enable)"; \
    fi

# Set proper permissions
# Note: Volumes will override these permissions, but we set them here for initial setup
# Use || true to avoid failures if directories don't exist or are already mounted as volumes
RUN chown -R node:node /app || true \
    && chown -R node:node /app/relay/data || true \
    && chown -R node:node /app/relay/holster-data || true \
    && chown -R node:node /app/keys || true \
    && chown -R ipfs:ipfs /data/ipfs || true \
    && chmod 755 /app/relay/src/public || true \
    && chmod 755 /app/relay/data || true \
    && chmod 755 /app/relay/holster-data || true \
    && chmod 755 /app/keys || true

# Expose ports
# 8765 = Relay server, 5001 = IPFS API, 8080 = IPFS Gateway, 4001 = IPFS Swarm
# 6881 = BitTorrent/WebTorrent peer connections (Anna's Archive seeding)
EXPOSE 8765 5001 8080 4001 6881

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8765/health || exit 1

# Use supervisor to manage multiple services
RUN mkdir -p /etc/supervisor/conf.d
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Set environment variables
ENV NODE_ENV=production
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Start all services with supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
