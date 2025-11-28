# Shogun Relay Full Stack Container
    && mv kubo/ipfs /usr/local/bin/ \
    && rm -rf kubo kubo_v${IPFS_VERSION}_linux-${ARCH_NAME}.tar.gz* \
    && echo "Testing IPFS binary..." \
    && /usr/local/bin/ipfs version \
    && echo "IPFS binary test successful"

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
    && chmod -R 755 /home/ipfs/.config /root/.config \
    && chmod 755 /usr/local/bin/ipfs

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