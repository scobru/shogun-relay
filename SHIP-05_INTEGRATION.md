# SHIP-05 Integration Guide - Shogun Relay

This document explains how Shogun Relay integrates with SHIP-05 (Decentralized File Storage) and provides optimal endpoint configuration.

## 📡 Relay Endpoints for SHIP-05

### Upload Endpoint
```
POST /api/v1/ipfs/upload
```

**Authentication**: Admin token required  
**Headers**:
```
Authorization: Bearer <admin-token>
token: <admin-token>
```

**Request**: `multipart/form-data` with `file` field  
**Response**:
```json
{
  "success": true,
  "file": {
    "hash": "QmHash...",
    "size": 12345,
    "timestamp": 1234567890
  }
}
```

### Download Endpoint
```
GET /api/v1/ipfs/content/:cid
```

**Authentication**: Admin token required for encrypted files  
**Headers**:
```
Authorization: Bearer <admin-token>
token: <admin-token>
```

**Response**: Raw file content (binary or decrypted)

### Pin Management
```
POST /api/v1/ipfs/pins/add    # Add pin
POST /api/v1/ipfs/pins/rm     # Remove pin
POST /api/v1/ipfs/pins/ls     # List pins
```

**Request Body** (for add/rm):
```json
{
  "cid": "QmHash..."
}
```

## 🔧 SHIP-05 Configuration

### Option 1: Using shogun-ipfs (Recommended)

```typescript
import { ShogunIpfs } from "shogun-ipfs";

const storage = ShogunIpfs({
  service: "CUSTOM",
  config: {
    url: "https://relay.shogun-eco.xyz/api/v1/ipfs",
    token: process.env.ADMIN_TOKEN
  }
});

// Upload encrypted file
const encryptedBuffer = Buffer.from(encryptedData);
const result = await storage.uploadBuffer(encryptedBuffer, {
  filename: "encrypted-file.bin"
});

// Download
const downloaded = await storage.get(result.id);

// Unpin
await storage.unpin(result.id);
```

### Option 2: Direct SHIP-05 Implementation

```typescript
import { SHIP_00 } from "shogun-core/ship";
import { SHIP_05 } from "shogun-core/ship";

// Initialize identity
const identity = new SHIP_00({
  gunOptions: { peers: ["https://relay.shogun-eco.xyz/gun"] }
});
await identity.login("alice", "password123");

// Initialize storage
const storage = new SHIP_05(identity, {
  ipfsService: "CUSTOM",
  ipfsConfig: {
    customApiUrl: "https://relay.shogun-eco.xyz/api/v1/ipfs",
    customToken: process.env.ADMIN_TOKEN
  },
  maxFileSizeMB: 100
});

await storage.initialize();

// Upload with SEA encryption
const file = Buffer.from(fileData);
const result = await storage.uploadFile(file, { encrypt: true });

// Download and decrypt
const decrypted = await storage.downloadFile(result.hash, { decrypt: true });
```

## 🔄 Endpoint Auto-Discovery

`shogun-ipfs` with `CUSTOM` service automatically tries endpoints:

### Upload Attempts (in order)
1. ✅ `/api/v1/ipfs/upload` - **Relay format** (used by Shogun Relay)
2. `/api/v1/ipfs/api/v0/add` - Standard IPFS API
3. `/api/v1/ipfs/add` - Simplified format

### Download Attempts (in order)
1. ✅ `/api/v1/ipfs/content/{hash}` - **Relay format** (used by Shogun Relay)
2. `/api/v1/ipfs/ipfs/{hash}` - Gateway format
3. `/api/v1/ipfs/api/v0/cat?arg={hash}` - IPFS API format

### Unpin
1. ✅ `/api/v1/ipfs/pins/rm` - **Relay format** (used by Shogun Relay)

**Result**: Works with Shogun Relay out of the box! 🎉

## 📊 Comparison: Direct API vs shogun-ipfs

| Feature | Direct Fetch | shogun-ipfs |
|---------|--------------|-------------|
| **Code Complexity** | ~200 LOC | ~20 LOC |
| **Error Handling** | Manual | Automatic |
| **Retry Logic** | Manual | Built-in |
| **Rate Limiting** | Manual | Built-in (10 req/sec) |
| **Type Safety** | Partial | Full TypeScript |
| **Browser Support** | ✅ Yes | ❌ No (Node.js only) |
| **Maintenance** | Per-project | Centralized |

## 🎯 Recommended Configuration

### For CLI Tools (Node.js)
```typescript
// Use shogun-ipfs
const storage = ShogunIpfs({
  service: "CUSTOM",
  config: {
    url: "https://relay.shogun-eco.xyz/api/v1/ipfs",
    token: process.env.ADMIN_TOKEN
  }
});
```

### For Web Apps (Browser)
```typescript
// Use SHIP-05 with fallback (already implemented)
const storage = new SHIP_05(identity, {
  ipfsService: "CUSTOM",
  ipfsConfig: {
    customApiUrl: "https://relay.shogun-eco.xyz/api/v1/ipfs",
    customToken: adminToken
  }
});
```

## 🔐 Authentication Flow

1. **User logs in** via SHIP-00 (GunDB)
2. **Admin token** configured for relay access
3. **SEA keypair** used for file encryption (SHIP-00)
4. **Relay token** used for IPFS upload/download/pin
5. **Metadata** stored on GunDB (decentralized)
6. **Files** stored on IPFS (via relay)

## 🛡️ Security Considerations

1. **Encryption**: Always use SEA encryption (SHIP-00) for sensitive files
2. **Admin Token**: Keep relay admin token secure
3. **HTTPS**: Always use HTTPS for custom gateways
4. **Public IPFS**: Remember that IPFS content is publicly accessible by hash
5. **Metadata**: File metadata on GunDB is encrypted if user authenticated

## 📈 Performance Tips

1. **Use uploadBuffer**: Avoid temporary files for encrypted data
2. **Rate Limiting**: Built-in (10 req/sec for CUSTOM)
3. **Batch Operations**: Consider delays between bulk uploads
4. **Pin Management**: Regularly unpin unused files
5. **Caching**: File metadata cached in memory by SHIP-05

## 🧪 Testing

### Test Upload
```bash
# Using CLI
cd shogun-core
yarn storage <username> <password>

# Choose option 7 to configure relay
Gateway/Relay URL: https://relay.shogun-eco.xyz/api/v1/ipfs
Auth Token: shogun2025

# Choose option 1 to upload
Enter file path: ./README.md
Encrypt: y
```

### Verify on Relay
```bash
# Check IPFS status
curl https://relay.shogun-eco.xyz/api/v1/ipfs/status

# List pins (requires auth)
curl -X POST https://relay.shogun-eco.xyz/api/v1/ipfs/pins/ls \
  -H "Authorization: Bearer shogun2025"
```

## 🔗 Related Documentation

- [SHIP-05 Specification](../shogun-core/ship/SHIP_05.md)
- [Shogun Relay README](./README.md)
- [shogun-ipfs README](../shogun-ipfs/README.md)
- [SHIP-00 Specification](../shogun-core/ship/SHIP_00.md)

---

**Last Updated**: 2025-10-11  
**Version Compatibility**:
- shogun-ipfs: ≥1.1.0
- shogun-core: ≥2.0.0
- shogun-relay: ≥1.0.0

