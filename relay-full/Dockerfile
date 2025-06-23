# Multi-stage build for Shogun Relay
FROM node:18-alpine AS base

# Install security updates and basic tools
RUN apk update && apk upgrade && apk add --no-cache dumb-init curl

# Create app directory
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S shogun -u 1001

# Copy package files first for better layer caching
COPY package*.json ./

# =======================
# Development Stage
# =======================
FROM base AS development

# Install all dependencies (including devDependencies)
RUN npm ci && npm cache clean --force

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p uploads logs radata

# Change ownership to non-root user
RUN chown -R shogun:nodejs /app

# Switch to non-root user
USER shogun

# Expose ports
EXPOSE 8765 8443 9229

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start in development mode with hot reload
CMD ["npm", "run", "dev"]

# =======================
# Production Stage
# =======================
FROM base AS production

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY . .

# Create necessary directories
RUN mkdir -p uploads logs radata

# Change ownership to non-root user
RUN chown -R shogun:nodejs /app

# Switch to non-root user
USER shogun

# Expose ports
EXPOSE 8765 8443

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:8765/api/status || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["npm", "start"]

# =======================
# Default target
# =======================
FROM production