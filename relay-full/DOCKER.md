# 🐳 Docker Setup for Shogun Relay

This directory contains the Docker configuration for running Shogun Relay in containerized environments.

## 📋 Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- At least 2GB of available memory
- At least 5GB of available disk space

## 🚀 Quick Start

### Production Deployment

1. **Copy the environment template:**
   ```bash
   cp env.example .env
   ```

2. **Edit the `.env` file with your configuration:**
   ```bash
   nano .env
   ```

3. **Start the services:**
   ```bash
   docker-compose up -d
   ```

4. **View logs:**
   ```bash
   docker-compose logs -f
   ```

### Development Setup

1. **Use the development compose file:**
   ```bash
   docker-compose -f docker-compose.dev.yml up
   ```

2. **With IPFS node (optional):**
   ```bash
   docker-compose -f docker-compose.dev.yml --profile ipfs up
   ```

## 🔧 Configuration

### Environment Variables

The most important environment variables to configure:

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `SECRET_TOKEN` | Authentication token for the relay | `changeme-in-production` | ✅ |
| `IPFS_ENABLED` | Enable IPFS integration | `false` | ❌ |
| `ONCHAIN_MEMBERSHIP_ENABLED` | Enable blockchain features | `false` | ❌ |
| `LOG_LEVEL` | Logging level (debug, info, warn, error) | `info` | ❌ |

### File Persistence

The following directories are mounted as volumes for persistence:
- `./uploads` - Uploaded files
- `./logs` - Application logs  
- `./radata` - Gun database files
- `./config.json` - Configuration file

## 🛠️ Available Commands

### Production Commands

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# View logs
docker-compose logs -f shogun-relay

# Restart services
docker-compose restart

# Update and restart
docker-compose pull && docker-compose up -d
```

### Development Commands

```bash
# Start development environment
docker-compose -f docker-compose.dev.yml up

# Start with IPFS node
docker-compose -f docker-compose.dev.yml --profile ipfs up

# Run with debugger
docker-compose -f docker-compose.dev.yml up shogun-relay-dev

# View development logs
docker-compose -f docker-compose.dev.yml logs -f
```

### Maintenance Commands

```bash
# Build image manually
docker-compose build

# Clean up unused containers and images
docker system prune -a

# Backup data
docker run --rm -v shogun-relay-full_shogun-uploads:/data -v $(pwd):/backup alpine tar czf /backup/uploads-backup.tar.gz -C /data .

# Restore data
docker run --rm -v shogun-relay-full_shogun-uploads:/data -v $(pwd):/backup alpine tar xzf /backup/uploads-backup.tar.gz -C /data
```

## 🔍 Troubleshooting

### Common Issues

1. **Port already in use:**
   ```bash
   # Change ports in docker-compose.yml or .env
   PORT=8766
   ```

2. **Permission denied errors:**
   ```bash
   # Fix ownership of mounted directories
   sudo chown -R 1001:1001 uploads logs radata
   ```

3. **Container won't start:**
   ```bash
   # Check logs for detailed error messages
   docker-compose logs shogun-relay
   ```

4. **Out of disk space:**
   ```bash
   # Clean up old containers and images
   docker system prune -a
   ```

### Health Checks

The production container includes health checks:

```bash
# Check container health
docker-compose ps

# Manual health check
curl http://localhost:8765/api/status
```

### Debugging

For development debugging:

```bash
# Attach debugger (port 9229 exposed in dev mode)
# Use your IDE or Chrome DevTools

# Execute commands inside container
docker-compose exec shogun-relay-dev sh

# View real-time logs
docker-compose logs -f shogun-relay-dev
```

## 🔒 Security Considerations

### Production Security

1. **Change default credentials:**
   - Set a strong `SECRET_TOKEN`
   - Change `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD`

2. **Use SSL certificates:**
   - Mount your certificates to `/app/keys/`
   - Set `CERT_PATH` and `PRIVKEY_PATH`

3. **Network security:**
   - Use a reverse proxy (nginx, traefik)
   - Configure proper CORS settings
   - Disable unnecessary services

4. **File permissions:**
   - Ensure mounted directories have correct permissions
   - Don't run as root (handled automatically)

### Development Security

- The development setup is more permissive for testing
- Don't use development settings in production
- CORS is disabled by default in development

## 📊 Monitoring

### Health Monitoring

The container exposes several endpoints for monitoring:

- `GET /api/status` - General server status
- `GET /api/relay/network-status` - Network and relay status
- `GET /check-websocket` - WebSocket connection check

### Log Monitoring

Logs are written to:
- Container stdout/stderr (visible with `docker-compose logs`)
- `/app/logs/` directory (mounted volume)

### Resource Monitoring

```bash
# Monitor resource usage
docker stats shogun-relay-server

# Monitor disk usage
docker system df
```

## 🔄 Updates

### Updating the Application

1. **Pull latest changes:**
   ```bash
   git pull origin main
   ```

2. **Rebuild and restart:**
   ```bash
   docker-compose down
   docker-compose build --no-cache
   docker-compose up -d
   ```

3. **Verify update:**
   ```bash
   docker-compose logs -f shogun-relay
   ```

## 🤝 Support

If you encounter issues with the Docker setup:

1. Check the logs: `docker-compose logs -f`
2. Verify your configuration: `cat .env`
3. Test connectivity: `curl http://localhost:8765/api/status`
4. Review this documentation
5. Check the main project README for additional troubleshooting

## 📚 Additional Resources

- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- [Docker Best Practices](https://docs.docker.com/develop/best-practices/)
- [Node.js Docker Guide](https://nodejs.org/en/docs/guides/nodejs-docker-webapp/) 