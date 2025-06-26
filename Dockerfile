# Shogun Relay Full Stack Container
# Includes: IPFS, Relay Server, FakeS3

FROM node:18-alpine

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

# Install IPFS (Kubo)
ENV IPFS_VERSION=0.24.0
RUN wget https://dist.ipfs.tech/kubo/v${IPFS_VERSION}/kubo_v${IPFS_VERSION}_linux-amd64.tar.gz \
    && tar -xzf kubo_v${IPFS_VERSION}_linux-amd64.tar.gz \
    && mv kubo/ipfs /usr/local/bin/ \
    && rm -rf kubo kubo_v${IPFS_VERSION}_linux-amd64.tar.gz

# Create IPFS user and directories
RUN adduser -D -s /bin/sh ipfs \
    && mkdir -p /data/ipfs /app/relay /app/fakes3 \
    && chown -R ipfs:ipfs /data/ipfs

# Copy application files
COPY relay/ /app/relay/
COPY fakes3/ /app/fakes3/
COPY start-full-stack.js /app/
COPY docker/ /app/docker/

# Install Node.js dependencies
RUN cd /app/relay && npm ci --only=production \
    && cd /app/fakes3 && npm ci --only=production

# Create environment files with Docker-optimized settings
RUN cp /app/docker/relay.env /app/relay/.env \
    && cp /app/docker/fakes3.env /app/fakes3/.env

# Set proper permissions
RUN chmod +x /app/docker/*.sh \
    && chown -R node:node /app \
    && chmod 755 /app/relay/src/public

# Expose ports
EXPOSE 8765 4569 5001 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8765/health || exit 1

# Use supervisor to manage multiple services
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Set environment variables
ENV NODE_ENV=production
ENV IPFS_PATH=/data/ipfs
ENV IPFS_GATEWAY=127.0.0.1:8080
ENV IPFS_API=127.0.0.1:5001

# Start all services with supervisor
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"] 