# Shogun Relay Troubleshooting Guide

## 🚨 Common Issues and Solutions

### S3 Unauthorized Error

**Symptoms:**
- `S3 Unauthorized` errors in relay server logs
- Failed file uploads to S3
- Authentication errors when accessing S3 endpoints

**Root Causes:**
- Mismatched credentials between FakeS3 and relay server
- Environment variables not properly loaded
- Service startup order issues

**Solutions:**
1. **Check Credential Consistency:**
   ```bash
   # All services should use these credentials:
   S3_ACCESS_KEY=shogun2025
   S3_SECRET_KEY=shogun2025
   S3_BUCKET=shogun-bucket
   ```

2. **Verify Service Configuration:**
   ```bash
   # Check FakeS3 logs
   docker compose logs fakes3
   
   # Check relay logs for S3 connection
   docker compose logs relay | grep -i s3
   ```

3. **Restart Services in Order:**
   ```bash
   ./docker-start.sh restart
   ```

### IPFS Disconnected

**Symptoms:**
- `IPFS disconnected` in relay server logs
- IPFS API calls failing
- Timeout errors when accessing IPFS

**Root Causes:**
- Lock files preventing IPFS startup
- Permission issues with IPFS data directory
- Service startup order problems

**Solutions:**
1. **Clean IPFS Lock Files:**
   ```bash
   docker compose down
   docker volume rm shogun-ipfs-data
   docker compose up -d
   ```

2. **Check IPFS Status:**
   ```bash
   # Test IPFS API directly
   curl http://localhost:5001/api/v0/version
   
   # Check IPFS logs
   docker compose logs ipfs
   ```

3. **Verify IPFS Configuration:**
   ```bash
   # Should show proper API binding
   docker compose exec ipfs ipfs config Addresses.API
   # Expected: /ip4/0.0.0.0/tcp/5001
   ```

## 📋 Quick Diagnostics

### Check All Services
```bash
./docker-start.sh status
```

### Test Connectivity
```bash
# Test IPFS
curl http://localhost:5001/api/v0/version

# Test FakeS3
curl http://localhost:4569

# Test Relay
curl http://localhost:8765/health
```

### View Logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f relay
docker compose logs -f ipfs
docker compose logs -f fakes3
```

## 🔧 Environment Variables Reference

### Consistent Credentials (Critical)
```env
S3_ACCESS_KEY=shogun2025
S3_SECRET_KEY=shogun2025
S3_BUCKET=shogun-bucket
ADMIN_PASSWORD=shogun2025
```

### IPFS Configuration
```env
IPFS_API_URL=http://127.0.0.1:5001
IPFS_GATEWAY_URL=http://127.0.0.1:8080
```

### S3 Configuration
```env
ENABLE_S3=true
S3_ENDPOINT=http://127.0.0.1:4569
S3_REGION=us-east-1
ALLOW_MISMATCHED_SIGNATURES=true
```

## 🚀 Service Startup Order

1. **IPFS** (priority 200) - Must initialize first
2. **FakeS3** (priority 300) - Needs to be ready before relay
3. **Relay** (priority 400) - Connects to both IPFS and S3

## 📊 Health Checks

All services include health checks:
- **IPFS**: API version endpoint
- **FakeS3**: HTTP response check
- **Relay**: Health endpoint

Wait for all services to be "healthy" before using.

## 🔄 Complete Reset

If all else fails, perform a complete reset:

```bash
# Stop and remove everything
docker compose down -v --remove-orphans

# Remove volumes
docker volume prune -f

# Restart fresh
./docker-start.sh start
```

This will delete all data but ensure a clean startup. 