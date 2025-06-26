# Shogun Relay Full Stack Container
# Includes: IPFS, Relay Server, FakeS3

FROM node:20-alpine

# Install required system packages
RUN apk add --no-cache \
    curl \
    wget \
    bash \
    supervisor \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Set working directory
WORKDIR /app

# Install IPFS (Kubo) - fix for Alpine Linux compatibility
ENV IPFS_VERSION=0.24.0
RUN apk add --no-cache libc6-compat \
    && wget https://dist.ipfs.tech/kubo/v${IPFS_VERSION}/kubo_v${IPFS_VERSION}_linux-amd64.tar.gz \
    && tar -xzf kubo_v${IPFS_VERSION}_linux-amd64.tar.gz \
    && chmod +x kubo/ipfs \
    && mv kubo/ipfs /usr/local/bin/ \
    && rm -rf kubo kubo_v${IPFS_VERSION}_linux-amd64.tar.gz \
    && /usr/local/bin/ipfs version || echo "IPFS binary test failed"

# Create IPFS user and directories
RUN adduser -D -s /bin/sh ipfs \
    && mkdir -p /data/ipfs /app/relay /app/fakes3 /var/log/supervisor \
    && mkdir -p /home/ipfs/.config/ipfs/denylists /root/.config/ipfs/denylists \
    && chown -R ipfs:ipfs /data/ipfs /home/ipfs/.config \
    && chmod -R 755 /home/ipfs/.config /root/.config

# Copy application files
COPY relay/ /app/relay/
COPY fakes3/ /app/fakes3/
COPY start-full-stack.js /app/
COPY docker/ /app/docker/

# Install Node.js dependencies
RUN cd /app/relay && npm install --omit=dev
RUN cd /app/fakes3 && npm install --omit=dev

# Create environment files with Docker-optimized settings
RUN cp /app/docker/relay.env /app/relay/.env \
    && cp /app/docker/fakes3.env /app/fakes3/.env

# Set proper permissions
RUN chmod +x /app/docker/*.sh \
    && chown -R node:node /app \
    && chmod 755 /app/relay/src/public

# Expose ports
EXPOSE 8765 4569 5001 8080 4001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8765/health || exit 1

# Use supervisor to manage multiple services
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Set environment variables
ENV NODE_ENV=production

# Start all services with supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"] 