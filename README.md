# Shogun Relay

A complete **GunDB relay server** with integrated IPFS storage, authentication, decentralized user management, and advanced file storage system.

![Shogun Relay Admin Panel](image.png)
_Shogun Relay Admin Panel - Complete control interface for managing your decentralized infrastructure_

## 🚀 Features

### 🔐 Authentication & Security

- **Admin Authentication**: Centralized admin token management with auto-fill
- **IPFS API Protection**: JWT-based authentication for IPFS API endpoints
- **Wallet Signature Authentication**: Ethereum wallet-based authentication for user operations
- **Rate Limiting**: Protection against abuse and spam

### 🌐 GunDB Relay Core

- **Decentralized Database**: Full GunDB relay with WebSocket support
- **Real-time Synchronization**: Live data sync across all connected peers
- **Graph Database**: Hierarchical data structure with soul/key/value pairs
- **WebRTC Support**: Peer-to-peer connections for enhanced decentralization
- **Local Storage**: Persistent data storage with radisk
- **Garbage Collection**: Automatic cleanup of unused data

### 📁 File Management System

- **User File Uploads**: Decentralized file storage with GunDB metadata
- **IPFS Integration**: Direct IPFS storage with pin management
- **File Encryption**: Optional file encryption before upload
- **Storage Quotas**: MB-based storage tracking and limits
- **File Repair**: Automatic repair of corrupted file metadata

### 🎯 Visual Graph Interface

- **Real-time Data Visualization**: Interactive D3.js graph exploration
- **GunDB Integration**: Direct connection to decentralized database
- **DFS Traversal**: Depth-First Search for comprehensive node exploration
- **Data Inspector**: View and edit node properties in real-time
- **Load All Nodes Mode**: Direct loading for complete graph visualization

### 🗂️ IPFS Pin Manager

- **Comprehensive Pin Management**: Add, remove, and list IPFS pins
- **Batch Operations**: Bulk unpin with progress tracking
- **System File Preservation**: Protect user uploads during bulk operations
- **Garbage Collection**: Integrated IPFS garbage collection
- **Connection Testing**: IPFS API connectivity verification

### 📊 User Management

- **Subscription System**: Ethereum-based subscription management
- **MB Usage Tracking**: Real-time storage usage calculation
- **File Synchronization**: Off-chain MB usage sync
- **User Profiles**: Decentralized user profile management

## �� API Endpoints

### 🔐 Authentication & User Management

```bash
# User Authentication
POST /api/v1/auth/register                    # User registration
POST /api/v1/auth/login                       # User login
POST /api/v1/auth/logout                      # User logout
GET  /api/v1/auth/status                      # Auth status
POST /api/v1/auth/forgot                      # Forgot password
POST /api/v1/auth/reset                       # Reset password
POST /api/v1/auth/change-password             # Change password

# Web3 Authentication
POST /api/v1/auth/web3/login                  # Web3 wallet login
POST /api/v1/auth/web3/register               # Web3 wallet registration

# Nostr Authentication
POST /api/v1/auth/nostr/login                 # Nostr login
POST /api/v1/auth/nostr/register              # Nostr registration

# OAuth Authentication
GET  /api/v1/auth/oauth/:provider/authorize   # OAuth authorization
POST /api/v1/auth/oauth/callback              # OAuth callback
GET  /api/v1/auth/oauth/callback              # OAuth callback (GET)

# Gun Key Authorization
POST /api/v1/auth/authorize-gun-key           # Authorize Gun key
DELETE /api/v1/auth/authorize-gun-key/:pubKey # Remove Gun key authorization
GET  /api/v1/auth/authorize-gun-key/:pubKey   # Get Gun key authorization

# User Management
GET  /api/v1/users/profile                     # Get user profile
PUT  /api/v1/users/profile                     # Update user profile
GET  /api/v1/users/:pubkey                     # Get user by pubkey
GET  /api/v1/users/search/:query               # Search users
GET  /api/v1/users/                            # Get all users
```

### 🗄️ GunDB Core

```bash
# GunDB WebSocket endpoint
GET /gun                    # GunDB WebSocket connection
GET /gun.js                 # GunDB client library

# GunDB REST API
GET  /api/v1/system/node/*                    # Get GunDB node
POST /api/v1/system/node/*                    # Create/update GunDB node
DELETE /api/v1/system/node/*                  # Delete GunDB node
```

### 📁 IPFS Management (Integrated)

```bash
# Pin Management
POST /api/v1/ipfs/pins/add          # Add pin
POST /api/v1/ipfs/pins/rm           # Remove pin
POST /api/v1/ipfs/pins/ls           # List all pins
POST /api/v1/ipfs/repo/gc           # Garbage collection
GET  /api/v1/ipfs/version           # IPFS version info
GET  /api/v1/ipfs/status            # IPFS status
GET  /api/v1/ipfs/repo/stat         # IPFS repository stats

# File Upload & Content
POST /api/v1/ipfs/upload            # Upload file to IPFS
GET  /api/v1/ipfs/content/:cid      # Get IPFS content
GET  /api/v1/ipfs/content-json/:cid # Get IPFS content as JSON

# IPFS API Proxy (Admin only)
GET  /api/v1/ipfs/proxy/*           # IPFS API proxy endpoints
GET  /api/v1/ipfs/test              # Test IPFS connection

# IPFS Gateway
GET  /ipfs/*                         # IPFS gateway access
GET  /ipns/*                         # IPNS gateway access
```

### 📤 User File Management

```bash
# User Uploads (Note: uses :identifier instead of :userAddress)
GET  /api/v1/user-uploads/:identifier           # Get user files
DELETE /api/v1/user-uploads/:identifier/:hash   # Delete user file
POST /api/v1/user-uploads/sync-mb-usage/:userAddress  # Sync MB usage

# System File Management
GET  /api/v1/user-uploads/system-hashes          # Get all system file hashes
GET  /api/v1/user-uploads/system-hashes-map      # Get system hashes with details
POST /api/v1/user-uploads/save-system-hash       # Save hash to system hashes
DELETE /api/v1/user-uploads/remove-system-hash/:hash  # Remove hash from system hashes
```

### 💳 Subscription Management

```bash
# Subscriptions (Note: uses :identifier instead of :userAddress)
GET  /api/v1/subscriptions/subscription-status/:identifier  # Get subscription status
```

### ⛓️ Smart Contract Integration

```bash
# Contract Management
GET  /api/v1/contracts/config                  # Get contract configuration
GET  /api/v1/contracts/ipcm                    # Get IPCM contract config
GET  /api/v1/contracts/all                     # Get all contracts
GET  /api/v1/contracts/:contractName           # Get specific contract
GET  /api/v1/contracts/:contractName/abi       # Get contract ABI
GET  /api/v1/contracts/:contractName/address   # Get contract address
GET  /api/v1/contracts/                        # Get contracts list
GET  /api/v1/contracts/chains                  # Get available chains

# Chain Contract (GunDB Blockchain Storage)
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

### 🛠️ System & Debug

```bash
# Health & Status
GET  /api/v1/system/health                    # Health check
GET  /api/v1/system/relay-info                # Relay information
GET  /api/v1/system/contract-config           # Contract configuration
GET  /api/v1/system/contract-status           # Contract status

# Subscription Management
GET  /api/v1/system/user-subscription/:userAddress  # User subscription
GET  /api/v1/system/subscription-status/:identifier # Subscription status
GET  /api/v1/system/user-subscription-details/:userAddress # Subscription details

# System Data & Stats
GET  /api/v1/system/alldata                   # All system data
GET  /api/v1/system/stats                     # System stats
POST /api/v1/system/stats/update              # Update stats
GET  /api/v1/system/stats.json                # Stats JSON

# System Operations
POST /api/v1/system/gc/trigger                # Trigger garbage collection
POST /api/v1/system/derive                    # Derive keys
GET  /api/v1/system/logs                      # Get logs
DELETE /api/v1/system/logs                    # Clear logs
GET  /api/v1/system/peers                     # Get peers
POST /api/v1/system/peers/add                 # Add peer

# Services Management
POST /api/v1/services/:service/restart        # Restart service
GET  /api/v1/services/status                  # Service status

# Legacy Health Endpoints
GET  /health                                   # Basic health check
```

### 📝 Notes Management

```bash
# Admin Notes (Encrypted)
GET  /api/v1/notes/                           # Get admin notes
POST /api/v1/notes/                           # Create admin note
DELETE /api/v1/notes/                         # Delete admin note

# Regular Notes
GET  /api/v1/notes/regular                    # Get regular notes
POST /api/v1/notes/regular                    # Create regular note
DELETE /api/v1/notes/regular                  # Delete regular note
PUT  /api/v1/notes/regular/:id                # Update regular note
GET  /api/v1/notes/regular/:id                # Get regular note
```

### 🎯 Visual Graph

```bash
# Visual Graph Interface
GET  /visualGraph/                            # Visual graph interface
GET  /visualGraph/visualGraph.js              # Visual graph JS
GET  /visualGraph/abstraction.js              # Abstraction JS
GET  /visualGraph/vGmain.css                  # Visual graph CSS
GET  /visualGraph/visualGraphIcon.svg         # Visual graph icon
```

### 🔧 Debug Endpoints

```bash
# Debug endpoints for troubleshooting
GET  /api/v1/debug/*                          # Various debug endpoints
```

### 📱 Web Interfaces

```bash
# Main Interfaces
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

# Static Assets
GET  /lib/:filename                           # JavaScript library files
GET  /styles/:filename                        # CSS style files
```

### 🔄 Legacy Endpoints (Deprecated)

```bash
# Legacy Authentication
POST /api/authorize-gun-key                   # Legacy Gun key authorization
DELETE /api/authorize-gun-key/:pubKey         # Legacy remove Gun key
GET  /api/authorize-gun-key/:pubKey           # Legacy get Gun key

# Legacy IPFS
POST /ipfs-api/:endpoint(*)                   # Legacy IPFS API
POST /ipfs-upload                             # Legacy IPFS upload
POST /ipfs-pin                                # Legacy IPFS pin
GET  /ipfs-status                             # Legacy IPFS status

# Legacy System
GET  /api/relay-info                          # Legacy relay info
GET  /api/contract-config                     # Legacy contract config
GET  /api/contract-status                     # Legacy contract status
POST /api/user-mb-usage/:identifier/reset     # Legacy MB usage reset
```

## 🔐 Authentication & Authorization

The Shogun Relay supports multiple authentication methods for different types of operations.

### Authentication Methods

#### 1. **Admin Token Authentication**

Required for admin operations and IPFS API access.

```bash
# Header format
Authorization: Bearer YOUR_ADMIN_TOKEN
# OR
token: YOUR_ADMIN_TOKEN

# Example
curl -H "Authorization: Bearer admin123" \
     http://localhost:8765/api/v1/system/health
```

#### 2. **Wallet Signature Authentication**

Required for user operations and file uploads.

```bash
# Required headers
x-user-address: 0x1234567890123456789012345678901234567890
x-wallet-signature: 0x...
x-signature-message: I Love Shogun

# Example
curl -H "x-user-address: 0x1234567890123456789012345678901234567890" \
     -H "x-wallet-signature: 0x..." \
     -H "x-signature-message: I Love Shogun" \
     http://localhost:8765/api/v1/user-uploads/USER_ADDRESS
```

#### 3. **Gun Key Authorization**

For GunDB-specific operations.

```bash
# Header format
x-pubkey: YOUR_GUN_PUBLIC_KEY

# Example
curl -H "x-pubkey: gun_public_key_here" \
     http://localhost:8765/api/v1/users/profile
```

### Authentication Requirements by Endpoint Type

| Endpoint Type       | Authentication Required | Method                              |
| ------------------- | ----------------------- | ----------------------------------- |
| Admin Operations    | Admin Token             | Bearer Token                        |
| IPFS API            | Admin Token             | Bearer Token                        |
| User Uploads        | Wallet Signature        | x-user-address + x-wallet-signature |
| User Management     | Gun Key                 | x-pubkey                            |
| Contract Operations | Wallet Signature        | x-user-address + x-wallet-signature |
| System Operations   | Admin Token             | Bearer Token                        |
| Public Endpoints    | None                    | None                                |

### Environment Variables

```bash
# Admin authentication
ADMIN_PASSWORD=your-secure-admin-token

# IPFS API protection
IPFS_API_TOKEN=your-ipfs-api-token

# Chain configuration
CHAIN_ID=11155111
ALCHEMY_API_KEY=your-alchemy-key
```

## 📱 Web Interfaces & Admin Panel

The Shogun Relay includes a comprehensive set of web interfaces for managing all aspects of the decentralized infrastructure.

### 🎛️ Admin Panel (`/admin`)

The main admin panel provides centralized management of all relay functions:

#### 📊 Monitoring & Analytics

- **Services Dashboard**: Real-time monitoring of all relay services
- **Live Stats**: Performance metrics and system status
- **Advanced Charts**: Data visualization and usage analytics
- **Live Graph Explorer**: Interactive GunDB data exploration
- **Visual Graph Data**: D3.js powered network visualization

#### 📁 Storage & Files

- **User Upload Management**: Monitor and manage user file uploads
- **Upload to IPFS**: Direct IPFS file upload interface
- **IPFS Pin Manager**: Comprehensive pin management with batch operations
- **IPFS Node Status**: Real-time IPFS node monitoring

#### 🗄️ Data Management

- **Create Data Node**: Direct GunDB node creation interface
- **View/Query Data**: Advanced data browsing and search
- **Chain Contract Interface**: Blockchain integration for data storage
- **IPCM Contract Interface**: IPFS CID mapping management
- **Admin Notes**: Internal documentation and notes system

#### 💬 Communication

- **Public Chat**: Community communication interface

#### 🔐 Security & Tools

- **Relay Subscription**: Subscription management system
- **Derive Keys**: Cryptographic key derivation tools
- **IPFS API Version**: API version management and monitoring

### 🎯 Visual Graph Interface (`/visualGraph`)

Interactive GunDB data visualization with real-time exploration capabilities:

#### Features

- **Interactive D3.js Visualization**: Force-directed graph layout with zoom and pan
- **Real-time Data Loading**: Direct GunDB connection with authentication
- **DFS Traversal**: Comprehensive node exploration with configurable limits
- **Load All Nodes Mode**: Direct loading for complete graph visualization
- **Data Inspector**: View and edit node properties in real-time
- **Authentication Integration**: Seamless admin token integration

#### Configuration

- **Relay Peer URL**: GunDB endpoint (default: your relay URL)
- **Auth Token**: Admin authentication (auto-loaded)
- **Start Key**: GunDB key to begin traversal
- **Label Property**: Property to use as node labels

### 📤 User Upload Interface (`/user-upload`)

Decentralized file storage interface for end users:

#### Features

- **Wallet Authentication**: Ethereum wallet signature required
- **File Upload**: Drag & drop or file selection
- **Storage Tracking**: Real-time MB usage display
- **File Management**: View, download, and delete files
- **Encryption Support**: Optional file encryption

### 🗂️ IPFS Pin Manager (`/pin-manager`)

Advanced pin management with automatic system file protection:

#### Features

- **Individual Pin Operations**: Add, remove, and manage individual pins
- **Batch Unpin All**: Bulk operation with progress tracking
- **System File Protection**: Automatically preserves user uploads
- **Garbage Collection**: Integrated IPFS cleanup with confirmation
- **Modern Design**: Clean, responsive interface
- **Real-time Progress**: Detailed progress tracking with logs

### ⛓️ Contract Interfaces

#### IPCM Contract Interface (`/ipcm-contract`)

**IPFS CID Mapping Contract** - Manage IPFS content identifiers on-chain

#### Chain Contract Interface (`/chain-contract`)

**GunDB Chain Integration** - Write and read data to/from blockchain

### 📊 Additional Interfaces

- **Stats Interface** (`/stats`): Performance metrics and analytics
- **Services Dashboard** (`/services-dashboard`): Service monitoring
- **Subscription Interface** (`/subscribe`): Subscription management
- **Notes Interface** (`/notes`): Admin and regular notes
- **Chat Interface** (`/chat`): Community communication
- **Charts Interface** (`/charts`): Data visualization
- **Drive Interface** (`/drive`): File management
- **Auth Interface** (`/auth`): Authentication management

### 🔧 Development Interfaces

- **Create Interface** (`/create`): Data node creation
- **View Interface** (`/view`): Data browsing
- **Edit Interface** (`/edit`): Data editing
- **Derive Interface** (`/derive`): Key derivation tools
- **Graph Interface** (`/graph`): Data visualization

## 🎯 Visual Graph

The relay includes a powerful visual graph interface for exploring GunDB data structures in real-time.

### Features

- **Interactive D3.js Visualization**: Force-directed graph layout with zoom and pan
- **Real-time Data Loading**: Direct GunDB connection with authentication
- **DFS Traversal**: Comprehensive node exploration with configurable limits
- **Load All Nodes Mode**: Direct loading for complete graph visualization
- **Data Inspector**: View and edit node properties in real-time
- **Authentication Integration**: Seamless admin token integration

### Access

```bash
# Direct access
https://your-relay.ngrok.io/visualGraph

# From main interface
https://your-relay.ngrok.io → Click "Visual Graph"
```

### Configuration

- **Relay Peer URL**: GunDB endpoint (default: your relay URL)
- **Auth Token**: Admin authentication (auto-loaded)
- **Start Key**: GunDB key to begin traversal
- **Label Property**: Property to use as node labels

## ⛓️ Contract Interfaces

The relay includes two powerful contract interfaces for blockchain integration:

### IPCM Contract Interface (`/ipcm-contract`)

**IPFS CID Mapping Contract** - Manage IPFS content identifiers on-chain

#### Features

- **IPCM Factory Operations**: Create and manage IPCM instances
- **Instance Management**: Load, update, and query IPCM instances
- **CID Mapping**: Update IPFS CID mappings for decentralized content
- **Owner Management**: Transfer ownership of IPCM instances
- **Batch Operations**: Get all instances or user-specific instances

#### Smart Contract Integration

- **Sepolia Testnet**: Deployed on Ethereum Sepolia testnet
- **Factory Pattern**: IPCMFactory contract for instance creation
- **Owner-based Access**: Only instance owners can update mappings
- **Ethereum Wallet**: MetaMask integration for transactions

#### Usage

1. **Connect Wallet**: MetaMask with Sepolia network
2. **Create IPCM**: Deploy new IPCM instance for CID mapping
3. **Load Instance**: Connect to existing IPCM instance
4. **Update Mapping**: Change IPFS CID mapping
5. **Query Data**: Get current mapping and instance details

### Chain Contract Interface (`/chain-contract`)

**GunDB Chain Integration** - Write and read data to/from blockchain

#### Features

- **GunDB Integration**: Direct blockchain storage for GunDB data
- **Data Writing**: Store GunDB nodes on-chain with soul/key/value
- **Data Reading**: Retrieve blockchain-stored GunDB data
- **Hash Generation**: Automatic keccak256 hashing for soul and keys
- **Dual Storage**: Write to both GunDB and blockchain

#### Smart Contract Integration

- **Chain.sol Contract**: Custom smart contract for GunDB data
- **Sepolia Testnet**: Deployed on Ethereum Sepolia testnet
- **Gas Optimization**: Efficient storage patterns
- **Data Verification**: On-chain data integrity checks

#### Usage

1. **Connect Wallet**: MetaMask with Sepolia network
2. **Write Data**: Store GunDB data on blockchain
3. **Read Data**: Retrieve blockchain-stored data
4. **Dual Mode**: Write to GunDB only or both systems
5. **Data Inspection**: View and verify stored data

### Contract Configuration

```bash
# Get contract configuration
GET /api/v1/contracts/ipcm
GET /api/v1/contracts/chain

# Get contract ABI
GET /api/v1/contracts/ipcm/abi
GET /api/v1/contracts/chain/abi

# Get contract address
GET /api/v1/contracts/ipcm/address
GET /api/v1/contracts/chain/address
```

## 🗂️ IPFS Pin Manager

Advanced pin management with automatic system file protection and modern UI.

### Features

- **Individual Pin Operations**: Add, remove, and manage individual pins with clean interface
- **Batch Unpin All**: Bulk operation with progress tracking and system file preservation
- **System File Protection**: Automatically preserves user uploads during bulk operations
- **Garbage Collection**: Integrated IPFS cleanup with confirmation
- **Modern Design**: Clean, responsive interface with consistent color scheme
- **Real-time Progress**: Detailed progress tracking with comprehensive logs
- **Smart Filtering**: Intelligent system file detection and preservation

### System File Protection

When "🛡️ Preserve system files" is enabled:

- **Automatic Detection**: System hashes are automatically managed when files are uploaded/removed
- **Smart Preservation**: Only non-system files are unpinned during bulk operations
- **Detailed Statistics**: Shows total pins, preserved files, and files to remove
- **Real-time Updates**: System hashes are updated automatically during file operations
- **Dual Authentication**: Supports both admin token and wallet signature authentication

### Automatic System Hash Management

- **Upload Integration**: Files are automatically added to system hashes when uploaded
- **Removal Integration**: Hashes are automatically removed when files are deleted/unpinned
- **Batch Operations**: System hashes are properly managed during bulk operations
- **Error Resilience**: Upload operations continue even if system hash management fails

### Usage

1. **Individual Pins**: Enter CID and use Add/Remove buttons
2. **Batch Operations**: Use "Unpin All Files" with preservation toggle
3. **System Files**: Checkbox protects user uploads by default
4. **Progress Tracking**: Real-time progress with detailed logs
5. **Garbage Collection**: Optional cleanup after unpinning with confirmation

### API Integration

```bash
# Get system hashes for pin manager
GET /api/v1/user-uploads/system-hashes

# Get detailed system hashes map
GET /api/v1/user-uploads/system-hashes-map

# Save hash to system hashes (admin/user)
POST /api/v1/user-uploads/save-system-hash

# Remove hash from system hashes (admin/user)
DELETE /api/v1/user-uploads/remove-system-hash/:hash
```

## 📁 File Upload System

### User Upload Interface (`/user-upload`)

- **Wallet Authentication**: Ethereum wallet signature required
- **File Upload**: Drag & drop or file selection
- **Storage Tracking**: Real-time MB usage display
- **File Management**: View, download, and delete files
- **Encryption Support**: Optional file encryption

### Admin Upload Interface (`/upload`)

- **Admin Authentication**: Centralized admin token
- **Direct IPFS Upload**: Bypass user system
- **Encryption Options**: Encrypt files with admin token
- **Multiple Gateways**: Local, relay, and public gateway URLs

### Storage Features

- **GunDB Metadata**: File information stored in decentralized database
- **MB Usage Tracking**: Real-time calculation from actual files
- **File Repair**: Automatic repair of corrupted metadata
- **Subscription Integration**: MB limits based on user subscriptions

## 🔐 Authentication System

### Admin Authentication

- **Centralized Token Management**: Single admin token for all operations
- **Auto-fill Support**: Automatic token loading from Control Panel
- **Cross-interface Sync**: Token shared across all admin interfaces
- **Secure Storage**: Token stored securely in browser

### User Authentication

- **Wallet Signature**: Ethereum wallet-based authentication
- **Subscription Verification**: Chain-based subscription validation
- **MB Usage Sync**: Off-chain storage calculation with on-chain verification

### IPFS API Protection

- **JWT Authentication**: Automatic JWT token generation by IPFS
- **Environment Fallback**: `IPFS_API_TOKEN` environment variable
- **Container Security**: Tokens only accessible inside container

## 🚀 Installation & Setup

### Quick Start with Docker

```bash
# Clone and start
git clone <repository-url>
cd shogun-relay
./docker-start.sh

# Verify installation
curl http://localhost:8765/health
```

### Environment Configuration

```bash
# Copy and configure environment
cp .env.example .env

# Key variables
IPFS_API_TOKEN=your-secret-token    # IPFS API protection
ADMIN_TOKEN=your-admin-token        # Admin authentication
```

### Manual Setup

```bash
# Install dependencies
cd relay
npm install

# Start development server
npm run dev
```

## 📊 Monitoring & Debugging

### Health Checks

```bash
# Basic health
curl http://localhost:8765/health

# Detailed health
curl http://localhost:8765/api/v1/health

# System info
curl http://localhost:8765/api/v1/system/relay-info
```

### Logs

```bash
# Container logs
docker logs -f shogun-relay-stack

# Real-time monitoring
docker exec shogun-relay-stack tail -f /var/log/supervisor/relay.log
```

### Debug Endpoints

```bash
# Debug user uploads
GET /api/v1/user-uploads/debug/:userAddress

# Debug MB usage
POST /api/v1/user-uploads/debug-mb-usage/:userAddress

# System hashes (for pin manager)
GET /api/v1/user-uploads/system-hashes
```

## 🌐 Ports & Services

- **8765**: Main GunDB relay server (HTTP/WebSocket)
- **5001**: IPFS API (authenticated, integrated)
- **8080**: IPFS Gateway (integrated)
- **4001**: IPFS Swarm (P2P, integrated)

### Main Interfaces

- `/`: Control Panel with navigation
- `/gun`: **GunDB WebSocket endpoint** (Primary)
- `/pin-manager`: IPFS pin management (Integrated)
- `/user-upload`: User file upload interface
- `/upload`: Admin file upload interface
- `/visualGraph`: Interactive GunDB visualization
- `/subscribe`: Subscription management
- `/ipcm-contract`: IPCM Contract Interface (IPFS CID Mapping)
- `/chain-contract`: Chain Contract Interface (GunDB Chain Integration)

## 🔧 Development

### Admin Panel Interface

The Shogun Relay includes a comprehensive admin panel that provides centralized management of all relay functions:

#### 📊 Monitoring & Analytics

- **Services Dashboard**: Real-time monitoring of all relay services
- **Live Stats**: Performance metrics and system status
- **Advanced Charts**: Data visualization and usage analytics
- **Live Graph Explorer**: Interactive GunDB data exploration
- **Visual Graph Data**: D3.js powered network visualization

#### 📁 Storage & Files

- **User Upload Management**: Monitor and manage user file uploads
- **Upload to IPFS**: Direct IPFS file upload interface
- **IPFS Pin Manager**: Comprehensive pin management with batch operations
- **IPFS Node Status**: Real-time IPFS node monitoring

#### 🗄️ Data Management

- **Create Data Node**: Direct GunDB node creation interface
- **View/Query Data**: Advanced data browsing and search
- **Chain Contract Interface**: Blockchain integration for data storage
- **IPCM Contract Interface**: IPFS CID mapping management
- **Admin Notes**: Internal documentation and notes system

#### 💬 Communication

- **Public Chat**: Community communication interface

#### 🔐 Security & Tools

- **Relay Subscription**: Subscription management system
- **Derive Keys**: Cryptographic key derivation tools
- **IPFS API Version**: API version management and monitoring

The admin panel requires authentication and provides a unified interface for managing your entire decentralized infrastructure from a single location.

### Project Structure

```
shogun-relay/
├── relay/
│   ├── src/
│   │   ├── routes/           # API routes
│   │   │   ├── ipfs.js       # IPFS management (integrated)
│   │   │   ├── uploads.js    # User file management
│   │   │   ├── subscriptions.js # Subscription system
│   │   │   ├── system.js     # System operations
│   │   │   └── visualGraph.js # Visual graph routes
│   │   ├── public/           # Frontend interfaces
│   │   │   ├── pin-manager.html
│   │   │   ├── user-upload.html
│   │   │   ├── visualGraph/
│   │   │   └── styles/
│   │   └── index.js          # Main GunDB server
├── docker/                   # Docker configuration
├── docker-compose.yml
└── README.md
```

### Key Components

- **GunDB Core**: Decentralized database relay with WebSocket support
- **IPFS Integration**: HTTP proxy to IPFS API with authentication
- **File Upload**: Multer-based file handling with encryption
- **Visual Graph**: D3.js visualization with DFS traversal
- **Pin Manager**: Comprehensive IPFS pin management

## 🛠️ Troubleshooting

### Common Issues

**GunDB Connection Problems**

```bash
# Test GunDB connection
curl http://localhost:8765/gun

# Check WebSocket endpoint
wscat -c ws://localhost:8765/gun

# Test GunDB client library
curl http://localhost:8765/gun.js
```

**IPFS Connection Problems (Integrated)**

```bash
# Check IPFS status
curl -H "Authorization: Bearer $IPFS_API_TOKEN" http://localhost:5001/api/v0/version

# Verify JWT token
docker exec shogun-relay-stack cat /tmp/ipfs-jwt-token
```

**File Upload Problems**

```bash
# Debug user uploads
curl http://localhost:8765/api/v1/user-uploads/debug/USER_ADDRESS

# Check MB usage
curl -X POST http://localhost:8765/api/v1/user-uploads/sync-mb-usage/USER_ADDRESS
```

### Performance Optimization

- **GunDB Timeouts**: Increased timeouts for large datasets
- **IPFS Garbage Collection**: Regular cleanup to free disk space
- **Batch Operations**: Efficient bulk operations with progress tracking
- **Caching**: Browser-based caching for static assets

## 📊 Complete Feature Overview

### 🔐 Authentication & Security

- **Multi-Method Authentication**: Admin tokens, wallet signatures, Gun keys, Web3, Nostr, OAuth
- **Role-Based Access**: Different authentication for different operations
- **Secure Token Management**: Centralized admin token with auto-fill support
- **IPFS API Protection**: JWT-based authentication for IPFS endpoints

### 🗄️ GunDB Core Features

- **Decentralized Database**: Full GunDB relay with WebSocket support
- **Real-time Synchronization**: Live data sync across all connected peers
- **Graph Database**: Hierarchical data structure with soul/key/value pairs
- **WebRTC Support**: Peer-to-peer connections for enhanced decentralization
- **Local Storage**: Persistent data storage with radisk
- **Garbage Collection**: Automatic cleanup of unused data

### 📁 File Management System

- **User File Uploads**: Decentralized file storage with GunDB metadata
- **IPFS Integration**: Direct IPFS storage with pin management
- **File Encryption**: Optional file encryption before upload
- **Storage Quotas**: MB-based storage tracking and limits
- **File Repair**: Automatic repair of corrupted file metadata
- **System File Protection**: Automatic preservation of user uploads

### ⛓️ Smart Contract Integration

- **Chain Contract**: GunDB blockchain storage integration
- **IPCM Contract**: IPFS CID mapping on-chain
- **Contract Management**: Complete contract configuration and management
- **Event Listening**: Real-time blockchain event processing
- **Data Synchronization**: Bidirectional GunDB-blockchain sync

### 🎯 Visual & Management Interfaces

- **Admin Panel**: Comprehensive centralized management interface
- **Visual Graph**: Interactive D3.js GunDB data exploration
- **Pin Manager**: Advanced IPFS pin management with batch operations
- **User Upload Interface**: Decentralized file storage for end users
- **Contract Interfaces**: Blockchain integration interfaces
- **Monitoring Dashboards**: Real-time system monitoring and analytics

### 🛠️ System & Debug

- **Health Monitoring**: Comprehensive health checks and status monitoring
- **Performance Analytics**: Real-time stats and performance metrics
- **Log Management**: System logs with filtering and cleanup
- **Peer Management**: GunDB peer configuration and monitoring
- **Service Management**: Service restart and status monitoring
- **Debug Tools**: Extensive debugging and troubleshooting endpoints

### 📝 Notes & Communication

- **Admin Notes**: Encrypted admin documentation system
- **Regular Notes**: Public note-taking system
- **Chat Interface**: Community communication platform

### 🔄 API Coverage

- **Total Endpoints**: 80+ API endpoints
- **Authentication Methods**: 6 different authentication types
- **Web Interfaces**: 20+ web-based management interfaces
- **Contract Integration**: Complete smart contract management
- **Legacy Support**: Backward compatibility with legacy endpoints

## 🌟 Next Steps

1. **Connect Your App**: Use `https://your-relay.ngrok.io/gun` as Gun.js peer
2. **Upload Files**: Test user upload system at `/user-upload`
3. **Manage Pins**: Use `/pin-manager` for IPFS pin management
4. **Explore Data**: Visit `/visualGraph` for interactive GunDB exploration
5. **Monitor Usage**: Check MB usage and subscription status
6. **Debug Issues**: Use debug endpoints for troubleshooting
7. **Admin Panel**: Access `/admin` for comprehensive management
8. **Contract Integration**: Test blockchain integration at `/chain-contract` and `/ipcm-contract`

## 📚 Additional Documentation

- **[Quick Start Guide](QUICK-START.md)**: Get started quickly
- **[API Documentation](relay/API_DOCUMENTATION.md)**: Detailed API reference
- **[Visual Graph Guide](relay/VISUAL_GRAPH.md)**: Visual graph usage
- **[Pin Manager Guide](relay/PIN_MANAGER.md)**: IPFS pin management

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Implement your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🧹 Docker Cleanup Script

```bash
# Pulizia sicura (raccomandata)
./docker-cleanup.sh --cache-only

# Pulizia completa (usa con cautela)
./docker-cleanup.sh --all

# Modalità dry-run (vedi cosa verrebbe pulito)
./docker-cleanup.sh --dry-run

# Aiuto
./docker-cleanup.sh --help
```

### Available Options:

- `--cache-only`: Pulizia sicura (container fermati, immagini non utilizzate, cache build)
- `--all`: Pulizia completa (include volumi - può cancellare dati)
- `--containers`: Solo container fermati
- `--images`: Solo immagini non utilizzate
- `--networks`: Solo reti non utilizzate
- `--volumes`: Solo volumi non utilizzati (ATTENZIONE: può cancellare dati)
- `--build-cache`: Solo cache di build
- `--dry-run`: Mostra cosa verrebbe pulito senza farlo

### Esempi:

```bash
# Pulizia rapida e sicura
./docker-cleanup.sh

# Verifica cosa verrebbe pulito
./docker-cleanup.sh --dry-run

# Pulizia completa con conferma
./docker-cleanup.sh --all
```

## 🚀 Quick Start
