# Shogun Relay - Quick Start Guide 🚀

Get your **GunDB relay server** with integrated IPFS storage for admin use running with HTTPS in under 10 minutes!

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

## 🔐 Admin Authentication

The relay uses centralized admin token authentication for all protected operations:

### Admin Authentication

```bash
# Header format for all admin operations
Authorization: Bearer YOUR_ADMIN_TOKEN
# OR
token: YOUR_ADMIN_TOKEN
```

### Test Admin APIs

```bash
# Health check
curl https://your-subdomain.ngrok.io/api/v1/health

# System info
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
     https://your-subdomain.ngrok.io/api/v1/system/relay-info

# Get system stats
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
     https://your-subdomain.ngrok.io/api/v1/system/stats
```

### Test System Hash APIs (Admin Only)

```bash
# Get all system file hashes (for pin manager protection)
curl https://your-subdomain.ngrok.io/api/v1/user-uploads/system-hashes

# Get system hashes map with details (for pin manager protection)
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

**Note:** These endpoints use the legacy `/user-uploads/` path but now only manage system file hashes for pin manager protection, not user files.

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

# Admin health check
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
     https://your-subdomain.ngrok.io/api/v1/health
```

## 💡 Quick Tips

### For Development
- Use ngrok's free plan for testing (dynamic URLs)
- Keep the ngrok terminal window open
- Use `docker logs -f shogun-relay-stack` to monitor
- Test admin APIs with tools like Postman or curl

### For Production
- Purchase ngrok static endpoint or use proper SSL certificates
- Configure environment variables for security
- Set up monitoring and backups
- Implement proper rate limiting for admin endpoints

### Troubleshooting
- **Container not starting**: Check `docker logs shogun-relay-stack`
- **ngrok connection issues**: Verify your authtoken and account limits
- **Can't access interface**: Ensure port 8765 is exposed in Docker
- **Authentication errors**: Check admin token and GunDB connectivity

## 🌟 Next Steps

### **Admin-Only Features (Authentication Required):**
1. **Admin panel**: Access `/admin` for comprehensive management
2. **Upload files**: Visit `/upload` to test IPFS storage (admin)
3. **Monitor performance**: Check `/stats` for real-time metrics (admin)
4. **Manage pins**: Use `/pin-manager` for IPFS pin management (admin)
5. **System monitoring**: Use `/services-dashboard` for service monitoring (admin)
6. **Charts**: Visit `/charts` for data visualization (admin)

### **Public Features (No Authentication Required):**
7. **Connect your app**: Use `https://your-subdomain.ngrok.io/gun` as your **GunDB peer**
8. **Explore data**: Visit `/visualGraph` for interactive GunDB visualization
9. **Chat**: Use `/chat` for community communication
10. **Derive keys**: Use `/derive` for cryptographic key derivation

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
- **Preservation Toggle**: Checkbox to protect system files during bulk operations
- **Smart Filtering**: Only non-system files are unpinned when preservation is enabled
- **Detailed Statistics**: Shows total pins, preserved files, and files to remove

### Usage
1. **Individual Pins**: Enter CID and use Add/Remove buttons
2. **Batch Operations**: Use "Unpin All Files" with preservation toggle
3. **System Files**: Checkbox protects system files by default
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
- **Admin Authentication**: See README.md for admin authentication details

---

**Need help?** Check the logs with `docker logs shogun-relay-stack` or open an issue on GitHub.
