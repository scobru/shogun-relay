# Shogun Relay 📡

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/your-org/shogun-relay)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D16.0.0-brightgreen.svg)](https://nodejs.org/)

A comprehensive, production-ready decentralized relay server for the Shogun ecosystem. Built on GunDB with enhanced performance, security features, IPFS integration, and real-time monitoring capabilities.

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

The Shogun Relay consists of two main components:

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

### 2. Management Scripts
Utility scripts for running the complete stack:

```
shogun-relay/
├── docker-compose.yml   # Docker configuration
├── Dockerfile           # Docker build instructions
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

The easiest way to run Shogun Relay is using the provided start script with Docker. This will set up and launch all necessary services automatically.

### Quick Start with `docker-start.sh`

From the root of the `shogun-relay` directory, simply run:

```bash
./docker-start.sh
```

This script will:
1. Check if Docker is running.
2. Stop any old containers.
3. Build the latest Docker image.
4. Start all services in the background.
5. Display the status and available service URLs.

### Manual Docker Compose Commands

If you prefer to manage the services manually, you can use `docker-compose`:

```bash
# 1. Build the image
docker-compose build

# 2. Start the services
docker-compose up -d

# 3. Verify status
docker-compose ps
docker-compose logs -f
```

### Services Included in Container

The Docker container automatically includes:

- **🔗 Relay Server** (port 8765) - Main Gun.js server
- **🌐 IPFS Daemon** (ports 5001, 8080, 4001) - Complete IPFS node
- **📊 Supervisor** - Service management and monitoring

### Exposed Ports

| Port | Service | Description |
|------|---------|-------------|
| 8765 | Relay Server | Main interface, Gun.js WebSocket |
| 5001 | IPFS API | IPFS API for programmatic operations |
| 8080 | IPFS Gateway | HTTP gateway for IPFS content access |
| 4001 | IPFS Swarm | IPFS P2P communication |

### Useful Docker Commands

```bash
# View logs in real-time
docker-compose logs -f

# Enter container for debugging
docker-compose exec shogun-relay-stack bash

# Check internal service status
docker-compose exec shogun-relay-stack supervisorctl status

# Restart the services
docker-compose restart

# Stop and remove the container and volumes
docker-compose down -v
```

### Advanced Docker Configuration

See the `docker-compose.yml` file for advanced configuration options, including setting environment variables and managing persistent volumes.

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

#### 3. Data Management

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
- **Centralized Authentication**: Single admin token management for all tools
- Server status and configuration with real-time metrics
- Real-time connection monitoring and health indicators
- Quick access to all admin tools with streamlined navigation
- Auto-sync password across all interface components

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
- Upload progress tracking
- File management tools

#### Additional Tools
- `/charts` - Advanced performance charts
- `/notes` - Admin notes and documentation
- `/pin-manager` - IPFS pin management
- `/derive` - Shogun key derivation tool
- `/client` - Minimal messenger interface
- `/chat` - Public relay chat

### Security Features

#### Centralized Authentication System
The relay features a centralized authentication system using `admin-auth.js`:

- **Centralized Token Management**: Set admin token once in the Control Panel
- **Auto-fill Functionality**: Automatically loads saved tokens across all pages
- **Secure Storage**: Tokens are stored securely in localStorage
- **Sync Across Pages**: Token updates propagate to all open tabs

```javascript
// All admin endpoints require authentication
Authorization: Bearer <admin-password>
// or
token: <admin-password>
```

#### Optimized UI
- **Removed Redundant Auth Boxes**: Authentication is now centralized in index.html
- **Streamlined Interface**: Cleaner UI without repetitive authentication fields
- **Auto-loading**: Admin tokens are automatically loaded where needed

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
| `IPFS_API_URL` | http://127.0.0.1:5001 | IPFS API endpoint |
| `IPFS_GATEWAY_URL` | http://127.0.0.1:8080 | IPFS gateway URL |
| `IPFS_API_TOKEN` | - | IPFS API authentication |
| `GC_ENABLED` | false | Enable garbage collection |
| `GC_INTERVAL` | 3600000 | GC run interval (ms) |
| `GC_EXPIRATION_AGE` | 86400000 | Data expiration time (ms) |

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

// With authentication middleware for admin operations
Gun.on("opt", function (ctx) {
  if (ctx.once) return;
  ctx.on("out", function (msg) {
    const to = this.to;
    const authToken = 'your-admin-token';
    if (authToken && msg.put) {
      msg.headers = { ...msg.headers, token: authToken };
    }
    to.next(msg);
  });
});

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

**Built with ❤️ by Scobru**

*Part of the [Shogun Ecosystem](https://github.com/scobru/shogun) - Decentralized infrastructure for the future of the web.*
