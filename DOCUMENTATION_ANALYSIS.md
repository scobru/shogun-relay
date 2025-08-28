# Shogun Relay Documentation Analysis

## Overview

This document analyzes the consistency between the README.md documentation and the actual API implementation in the relay folder.

## 🔍 Major Discrepancies Found

### 1. **Missing API Endpoints in Documentation**

#### GunDB Core Endpoints

**Documentation Claims:**

```bash
GET /gun                    # GunDB WebSocket connection
GET /gun.js                 # GunDB client library
GET /api/v1/system/node/:key       # Get GunDB node
POST /api/v1/system/node/:key      # Create/update GunDB node
```

**Actual Implementation:**

- ✅ `/gun` - GunDB WebSocket endpoint (via `app.use(Gun.serve)`)
- ✅ `/gun.js` - GunDB client library (via `app.use(Gun.serve)`)
- ✅ `/api/v1/system/node/*` - GunDB node operations (via system.js routes)

#### IPFS Management Endpoints

**Documentation Claims:**

```bash
POST /api/v1/ipfs/pins/add          # Add pin
POST /api/v1/ipfs/pins/rm           # Remove pin
POST /api/v1/ipfs/pins/ls           # List all pins
POST /api/v1/ipfs/repo/gc           # Garbage collection
GET  /api/v1/ipfs/version           # IPFS version info
POST /api/v1/ipfs/upload            # Upload file to IPFS
```

**Actual Implementation:**

- ✅ `/api/v1/ipfs/pins/add` - Add pin
- ✅ `/api/v1/ipfs/pins/rm` - Remove pin
- ✅ `/api/v1/ipfs/pins/ls` - List all pins
- ✅ `/api/v1/ipfs/repo/gc` - Garbage collection
- ✅ `/api/v1/ipfs/version` - IPFS version info
- ✅ `/api/v1/ipfs/upload` - Upload file to IPFS
- ✅ `/api/v1/ipfs/proxy/*` - IPFS API proxy (NOT documented)
- ✅ `/api/v1/ipfs/status` - IPFS status (NOT documented)
- ✅ `/api/v1/ipfs/content/:cid` - IPFS content retrieval (NOT documented)

#### User File Management Endpoints

**Documentation Claims:**

```bash
GET  /api/v1/user-uploads/:userAddress           # Get user files
DELETE /api/v1/user-uploads/:userAddress/:hash   # Delete user file
POST /api/v1/user-uploads/sync-mb-usage/:userAddress  # Sync MB usage
POST /api/v1/user-uploads/repair-files/:userAddress   # Repair corrupted files
GET  /api/v1/user-uploads/system-hashes          # Get all system file hashes
GET  /api/v1/user-uploads/system-hashes-map      # Get system hashes with details
POST /api/v1/user-uploads/save-system-hash       # Save hash to system hashes
DELETE /api/v1/user-uploads/remove-system-hash/:hash  # Remove hash from system hashes
```

**Actual Implementation:**

- ✅ `/api/v1/user-uploads/:identifier` - Get user files (parameter name differs)
- ✅ `/api/v1/user-uploads/:identifier/:hash` - Delete user file (parameter name differs)
- ✅ `/api/v1/user-uploads/sync-mb-usage/:userAddress` - Sync MB usage
- ❌ `/api/v1/user-uploads/repair-files/:userAddress` - NOT implemented
- ✅ `/api/v1/user-uploads/system-hashes` - Get all system file hashes
- ✅ `/api/v1/user-uploads/system-hashes-map` - Get system hashes with details
- ✅ `/api/v1/user-uploads/save-system-hash` - Save hash to system hashes
- ✅ `/api/v1/user-uploads/remove-system-hash/:hash` - Remove hash from system hashes

#### Subscription Management Endpoints

**Documentation Claims:**

```bash
GET  /api/v1/subscriptions/user-subscription-details/:userAddress  # Get subscription details
POST /api/v1/subscriptions/sync-mb-usage/:userAddress              # Sync subscription MB
```

**Actual Implementation:**

- ❌ `/api/v1/subscriptions/user-subscription-details/:userAddress` - NOT found
- ❌ `/api/v1/subscriptions/sync-mb-usage/:userAddress` - NOT found
- ✅ `/api/v1/subscriptions/subscription-status/:identifier` - Get subscription status (different endpoint)

### 2. **Missing API Endpoints in Documentation**

#### Authentication Endpoints (NOT documented)

```bash
POST /api/v1/auth/register                    # User registration
POST /api/v1/auth/login                       # User login
POST /api/v1/auth/logout                      # User logout
POST /api/v1/auth/web3/login                  # Web3 login
POST /api/v1/auth/web3/register               # Web3 registration
POST /api/v1/auth/nostr/login                 # Nostr login
POST /api/v1/auth/nostr/register              # Nostr registration
GET  /api/v1/auth/status                      # Auth status
POST /api/v1/auth/forgot                      # Forgot password
POST /api/v1/auth/reset                       # Reset password
POST /api/v1/auth/change-password             # Change password
POST /api/v1/auth/authorize-gun-key           # Authorize Gun key
DELETE /api/v1/auth/authorize-gun-key/:pubKey # Remove Gun key authorization
GET /api/v1/auth/authorize-gun-key/:pubKey    # Get Gun key authorization
GET /api/v1/auth/oauth/:provider/authorize    # OAuth authorization
POST /api/v1/auth/oauth/callback              # OAuth callback
GET /api/v1/auth/oauth/callback               # OAuth callback (GET)
```

#### User Management Endpoints (NOT documented)

```bash
GET  /api/v1/users/profile                     # Get user profile
PUT  /api/v1/users/profile                     # Update user profile
GET  /api/v1/users/:pubkey                     # Get user by pubkey
GET  /api/v1/users/search/:query               # Search users
GET  /api/v1/users/                            # Get all users
```

#### Contract Management Endpoints (NOT documented)

```bash
GET  /api/v1/contracts/config                  # Get contract configuration
GET  /api/v1/contracts/ipcm                    # Get IPCM contract config
GET  /api/v1/contracts/all                     # Get all contracts
GET  /api/v1/contracts/:contractName           # Get specific contract
GET  /api/v1/contracts/:contractName/abi       # Get contract ABI
GET  /api/v1/contracts/:contractName/address   # Get contract address
GET  /api/v1/contracts/                        # Get contracts list
GET  /api/v1/contracts/chains                  # Get available chains
```

#### Chain Contract Endpoints (NOT documented)

```bash
POST /api/v1/chain/start-events               # Start chain events
GET  /api/v1/chain/status                     # Get chain status
GET  /api/v1/chain/hash-test/:hash            # Test hash
GET  /api/v1/chain/contract-read/:soul/:key   # Read from contract
GET  /api/v1/chain/decode-test/:soul/:key     # Test decoding
GET  /api/v1/chain/debug/:soul                # Debug chain data
GET  /api/v1/chain/read/:soul/:key?           # Read chain data
GET  /api/v1/chain/events                     # Get chain events
GET  /api/v1/chain/test                       # Test chain
POST /api/v1/chain/test-sync                  # Test sync
POST /api/v1/chain/sync-custom                # Custom sync
GET  /api/v1/chain/listener-status            # Listener status
POST /api/v1/chain/test-propagation           # Test propagation
POST /api/v1/chain/restart-listener           # Restart listener
```

#### System Endpoints (NOT documented)

```bash
GET  /api/v1/system/health                    # Health check
GET  /api/v1/system/relay-info                # Relay information
GET  /api/v1/system/contract-config           # Contract configuration
GET  /api/v1/system/contract-status           # Contract status
GET  /api/v1/system/user-subscription/:userAddress  # User subscription
GET  /api/v1/system/subscription-status/:identifier # Subscription status
GET  /api/v1/system/user-subscription-details/:userAddress # Subscription details
GET  /api/v1/system/alldata                   # All system data
GET  /api/v1/system/stats                     # System stats
POST /api/v1/system/gc/trigger                # Trigger garbage collection
POST /api/v1/system/stats/update              # Update stats
GET  /api/v1/system/stats.json                # Stats JSON
POST /api/v1/system/derive                    # Derive keys
GET  /api/v1/system/node/*                    # Get GunDB node
POST /api/v1/system/node/*                    # Create/update GunDB node
DELETE /api/v1/system/node/*                  # Delete GunDB node
GET  /api/v1/system/logs                      # Get logs
DELETE /api/v1/system/logs                    # Clear logs
GET  /api/v1/system/peers                     # Get peers
POST /api/v1/system/peers/add                 # Add peer
```

#### Notes Endpoints (NOT documented)

```bash
GET  /api/v1/notes/                           # Get admin notes
POST /api/v1/notes/                           # Create admin note
DELETE /api/v1/notes/                         # Delete admin note
GET  /api/v1/notes/regular                    # Get regular notes
POST /api/v1/notes/regular                    # Create regular note
DELETE /api/v1/notes/regular                  # Delete regular note
PUT  /api/v1/notes/regular/:id                # Update regular note
GET  /api/v1/notes/regular/:id                # Get regular note
```

#### Debug Endpoints (NOT documented)

```bash
# Various debug endpoints for troubleshooting
```

#### Services Endpoints (NOT documented)

```bash
POST /api/v1/services/:service/restart        # Restart service
GET  /api/v1/services/status                  # Service status
```

#### Visual Graph Endpoints (NOT documented)

```bash
GET  /visualGraph/                            # Visual graph interface
GET  /visualGraph/visualGraph.js              # Visual graph JS
GET  /visualGraph/abstraction.js              # Abstraction JS
GET  /visualGraph/vGmain.css                  # Visual graph CSS
GET  /visualGraph/visualGraphIcon.svg         # Visual graph icon
```

### 3. **Additional Endpoints Not in Documentation**

#### IPFS Content Endpoints

```bash
GET  /ipfs-content/:cid                       # Get IPFS content
GET  /ipfs-content-json/:cid                  # Get IPFS content as JSON
```

#### Legacy Endpoints

```bash
POST /api/authorize-gun-key                   # Legacy Gun key authorization
DELETE /api/authorize-gun-key/:pubKey         # Legacy remove Gun key
GET /api/authorize-gun-key/:pubKey            # Legacy get Gun key
POST /ipfs-api/:endpoint(*)                   # Legacy IPFS API
POST /ipfs-upload                             # Legacy IPFS upload
POST /ipfs-pin                                # Legacy IPFS pin
GET /ipfs-status                              # Legacy IPFS status
GET /health                                   # Legacy health check
GET /api/relay-info                           # Legacy relay info
GET /api/contract-config                      # Legacy contract config
GET /api/contract-status                      # Legacy contract status
POST /api/user-mb-usage/:identifier/reset     # Legacy MB usage reset
```

#### UI Endpoints (NOT documented)

```bash
GET  /user-upload                             # User upload interface
GET  /admin                                   # Admin panel
GET  /subscribe                               # Subscription interface
GET  /stats                                   # Stats interface
GET  /services-dashboard                      # Services dashboard
GET  /pin-manager                             # Pin manager interface
GET  /notes                                   # Notes interface
GET  /upload                                  # Upload interface
GET  /create                                  # Create interface
GET  /view                                    # View interface
GET  /edit                                    # Edit interface
GET  /derive                                  # Derive interface
GET  /graph                                   # Graph interface
GET  /chat                                    # Chat interface
GET  /charts                                  # Charts interface
GET  /chain-contract                          # Chain contract interface
GET  /ipcm-contract                           # IPCM contract interface
GET  /drive                                   # Drive interface
GET  /auth                                    # Auth interface
GET  /lib/:filename                           # JavaScript library files
GET  /styles/:filename                        # CSS style files
```

### 4. **Parameter Name Discrepancies**

#### User Uploads

- **Documentation:** `:userAddress`
- **Implementation:** `:identifier`

#### Subscriptions

- **Documentation:** `:userAddress`
- **Implementation:** `:identifier`

### 5. **Missing Features in Documentation**

#### IPFS Proxy

The relay includes a comprehensive IPFS API proxy at `/api/v0/*` that's not documented.

#### Authentication Methods

The relay supports multiple authentication methods not documented:

- Web3 wallet authentication
- Nostr authentication
- OAuth authentication
- Gun key authorization

#### Contract Integration

The relay has extensive smart contract integration not documented:

- Chain contract for GunDB blockchain storage
- IPCM contract for IPFS CID mapping
- Multiple contract management endpoints

#### Debug and Monitoring

The relay includes extensive debug and monitoring capabilities not documented:

- System logs
- Performance stats
- Garbage collection
- Peer management

## 🚨 Critical Issues

### 1. **Missing Core Features**

- Authentication system completely undocumented
- Contract integration not mentioned
- Debug capabilities not documented
- User management system not documented

### 2. **Incorrect Endpoint Names**

- Parameter names don't match implementation
- Some documented endpoints don't exist
- Many implemented endpoints not documented

### 3. **Missing UI Documentation**

- All web interfaces not documented
- Admin panel not described
- Visual graph interface not explained

## 📋 Recommendations

### 1. **Update API Documentation**

- Add all missing endpoints
- Correct parameter names
- Document authentication methods
- Add contract integration documentation

### 2. **Add UI Documentation**

- Document all web interfaces
- Explain admin panel features
- Describe visual graph capabilities

### 3. **Improve Organization**

- Group endpoints by functionality
- Add authentication requirements
- Include request/response examples

### 4. **Add Examples**

- Provide curl examples for all endpoints
- Include JavaScript client examples
- Add authentication examples

## 📊 Summary

- **Total Documented Endpoints:** ~15
- **Total Implemented Endpoints:** ~80+
- **Documentation Coverage:** ~18%
- **Critical Missing Features:** Authentication, Contracts, UI, Debug

The documentation needs significant updates to accurately reflect the comprehensive functionality of the Shogun Relay implementation.
