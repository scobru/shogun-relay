# 📡 Shogun Relay

This is a unified relay server for the Shogun application, providing Gun database, IPFS integration, and API services.

## Features

- **GunDB Relay**: Provides a WebSocket endpoint for GunDB peer synchronization
- **IPFS Integration**: Seamlessly stores and retrieves data from IPFS
- **File Storage**: Handles file uploads with automatic IPFS backup when enabled
- **REST API**: Comprehensive API for file management and system configuration
- **Authentication**: Token-based security for all API endpoints, including user-specific tokens
- **User Management**: Native GunDB user authentication with API token generation
- **ShogunCore Integration**: Powerful authentication with WebAuthn, MetaMask, and password
- **Key Pair Generator**: Web interface to generate and download GunDB key pairs
- **CORS Protection**: Configurable cross-origin resource sharing
- **Blockchain Integration**: Connect with Ethereum smart contracts for membership verification, DIDs, and oracle services

## Architecture

The Shogun Relay Server combines several key technologies:

### GunDB Integration

The relay serves as a Gun peer node, providing:
- WebSocket endpoint for real-time data synchronization
- RAD (Radisk) persistence for graph data
- Optional transaction logging for audit purposes
- Native Gun user authentication system
- User-specific API token management

### ShogunCore Integration

The relay now integrates with ShogunCore for enhanced authentication:
- WebAuthn support for passwordless authentication
- MetaMask authentication for web3 integration
- Traditional username/password authentication
- DID (Decentralized Identity) management
- Wallet management for crypto operations

### Blockchain Integration

The relay includes three key blockchain components:
- **RelayMembershipVerifier**: Validates if users are authorized members of the Shogun protocol
- **DIDVerifier**: Manages decentralized identifiers with on-chain verification
- **OracleBridge**: Publishes and verifies Merkle roots for data notarization

#### On-Chain Membership Verification

When enabled, the relay can verify if GunDB message senders are authorized members of the protocol:

- When `ONCHAIN_MEMBERSHIP_ENABLED=true`, the relay server will:
  - Extract the public key from incoming Gun messages
  - Verify the public key against the RelayMembership smart contract
  - Authorize or reject messages based on on-chain verification
  - Provide an additional layer of security by ensuring only authorized participants can interact with the system

This provides true decentralized access control, where membership is verified on-chain rather than just through tokens or credentials.

#### Ethereum Transaction Signing

For blockchain interactions that require write operations (transactions):

- Read operations (like checking membership or verifying DIDs) don't require a private key
- Write operations (like registering DIDs or publishing Merkle roots) require a private key
- Configure `ETHEREUM_PRIVATE_KEY` in your `.env` file to enable write operations
- The relay will automatically create a signer using this private key to sign transactions
- For security, consider using environment variables rather than hardcoding the key
- If no private key is provided, write operations will fail with appropriate error messages

For example, the `POST /api/relay/oracle/publish-root` endpoint requires a private key to sign the transaction that publishes a new Merkle root to the OracleBridge contract.

### IPFS Layer

The IPFS integration provides:
- Automatic data retrieval from IPFS when referenced in GunDB
- Support for both local IPFS nodes and Pinata cloud storage
- Configurable fallback to local storage when IPFS is unavailable

### File Storage System

The file system offers:
- Multi-part file uploads with streaming support
- Automatic IPFS backup when enabled
- Local file storage fallback
- Metadata tracking in GunDB

## Key Pair Generator

The relay includes a built-in key pair generator page at `/keypair` that allows:
- Generation of cryptographic key pairs compatible with GunDB
- Downloading key pairs as JSON files
- Using key pairs for authentication with Gun.js or Shogun applications
- Certificate-based API token generation

## Security Enhancements

The server includes several security enhancements:

1. CORS protection with specific configurations for different API endpoints
2. Token-based authentication for APIs with user-specific tokens
3. WebSocket connection validation
4. Input sanitization for API parameters
5. Comprehensive error handling
6. Gun's native SEA (Security, Encryption, Authorization) for user management
7. Certificate-based authentication for enhanced security

## Environment Variables

For security reasons, several configurations should be set via environment variables instead of hardcoding in the source code. Create a `.env` file in the root directory with the following variables:

```
# Server configuration
PORT=8765
NODE_ENV=development  # Use 'production' for production environments

# Security
API_SECRET_TOKEN=your_secret_token_here

# CORS configuration
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080

# IPFS configuration
IPFS_ENABLED=true
IPFS_SERVICE=IPFS-CLIENT  # or 'PINATA' for cloud storage
IPFS_NODE_URL=http://127.0.0.1:5001
IPFS_GATEWAY=http://127.0.0.1:8080/ipfs

# Pinata configuration (if using PINATA service)
PINATA_GATEWAY=https://gateway.pinata.cloud
PINATA_JWT=your_pinata_jwt_token

# Ethereum provider configuration
ETHEREUM_PROVIDER_URL=http://localhost:8545  # Use Infura, Alchemy, etc. for production
ETHEREUM_PRIVATE_KEY=  # Optional: Private key for signing transactions (needed for write operations)

# Relay Membership configuration
RELAY_MEMBERSHIP_ENABLED=false
RELAY_MEMBERSHIP_CONTRACT=0x0000000000000000000000000000000000000000
ONCHAIN_MEMBERSHIP_ENABLED=false  # Enable membership verification for Gun messages

# DID Verifier configuration
DID_VERIFIER_ENABLED=false
DID_REGISTRY_CONTRACT=0x0000000000000000000000000000000000000000

# Oracle Bridge configuration
ORACLE_BRIDGE_ENABLED=false
ORACLE_BRIDGE_CONTRACT=0x0000000000000000000000000000000000000000

# WebAuthn configuration
WEBAUTHN_RP_ID=localhost  # The Relying Party ID for WebAuthn

# Encryption (optional)
ENCRYPTION_ENABLED=false
ENCRYPTION_KEY=your_encryption_key
ENCRYPTION_ALGORITHM=aes-256-gcm

# SQLite configuration (optional)
SQLITE_ENABLED=true
SQLITE_PATH=./sqlitedata
SQLITE_FILE=shogun.db
SQLITE_VERBOSE=false
```

## User Management System

The relay now includes a complete user management system with the following features:

### Native GunDB User Authentication

The system uses Gun's native SEA (Security, Encryption, Authorization) module:
- Secure cryptographic key pairs for each user
- End-to-end encryption for sensitive data
- Digital signatures for authenticity verification
- Zero-knowledge proof authentication

### ShogunCore Authentication Methods

Multiple authentication methods are available through ShogunCore:
- Username and password authentication
- WebAuthn (passwordless) authentication using biometrics or security keys
- MetaMask authentication for web3/Ethereum integration
- Key pair-based authentication

### User Registration and Authentication

Users can register with a username, password, and optional email:
- User credentials are securely managed by Gun's SEA system
- Additional profile data is stored in the user's secure space
- Gun certificates (proof of identity) are provided to clients upon login

### Token Management

Each user can have multiple API tokens with:
- Customizable names for different purposes/applications
- Optional expiration dates
- Ability to revoke tokens
- Last used timestamps for tracking

### Permission System

The system includes a basic permission system:
- System/admin token with full access
- User-specific tokens with configurable permissions
- Permission checking in sensitive operations

### Client Integration

Clients can seamlessly integrate with both systems:
- Gun's user authentication for real-time data security
- API tokens for REST API access
- Gun certificates returned on login can be stored for continued session use

## Blockchain Integration APIs

The relay server provides several REST APIs for interacting with the blockchain components:

### Relay Membership Verifier API

These endpoints allow verification of protocol membership:

- `GET /api/relay/membership/status` - Check relay membership service status
- `GET /api/relay/membership/check-address/:address` - Check if an Ethereum address is authorized
- `POST /api/relay/membership/check-pubkey` - Check if a public key is authorized
- `POST /api/relay/membership/address-for-pubkey` - Get the address associated with a public key
- `GET /api/relay/membership/user-info/:address` - Get user information for an address
- `GET /api/relay/membership/is-active/:address` - Check if a user's subscription is active
- `POST /api/relay/membership/config` - Update relay membership configuration (admin only)

### DID Verifier API

These endpoints provide DID (Decentralized Identifier) verification:

- `GET /api/relay/did/status` - Check DID verifier service status
- `GET /api/relay/did/verify/:did` - Verify a DID and get its controller
- `POST /api/relay/did/check-controller` - Check if a DID is controlled by a specific controller
- `POST /api/relay/did/authenticate` - Authenticate using a DID and a signature
- `POST /api/relay/did/register` - Register a new DID (admin only)
- `POST /api/relay/did/config` - Update DID verifier configuration (admin only)

### Oracle Bridge API

These endpoints interact with the OracleBridge contract:

- `GET /api/relay/oracle/status` - Check Oracle Bridge service status
- `GET /api/relay/oracle/epoch` - Get the current epoch ID
- `GET /api/relay/oracle/root/:epochId` - Get the Merkle root for a specific epoch
- `POST /api/relay/oracle/verify-root` - Verify if a Merkle root matches the expected value
- `POST /api/relay/oracle/publish-root` - Publish a new Merkle root (admin only)
- `POST /api/relay/oracle/config` - Update Oracle Bridge configuration (admin only)

### Example Usage

**Checking if an Ethereum address is authorized**:
```javascript
// Client-side code
async function checkAddressAuthorization(address) {
  const response = await fetch(`http://localhost:8765/api/relay/membership/check-address/${address}`, {
    method: 'GET',
    headers: {
      'Authorization': 'your_api_token'
    }
  });
  
  const data = await response.json();
  return data.isAuthorized;
}
```

**Verifying a DID**:
```javascript
// Client-side code
async function verifyDID(did) {
  const response = await fetch(`http://localhost:8765/api/relay/did/verify/${did}`, {
    method: 'GET',
    headers: {
      'Authorization': 'your_api_token'
    }
  });
  
  const data = await response.json();
  return {
    isValid: data.isValid,
    controller: data.controller
  };
}
```

**Getting the current epoch ID**:
```javascript
// Client-side code
async function getCurrentEpochId() {
  const response = await fetch('http://localhost:8765/api/relay/oracle/epoch', {
    method: 'GET',
    headers: {
      'Authorization': 'your_api_token'
    }
  });
  
  const data = await response.json();
  return data.epochId;
}
```

## IPFS-GunDB Middleware

The relay includes a middleware that integrates GunDB with IPFS:

### How It Works

1. **Data Retrieval**: When GunDB data contains IPFS references (ipfsHash), the middleware automatically retrieves the full data from IPFS
2. **Format Support**: Handles both direct IPFS hash references and structured references
3. **Client-Side Storage**: Allows clients to store data on IPFS and reference it in GunDB

### Usage Examples

**Storing data in IPFS from client**:
```javascript
// Client-side code
const storeInIPFS = async (data) => {
  // Upload to IPFS first
  const ipfsHash = await ipfsClient.add(JSON.stringify(data));
  
  // Store only the reference in GunDB
  gun.get('myNode').put({
    ipfsHash: ipfsHash.path,
    timestamp: Date.now()
  });
};
```

**Retrieving data**:
```javascript
// Client-side code
gun.get('myNode').on((data) => {
  // The middleware automatically retrieves the full data from IPFS
  console.log(data); // Complete data, not just the reference
});
```

## Running the Server

1. Install dependencies:
   ```
   npm install
   ```

2. Create and configure your `.env` file with appropriate values

3. Start the server:
   ```
   node index.js
   ```

## API Authentication

All API endpoints are protected with token-based authentication. You need to provide the token in one of these ways:

1. In the Authorization header: `Authorization: your_token_here` or `Authorization: Bearer your_token_here`
2. As a query parameter: `?token=your_token_here`
3. In the request body: `{ "token": "your_token_here" }`

### User Authentication API Endpoints

The server provides several authentication endpoints:

#### Standard Authentication
- `POST /api/auth/register` - Register a new user
  - Required fields: `username`, `password`
  - Optional fields: `email`
  - Returns a new API token and Gun user certificate

- `POST /api/auth/login` - Login with username and password
  - Required fields: `username`, `password`
  - Returns active tokens or creates a new one
  - Returns Gun certificate for client-side use

#### ShogunCore Authentication
- `POST /api/auth/shogun/login` - Login with ShogunCore (username/password)
  - Required fields: `username`, `password`
  - Returns API token and user certificate

- `POST /api/auth/shogun/signup` - Register with ShogunCore
  - Required fields: `username`, `password`
  - Optional fields: `email`
  - Returns API token and user certificate

#### WebAuthn Authentication
- `POST /api/auth/shogun/webauthn/login` - Login with WebAuthn
  - Required fields: `username`
  - Returns API token and authentication result

- `POST /api/auth/shogun/webauthn/signup` - Register with WebAuthn
  - Required fields: `username`
  - Returns API token and registration result

#### MetaMask Authentication
- `POST /api/auth/shogun/metamask/login` - Login with MetaMask
  - Required fields: `address` (Ethereum address)
  - Returns API token and authentication result

- `POST /api/auth/shogun/metamask/signup` - Register with MetaMask
  - Required fields: `address` (Ethereum address)
  - Returns API token and registration result

#### Certificate Authentication
- `POST /api/auth/verify-cert` - Authenticate with Gun certificate
  - Required fields: `certificate` (Gun SEA certificate object)
  - Returns API token if certificate is valid

#### Token Management
- `POST /api/auth/tokens` - Create a new API token (requires authentication)
  - Optional fields: `name`, `expiresInDays`

- `GET /api/auth/tokens` - List all tokens for the authenticated user

- `DELETE /api/auth/tokens/:tokenId` - Revoke a specific token

- `POST /api/auth/verify-token` - Verify if a token is valid
  - Required fields: `token`