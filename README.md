# Shogun Relay

A complete IPFS relay server with integrated authentication and decentralized user management system.

## 🔗 Contract Configuration APIs

The relay includes comprehensive APIs for accessing contract configurations, ABIs, and addresses directly from the `shogun-contracts` package:

### Contract API Endpoints

```bash
# Get all available contracts
GET /api/contracts

# Get complete contract configuration
GET /api/contracts/config

# Get specific contract details
GET /api/contracts/:contractName

# Get contract ABI only
GET /api/contracts/:contractName/abi

# Get contract address only
GET /api/contracts/:contractName/address
```

### Available Contract Names

- `relay-payment-router` - RelayPaymentRouter contract
- `stealth-pool` - StealthPool contract
- `pair-recovery` - PairRecovery contract
- `integrity` - Integrity contract
- `payment-forwarder` - PaymentForwarder contract
- `stealth-key-registry` - StealthKeyRegistry contract
- `bridge-dex` - BridgeDex contract

### Example Usage

```javascript
// Dynamic contract loading
const abiResponse = await fetch('/api/contracts/relay-payment-router/abi');
const addressResponse = await fetch('/api/contracts/relay-payment-router/address');

const abiData = await abiResponse.json();
const addressData = await addressResponse.json();

// Use with ethers.js
const contract = new ethers.Contract(
  addressData.address,
  abiData.abi,
  provider
);
```

For detailed documentation, see [CONTRACT_APIS.md](relay/CONTRACT_APIS.md).

## 🎯 Visual Graph

The relay includes a powerful visual graph interface for exploring and visualizing GunDB data structures in real-time.

### Visual Graph Features

- **Real-time data visualization** using D3.js
- **Interactive graph exploration** with zoom, pan, and node selection
- **Depth-First Search (DFS) traversal** of GunDB nodes
- **Customizable node labels** and graph properties
- **Data inspector** for viewing and editing node properties
- **Authentication integration** with centralized admin token
- **Responsive design** that works on desktop and mobile

### Accessing the Visual Graph

```bash
# Direct access to the visual graph interface
https://your-subdomain.ngrok.io/visualGraph

# Or navigate from the main interface
https://your-subdomain.ngrok.io → Click "Visual Graph" in the navigation
```

### Visual Graph Configuration

The visual graph supports various configuration options:

- **Relay Peer URL**: The GunDB endpoint to connect to (default: `http://localhost:8765`)
- **Auth Token**: Admin authentication token (auto-loaded from Control Panel)
- **Start Key**: The GunDB key to begin the graph traversal from
- **Label Property**: Property to use as node labels in the visualization

### Visual Graph API Endpoints

```bash
# Main visual graph interface
GET /visualGraph

# Visual graph static assets
GET /visualGraph/* (CSS, JS, images)

# GunDB endpoint for graph data
GET /gun (WebSocket endpoint)
```

### Usage Example

```javascript
// Connect to the visual graph with authentication
const gun = new Gun({
  peers: ['https://your-subdomain.ngrok.io/gun'],
  localStorage: false
});

// Add authentication headers
Gun.on('opt', function(ctx) {
  if (ctx.once) return;
  ctx.on('out', function(msg) {
    msg.headers = {
      token: 'your-admin-token',
      Authorization: 'Bearer your-admin-token'
    };
    this.to.next(msg);
  });
});

// Start DFS traversal from a specific key
const dfs = new DFS(gun);
dfs.search('shogun', 'name'); // Start from 'shogun' key, use 'name' as label
```

### Visual Graph Components

- **Graph Viewer**: Interactive D3.js visualization with force-directed layout
- **Data Inspector**: Panel for viewing and editing node properties
- **Control Panel**: Configuration options for graph traversal
- **Status Display**: Real-time connection and search status

## 🔐 User Authentication

The relay includes a complete user authentication system based on GunDB:

### Authentication Features

- **User registration** with email and passphrase
- **Login/logout** with native GunDB authentication
- **Password recovery** via security hints
- **Password change** for authenticated users
- **Decentralized user profile management**
- **Rate limiting** to prevent abuse
- **Public key-based authorization**

### API Endpoints

```bash
# Authentication
POST /api/v1/auth/register    # Register new user
POST /api/v1/auth/login       # User login
POST /api/v1/auth/forgot      # Password recovery
POST /api/v1/auth/reset       # Password reset
POST /api/v1/auth/change-password  # Change password

# User Management
GET  /api/v1/users            # Current user profile
GET  /api/v1/users/:pubkey    # Specific user profile
PUT  /api/v1/users/profile    # Update profile
GET  /api/v1/users/stats/:pubkey  # User statistics
```

### Usage Example

```javascript
// Registration
const response = await fetch('/api/v1/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    passphrase: 'secure-password',
    hint: 'password-hint'
  })
});

// Login
const loginResponse = await fetch('/api/v1/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    passphrase: 'secure-password'
  })
});

const { data: { userPub } } = await loginResponse.json();

// Access protected resources
const profileResponse = await fetch('/api/v1/users', {
  headers: { 'authorization': userPub }
});
```

## 🔒 IPFS Authentication

The relay uses native IPFS Kubo authentication with JWT tokens to protect the IPFS API.

### How it works

1. **Initialization**: During container startup, IPFS automatically generates a JWT token for API authentication
2. **Storage**: The token is saved in `/tmp/ipfs-jwt-token` inside the container
3. **Usage**: The relay reads the token and uses it to authenticate all IPFS API requests
4. **Fallback**: If the JWT token is not available, the relay uses the environment token `IPFS_API_TOKEN`

### Configuration

To enable authentication, set the environment variable:

```bash
IPFS_API_TOKEN=your-secret-token
```

If `IPFS_API_TOKEN` is not set, the IPFS API will be publicly accessible.

### Security

- The JWT token is automatically generated by IPFS
- The token has administrator permissions for all API operations
- The token is only accessible inside the container
- All IPFS API requests are authenticated with the token

### Authentication Testing

To test that authentication works:

```bash
# Without token (should fail)
curl http://localhost:5001/api/v0/version

# With token (should work)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:5001/api/v0/version
```

## 🚀 Installation and Startup

### Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd shogun-relay

# Start with Docker (includes all features)
./docker-start.sh

# Verify everything works
curl http://localhost:8765/health
curl http://localhost:8765/api/v1/health
```

### Manual Configuration

```bash
# Configure environment variables
cp .env.example .env
# Edit .env with your configurations

# Start with Docker Compose
docker-compose up -d

# Verify everything works
curl http://localhost:8765/health
```

## 📁 Project Structure

```
shogun-relay/
├── relay/                 # Relay server code
│   ├── src/
│   │   ├── routes/       # API routes (auth, users, etc.)
│   │   │   ├── auth.js   # Authentication routes
│   │   │   ├── users.js  # User management routes
│   │   │   └── index.js  # Route configuration
│   │   └── index.js      # Main server
│   └── package.json
├── docker/               # Docker configuration files
├── docker-compose.yml    # Docker Compose configuration
├── Dockerfile           # Docker image
├── QUICK-START.md       # Quick start guide
└── README.md           # This file
```

## 🌐 Ports and Endpoints

- `8765`: Main relay server
- `5001`: IPFS API (protected by authentication)
- `8080`: IPFS Gateway
- `4001`: IPFS Swarm

### Main Endpoints

- `/gun`: GunDB endpoint for decentralized applications
- `/api/v1/auth/*`: User authentication APIs
- `/api/v1/users/*`: User management APIs
- `/upload`: IPFS file upload interface
- `/pin-manager`: IPFS pin management
- `/visualGraph`: Interactive GunDB data visualization
- `/health`: System health check

## 📊 Logs and Monitoring

Logs are available in:
- `/var/log/supervisor/` inside the container
- `./logs/` in the project directory (if mounted)

### Real-time Monitoring

```bash
# Container logs
docker logs -f shogun-relay-stack

# Relay statistics
curl http://localhost:8765/api/stats

# Complete health check
curl http://localhost:8765/api/v1/health
```

## 🔧 Development

For local development:

```bash
# Install dependencies
cd relay
npm install

# Start in development mode
npm run dev

# Test authentication APIs
curl -X POST http://localhost:8765/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","passphrase":"password123","hint":"test"}'
```

## 🛠️ Troubleshooting

### User Authentication Issues

1. Verify that GunDB is properly initialized
2. Check logs for rate limiting errors
3. Verify that routes are loaded: `docker logs shogun-relay-stack | grep "Route"`
4. Test APIs with curl or Postman

### IPFS Authentication Issues

1. Verify that `IPFS_API_TOKEN` is set
2. Check IPFS logs: `docker logs shogun-relay-stack`
3. Verify that the JWT token was generated: `docker exec shogun-relay-stack cat /tmp/ipfs-jwt-token`

### Connection Issues

1. Verify that all ports are properly exposed
2. Check that Docker volumes are configured
3. Verify directory permissions

## 🌟 Next Steps

1. **Connect your app**: Use `https://your-subdomain.ngrok.io/gun` as your Gun.js peer
2. **Upload files**: Visit `/upload` to test IPFS storage
3. **Monitor performance**: Check `/stats` for real-time metrics
4. **Explore data**: Visit `/visualGraph` for interactive GunDB visualization
5. **Manage pins**: Use `/pin-manager` for IPFS pin management
6. **Test authentication**: Use the new `/api/v1/auth/*` endpoints
7. **Manage users**: Explore user management APIs

## 📚 Additional Documentation

- **[Quick Start Guide](QUICK-START.md)**: Quick guide to get started
- **[API Authentication](relay/API_AUTHENTICATION.md)**: Detailed authentication API documentation
- **[IPFS Pin Behavior](relay/IPFS_PIN_BEHAVIOR.md)**: Explanation of IPFS pin behavior

## 🤝 Contributing

1. Fork the repository
2. Create a branch for your feature
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📄 License

MIT License
