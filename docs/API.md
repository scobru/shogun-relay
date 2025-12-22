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
Upload a single file to IPFS.

**Headers:**
- `Content-Type: multipart/form-data`
- `Authorization: Bearer <token>` (admin) OR `X-User-Address: <address>` (user with subscription)
- `X-Deal-Upload: true` (optional, for storage deals)

**Body:**
- `file`: File to upload

**Response:**
```json
{
  "success": true,
  "file": {
    "hash": "Qm...",
    "name": "file.txt",
    "size": 1024,
    "mimetype": "text/plain"
  },
  "cid": "Qm..."
}
```

#### POST `/api/v1/ipfs/upload-directory`
Upload multiple files as a directory to IPFS. Maintains directory structure using relative paths.

**Headers:**
- `Content-Type: multipart/form-data`
- `Authorization: Bearer <token>` (admin) OR `X-User-Address: <address>` (user with subscription)
- `X-Deal-Upload: true` (optional, for storage deals)

**Body:**
- `files`: Multiple files with relative paths (e.g., `index.html`, `css/style.css`, `js/app.js`)

**Example:**
```bash
curl -X POST http://localhost:8765/api/v1/ipfs/upload-directory \
  -H "Authorization: Bearer <token>" \
  -F "files=@index.html" \
  -F "files=@css/style.css" \
  -F "files=@js/app.js"
```

**Response:**
```json
{
  "success": true,
  "cid": "QmDirectoryHash...",
  "directoryCid": "QmDirectoryHash...",
  "fileCount": 3,
  "totalSize": 15360,
  "totalSizeMB": 0.015,
  "files": [
    {
      "name": "index.html",
      "path": "index.html",
      "size": 5120,
      "mimetype": "text/html"
    },
    {
      "name": "style.css",
      "path": "css/style.css",
      "size": 2048,
      "mimetype": "text/css"
    },
    {
      "name": "app.js",
      "path": "js/app.js",
      "size": 8192,
      "mimetype": "application/javascript"
    }
  ]
}
```

**Notes:**
- Files are uploaded to IPFS with `wrap-with-directory=true` to maintain directory structure
- The returned `directoryCid` can be used to access files via `/ipfs/{directoryCid}/path/to/file`
- For user uploads with x402 subscriptions, storage limits are checked against total size

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

### User Uploads & Metadata

These endpoints are used by drive applications to manage file metadata in the GunDB systemhash node.

#### GET `/api/v1/user-uploads/system-hashes-map`
Get the complete system hashes map with metadata for all files.

**Headers:**
- `Authorization: Bearer <token>` (admin token required)

**Response:**
```json
{
  "success": true,
  "systemHashes": {
    "QmHash1...": {
      "hash": "QmHash1...",
      "userAddress": "drive-user",
      "timestamp": 1704067200000,
      "uploadedAt": 1704067200000,
      "fileName": "example.txt",
      "displayName": "example.txt",
      "originalName": "example.txt",
      "fileSize": 1024,
      "contentType": "text/plain",
      "isEncrypted": false,
      "relayUrl": "http://localhost:8765/api/v1/ipfs/cat/QmHash1..."
    },
    "QmDirectoryHash...": {
      "hash": "QmDirectoryHash...",
      "userAddress": "drive-user",
      "timestamp": 1704067200000,
      "isDirectory": true,
      "fileCount": 5,
      "displayName": "My Folder",
      "files": [
        {
          "name": "file1.txt",
          "path": "file1.txt",
          "size": 512,
          "mimetype": "text/plain"
        }
      ]
    }
  },
  "count": 2,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

#### POST `/api/v1/user-uploads/save-system-hash`
Save file or directory metadata to the system hash map.

**Headers:**
- `Authorization: Bearer <token>` (admin token required)
- `Content-Type: application/json`

**Body:**
```json
{
  "hash": "QmHash...",
  "userAddress": "drive-user",
  "timestamp": 1704067200000,
  "fileName": "example.txt",
  "displayName": "example.txt",
  "originalName": "example.txt",
  "fileSize": 1024,
  "contentType": "text/plain",
  "isEncrypted": false,
  "isDirectory": false,
  "fileCount": 0,
  "files": [],
  "relayUrl": "http://localhost:8765/api/v1/ipfs/cat/QmHash...",
  "uploadedAt": 1704067200000
}
```

**Required fields:**
- `hash`: IPFS CID
- `userAddress`: User identifier

**Response:**
```json
{
  "success": true,
  "message": "Hash saved to systemhash node successfully",
  "hash": "QmHash...",
  "userAddress": "drive-user",
  "timestamp": 1704067200000
}
```

#### DELETE `/api/v1/user-uploads/remove-system-hash/:cid`
Remove file metadata from the system hash map.

**Headers:**
- `Authorization: Bearer <token>` (admin token required)
- `Content-Type: application/json`

**Parameters:**
- `cid`: IPFS CID to remove (path parameter)

**Body (optional):**
```json
{
  "userAddress": "drive-user"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Hash removed from systemhash node successfully",
  "hash": "QmHash...",
  "userAddress": "drive-user",
  "timestamp": 1704067200000
}
```

**Notes:**
- These endpoints are primarily used by drive applications built on top of the relay
- Metadata is stored in GunDB's `shogun.systemhash` node
- The system hash map enables applications to track file metadata, directory structures, and file relationships
- See the SDK documentation for browser-friendly methods to interact with these endpoints

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

