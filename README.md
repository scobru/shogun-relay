# Shogun Relay 📡

An advanced relay server that integrates GunDB, IPFS and Ethereum for decentralized management of data, files and authentication.

## Technology Stack

- **Express**: Web server framework for API endpoints and routing
- **GunDB**: Decentralized real-time database for data synchronization
- **Shogun Core**: Core library providing relay verification and authentication
- **Shogun IPFS**: IPFS integration for decentralized storage
- **Mityli**: Runtime type checking and validation
- **Shogun NoDom**: Lightweight UI framework for the management interface
- **MerkleTree**: For data integrity verification and proof generation

## Main Features

### Decentralized Architecture

- **GunDB**: Decentralized database for real-time data synchronization
- **IPFS**: Distributed and persistent storage for files and content
- **Ethereum**: Optional on-chain verification for member authentication
- **Mityli**: Runtime type validation to ensure data integrity
- **MerkleTree**: Cryptographic verification of data consistency

### User Interface Components

The project includes multiple UI interfaces for different functionalities:

1. **Dashboard UI** (`/src/ui/dashboard/`)
   - Built with ShogunNoDom lightweight framework
   - Accessible at the root endpoint `/`
   - Provides system monitoring, configuration, and management
   - Login interface at `/login`

2. **WebRTC Communication UI** (`/src/ui/webrtc/`)
   - Implements peer-to-peer communication
   - Uses Bugout for WebRTC functionality
   - Client interface at `/client.html`
   - Server interface at `/server.html`

3. **Messaging UI** (`/src/ui/messages-gun/`)
   - GunDB-powered messaging system
   - Client accessible at `/msg/client.html`

4. **Debug Interface** (`/src/ui/debug.html`)
   - Advanced debugging tools
   - Accessible at `/debug-interface`

### Security

- Enhanced token-based authentication with system and user token support
- Support for on-chain verification via RelayVerifier
- Secure WebSocket connection handling
- HTTPS support with custom certificates
- Automatic data type validation to prevent corruption
- StorageLog for tracking and auditing data operations

### Complete APIs

- REST API for file management and configuration
- WebSocket for real-time synchronization
- Support for file upload and management
- Endpoints for IPFS integration
- Type validation configuration endpoints
- WebSocket configuration checking

## Architecture

### Core Components

1. **Relay Server (`src/index.js`)**

   - WebSocket connection management for GunDB
   - HTTP/HTTPS request routing
   - Multi-level authentication support
   - Advanced CORS configuration
   - MerkleTree integration for data integrity
   - StorageLog for operation tracking

2. **Authentication Manager (`src/managers/AuthenticationManager.js`)**

   - token validation
   - Integration with RelayVerifier for on-chain verification
   - Access control for API and WebSocket

3. **IPFS Manager (`src/managers/IpfsManager.js`)**

   - Native IPFS integration
   - Support for Pinata and local IPFS nodes
   - File and metadata management

4. **File Manager (`src/managers/FileManager.js`)**
   - Local and distributed file management
   - Multi-part upload system
   - Backup and synchronization

### API Routes

1. **Auth Routes (`src/routes/authRoutes.js`)**

   - User authentication
   - Token management
   - On-chain verification

2. **IPFS Routes (`src/routes/ipfsApiRoutes.js`)**

   - Endpoints for IPFS operations
   - Metadata management
   - IPFS status control

3. **File Routes (`src/routes/fileManagerRoutes.js`)**

   - File querying and search
   - File details access
   - Advanced queries

4. **Relay Routes (`src/routes/relayApiRoutes.js`)**
   - Relay configuration
   - Status and diagnostics
   - Subscription management

## API Endpoints

### Authentication

- `POST /auth/register`: User registration
- `POST /auth/login`: User login
- `POST /auth/verify-onchain`: On-chain verification of public keys

### Files

- `GET /api/files/all`: List of all files
- `GET /api/files/search`: File search with custom criteria
- `GET /api/files/:id`: Details of a specific file

### IPFS

- `GET /api/ipfs/status`: IPFS service status
- `GET /api/ipfs/health-check`: IPFS system health check
- `GET /api/ipfs/metadata`: IPFS file metadata
- `GET /api/ipfs/pin-status/:hash`: Pin status for specific hash
- `POST /api/ipfs/pin`: Add pin to content
- `POST /api/ipfs/unpin`: Remove pin from content
- `POST /api/ipfs/toggle`: Enable/disable IPFS service
- `POST /api/ipfs/update-config`: Update IPFS configuration

### Type Validation

- `GET /api/test-mityli`: Test type validation implementation
- `POST /api/validation-config`: Update type validation configuration (requires authentication)

### Relay

- `GET /api/relay/status`: Relay server status
- `GET /api/relay/all`: List of all available relays
- `GET /api/relay/check-subscription/:relayAddress/:userAddress`: Check subscription
- `GET /api/relay/user-active-relays/:userAddress`: Active relays for a user
- `GET /api/relay/subscription-info/:relayAddress/:userAddress`: Subscription info
- `POST /api/relay/update-relay-config`: Update relay configuration
- `POST /api/relay/auth/update-config`: Update authentication configuration

### WebSocket

- `/gun`: GunDB WebSocket endpoint
- `GET /check-websocket`: Check WebSocket configuration

### Debug

- `POST /debug`: Generate detailed debug information

## Configuration

The server uses a `config.json` file containing all necessary options.

## Installation

### Prerequisites

- **Node.js**: Version 16 or higher
- **IPFS**: Local IPFS node (optional, can use Pinata instead)
- **Ethereum Provider**: Access to Ethereum provider (optional, for on-chain verification)
- **Dependencies**:
  - Express: Web server framework
  - GunDB: Decentralized database
  - Shogun Core: Core relay functionality 
  - Shogun IPFS: IPFS integration
  - Mityli: Runtime type validation
  - Shogun NoDom: UI framework

### Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/shogun-relay.git
cd shogun-relay

# Install dependencies
npm install

# Copy example configuration
cp config.json.example config.json

# Edit configuration as needed
nano config.json

# Start the server
npm start
```

### Development Setup

```bash
# Start in development mode with hot reload
npm run dev

# In a separate terminal, monitor logs
tail -f server.log
```

### UI Development

The NoDom-based UI is located in `src/ui/` directory. If you wish to modify the UI:

```bash
# Modify the UI files
nano src/ui/app-nodom.js
nano src/ui/components-nodom.js

# The changes will be served immediately when the server is running
```

## UI Endpoints

The management interface is accessible through the following URLs:

- `/`: Main management dashboard
- `/login`: Authentication page
- `/debug-interface`: Debug and diagnostics interface

### Accessing the UI

1. Start the server using `npm start`
2. Open your browser and navigate to `http://localhost:8765` (or your configured HOST:PORT)
3. You will be presented with the NoDom-powered management interface
4. Use the admin credentials from your config.json to log in

### UI Features

- **Dashboard**: Overview of system status, connections, and recent activities
- **File Manager**: Browse, upload, and manage files (both local and IPFS)
- **Settings**: Configure relay server settings
- **Diagnostics**: Tools for debugging and testing connectivity
- **Logs**: View system logs and error reports

## Debugging

### Debug Commands

- Use `/debug` command in the UI to activate debug mode
- Debug logs are stored in the `logs` directory
- Debug mode provides additional logging and detailed error information

### Debugging APIs

The following endpoints are available for debugging:

- `GET /api/status`: Overall server status
- `GET /api/test-gundb`: Test GunDB connectivity
- `GET /check-websocket`: Check WebSocket configuration
- `GET /api/test-mityli`: Test type validation system
- `POST /debug`: Generate detailed debug information

### Debugging Tools

- **Bullet Catcher**: Global exception handler to prevent server crashes
- **Console Logging**: Detailed logs with timestamp and context
- **Type Validation**: Runtime checking of data structures

## Command Reference

### Server Commands

```bash
# Start the server in production mode
npm start

# Start the server in development mode with hot reload
npm run dev

# Clean all data (radata, uploads, logs)
npm run clean-all

# Generate a new key pair for authentication
npm run generate-keypair
```

### Testing Commands

```bash
# Test GunDB connectivity
curl http://localhost:8765/api/test-gundb

# Check server status
curl http://localhost:8765/api/status

# Test type validation system
curl http://localhost:8765/api/test-mityli
```
