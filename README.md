# Shogun Relay 📡

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/your-org/shogun-relay)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)

A comprehensive, production-ready decentralized relay server for the Shogun ecosystem. Built on GunDB with enhanced performance, security features, IPFS integration, S3 storage support, and real-time monitoring capabilities.

## 🌟 Overview

Shogun Relay is an enhanced Gun.js relay server that facilitates secure, decentralized communication between nodes in the Shogun network. It provides a robust foundation for building distributed applications with features like authentication, file storage, garbage collection, and comprehensive monitoring.

## ✨ Key Features

### 🔒 Security & Authentication
- **Token-based authentication** with configurable admin access
- **Request validation** and rate limiting
- **CORS support** with configurable origins
- **Secure headers** and input sanitization

### 📁 Storage Solutions
- **IPFS Integration**: Direct IPFS API proxy with file upload/download
- **S3 Storage**: Compatible with AWS S3 and local FakeS3 server
- **GunDB Persistence**: Enhanced radisk storage with garbage collection
- **Encrypted Storage**: Support for encrypted file uploads with SEA

### 🎯 Performance & Monitoring
- **Real-time Statistics**: Connection tracking, message throughput, memory usage
- **Health Endpoints**: `/health`, `/stats`, and detailed system metrics
- **Garbage Collection**: Automatic cleanup of expired data
- **Time-series Data**: Historical performance metrics for monitoring

### 🌐 Network Features
- **Multi-peer Support**: Connect to multiple Gun.js peers
- **WebSocket Management**: Efficient connection handling
- **Proxy Services**: IPFS API and Gateway proxying
- **Admin Interface**: Web-based control panel for monitoring

## 🏗️ Architecture

The Shogun Relay consists of three main components:

### 1. Main Relay Server (`/relay`)
The core relay server with enhanced Gun.js functionality:

```
shogun-relay/relay/
├── src/
│   ├── index.js           # Main relay server implementation
│   └── public/            # Web interface and static files
│       ├── index.html     # Main control panel
│       ├── charts.html    # Performance monitoring
│       ├── graph.html     # Live graph explorer
│       ├── upload.html    # File upload interface
│       └── ...           # Additional admin tools
├── package.json          # Dependencies and configuration
└── env.example           # Environment configuration template
```

### 2. FakeS3 Server (`/fakes3`)
Local S3-compatible storage server for development and testing:

```
shogun-relay/fakes3/
├── index.js              # S3rver implementation
├── buckets/              # Local storage directory
├── example/              # Configuration examples
│   ├── cors.xml          # CORS configuration
│   └── website.xml       # Website configuration
└── package.json          # Dependencies
```

### 3. Management Scripts
Utility scripts for running the complete stack:

```
shogun-relay/
├── start-full-stack.js   # Launch relay + FakeS3 together
└── README.md            # This documentation
```

## 🚀 Quick Start

### Prerequisites

- **For Docker**: Docker Desktop or Docker Engine (recommended)
- **For Manual Setup**: Node.js >= 16.0.0, npm or yarn package manager
- Optional: IPFS Desktop or daemon for IPFS features

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/shogun-relay.git
cd shogun-relay

# Install relay dependencies
cd relay
npm install

# Install FakeS3 dependencies (optional)
cd ../fakes3
npm install
```

### Basic Setup

1. **Configure Environment Variables**:

```bash
# Copy environment template
cp relay/env.example relay/.env

# Edit configuration
nano relay/.env
```

2. **Start the Relay Server**:

```bash
cd relay
npm start
```

3. **Access the Control Panel**:
   - Open `http://localhost:8765` in your browser
   - Use the admin interface to monitor and manage your relay

## 🐳 Docker Deployment (Recommended)

The easiest way to run Shogun Relay is using Docker, which automatically includes all necessary services:

### Quick Start with Docker

```bash
# 1. Build the Docker image
docker build -t shogun-relay:latest .

# 2. Start the container with all services
docker run -d \
  --name shogun-relay-stack \
  --rm \
  -p 8765:8765 \
  -p 4569:4569 \
  -p 5001:5001 \
  -p 8080:8080 \
  -p 4001:4001 \
  shogun-relay:latest

# 3. Verify status
docker ps --filter "name=shogun-relay"
docker logs shogun-relay-stack
```

### Services Included in Container

The Docker container automatically includes:

- **🔗 Relay Server** (port 8765) - Main Gun.js server
- **📁 FakeS3** (port 4569) - Local S3-compatible storage
- **🌐 IPFS Daemon** (ports 5001, 8080, 4001) - Complete IPFS node
- **📊 Supervisor** - Service management and monitoring

### Exposed Ports

| Port | Service | Description |
|------|---------|-------------|
| 8765 | Relay Server | Main interface, Gun.js WebSocket |
| 4569 | FakeS3 | S3-compatible API for local storage |
| 5001 | IPFS API | IPFS API for programmatic operations |
| 8080 | IPFS Gateway | HTTP gateway for IPFS content access |
| 4001 | IPFS Swarm | IPFS P2P communication |

### Useful Docker Commands

```bash
# View logs in real-time
docker logs -f shogun-relay-stack

# Enter container for debugging
docker exec -it shogun-relay-stack bash

# Check internal service status
docker exec shogun-relay-stack ps aux

# Restart the container
docker restart shogun-relay-stack

# Stop and remove the container
docker stop shogun-relay-stack
```

### Advanced Docker Configuration

#### With Persistent Volume

To preserve data between restarts:

```bash
# Create volume for persistent data
docker volume create shogun-relay-data

# Start with mounted volume
docker run -d \
  --name shogun-relay-stack \
  --rm \
  -p 8765:8765 \
  -p 4569:4569 \
  -p 5001:5001 \
  -p 8080:8080 \
  -p 4001:4001 \
  -v shogun-relay-data:/data \
  shogun-relay:latest
```

#### With Environment Variables

```bash
docker run -d \
  --name shogun-relay-stack \
  --rm \
  -p 8765:8765 \
  -p 4569:4569 \
  -p 5001:5001 \
  -p 8080:8080 \
  -p 4001:4001 \
  -e ADMIN_PASSWORD=your-secure-password \
  -e GC_ENABLED=true \
  -e GC_INTERVAL=3600000 \
  shogun-relay:latest
```

#### Docker Compose (Recommended for Production)

Create a `docker-compose.yml` file:

```yaml
services:
  shogun-relay:
    build: .
    container_name: shogun-relay-stack
    restart: unless-stopped
    ports:
      - "8765:8765"   # Relay Server
      - "4569:4569"   # FakeS3
      - "5001:5001"   # IPFS API
      - "8080:8080"   # IPFS Gateway
      - "4001:4001"   # IPFS Swarm
    volumes:
      - shogun-data:/data
      - shogun-logs:/var/log/supervisor
    environment:
      - NODE_ENV=production
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-change-me}
      - GC_ENABLED=true
      - GC_INTERVAL=3600000
      - IPFS_API_URL=http://127.0.0.1:5001
      - IPFS_GATEWAY_URL=http://127.0.0.1:8080
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8765/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

volumes:
  shogun-data:
    driver: local
  shogun-logs:
    driver: local
```

Then start with:

```bash
# Start with Docker Compose
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

### Container Monitoring

#### Health Check

```bash
# Check health status
docker inspect shogun-relay-stack | grep -A 10 Health

# Manual health check test
curl http://localhost:8765/health
```

#### Metrics and Logs

```bash
# Container statistics
docker stats shogun-relay-stack

# Service-specific logs
docker exec shogun-relay-stack tail -f /var/log/supervisor/relay.log
docker exec shogun-relay-stack tail -f /var/log/supervisor/ipfs.log
docker exec shogun-relay-stack tail -f /var/log/supervisor/fakes3.log
```

### Troubleshooting Docker

#### Common Issues

1. **IPFS fails to start**:
   ```bash
   # Check IPFS logs
   docker exec shogun-relay-stack cat /var/log/supervisor/ipfs.log
   
   # Verify directories
   docker exec shogun-relay-stack ls -la /root/.config/ipfs/
   ```

2. **Ports already in use**:
   ```bash
   # Change exposed ports
   docker run -p 8766:8765 -p 4570:4569 ... shogun-relay:latest
   ```

3. **Permission issues**:
   ```bash
   # Rebuild the image
   docker build --no-cache -t shogun-relay:latest .
   ```

4. **Container not responding**:
   ```bash
   # Complete restart
   docker stop shogun-relay-stack
   docker rm shogun-relay-stack
   docker run -d --name shogun-relay-stack ... shogun-relay:latest
   ```

### Docker Updates

```bash
# 1. Stop current container
docker stop shogun-relay-stack

# 2. Backup data (if needed)
docker cp shogun-relay-stack:/data ./backup-data

# 3. Rebuild the image
docker build -t shogun-relay:latest .

# 4. Start new container
docker run -d --name shogun-relay-stack ... shogun-relay:latest
```

### Production Deployment

For production use, configure the following environment variables:

```bash
# Core Configuration
RELAY_HOST=your-domain.com
RELAY_PORT=8765
ADMIN_PASSWORD=your-secure-admin-password

# Storage Configuration
ENABLE_S3=true
S3_ENDPOINT=https://s3.amazonaws.com
S3_BUCKET=your-bucket-name
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key

# IPFS Configuration
IPFS_API_URL=http://127.0.0.1:5001
IPFS_GATEWAY_URL=http://127.0.0.1:8080
IPFS_API_TOKEN=your-ipfs-token

# Performance Tuning
GC_ENABLED=true
GC_INTERVAL=3600000
GC_EXPIRATION_AGE=86400000
```

## 📖 Detailed Documentation

### Core Features

#### 1. Enhanced Gun.js Relay

The main relay server (`relay/src/index.js`) provides:

- **Multi-peer networking** with automatic peer discovery
- **Radisk persistence** with configurable storage paths
- **Real-time statistics** tracking connections and performance
- **Graceful shutdown** handling with proper cleanup

#### 2. IPFS Integration

Complete IPFS support with:

```javascript
// File upload to IPFS
POST /ipfs-upload
Content-Type: multipart/form-data
Authorization: Bearer <admin-token>

// Access IPFS content
GET /ipfs/<hash>
GET /ipfs-content/<hash>?token=<encryption-token>

// IPFS API proxy
POST /api/v0/<endpoint>
Authorization: Bearer <admin-token>
```

#### 3. S3 Storage Support

AWS S3 and FakeS3 compatibility:

```javascript
// Upload to S3
POST /s3-upload
Authorization: Bearer <admin-token>

// Download from S3
GET /s3-file/<bucket>/<key>

// Get file metadata
GET /s3-info/<bucket>/<key>

// Delete file
DELETE /s3-file/<bucket>/<key>
```

#### 4. Data Management

Advanced data operations:

```javascript
// Access any Gun node
GET /node/<path>
POST /node/<path>
DELETE /node/<path>

// Get all graph data
GET /api/alldata
Authorization: Bearer <admin-token>

// Key derivation for crypto operations
POST /api/derive
{
  "password": "user-password",
  "extra": "additional-data",
  "options": {...}
}
```

### Web Interface Features

#### Control Panel (`/`)
- Server status and configuration
- Real-time connection monitoring
- Quick access to all admin tools

#### Statistics Dashboard (`/stats`)
- Real-time performance metrics
- Memory usage tracking
- Connection statistics
- Historical data visualization

#### Graph Explorer (`/graph`)
- Live Gun.js graph visualization
- Node inspection and navigation
- Real-time data updates
- Search and filter capabilities

#### File Upload Interface (`/upload`)
- IPFS file upload with encryption
- S3 storage upload options
- Upload progress tracking
- File management tools

#### Additional Tools
- `/charts` - Advanced performance charts
- `/notes` - Admin notes and documentation
- `/pin-manager` - IPFS pin management
- `/s3-dashboard` - S3 storage monitoring

### Security Features

#### Authentication System
```javascript
// All admin endpoints require authentication
Authorization: Bearer <admin-password>
// or
token: <admin-password>
```

#### Request Validation
- Input sanitization and validation
- File type and size restrictions
- Rate limiting and abuse prevention
- Secure error handling

#### Data Protection
- End-to-end encryption for file uploads
- Secure key derivation using shogun-core
- Protected namespace management
- Automatic data expiration

### Performance Optimization

#### Garbage Collection
Automatic cleanup of expired data:

```javascript
// Protected namespaces (never deleted)
const GC_EXCLUDED_NAMESPACES = [
  '~',              // User spaces
  '!',              // Root node
  'relays',         // Relay health data
  'shogun-relay',   // App data
];

// Configurable expiration
const EXPIRATION_AGE = 24 * 60 * 60 * 1000; // 24 hours
const GC_INTERVAL = 60 * 60 * 1000;         // 1 hour
```

#### Connection Management
- Active connection tracking
- Automatic timeout handling
- Connection pool optimization
- WebSocket management

#### Memory Monitoring
- Real-time memory usage tracking
- Automatic garbage collection triggers
- Memory leak detection
- Performance alerts

## 🔧 Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RELAY_HOST` | System IP | Server hostname or IP |
| `RELAY_PORT` | 8765 | Server port |
| `RELAY_STORE` | true | Enable persistent storage |
| `RELAY_PATH` | "public" | Static files directory |
| `ADMIN_PASSWORD` | - | Admin authentication token |
| `ENABLE_S3` | false | Enable S3 storage |
| `S3_ENDPOINT` | AWS default | S3 service endpoint |
| `S3_BUCKET` | - | S3 bucket name |
| `S3_ACCESS_KEY` | - | S3 access key |
| `S3_SECRET_KEY` | - | S3 secret key |
| `IPFS_API_URL` | http://127.0.0.1:5001 | IPFS API endpoint |
| `IPFS_GATEWAY_URL` | http://127.0.0.1:8080 | IPFS gateway URL |
| `IPFS_API_TOKEN` | - | IPFS API authentication |
| `GC_ENABLED` | false | Enable garbage collection |
| `GC_INTERVAL` | 3600000 | GC run interval (ms) |
| `GC_EXPIRATION_AGE` | 86400000 | Data expiration time (ms) |

### FakeS3 Configuration

For local development and testing:

| Variable | Default | Description |
|----------|---------|-------------|
| `ACCESS_KEY` | S3RVER | FakeS3 access key |
| `SECRET_KEY` | S3RVER | FakeS3 secret key |
| `BUCKET_NAME` | test-bucket | Default bucket name |
| `PORT` | 4569 | FakeS3 server port |
| `ADDRESS` | localhost | FakeS3 bind address |

## 🛠️ Development

### Running the Full Stack

Start both relay and FakeS3 servers:

```bash
# Start complete stack
node start-full-stack.js

# Or manually start each component
cd relay && npm start &
cd fakes3 && npm start &
```

### Development Mode

With auto-restart on file changes:

```bash
cd relay
npm run dev
```

### Testing IPFS Integration

1. Install IPFS Desktop or start IPFS daemon
2. Verify IPFS connectivity at `/ipfs-status`
3. Test file upload at `/upload`
4. Check IPFS gateway at `/ipfs/<hash>`

### Testing S3 Storage

1. Start FakeS3 server: `cd fakes3 && npm start`
2. Configure relay with S3 settings
3. Test uploads at `/upload`
4. Monitor S3 dashboard at `/s3-dashboard`

## 📊 Monitoring & Maintenance

### Health Checks

```bash
# Basic health check
curl http://localhost:8765/health

# Detailed statistics
curl http://localhost:8765/api/stats

# IPFS status
curl http://localhost:8765/ipfs-status
```

### Log Monitoring

The relay provides comprehensive logging:

```
🚀 Enhanced Gun Relay started on port 8765
📊 Metrics enabled: true
🔍 Health check enabled: true
💾 Radisk persistence: radata
🌐 Peers: http://localhost:8766/gun
✅ IPFS node is responsive
✅ S3 storage enabled
📊 Metrics - Active: 45, Total: 150, Messages: 5420
```

### Performance Metrics

Available metrics include:
- Active/total connections
- Message throughput (gets/puts per second)
- Memory usage and garbage collection
- IPFS and S3 operation status
- Time-series performance data

## 🔗 Integration

### Client Connection

Connect to the relay from your application:

```javascript
// Gun.js client
const gun = Gun(['http://localhost:8765/gun']);

// Shogun Core integration
import { ShogunCore } from 'shogun-core';

const shogun = new ShogunCore({
  peers: ['http://localhost:8765/gun'],
  scope: 'my-app'
});
```

### File Upload Integration

```javascript
// Upload file to IPFS
const formData = new FormData();
formData.append('file', fileBlob);

const response = await fetch('/ipfs-upload', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`
  },
  body: formData
});

const result = await response.json();
console.log('IPFS hash:', result.file.hash);
```

## 🚀 Production Deployment

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY relay/ ./relay/
COPY fakes3/ ./fakes3/

# Install dependencies
RUN cd relay && npm ci --only=production
RUN cd fakes3 && npm ci --only=production

# Set environment
ENV NODE_ENV=production
ENV ADMIN_PASSWORD=your-secure-password

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8765/health || exit 1

# Expose ports
EXPOSE 8765 4569

# Start services
CMD node start-full-stack.js
```

### Load Balancer Configuration

Example Nginx configuration:

```nginx
upstream shogun_relay {
    least_conn;
    server relay1.example.com:8765;
    server relay2.example.com:8765;
    server relay3.example.com:8765;
}

server {
    listen 443 ssl http2;
    server_name relay.example.com;

    location /gun {
        proxy_pass http://shogun_relay;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    location /health {
        proxy_pass http://shogun_relay;
        access_log off;
    }

    location / {
        proxy_pass http://shogun_relay;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Monitoring Setup

Integrate with monitoring tools:

```bash
# Prometheus metrics
curl http://localhost:8765/api/stats

# Health checks for uptime monitoring
curl http://localhost:8765/health

# Log aggregation
tail -f relay/logs/relay.log | grep ERROR
```

## 🤝 Contributing

We welcome contributions! Please follow these guidelines:

1. **Fork the repository** and create a feature branch
2. **Follow code style** and existing patterns
3. **Add tests** for new functionality
4. **Update documentation** for any changes
5. **Test thoroughly** including edge cases
6. **Submit a pull request** with clear description

### Development Setup

```bash
# Clone and setup
git clone https://github.com/your-org/shogun-relay.git
cd shogun-relay

# Install all dependencies
cd relay && npm install
cd ../fakes3 && npm install

# Run tests
npm test

# Start development environment
npm run dev
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: Check this README and inline code comments
- **Issues**: [GitHub Issues](https://github.com/your-org/shogun-relay/issues)
- **Community**: Join our Discord/Telegram for real-time support
- **Commercial Support**: Contact us for enterprise support options

## 🔮 Roadmap

### Upcoming Features

- [ ] **Cluster Mode**: Multi-process relay with load balancing
- [ ] **Plugin System**: Extensible plugin architecture
- [ ] **Advanced Analytics**: Enhanced monitoring and alerting
- [ ] **Auto-scaling**: Dynamic resource management
- [ ] **Backup/Restore**: Automated data backup solutions
- [ ] **Admin API**: RESTful API for programmatic management

### Performance Goals

- **10,000+ concurrent connections** per relay instance
- **Sub-100ms latency** for real-time operations
- **99.9% uptime** with proper clustering
- **Automatic recovery** from network partitions

---

**Built with ❤️ by the Shogun Team**

*Part of the [Shogun Ecosystem](https://github.com/your-org/shogun-2) - Decentralized infrastructure for the future of the web.*
