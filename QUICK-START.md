# Shogun Relay - Quick Start Guide 🚀

Get your **GunDB relay server** with integrated IPFS storage running with HTTPS in under 10 minutes!

## 📋 Prerequisites

- Docker Desktop or Docker Engine installed
- ngrok account (for HTTPS access)
- Terminal/Command prompt access

## 🌐 Option 1: HTTPS Setup with ngrok (Recommended for Development)

### Step 1: Get ngrok Endpoint

1. **Sign up/Login to ngrok**: Go to [ngrok.com](https://ngrok.com) and create an account
2. **Purchase a static endpoint** (or use free dynamic endpoint):
   - Navigate to `Endpoints` in your ngrok dashboard
   - Click `Create Endpoint` 
   - Choose your preferred region and subdomain
   - Note your endpoint URL (e.g., `https://your-subdomain.ngrok.io`)

### Step 2: Build and Start the Container

```bash
# Clone the repository (if not already done)
git clone https://github.com/your-org/shogun-relay.git
cd shogun-relay

# Run the quick-start script
./docker-start.sh

# The script will build the image, start the services, and show their status.
```

### Step 3: Setup ngrok Tunnel

```bash
# Install ngrok authtoken (get from your ngrok dashboard)
ngrok config add-authtoken YOUR_AUTHTOKEN_HERE

# Start ngrok tunnel pointing to your relay container
ngrok http 8765 --domain=your-subdomain.ngrok.io

# For free accounts (dynamic URL):
ngrok http 8765
```

### Step 4: Access Your Relay

🎉 **You're ready!** Your Shogun GunDB Relay is now accessible via HTTPS:

- **Relay Interface**: `https://your-subdomain.ngrok.io`
- **GunDB Endpoint**: `https://your-subdomain.ngrok.io/gun` (Primary)
- **API Endpoints**: `https://your-subdomain.ngrok.io/api/*`
- **Health Check**: `https://your-subdomain.ngrok.io/health`

## 🔐 New User Authentication APIs

The relay now includes a complete user authentication system with GunDB:

### Authentication Endpoints

```bash
# Register a new user
POST https://your-subdomain.ngrok.io/api/v1/auth/register
{
  "email": "user@example.com",
  "passphrase": "secure-password",
  "hint": "password-hint"
}

# Login user
POST https://your-subdomain.ngrok.io/api/v1/auth/login
{
  "email": "user@example.com", 
  "passphrase": "secure-password"
}

# Password recovery
POST https://your-subdomain.ngrok.io/api/v1/auth/forgot
{
  "email": "user@example.com",
  "hint": "password-hint"
}

# Reset password
POST https://your-subdomain.ngrok.io/api/v1/auth/reset
{
  "email": "user@example.com",
  "oldPassphrase": "temp-password",
  "newPassphrase": "new-secure-password"
}

# Change password
POST https://your-subdomain.ngrok.io/api/v1/auth/change-password
{
  "email": "user@example.com",
  "oldPassphrase": "current-password",
  "newPassphrase": "new-password"
}
```

### User Management Endpoints

```bash
# Get current user profile
GET https://your-subdomain.ngrok.io/api/v1/users
Headers: { "authorization": "user-pubkey" }

# Get specific user profile
GET https://your-subdomain.ngrok.io/api/v1/users/:pubkey

# Update user profile
PUT https://your-subdomain.ngrok.io/api/v1/users/profile
Headers: { "authorization": "user-pubkey" }
{
  "profile": {
    "name": "John Doe",
    "bio": "Developer"
  }
}

# Get user statistics
GET https://your-subdomain.ngrok.io/api/v1/users/stats/:pubkey
```

### Test Authentication APIs

```bash
# Health check
curl https://your-subdomain.ngrok.io/api/v1/health

# Register a test user
curl -X POST https://your-subdomain.ngrok.io/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","passphrase":"password123","hint":"test"}'

# Login with the user
curl -X POST https://your-subdomain.ngrok.io/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","passphrase":"password123"}'
```

### Test Contract APIs

```bash
# Get all available contracts
curl https://your-subdomain.ngrok.io/api/contracts

# Get relay payment router ABI
curl https://your-subdomain.ngrok.io/api/contracts/relay-payment-router/abi

# Get contract address
curl https://your-subdomain.ngrok.io/api/contracts/relay-payment-router/address

# Get complete configuration
curl https://your-subdomain.ngrok.io/api/contracts/config
```

### Test IPCM Contract APIs

```bash
# Get IPCM contract configuration
curl https://your-subdomain.ngrok.io/api/v1/contracts/ipcm

# Get IPCM factory ABI
curl https://your-subdomain.ngrok.io/api/v1/contracts/ipcm/abi

# Get IPCM factory address
curl https://your-subdomain.ngrok.io/api/v1/contracts/ipcm/address
```

### Test Chain Contract APIs

```bash
# Get Chain contract configuration
curl https://your-subdomain.ngrok.io/api/v1/contracts/chain

# Get Chain contract ABI
curl https://your-subdomain.ngrok.io/api/v1/contracts/chain/abi

# Get Chain contract address
curl https://your-subdomain.ngrok.io/api/v1/contracts/chain/address
```

### Test System Hash APIs

```bash
# Get all system file hashes (for pin manager)
curl https://your-subdomain.ngrok.io/api/v1/user-uploads/system-hashes

# Get system hashes map with details
curl https://your-subdomain.ngrok.io/api/v1/user-uploads/system-hashes-map

# Save a hash to system hashes (admin)
curl -X POST https://your-subdomain.ngrok.io/api/v1/user-uploads/save-system-hash \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{"hash":"Qm...","userAddress":"admin-upload","timestamp":1234567890}'

# Remove hash from system hashes (admin)
curl -X DELETE https://your-subdomain.ngrok.io/api/v1/user-uploads/remove-system-hash/Qm... \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{"userAddress":"admin-remove"}'
```

## 🎯 Visual Graph Interface

The relay includes a powerful visual graph interface for exploring GunDB data structures in real-time.

### Access the Visual Graph

```bash
# Direct access
https://your-subdomain.ngrok.io/visualGraph

# Or navigate from the main interface
https://your-subdomain.ngrok.io → Click "Visual Graph"
```

### Visual Graph Features

- **Interactive D3.js visualization** with zoom, pan, and node selection
- **Depth-First Search (DFS) traversal** of GunDB nodes
- **Real-time data exploration** with customizable node labels
- **Data inspector** for viewing and editing node properties
- **Authentication integration** with centralized admin token
- **Responsive design** for desktop and mobile

### Quick Start with Visual Graph

1. **Set your admin password** in the Control Panel
2. **Navigate to** `/visualGraph`
3. **Configure the connection**:
   - Relay Peer URL: `https://your-subdomain.ngrok.io` (auto-filled)
   - Auth Token: Auto-loaded from Control Panel
   - Start Key: `shogun` (or any GunDB key)
   - Label Property: `name` (or any property to display as node labels)
4. **Click "Start"** to begin the graph traversal
5. **Explore the visualization** by zooming, panning, and clicking nodes

### Visual Graph API

```bash
# Main interface
GET https://your-subdomain.ngrok.io/visualGraph

# Static assets (CSS, JS, images)
GET https://your-subdomain.ngrok.io/visualGraph/*

# GunDB WebSocket endpoint
GET https://your-subdomain.ngrok.io/gun
```

## 🌐 GunDB Relay Core

The relay provides a complete GunDB relay server with real-time synchronization and decentralized data storage.

### GunDB Features
- **WebSocket Support**: Real-time bidirectional communication
- **Graph Database**: Hierarchical data structure with soul/key/value pairs
- **WebRTC Integration**: Peer-to-peer connections for enhanced decentralization
- **Local Storage**: Persistent data storage with radisk
- **Garbage Collection**: Automatic cleanup of unused data
- **Authentication**: Token-based access control for protected operations

### Connect to GunDB
```bash
# WebSocket connection (primary)
wss://your-subdomain.ngrok.io/gun

# HTTP connection (fallback)
https://your-subdomain.ngrok.io/gun

# Client library
https://your-subdomain.ngrok.io/gun.js
```

### GunDB Client Example
```javascript
// Connect to the relay
const gun = Gun(['https://your-subdomain.ngrok.io/gun']);

// Store data
gun.get('users').get('john').put({
  name: 'John Doe',
  email: 'john@example.com'
});

// Retrieve data
gun.get('users').get('john').on((data) => {
  console.log('User data:', data);
});
```

### GunDB Authentication
```bash
# For protected operations, include token in headers
const gun = Gun({
  peers: ['https://your-subdomain.ngrok.io/gun'],
  headers: {
    token: 'your-admin-token'
  }
});
```

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

#### Quick Start with IPCM Contract
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

#### Quick Start with Chain Contract
1. **Connect Wallet**: MetaMask with Sepolia network
2. **Write Data**: Store GunDB data on blockchain
3. **Read Data**: Retrieve blockchain-stored data
4. **Dual Mode**: Write to GunDB only or both systems
5. **Data Inspection**: View and verify stored data

### Contract Interface Access
```bash
# Direct access
https://your-subdomain.ngrok.io/ipcm-contract
https://your-subdomain.ngrok.io/chain-contract

# From main interface
https://your-subdomain.ngrok.io → Click "IPCM Contract Interface" or "Chain Contract Interface"
```

## 🏠 Option 2: Local Development (HTTP Only)

For local testing without HTTPS:

```bash
# From the shogun-relay directory, run the start script
./docker-start.sh

# Access locally
open http://localhost:8765
```

## 🔧 Quick Configuration

### Set Admin Password

1. Open your relay interface: `https://your-subdomain.ngrok.io`
2. In the Control Panel, set your admin password
3. The password will auto-sync across all admin tools

### Test Your Setup

```bash
# Health check
curl https://your-subdomain.ngrok.io/health

# Basic stats
curl https://your-subdomain.ngrok.io/api/stats

# New authentication health check
curl https://your-subdomain.ngrok.io/api/v1/health
```

## 💡 Quick Tips

### For Development
- Use ngrok's free plan for testing (dynamic URLs)
- Keep the ngrok terminal window open
- Use `docker logs -f shogun-relay-stack` to monitor
- Test authentication APIs with tools like Postman or curl

### For Production
- Purchase ngrok static endpoint or use proper SSL certificates
- Configure environment variables for security
- Set up monitoring and backups
- Implement proper rate limiting for authentication endpoints

### Troubleshooting
- **Container not starting**: Check `docker logs shogun-relay-stack`
- **ngrok connection issues**: Verify your authtoken and account limits
- **Can't access interface**: Ensure port 8765 is exposed in Docker
- **Authentication errors**: Check rate limiting and GunDB connectivity

## 🌟 Next Steps

1. **Connect your app**: Use `https://your-subdomain.ngrok.io/gun` as your **GunDB peer**
2. **Upload files**: Visit `/upload` to test IPFS storage (integrated)
3. **Monitor performance**: Check `/stats` for real-time metrics
4. **Explore data**: Visit `/visualGraph` for interactive GunDB visualization
5. **Manage pins**: Use `/pin-manager` for IPFS pin management (integrated)
6. **Test authentication**: Use the new `/api/v1/auth/*` endpoints
7. **Manage users**: Explore user management APIs
8. **Deploy contracts**: Use `/ipcm-contract` for IPFS CID mapping
9. **Chain integration**: Use `/chain-contract` for GunDB blockchain storage

## 🗂️ IPFS Pin Manager

Advanced pin management with automatic system file protection.

### Features
- **Individual Pin Operations**: Add, remove, and manage individual pins
- **Batch Unpin All**: Bulk operation with progress tracking and system file preservation
- **System File Protection**: Automatically preserves user uploads during bulk operations
- **Garbage Collection**: Integrated IPFS cleanup with confirmation
- **Modern UI**: Clean, responsive interface with consistent design
- **Real-time Progress**: Detailed progress tracking with logs

### System File Protection
- **Automatic Detection**: System hashes are automatically managed when files are uploaded/removed
- **Preservation Toggle**: Checkbox to protect user uploads during bulk operations
- **Smart Filtering**: Only non-system files are unpinned when preservation is enabled
- **Detailed Statistics**: Shows total pins, preserved files, and files to remove

### Usage
1. **Individual Pins**: Enter CID and use Add/Remove buttons
2. **Batch Operations**: Use "Unpin All Files" with preservation toggle
3. **System Files**: Checkbox protects user uploads by default
4. **Progress Tracking**: Real-time progress with detailed logs
5. **Garbage Collection**: Optional cleanup after unpinning

### Access
```bash
# Direct access
https://your-subdomain.ngrok.io/pin-manager

# From main interface
https://your-subdomain.ngrok.io → Click "Pin Manager"
```

## 📚 More Information

- **Full Documentation**: See [README.md](README.md) for complete feature list
- **API Reference**: Check the web interface for endpoint documentation
- **Configuration**: See environment variables in README.md
- **Authentication**: See [API_AUTHENTICATION.md](relay/API_AUTHENTICATION.md) for detailed auth docs

---

**Need help?** Check the logs with `docker logs shogun-relay-stack` or open an issue on GitHub.
