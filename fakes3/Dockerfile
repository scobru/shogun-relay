FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json yarn.lock ./

# Install dependencies
RUN npm install --production

# Copy application code
COPY . .

# Create buckets directory
RUN mkdir -p buckets

# Set environment variables
ENV NODE_ENV=production
ENV S3_ACCESS_KEY=shogun2025
ENV S3_SECRET_KEY=shogun2025
ENV S3_BUCKET_NAME=shogun-bucket
ENV S3_PORT=4569
ENV S3_ADDRESS=127.0.0.1
ENV S3_STORAGE_DIRECTORY=./buckets

# Expose port
EXPOSE 4569

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://localhost:4569 || exit 1

# Start the service
CMD ["node", "index.js"] 