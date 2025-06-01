# Shogun Relay 📡

An advanced relay server that integrates GunDB, IPFS and Ethereum for decentralized management of data, files and authentication.

## Technology Stack

- **Express**: Web server framework for API endpoints and routing
- **GunDB**: Decentralized real-time database for data synchronization
- **Shogun Core**: Core library providing relay verification and authentication
- **Shogun IPFS**: IPFS integration for decentralized storage
- **Mityli**: Runtime type checking and validation
- **Shogun NoDom**: Lightweight UI framework for the management interface
- **Better SQLite3**: For local data persistence
- **S3rver**: Mock S3 server for development and testing

## Repository Structure

This repository contains three main components:

### 1. **relay/** 
Simple GunDB relay implementation for basic peer-to-peer communication.

### 2. **relay-full/**
Advanced relay server with comprehensive features including:
- GunDB WebSocket relay
- IPFS integration with Pinata support
- Authentication and authorization
- File management system
- Management dashboard UI
- Backup and maintenance scripts
- Docker support

### 3. **satellite-s3/**
Mock S3-compatible storage service built with S3rver. This component:
- Provides S3-compatible API endpoints
- Enables development without requiring AWS S3
- Supports CORS and website hosting configurations
- Uses local filesystem storage (`./buckets`)
- Default configuration: port 4569, bucket name 'satellite-1'

## Main Features

### Decentralized Architecture

- **GunDB**: Decentralized database for real-time data synchronization
- **IPFS**: Distributed and persistent storage for files and content (optional)
- **Ethereum**: Optional on-chain verification for member authentication

### User Interface Components

The project includes multiple UI interfaces for different functionalities:

1. **Dashboard UI** (`/src/ui/dashboard/`)
   - Built with ShogunNoDom lightweight framework
   - Accessible at the root endpoint `/`
   - Provides system monitoring, configuration, and management
   - Login interface at `/login`

2. **GunDB UI** (`/src/ui/gundb/`)
   - Direct GunDB interface for database interactions

3. **RTC UI** (`/src/ui/rtc/`)
   - Real-time communication interface
   - WebRTC functionality for peer-to-peer connections

### Security & Authentication

- **Admin token authentication**: Uses SECRET_TOKEN for administrative access to relay APIs
- **Optional on-chain verification**: Public key authorization check via smart contracts (when enabled)
- **Gun message filtering**: Token validation for write operations to prevent unauthorized data
- **HTTPS support**: SSL certificate generation and management for secure connections

### Manager Components

1. **AuthenticationManager (`src/managers/AuthenticationManager.js`)**
   - SECRET_TOKEN validation for admin endpoints
   - Public key formatting utilities for blockchain verification
   - HTTP request authentication middleware

2. **IPFS Manager (`src/managers/IpfsManager.js`)**
   - IPFS integration with multiple services (local node, Pinata)
   - File upload and retrieval operations
   - Metadata management and caching

3. **File Manager (`src/managers/FileManager.js`)**
   - Local file storage and management
   - Integration with IPFS for distributed storage
   - Upload handling with multer middleware

### Backup & Maintenance

The relay includes comprehensive backup and maintenance utilities:

- **Automated Backup System**: Scheduled backup of GunDB radata
- **SSL Certificate Management**: Generation and verification of SSL certificates
- **Data Cleanup**: Scripts to reset and clean all relay data
- **Key Verification**: Tools for verifying cryptographic keys
- **Logging**: Comprehensive logging system with rotation

### Complete APIs

- REST API for file management and configuration
- WebSocket for real-time synchronization
- Support for file upload and management
- Endpoints for IPFS integration
- Type validation configuration endpoints
- Backup and maintenance APIs

## Architecture

### Core Components

1. **Relay Server (`src/index.js`)**
   - WebSocket connection management for GunDB
   - HTTP/HTTPS request routing
   - CORS configuration and middleware setup
   - S3 storage integration when configured
   - Comprehensive logging system

2. **Manager Components** (see Manager Components section above)

3. **Route Handlers**
   - Auth routes: Simple user registration/login
   - IPFS routes: File operations and IPFS management
   - File routes: Local file management and queries
   - Relay routes: Configuration and diagnostics

## API Endpoints

### Authentication

- `POST /api/auth/verify-onchain`: On-chain public key authorization check (when blockchain verification is enabled)

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

- `POST /debug`: Generate detailed debug information and logs

## Configuration

Both relay components support dynamic S3 integration with satellite-s3.

### Configuration Files

Both `relay/` and `relay-full/` use `config.json` files for configuration.

#### **relay-full/config.json** Key Options:
- **Basic Settings**: PORT, HTTPS_PORT, SECRET_TOKEN
- **IPFS Integration**: IPFS_ENABLED, IPFS_SERVICE, PINATA_JWT
- **Ethereum Integration**: ETHEREUM_PROVIDER_URL, ONCHAIN_MEMBERSHIP_ENABLED
- **SSL/TLS**: PRIVKEY_PATH, CERT_PATH
- **Type Validation**: TYPE_VALIDATION_ENABLED, TYPE_VALIDATION_STRICT
- **S3 Integration**: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_ENDPOINT

#### **relay/config.json** Key Options:
- **Basic Settings**: PORT, AUTH_TOKEN, PEERS
- **S3 Integration**: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET, S3_ENDPOINT

### Dynamic S3 Integration

Both relay implementations automatically detect S3 configuration and integrate with satellite-s3:

**✅ S3 Enabled**: When S3 credentials are provided in config.json:
```json
{
  "S3_ACCESS_KEY_ID": "automa25",
  "S3_SECRET_ACCESS_KEY": "automa25",
  "S3_BUCKET": "satellite-1",
  "S3_ENDPOINT": "http://0.0.0.0:4569"
}
```
- GunDB will use satellite-s3 as storage backend
- Data is stored in S3-compatible format
- Console will show: `S3 configuration found in config, adding to Gun options 🪣`

**❌ S3 Disabled**: When S3 credentials are empty or missing:
```json
{
  "S3_ACCESS_KEY_ID": "",
  "S3_SECRET_ACCESS_KEY": ""
}
```
- GunDB will use local storage (radisk for relay-full, default for relay)
- Console will show: `S3 configuration not found in config, using [local] storage 💽`

### Configuration Examples

#### For satellite-s3 integration:
```json
{
  "S3_ACCESS_KEY_ID": "automa25",
  "S3_SECRET_ACCESS_KEY": "automa25",
  "S3_BUCKET": "satellite-1",
  "S3_REGION": "us-east-1",
  "S3_ENDPOINT": "http://0.0.0.0:4569",
  "S3_ADDRESS": "0.0.0.0",
  "S3_PORT": 4569
}
```

#### For local storage only:
```json
{
  "S3_ACCESS_KEY_ID": "",
  "S3_SECRET_ACCESS_KEY": ""
}
```

## Installation

### Prerequisites

- **Node.js**: Version 16 or higher
- **Yarn**: Package manager
- **IPFS**: Local IPFS node (optional, can use Pinata instead)
- **Ethereum Provider**: Access to Ethereum provider (optional, for on-chain verification)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/shogun-relay.git
cd shogun-relay/test-env

# Option 1: Start the full-featured relay
cd relay-full
yarn install

# Copy example configuration
cp config.json.example config.json

# Edit configuration as needed
nano config.json

# Start the relay server
yarn start

# Option 2: Start the simple relay
cd ../relay
yarn install  # or npm install

# Edit configuration if needed
nano config.json

# Start the simple relay
node src/index.js

# Option 3: Start satellite-s3 (optional, for S3 storage)
cd ../satellite-s3
yarn install
node index.js
```

### Development Setup

```bash
# Start relay-full in development mode with hot reload
cd relay-full
yarn dev

# In a separate terminal, monitor logs
tail -f logs/server.log

# Start satellite-s3 for S3-compatible storage
cd ../satellite-s3
node index.js
```

### SSL Certificate Generation

```bash
# Generate SSL certificates for HTTPS
cd relay-full
yarn generate-certs
```

## Backup & Maintenance Scripts

The `relay-full/scripts/` directory contains essential maintenance utilities:

### Backup Scripts
- **`backup-radata.js`**: Creates backups of GunDB's radata directory
- **`setup-backup-cron.js`**: Configures automated backup scheduling

### Security Scripts
- **`generate-ssl-certs.js`**: Creates SSL certificates for HTTPS
- **`verify-ssl-certs.js`**: Validates existing SSL certificates
- **`verify-key.js`**: Verifies cryptographic keys and their integrity

### Maintenance Scripts
- **`clean-all-data.js`**: Resets/cleans all relay data
- **`test-logger.js`**: Tests the logging system functionality

### Smart Contract Scripts
- **`getDeployedContraacts.js`**: Retrieves deployed contract information

### Usage Examples

```bash
# Backup radata
node scripts/backup-radata.js

# Setup automated backups
node scripts/setup-backup-cron.js

# Clean all data (use with caution)
yarn clean-all

# Generate SSL certificates
yarn generate-certs

# Verify a specific key
node scripts/verify-key.js [key] [root]
```

## UI Endpoints

The management interface is accessible through the following URLs:

- `/`: Main management dashboard
- `/login`: Authentication page
- `/debug-interface`: Debug and diagnostics interface

### Accessing the UI

1. Start the server using `yarn start`
2. Open your browser and navigate to `http://localhost:8765` (or your configured HOST:PORT)
3. You will be presented with the NoDom-powered management interface
4. Use the admin credentials from your config.json to log in

### UI Features

- **Dashboard**: Overview of system status, connections, and recent activities
- **File Manager**: Browse, upload, and manage files (both local and IPFS)
- **Settings**: Configure relay server settings
- **Diagnostics**: Tools for debugging and testing connectivity
- **Logs**: View system logs and error reports

## Satellite-S3 Mock Service

The satellite-s3 component provides S3-compatible API endpoints for development and testing:

### Features
- **S3-Compatible API**: Fully compatible with AWS S3 SDK
- **Local Storage**: Uses filesystem-based storage in `./buckets`
- **CORS Support**: Configurable CORS settings
- **Website Hosting**: Static website hosting capabilities
- **Event Monitoring**: Real-time event logging for S3 operations

### Configuration
- **Port**: 4569 (default)
- **Address**: 0.0.0.0 (all interfaces)
- **Bucket**: satellite-1 (default)
- **Auth Token**: automa25 (for both access key and secret)

### Usage
```bash
# Start satellite-s3
cd satellite-s3
node index.js

# The service will be available at http://localhost:4569
# Use access key and secret key: automa25
```

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
- **Winston Logging**: Comprehensive logging with daily rotation
- **Type Validation**: Runtime checking of data structures with Mityli

## Command Reference

### Relay-Full Commands

```bash
# Start the relay server in production mode
yarn start

# Start the relay server in development mode with hot reload
yarn dev

# Clean all data (radata, uploads, logs)
yarn clean-all

# Generate SSL certificates
yarn generate-certs

# Get deployed contract information
yarn get-deployed-contracts
```

### Simple Relay Commands

```bash
# Start the simple relay server
node src/index.js

# Start with npm (if using npm instead of yarn)
npm start
```

### Testing Commands

```bash
# Test GunDB connectivity (relay-full)
curl http://localhost:8765/api/test-gundb

# Check server status (relay-full)
curl http://localhost:8765/api/status

# Test type validation system (relay-full)
curl http://localhost:8765/api/test-mityli

# Test simple relay connectivity
curl http://localhost:8000/gun
```

### Backup Commands

```bash
# Create manual backup (relay-full)
node scripts/backup-radata.js

# Setup automated backup schedule (relay-full)
node scripts/setup-backup-cron.js

# Test logging system (relay-full)
node scripts/test-logger.js
```

## Docker Support

The relay-full component includes Docker support:

```bash
# Build Docker image
docker build -t shogun-relay .

# Run with Docker Compose
docker-compose up
```

## Performance Considerations

- **Type Validation**: Can be disabled or set to non-strict mode for better performance
- **IPFS Integration**: Optional and can be disabled if not needed
- **Logging**: Configurable log levels to balance detail and performance
- **Backup Scheduling**: Automated backups can be scheduled during low-traffic periods
