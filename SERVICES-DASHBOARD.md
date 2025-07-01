# Services Dashboard

## Overview

The Services Dashboard provides real-time monitoring and control capabilities for all Shogun Relay services including Gun Relay, IPFS, and S3 storage.

## Features

### 🔍 **Real-time Monitoring**
- **Gun Relay**: Active connections, total connections, memory usage, uptime
- **IPFS Node**: Status, version, type, API/Gateway ports  
- **S3 Storage**: Buckets count, total objects, storage size
- **Auto-refresh**: Updates every 30 seconds automatically

### ⚡ **Service Management**
- **Individual Service Restart**: Restart specific services (Gun, IPFS, S3)
- **Health Checks**: Comprehensive service health verification
- **Garbage Collection**: Trigger memory cleanup for Gun Relay
- **Service Status Alerts**: Visual indicators and alerts for offline services

### 📊 **Visual Status Indicators**
- 🟢 **Green**: Service online and healthy
- 🔴 **Red**: Service offline or unreachable  
- 🟡 **Yellow**: Service warning state
- ⚪ **Gray**: Unknown/checking status

## Access

Navigate to: `http://localhost:8765/services-dashboard.html`

## Authentication

Service restart operations require admin authentication:
1. Set admin password in environment: `ADMIN_PASSWORD=your_secure_password`
2. The dashboard will prompt for credentials when needed
3. Password is stored securely in browser's localStorage

## API Endpoints

### Health & Monitoring
- `GET /health` - Gun Relay health status
- `GET /ipfs-status` - IPFS node status  
- `GET /api/s3-stats` - S3 storage statistics (requires auth)
- `GET /api/services/status` - Combined status of all services

### Service Control  
- `POST /api/services/{service}/restart` - Restart specific service (requires auth)
- `POST /api/gc/trigger` - Trigger garbage collection (requires auth)

**Supported services**: `gun`, `ipfs`, `s3`

## Docker Integration

The dashboard integrates with Docker to perform actual service restarts:

### Container Management
- **Primary Container**: `shogun-relay-stack` 
- **Service-Specific Restarts**: Uses `supervisorctl` for individual services
- **Fallback**: Full container restart if service-specific restart fails

### Restart Strategies
1. **Gun Relay**: Full container restart (Gun is the main process)
2. **IPFS**: Restart IPFS daemon via supervisorctl, fallback to container restart
3. **S3**: Restart FakeS3 service via supervisorctl, fallback to container restart

## Usage Guide

### Starting the Dashboard
1. Ensure Shogun Relay stack is running: `docker-compose up -d`
2. Access dashboard: `http://localhost:8765/services-dashboard.html`
3. Dashboard will auto-initialize and start monitoring

### Monitoring Services
- **Status Cards**: View current status of each service
- **Metrics**: Real-time connection counts, memory usage, storage stats  
- **Alerts**: Automatic notifications when services go offline
- **Logs**: View real-time service monitoring logs

### Restarting Services
1. Click the **🔄 Restart** button on any service card
2. Enter admin password when prompted
3. Confirm restart operation
4. Monitor logs for restart progress
5. Service status will auto-refresh after restart

### Troubleshooting
- **Service Offline**: Check Docker containers are running
- **Auth Required**: Set `ADMIN_PASSWORD` environment variable
- **Restart Failed**: Check Docker daemon is running and accessible
- **No Response**: Verify relay server is running on port 8765

## Security Notes

⚠️ **Important Security Considerations**:
- Admin password required for all restart operations
- Dashboard uses bearer token authentication
- Credentials stored in browser localStorage only
- Service restart operations are logged
- Docker socket access required for container operations

## Development

### File Structure
```
shogun-relay/relay/src/public/
├── services-dashboard.html     # Main dashboard interface
├── styles/
│   └── wormhole.css           # Custom styling
└── assets/                     # Dashboard assets
```

### Dependencies
- **TailwindCSS**: UI framework and styling
- **DaisyUI**: Component library  
- **Dockerode**: Docker API integration (server-side)
- **Fetch API**: Service communication

## Logs and Monitoring

### Dashboard Logs
- Real-time service monitoring events
- Restart operation results  
- Error messages and warnings
- Auto-clearing after 50 entries

### Server Logs  
- Service restart requests logged to console
- Docker operation results
- Authentication attempts
- Health check failures

## Configuration

### Environment Variables
```bash
ADMIN_PASSWORD=your_secure_password    # Required for service restarts
IPFS_API_URL=http://localhost:5001     # IPFS API endpoint
S3_ENDPOINT=http://localhost:4569      # S3/FakeS3 endpoint  
```

### Docker Compose Services
```yaml
services:
  shogun-relay:
    ports:
      - "8765:8765"    # Main relay + dashboard
      - "8080:8080"    # IPFS Gateway
      - "5001:5001"    # IPFS API
      - "4569:4569"    # FakeS3 API
```

---

**Dashboard URL**: http://localhost:8765/services-dashboard.html  
**Repository**: [Shogun Relay](https://github.com/your-org/shogun-relay)  
**Version**: 1.0.0