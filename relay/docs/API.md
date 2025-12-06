# Shogun Relay API Documentation

## Base URL
```
http://localhost:8765
```

## Authentication

Most endpoints require authentication via one of these methods:

1. **Bearer Token**: `Authorization: Bearer <ADMIN_PASSWORD>`
2. **Custom Header**: `token: <ADMIN_PASSWORD>`
3. **Session Token**: `X-Session-Token: <session_id>` (after initial auth)

### Rate Limiting
- Max 5 failed authentication attempts per IP per 15 minutes
- Sessions expire after 24 hours

## Endpoints

### Health & Status

#### GET `/health`
Health check endpoint with detailed system status.

**Response:**
```json
{
  "success": true,
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": {
    "seconds": 3600,
    "hours": 1.0,
    "formatted": "1h 0m"
  },
  "connections": {
    "active": 5,
    "total": 100
  },
  "memory": {
    "heapUsedMB": 50.5,
    "heapTotalMB": 100.0,
    "percent": 50.5,
    "rssMB": 150.0
  },
  "relay": {
    "pub": "relay_public_key...",
    "name": "shogun-relay",
    "host": "0.0.0.0",
    "port": 8765
  },
  "services": {
    "gun": "active",
    "holster": "active",
    "ipfs": "connected"
  }
}
```

#### GET `/metrics`
Detailed metrics for monitoring (requires authentication).

**Response:**
```json
{
  "timestamp": 1704067200000,
  "uptime": 3600,
  "memory": {
    "heapUsed": 52953088,
    "heapTotal": 104857600,
    "rss": 157286400,
    "external": 1024000
  },
  "cpu": {
    "user": 1000000,
    "system": 500000
  },
  "connections": {
    "active": 5,
    "total": 100
  },
  "sessions": {
    "active": 10,
    "failedAuthAttempts": 2
  }
}
```

### IPFS Operations

#### POST `/api/v1/ipfs/upload`
Upload a file to IPFS.

**Headers:**
- `Content-Type: multipart/form-data`
- `Authorization: Bearer <token>`

**Body:**
- `file`: File to upload

**Response:**
```json
{
  "success": true,
  "cid": "Qm...",
  "size": 1024,
  "path": "/ipfs/Qm..."
}
```

#### GET `/api/v1/ipfs/cat/:cid`
Retrieve file content from IPFS by CID.

**Response:**
- Binary file content or JSON if `?json=true`

#### POST `/api/v1/ipfs/pin/add`
Pin a CID to IPFS.

**Body:**
```json
{
  "cid": "Qm..."
}
```

### x402 Subscriptions

#### GET `/api/v1/x402/tiers`
List available subscription tiers.

**Response:**
```json
{
  "success": true,
  "tiers": [
    {
      "id": "basic",
      "priceUSDC": 0.001,
      "storageMB": 100,
      "priceDisplay": "0.001 USDC"
    }
  ],
  "relayStorage": {
    "unlimited": false,
    "usedGB": 5.0,
    "maxStorageGB": 100.0,
    "remainingGB": 95.0,
    "percentUsed": 5.0
  }
}
```

#### GET `/api/v1/x402/subscription/:userAddress`
Get subscription status for a user.

**Response:**
```json
{
  "success": true,
  "userAddress": "0x...",
  "subscription": {
    "active": true,
    "tier": "premium",
    "expiresAt": 1704153600000,
    "storageUsedMB": 50,
    "storageLimitMB": 500
  }
}
```

#### POST `/api/v1/x402/subscribe`
Purchase or renew a subscription.

**Body:**
```json
{
  "userAddress": "0x...",
  "tier": "premium",
  "payment": {
    "x402Version": "1.0",
    "scheme": "ethereum",
    "network": "base-sepolia",
    "payload": {
      "authorization": {
        "from": "0x...",
        "to": "0x...",
        "value": "1000000"
      },
      "signature": "0x..."
    }
  }
}
```

### Storage Deals

#### POST `/api/v1/deals/create`
Create a new storage deal.

**Body:**
```json
{
  "cid": "Qm...",
  "clientAddress": "0x...",
  "sizeMB": 100,
  "durationDays": 30,
  "tier": "premium",
  "relayAddress": "0x..."
}
```

**Response:**
```json
{
  "success": true,
  "deal": {
    "id": "0x...",
    "cid": "Qm...",
    "status": "pending"
  },
  "paymentRequired": {
    "amountAtomic": "6000000",
    "amountUSDC": "6.0"
  }
}
```

#### POST `/api/v1/deals/:dealId/activate`
Activate a deal on-chain.

**Response:**
```json
{
  "success": true,
  "onChainTx": "0x...",
  "dealId": "0x..."
}
```

### Network & Discovery

#### GET `/api/v1/network/relays`
Get list of active relays in the network.

**Response:**
```json
{
  "success": true,
  "relays": [
    {
      "address": "0x...",
      "endpoint": "https://...",
      "stake": "1000000000",
      "reputation": 85.5
    }
  ]
}
```

#### GET `/api/v1/network/reputation/:host`
Get reputation score for a relay.

**Response:**
```json
{
  "success": true,
  "host": "relay.example.com",
  "reputation": {
    "score": 85.5,
    "totalProofs": 100,
    "successfulProofs": 95,
    "uptime": 0.99
  }
}
```

## Error Responses

All endpoints return errors in this format:

```json
{
  "success": false,
  "error": "Error message",
  "reason": "Detailed reason (optional)"
}
```

### Status Codes

- `200` - Success
- `400` - Bad Request
- `401` - Unauthorized
- `402` - Payment Required (x402)
- `404` - Not Found
- `429` - Too Many Requests (rate limited)
- `500` - Internal Server Error
- `503` - Service Unavailable

## Rate Limiting

- General endpoints: 1000 requests per 15 minutes per IP
- Authentication: 5 failed attempts per 15 minutes per IP
- Upload endpoints: 100 requests per hour per IP

## WebSocket Endpoints

### GunDB WebSocket
```
ws://localhost:8765/gun
```

### Holster WebSocket
```
ws://localhost:8766
```

## IPFS Gateway

### Public Gateway
```
http://localhost:8765/ipfs/:cid
```

### IPNS Support
```
http://localhost:8765/ipns/:name
```

## Examples

### cURL Examples

#### Health Check
```bash
curl http://localhost:8765/health
```

#### Upload File
```bash
curl -X POST http://localhost:8765/api/v1/ipfs/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@example.txt"
```

#### Create Subscription
```bash
curl -X POST http://localhost:8765/api/v1/x402/subscribe \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "0x...",
    "tier": "premium",
    "payment": {...}
  }'
```

## Changelog

### v1.0.0
- Initial API documentation
- Added session-based authentication
- Enhanced health checks
- Metrics endpoint

