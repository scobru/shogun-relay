# Gateway Service Dockerfile
# For CapRover deployment - build context is gateway/ directory

FROM node:20-alpine

# Install curl for healthcheck
RUN apk add --no-cache curl

# Set up gateway application
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy the gateway application
COPY server.js ./

# Expose gateway port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Set environment variables
ENV NODE_ENV=production

# Start the gateway server
CMD ["node", "server.js"]


