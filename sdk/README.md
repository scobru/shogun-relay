# Shogun Relay SDK

TypeScript/JavaScript SDK for interacting with Shogun Relay API.

## Installation

```bash
npm install @shogun/relay-sdk
# or
yarn add @shogun/relay-sdk
```

## Quick Start

```typescript
import ShogunRelaySDK from '@shogun/relay-sdk';
import { generateWalletSignature } from '@shogun/relay-sdk/utils/wallet';
import { ethers } from 'ethers';

// Initialize SDK
const sdk = new ShogunRelaySDK({
  baseURL: 'https://shogun-relay.scobrudot.dev',
  token: 'your-admin-token' // Optional: for admin operations
});

// Or set token later
sdk.setToken('your-admin-token');
```

## Authentication

### Admin Authentication

For admin operations, use the admin token:

```typescript
const sdk = new ShogunRelaySDK({
  baseURL: 'https://shogun-relay.scobrudot.dev',
  token: 'your-admin-token'
});

// Admin upload (no signature required)
const result = await sdk.ipfs.uploadFile(
  fileBuffer,
  'example.txt',
  'text/plain'
);
```

### Wallet Signature Authentication

For user operations, you need to sign a message with your wallet:

```typescript
import { generateWalletSignature } from '@shogun/relay-sdk/utils/wallet';
import { ethers } from 'ethers';

// Connect to wallet
const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();
const address = await signer.getAddress();

// Generate signature
const signature = await generateWalletSignature(signer);

// Upload with wallet signature
const result = await sdk.ipfs.uploadFile(
  fileBuffer,
  'example.txt',
  'text/plain',
  {
    userAddress: address,
    walletSignature: signature,
    isDealUpload: true // For deal uploads (no subscription required)
  }
);
```

## IPFS Operations

### Upload Single File

```typescript
// Admin upload
const result = await sdk.ipfs.uploadFile(
  fileBuffer,
  'example.txt',
  'text/plain'
);

// User upload with subscription
const result = await sdk.ipfs.uploadFile(
  fileBuffer,
  'example.txt',
  'text/plain',
  {
    userAddress: address,
    walletSignature: signature
  }
);

// Deal upload (no subscription required)
const result = await sdk.ipfs.uploadFile(
  fileBuffer,
  'example.txt',
  'text/plain',
  {
    userAddress: address,
    walletSignature: signature,
    isDealUpload: true
  }
);

// Encrypted upload
const encryptedResult = await sdk.ipfs.uploadFile(
  fileBuffer,
  'example.txt',
  'text/plain',
  {
    userAddress: address,
    walletSignature: signature,
    encrypted: true,
    encryptionToken: signature // Use same signature for encryption
  }
);
```

### Upload Directory

```typescript
const files = [
  {
    buffer: indexHtmlBuffer,
    filename: 'index.html',
    path: 'index.html',
    contentType: 'text/html'
  },
  {
    buffer: styleCssBuffer,
    filename: 'style.css',
    path: 'css/style.css',
    contentType: 'text/css'
  }
];

const result = await sdk.ipfs.uploadDirectory(files, {
  userAddress: address,
  walletSignature: signature,
  isDealUpload: true
});
```

### Browser Upload

```typescript
// Single file
const fileInput = document.querySelector('input[type="file"]');
const file = fileInput.files[0];

const result = await sdk.ipfs.uploadFileBrowser(file, {
  userAddress: address,
  walletSignature: signature,
  isDealUpload: true
});

// Directory upload
const directoryInput = document.querySelector('input[type="file"][webkitdirectory]');
const files = Array.from(directoryInput.files);

const result = await sdk.ipfs.uploadDirectoryBrowser(files, {
  userAddress: address,
  walletSignature: signature
});
```

### Retrieve File

```typescript
// Get file content
const content = await sdk.ipfs.cat('QmHash...');

// Get encrypted file (decrypted)
const decryptedContent = await sdk.ipfs.catDecrypt(
  'QmHash...',
  signature, // Encryption token
  address // Optional: for signature verification
);
```

## Storage Deals

### Upload for Deal

```typescript
const signature = await generateWalletSignature(signer);

const result = await sdk.deals.uploadForDeal(
  fileBuffer,
  'example.txt',
  'text/plain',
  address,
  signature // Required: wallet signature
);
```

### Create Deal

```typescript
const deal = await sdk.deals.createDeal({
  cid: 'QmHash...',
  clientAddress: address,
  sizeMB: 10,
  durationDays: 30,
  tier: 'standard'
});
```

## Wallet Utilities

The SDK includes utility functions for wallet operations:

```typescript
import {
  generateWalletSignature,
  verifyWalletSignature,
  getAddressFromSignature,
  WALLET_AUTH_MESSAGE
} from '@shogun/relay-sdk/utils/wallet';

// Generate signature
const signature = await generateWalletSignature(signer);

// Verify signature
const isValid = await verifyWalletSignature(address, signature);

// Get address from signature
const recoveredAddress = await getAddressFromSignature(signature);

// The message that must be signed
console.log(WALLET_AUTH_MESSAGE); // "I Love Shogun"
```

## Complete Example

```typescript
import ShogunRelaySDK from '@shogun/relay-sdk';
import { generateWalletSignature } from '@shogun/relay-sdk/utils/wallet';
import { ethers } from 'ethers';
import fs from 'fs';

async function uploadFileExample() {
  // Initialize SDK
  const sdk = new ShogunRelaySDK({
    baseURL: 'https://shogun-relay.scobrudot.dev'
  });

  // Connect wallet
  const provider = new ethers.BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();

  // Generate signature for authentication
  const signature = await generateWalletSignature(signer);

  // Read file
  const fileBuffer = fs.readFileSync('example.txt');

  // Upload as deal (no subscription required)
  const result = await sdk.ipfs.uploadFile(
    fileBuffer,
    'example.txt',
    'text/plain',
    {
      userAddress: address,
      walletSignature: signature,
      isDealUpload: true
    }
  );

  console.log('Uploaded! CID:', result.cid);
  return result;
}
```

## API Reference

See the main [API Documentation](../docs/API.md) for complete endpoint reference.

## Modules

- **System**: Health checks, stats, system information
- **IPFS**: File uploads, directory uploads, content retrieval, pinning
- **Deals**: Storage deal creation, activation, management
- **Registry**: On-chain relay registry operations
- **Network**: Network federation, reputation, relay discovery
- **X402**: Subscription management, storage limits
- **Bridge**: L2 bridge operations, deposits, withdrawals
- **Uploads**: User upload metadata management
- **AnnasArchive**: Torrent and archive management

## License

MIT

