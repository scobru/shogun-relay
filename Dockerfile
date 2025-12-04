# Shogun Relay Full Stack Container
# Includes: IPFS, Relay Server

FROM node:20-alpine

# Build arguments (may be passed by CapRover or other deployment systems)
ARG ADMIN_PASSWORD
ARG CAPROVER_GIT_COMMIT_SHA
ARG IPFS_API_KEY
ARG IPFS_API_TOKEN
ARG IPFS_VERSION=0.29.0
ARG RELAY_PEERS
ARG RELAY_GUN_USERNAME
ARG RELAY_GUN_PASSWORD
ARG RELAY_HOST
ARG RELAY_PORT
ARG RELAY_NAME
ARG X402_PAY_TO_ADDRESS
ARG X402_NETWORK
ARG X402_SETTLEMENT_MODE
ARG X402_PRIVATE_KEY
ARG X402_RPC_URL
ARG X402_FACILITATOR_URL
ARG X402_FACILITATOR_API_KEY
# Storage limits
ARG RELAY_MAX_STORAGE_GB
ARG RELAY_STORAGE_WARNING_THRESHOLD
# On-chain registry
ARG RELAY_PRIVATE_KEY
ARG REGISTRY_CHAIN_ID
# Holster relay
ARG HOLSTER_RELAY_HOST
ARG HOLSTER_RELAY_PORT
ARG HOLSTER_RELAY_STORAGE
ARG HOLSTER_RELAY_STORAGE_PATH
ARG HOLSTER_MAX_CONNECTIONS
# Network federation
ARG AUTO_REPLICATION

# Install required system packages
RUN apk add  \
    git \
    curl \
    wget \
    dos2unix \
    supervisor \
    gcompat

# Download and install IPFS Kubo (separate step for better caching and retry)
# Note: IPFS Kubo binaries are compiled for glibc, Alpine uses musl libc - gcompat provides compatibility
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

# Create users and set up directories
RUN adduser -D -s /bin/sh ipfs \
    && mkdir -p /data/ipfs \
    && mkdir -p /app/relay \
    && mkdir -p /var/log/supervisor \
    && mkdir -p /home/ipfs/.config/ipfs/denylists \
    && mkdir -p /root/.config/ipfs/denylists \
    && chown -R ipfs:ipfs /data/ipfs /home/ipfs/.config \
    && chmod -R 755 /home/ipfs/.config /root/.config

# Set up relay application
WORKDIR /app

# Copy configuration files first
COPY docker/ /app/docker/

# Convert script line endings from CRLF to LF
RUN dos2unix /app/docker/init-ipfs.sh
RUN dos2unix /app/docker/entrypoint.sh

# Set executable permissions for scripts
RUN chmod +x /app/docker/init-ipfs.sh
RUN chmod +x /app/docker/entrypoint.sh

# Copy entrypoint to final location and ensure it's executable
RUN cp /app/docker/entrypoint.sh /usr/local/bin/entrypoint.sh && \
    chmod +x /usr/local/bin/entrypoint.sh

# Create environment files with Docker-optimized settings
RUN cp /app/docker/relay.env /app/relay/.env

# Copy package files and install dependencies
COPY relay/package*.json /app/relay/
WORKDIR /app/relay
RUN npm install --omit=dev

# Copy the rest of the application
COPY relay/ /app/relay/

# Set proper permissions
RUN chown -R node:node /app \
    && chown -R ipfs:ipfs /data/ipfs \
    && chmod 755 /app/relay/src/public

# Expose ports
EXPOSE 8765 5001 8080 4001

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
