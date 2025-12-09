# Gun Relay Service Dockerfile
# For CapRover deployment - build context is relay/ directory

FROM node:20-alpine

# Install curl for healthcheck
RUN apk add --no-cache curl

# Build arguments
ARG ADMIN_PASSWORD
ARG RELAY_PEERS
ARG RELAY_NAME

# Set up relay application
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the relay application
COPY src ./src

# Set proper permissions
RUN chmod -R 755 src/public

# Expose Gun relay port
EXPOSE 8765

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8765/health || exit 1

# Set environment variables
ENV NODE_ENV=production

# Start the relay server
CMD ["node", "src/index.js"]


