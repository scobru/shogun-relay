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

# Install required system packages and IPFS
RUN apk add --no-cache \
    git \
    curl \
    wget \
    dos2unix \
    supervisor \
    && ARCH=$(uname -m) \
    && case $ARCH in \
    x86_64) ARCH_NAME="amd64" ;; \
    aarch64) ARCH_NAME="arm64" ;; \
    *) echo "Unsupported architecture: $ARCH"; exit 1 ;; \
    esac \
    && echo "Downloading IPFS Kubo v${IPFS_VERSION} for ${ARCH_NAME}..." \
    && wget -q https://dist.ipfs.tech/kubo/v${IPFS_VERSION}/kubo_v${IPFS_VERSION}_linux-${ARCH_NAME}.tar.gz \
    && wget -q https://dist.ipfs.tech/kubo/v${IPFS_VERSION}/kubo_v${IPFS_VERSION}_linux-${ARCH_NAME}.tar.gz.sha512 \
    && echo "Verifying checksum..." \
    && sha512sum -c kubo_v${IPFS_VERSION}_linux-${ARCH_NAME}.tar.gz.sha512 \
    && echo "Extracting IPFS..." \
    && tar -xzf kubo_v${IPFS_VERSION}_linux-${ARCH_NAME}.tar.gz \
    && echo "Checking extracted files..." \
    && ls -la kubo/ || (echo "ERROR: kubo directory not found after extraction" && exit 1) \
    && test -f kubo/ipfs || (echo "ERROR: kubo/ipfs binary not found" && exit 1) \
    && echo "Setting permissions..." \
    && chmod +x kubo/ipfs \
    && echo "Installing IPFS to /usr/local/bin..." \
    && cp kubo/ipfs /usr/local/bin/ipfs \
    && chmod 755 /usr/local/bin/ipfs \
    && echo "Verifying installation..." \
    && test -f /usr/local/bin/ipfs || (echo "ERROR: IPFS binary not found in /usr/local/bin" && exit 1) \
    && /usr/local/bin/ipfs version || (echo "ERROR: IPFS binary is not executable" && exit 1) \
    && echo "Cleaning up..." \
    && rm -rf kubo kubo_v${IPFS_VERSION}_linux-${ARCH_NAME}.tar.gz* \
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
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Set environment variables
ENV NODE_ENV=production
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

# Start all services with supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]