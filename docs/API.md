# Shogun Relay API Documentation

## Base URL

```
http://localhost:8765
```

## Authentication

Most endpoints require authentication via one of these methods:

### Admin Authentication

1. **Bearer Token**: `Authorization: Bearer <ADMIN_PASSWORD>`
2. **Custom Header**: `token: <ADMIN_PASSWORD>`
3. **Session Token**: `X-Session-Token: <session_id>` (after initial auth)

Admin authentication allows full access to all endpoints without additional requirements.

### User Authentication (Wallet Signature)

For user-based operations (uploads, deals, subscriptions), you need:

1. **Wallet Address**: `X-User-Address: <ethereum_address>`
2. **Wallet Signature**: `X-Wallet-Signature: <signature>`

The signature must be a valid EIP-191 signature of the message `"I Love Shogun"` signed by the wallet address.

**Example:**

```javascript
// Using ethers.js
const message = "I Love Shogun";
const signature = await signer.signMessage(message);

// Include in request headers
headers: {
  'X-User-Address': walletAddress,
  'X-Wallet-Signature': signature
}
```

### Deal Upload Authentication

For storage deal uploads (paid on-chain), you need:

- `X-User-Address: <address>`
- `X-Wallet-Signature: <signature>`
- `X-Deal-Upload: true` (or `?deal=true` query parameter)

No subscription required for deal uploads.

### Rate Limiting

- Max 5 failed authentication attempts per IP per 15 minutes
- Sessions expire after 24 hours
- Upload endpoints: 100 requests per hour per IP

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

**Authentication Options:**

1. **Admin Upload** (no signature required):

   - `Authorization: Bearer <ADMIN_PASSWORD>`
   - Optional: `X-User-Address: <address>` (for tracking)

2. **User Upload with Subscription** (requires signature):

   - `X-User-Address: <ethereum_address>`
   - `X-Wallet-Signature: <signature>` (EIP-191 signature of "I Love Shogun")
   - Requires active x402 subscription

3. **Deal Upload** (requires signature, no subscription):
   - `X-User-Address: <ethereum_address>`
   - `X-Wallet-Signature: <signature>` (EIP-191 signature of "I Love Shogun")
   - `X-Deal-Upload: true` (or `?deal=true` query parameter)

**Headers:**

- `Content-Type: multipart/form-data`
- Authentication headers (see above)

**Body:**

- `file`: File to upload
- `encrypted`: `"true"` or `"false"` (optional, for encrypted files)
- `encryptionMethod`: `"SEA"` (optional, if encrypted)
- `encryptionToken`: Signature token (optional, for encrypted files)

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
  "cid": "Qm...",
  "authType": "admin" | "user",
  "mbUsage": {
    "actualSizeMB": 0.001,
    "sizeMB": 1,
    "verified": true
  },
  "subscription": {
    "storageUsedMB": 45.2,
    "storageRemainingMB": 54.8
  }
}
```

**Error Responses:**

- `401 Unauthorized`: Missing or invalid authentication
  - `"Wallet signature required"`: Missing `X-Wallet-Signature` header
  - `"Invalid wallet signature"`: Signature doesn't match address
- `402 Payment Required`: No active subscription (for user uploads without deal flag)

#### POST `/api/v1/ipfs/upload-directory`

Upload multiple files as a directory to IPFS. Maintains directory structure using relative paths.

**Authentication:** Same as `/api/v1/ipfs/upload` (see above)

**Headers:**

- `Content-Type: multipart/form-data`
- Authentication headers (admin token OR wallet signature)
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

**Query Parameters:**

- `json=true` (optional): Return content as JSON instead of binary

**Response:**

- Binary file content or JSON if `?json=true`

#### GET `/api/v1/ipfs/cat/:cid/decrypt`

Decrypt and retrieve encrypted file content from IPFS.

**Query Parameters:**

- `token`: Encryption token (wallet signature used for encryption)

**Headers:**

- `X-User-Address`: (optional) User address for signature verification

**Response:**

- Decrypted binary file content

**Example:**

```bash
curl "http://localhost:8765/api/v1/ipfs/cat/Qm.../decrypt?token=0xYourSignature" \
  -H "X-User-Address: 0xYourWalletAddress"
```

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

#### GET `/api/v1/x402/subscriptions`

List all active subscriptions (admin only).

**Response:**

```json
{
  "success": true,
  "count": 1,
  "subscriptions": [
    {
      "userAddress": "0x...",
      "tier": "premium",
      "isActive": true,
      "status": "active"
    }
  ]
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

### Torrents

#### GET `/api/v1/torrent/status`

List all active torrents managed by the relay.

**Headers:**
- `Authorization: Bearer <ADMIN_TOKEN>`

**Response:**

```json
{
  "success": true,
  "data": {
    "activeTorrents": 2,
    "downloadSpeed": 1024000,
    "uploadSpeed": 512000,
    "ratio": 1.5,
    "torrents": [
      {
        "infoHash": "...",
        "name": "Ubuntu 22.04",
        "progress": 1.0,
        "state": "seeding",
        "downloadSpeed": 0,
        "uploadSpeed": 10240,
        "numPeers": 50,
        "files": [
          {
            "name": "ubuntu.iso",
            "path": "ubuntu.iso",
            "length": 1000000000
          }
        ]
      }
    ]
  }
}
```

#### POST `/api/v1/torrent/add`

Add a torrent to the manager via magnet link or torrent file URL.

**Headers:**
- `Authorization: Bearer <ADMIN_TOKEN>`
- `Content-Type: application/json`

**Body:**

```json
{
  "magnet": "magnet:?xt=urn:btih:..."
}
```

#### POST `/api/v1/torrent/control`

Control a torrent (pause, resume, remove).

**Headers:**
- `Authorization: Bearer <ADMIN_TOKEN>`
- `Content-Type: application/json`

**Body:**

```json
{
  "infoHash": "...",
  "action": "pause" | "resume" | "remove",
  "deleteFiles": false
}
```

#### GET `/api/v1/torrent/search`

Search for content across configured sources (Internet Archive).

**Query Parameters:**
- `q`: Search query
- `sources`: `internet-archive` (default)
- `limit`: Number of results (default 25)

**Response:**

```json
{
  "success": true,
  "results": [
    {
      "source": "internet-archive",
      "identifier": "...",
      "title": "...",
      "size": 1048576,
      "seeders": 10,
      "magnetUri": "magnet:?..."
    }
  ]
}
```

#### GET `/api/v1/torrent/search/internet-archive`

Direct search to Internet Archive.

**Query Parameters:**
- `q`: Search query
- `mediaType`: Filter by media type (audio, video, texts, software, etc.)
- `rows`: Number of results

---

### Chat

#### GET `/api/v1/chat/peers`

List potential chat peers from network discovery.

**Headers:**
- `Authorization: Bearer <ADMIN_TOKEN>`

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "pub": "...",
      "alias": "...",
      "lastSeen": 1234567890
    }
  ]
}
```

#### GET `/api/v1/chat/conversations`

List active chat conversations.

**Headers:**
- `Authorization: Bearer <ADMIN_TOKEN>`

**Response:**

```json
{
  "success": true,
  "data": {}
}
```

#### GET `/api/v1/chat/messages/:pub`

Get message history for a peer.

**Headers:**
- `Authorization: Bearer <ADMIN_TOKEN>`

**Response:**

```json
{
  "success": true,
  "data": []
}
```

#### POST `/api/v1/chat/messages/:pub`

Send a private encrypted message.

**Headers:**
- `Authorization: Bearer <ADMIN_TOKEN>`
- `Content-Type: application/json`

**Body:**

```json
{
  "text": "Hello world"
}
```

#### POST `/api/v1/chat/console`

Execute a bot command.

**Headers:**
- `Authorization: Bearer <ADMIN_TOKEN>`
- `Content-Type: application/json`

**Body:**

```json
{
  "command": "/help"
}
```

#### GET `/api/v1/chat/lobby`

Get public lobby messages.

#### POST `/api/v1/chat/lobby`

Send public lobby message.

**Body:**

```json
{
  "text": "Hello lobby"
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

#### Upload File (Admin)

```bash
curl -X POST http://localhost:8765/api/v1/ipfs/upload \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -F "file=@example.txt"
```

#### Upload File (User with Wallet Signature)

```bash
# First, sign the message "I Love Shogun" with your wallet
# Then use the signature in the request:
curl -X POST http://localhost:8765/api/v1/ipfs/upload \
  -H "X-User-Address: 0xYourWalletAddress" \
  -H "X-Wallet-Signature: 0xYourSignature" \
  -F "file=@example.txt"
```

#### Upload File (Deal Upload - No Subscription Required)

```bash
curl -X POST "http://localhost:8765/api/v1/ipfs/upload?deal=true" \
  -H "X-User-Address: 0xYourWalletAddress" \
  -H "X-Wallet-Signature: 0xYourSignature" \
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

## Admin Drive

Admin-only file storage system for managing files and folders on the relay server. All endpoints require admin authentication.

### Base Path

```
/api/v1/drive
```

### List Directory

**GET** `/api/v1/drive/list` or `/api/v1/drive/list/{path}`

List files and folders in the specified directory. Omit path for root directory.

**Parameters:**
- `path` (path, optional): Directory path (omit for root)

**Example:**

```bash
curl -X GET "http://localhost:8765/api/v1/drive/list" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD"
```

**Response:**

```json
{
  "success": true,
  "items": [
    {
      "name": "document.pdf",
      "path": "document.pdf",
      "type": "file",
      "size": 1024,
      "modified": 1699123456000
    },
    {
      "name": "folder1",
      "path": "folder1",
      "type": "directory",
      "size": 0,
      "modified": 1699123456000
    }
  ],
  "path": ""
}
```

### Upload Files

**POST** `/api/v1/drive/upload/{path}`

Upload one or multiple files. Use `file` field for single file, `files` field for multiple files. Omit path for root directory.

**Parameters:**
- `path` (path, optional): Directory path (omit for root)

**Example (single file):**

```bash
curl -X POST "http://localhost:8765/api/v1/drive/upload" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -F "file=@example.txt"
```

**Example (multiple files):**

```bash
curl -X POST "http://localhost:8765/api/v1/drive/upload" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -F "files=@file1.txt" \
  -F "files=@file2.txt"
```

### Download File

**GET** `/api/v1/drive/download/{path}`

Download a file from the drive.

**Parameters:**
- `path` (path, required): File path to download

**Example:**

```bash
curl -X GET "http://localhost:8765/api/v1/drive/download/document.pdf" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -o downloaded_file.pdf
```

### Delete Item

**DELETE** `/api/v1/drive/delete/{path}`

Delete a file or directory (recursive for directories).

**Parameters:**
- `path` (path, required): Item path to delete

**Example:**

```bash
curl -X DELETE "http://localhost:8765/api/v1/drive/delete/document.pdf" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD"
```

### Create Directory

**POST** `/api/v1/drive/mkdir` or `/api/v1/drive/mkdir/{path}`

Create a new directory. Omit path for root directory.

**Parameters:**
- `path` (path, optional): Parent directory path (omit for root)

**Request Body:**

```json
{
  "name": "new-folder"
}
```

**Example:**

```bash
curl -X POST "http://localhost:8765/api/v1/drive/mkdir" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"name": "new-folder"}'
```

### Rename Item

**POST** `/api/v1/drive/rename`

Rename a file or directory.

**Request Body:**

```json
{
  "oldPath": "old-name.txt",
  "newName": "new-name.txt"
}
```

**Example:**

```bash
curl -X POST "http://localhost:8765/api/v1/drive/rename" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"oldPath": "old-name.txt", "newName": "new-name.txt"}'
```

### Move Item

**POST** `/api/v1/drive/move`

Move a file or directory to a new location.

**Request Body:**

```json
{
  "sourcePath": "file.txt",
  "destPath": "folder1/file.txt"
}
```

**Example:**

```bash
curl -X POST "http://localhost:8765/api/v1/drive/move" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"sourcePath": "file.txt", "destPath": "folder1/file.txt"}'
```

### Get Storage Statistics

**GET** `/api/v1/drive/stats`

Get storage usage statistics.

**Example:**

```bash
curl -X GET "http://localhost:8765/api/v1/drive/stats" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD"
```

**Response:**

```json
{
  "success": true,
  "stats": {
    "totalBytes": 1048576,
    "totalSizeMB": "1.00",
    "totalSizeGB": "0.0010",
    "fileCount": 10,
    "dirCount": 3
  }
}
```

## API Keys

Generic API key management service for programmatic access to all relay services (Drive, IPFS, etc.). API keys are more secure for automation as they:
- Can be revoked individually without changing your password
- Don't expose your main credentials
- Can have optional expiration dates
- Track last usage time
- Can be used across all relay services (Drive, IPFS, etc.)

**Note**: API keys are stored in the relay's GunDB user space and are accessible only by the relay.

### Base Path

```
/api/v1/api-keys
```

### List API Keys

**GET** `/api/v1/api-keys`

List all API keys for the drive. Requires admin authentication.

**Example:**

```bash
curl -X GET "http://localhost:8765/api/v1/api-keys" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD"
```

**Response:**

```json
{
  "success": true,
  "keys": [
    {
      "keyId": "abc123...",
      "name": "My App Key",
      "createdAt": 1699123456000,
      "lastUsedAt": 1699200000000,
      "expiresAt": null
    }
  ]
}
```

### Create API Key

**POST** `/api/v1/api-keys`

Generate a new API key. Requires admin authentication.

**Request Body:**

```json
{
  "name": "My App Key",
  "expiresInDays": 30
}
```

- `name` (string, required): A descriptive name for the API key
- `expiresInDays` (number, optional): Number of days until the key expires (omit for no expiration)

**Example:**

```bash
curl -X POST "http://localhost:8765/api/v1/api-keys" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"name": "My App Key", "expiresInDays": 30}'
```

**Response:**

```json
{
  "success": true,
  "keyId": "abc123...",
      "token": "shogun-api-abc123...",
  "name": "My App Key",
  "createdAt": 1699123456000,
  "expiresAt": 1701715456000,
  "message": "Save this token securely. It will not be shown again."
}
```

**Important**: The `token` field is only shown once when the key is created. Save it securely.

### Revoke API Key

**DELETE** `/api/v1/api-keys/{keyId}`

Revoke (delete) an API key. Requires admin authentication.

**Example:**

```bash
curl -X DELETE "http://localhost:8765/api/v1/api-keys/abc123..." \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD"
```

**Response:**

```json
{
  "success": true,
  "message": "API key revoked successfully"
}
```

### Using API Keys

Once you have an API key, you can use it exactly like the admin password in the `Authorization` header. API keys work across all relay services:

**Drive:**
```bash
curl -X GET "http://localhost:8765/api/v1/drive/list" \
  -H "Authorization: Bearer shogun-api-abc123..."
```

**IPFS:**
```bash
curl -X POST "http://localhost:8765/api/v1/ipfs/pin/add" \
  -H "Authorization: Bearer shogun-api-abc123..." \
  -H "Content-Type: application/json" \
  -d '{"cid": "QmHash..."}'
```

All endpoints that accept admin authentication also accept API keys. API keys use the prefix `shogun-api-`.

## Drive Public Links

You can generate public sharing links for files in the drive. These links allow anyone with the URL to access the file without authentication.

### Create Public Link

**POST** `/api/v1/drive/links`

Create a public sharing link for a file. Requires admin or API key authentication.

**Request Body:**

```json
{
  "filePath": "document.pdf",
  "expiresInDays": 7
}
```

- `filePath` (string, required): Path to the file to share
- `expiresInDays` (number, optional): Number of days until the link expires (omit for no expiration)

**Example:**

```bash
curl -X POST "http://localhost:8765/api/v1/drive/links" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -H "Content-Type: application/json" \
  -d '{"filePath": "document.pdf", "expiresInDays": 7}'
```

**Response:**

```json
{
  "success": true,
  "linkId": "abc123...",
  "filePath": "document.pdf",
  "publicUrl": "http://localhost:8765/api/v1/drive/public/abc123...",
  "createdAt": 1699123456000,
  "expiresAt": 1699728256000
}
```

### List Public Links

**GET** `/api/v1/drive/links`

List all public links. Requires admin or API key authentication.

**Example:**

```bash
curl -X GET "http://localhost:8765/api/v1/drive/links" \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD"
```

**Response:**

```json
{
  "success": true,
  "links": [
    {
      "linkId": "abc123...",
      "filePath": "document.pdf",
      "createdAt": 1699123456000,
      "expiresAt": 1699728256000,
      "accessCount": 42,
      "lastAccessedAt": 1699200000000
    }
  ]
}
```

### Revoke Public Link

**DELETE** `/api/v1/drive/links/{linkId}`

Revoke (delete) a public link. Requires admin or API key authentication.

**Example:**

```bash
curl -X DELETE "http://localhost:8765/api/v1/drive/links/abc123..." \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD"
```

**Response:**

```json
{
  "success": true,
  "message": "Public link revoked successfully"
}
```

### Access File via Public Link

**GET** `/api/v1/drive/public/{linkId}`

Access a file via public link. **NO AUTHENTICATION REQUIRED**.

**Example:**

```bash
curl -X GET "http://localhost:8765/api/v1/drive/public/abc123..." \
  -o downloaded_file.pdf
```

Or simply open the URL in a browser. The file will be served directly with appropriate content-type headers.

### Visual Graph

#### GET `/api/v1/visualGraph`

Get the visual graph HTML interface.

**Response:**

- HTML content of the visual graph interface.

## Changelog

### v1.3.0 (2025-12-27)

- **Added Generic API Keys**: API key management service for programmatic access to all relay services
  - Generate, list, and revoke API keys
  - Optional expiration dates
  - Last usage tracking
  - Keys stored securely in relay's GunDB user space
  - Usable across all services (Drive, IPFS, etc.)
  - Endpoints moved from `/api/v1/drive/keys` to `/api/v1/api-keys`
- **Added Drive Public Links**: Public file sharing system
  - Generate public sharing links for files
  - Optional expiration dates
  - Access count tracking
  - Links stored in relay's GunDB user space
  - Public access endpoint (no authentication required)

### v1.2.0 (2025-01-XX)

- **Added Admin Drive**: New admin-only file storage system with full CRUD operations
- **File Management**: Upload, download, delete, rename, move files and folders
- **Storage Statistics**: Track total storage usage, file count, and directory count
- **Path Validation**: Security measures to prevent path traversal attacks

### v1.1.0 (2025-12-25)

- **Added Wallet Signature Authentication**: User uploads now require EIP-191 signature of "I Love Shogun" message
- **Admin Upload Enhancement**: Admin uploads no longer require wallet signature or user address
- **Deal Upload Support**: Added `X-Deal-Upload` header for storage deal uploads (no subscription required)
- **Enhanced Upload Response**: Added `authType`, `mbUsage`, and `subscription` fields to upload responses
- **Improved Error Messages**: Better error hints for authentication failures

### v1.0.0

- Initial API documentation
- Added session-based authentication
- Enhanced health checks
- Metrics endpoint
