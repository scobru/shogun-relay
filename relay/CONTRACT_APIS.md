# Shogun Relay - Contract APIs Documentation

Complete documentation for the contract configuration and management APIs.

## Overview

The Shogun Relay now includes comprehensive APIs for accessing contract configurations, ABIs, and addresses directly from the `shogun-contracts` package. This provides a centralized way to manage contract deployments across different chains.

## Base URL

All contract API endpoints are prefixed with `/api/contracts`

## Available Endpoints

### Get All Available Contracts

Retrieves a list of all available contracts for the current chain.

**Endpoint:** `GET /api/contracts`

**Response (200 OK):**
```json
{
  "success": true,
  "chainId": "11155111",
  "contracts": [
    {
      "name": "Relay#RelayPaymentRouter",
      "address": "0x5215d5B4F967d96E5F22350EDfFC2f20773b6F13",
      "shortName": "relay-payment-router"
    },
    {
      "name": "Stealth#StealthPool",
      "address": "0xEcC63BE2EA5Fb72Ca63c758bC9Fd41630230b56e",
      "shortName": "stealth-pool"
    }
  ],
  "timestamp": 1703123456789
}
```

### Get Complete Contract Configuration

Retrieves the complete configuration for all contracts.

**Endpoint:** `GET /api/contracts/config`

**Response (200 OK):**
```json
{
  "success": true,
  "chainId": "11155111",
  "contracts": {
    "relayPaymentRouter": {
      "address": "0x5215d5B4F967d96E5F22350EDfFC2f20773b6F13",
      "abi": [...]
    },
    "stealthPool": {
      "address": "0xEcC63BE2EA5Fb72Ca63c758bC9Fd41630230b56e",
      "abi": [...]
    }
  },
  "timestamp": 1703123456789
}
```

### Get Specific Contract Details

Retrieves complete details for a specific contract.

**Endpoint:** `GET /api/contracts/:contractName`

**Parameters:**
- `contractName` - The short name of the contract (e.g., `relay-payment-router`)

**Available Contract Names:**
- `relay-payment-router` - RelayPaymentRouter contract
- `stealth-pool` - StealthPool contract
- `pair-recovery` - PairRecovery contract
- `integrity` - Integrity contract
- `payment-forwarder` - PaymentForwarder contract
- `stealth-key-registry` - StealthKeyRegistry contract
- `bridge-dex` - BridgeDex contract

**Response (200 OK):**
```json
{
  "success": true,
  "chainId": "11155111",
  "contractName": "relay-payment-router",
  "contract": {
    "address": "0x5215d5B4F967d96E5F22350EDfFC2f20773b6F13",
    "abi": [...]
  },
  "timestamp": 1703123456789
}
```

### Get Contract ABI Only

Retrieves only the ABI for a specific contract.

**Endpoint:** `GET /api/contracts/:contractName/abi`

**Response (200 OK):**
```json
{
  "success": true,
  "chainId": "11155111",
  "contractName": "relay-payment-router",
  "abi": [
    {
      "inputs": [],
      "stateMutability": "nonpayable",
      "type": "constructor"
    },
    {
      "inputs": [
        {
          "internalType": "address",
          "name": "_user",
          "type": "address"
        },
        {
          "internalType": "address",
          "name": "_relayAddress",
          "type": "address"
        }
      ],
      "name": "getSubscriptionDetails",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "startTime",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "endTime",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "amountPaid",
          "type": "uint256"
        },
        {
          "internalType": "uint256",
          "name": "mbAllocated",
          "type": "uint256"
        },
        {
          "internalType": "bool",
          "name": "isActive",
          "type": "bool"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    }
  ],
  "timestamp": 1703123456789
}
```

### Get Contract Address Only

Retrieves only the address for a specific contract.

**Endpoint:** `GET /api/contracts/:contractName/address`

**Response (200 OK):**
```json
{
  "success": true,
  "chainId": "11155111",
  "contractName": "relay-payment-router",
  "address": "0x5215d5B4F967d96E5F22350EDfFC2f20773b6F13",
  "timestamp": 1703123456789
}
```

## Error Responses

### Contract Not Found (404)
```json
{
  "success": false,
  "error": "Contract not found: invalid-contract-name"
}
```

### Chain Not Found (404)
```json
{
  "success": false,
  "error": "No deployments found for chain ID: 999999"
}
```

### Server Error (500)
```json
{
  "success": false,
  "error": "Failed to load contract configuration",
  "details": "Error message details"
}
```

## Usage Examples

### JavaScript/TypeScript

```javascript
// Get all available contracts
const contractsResponse = await fetch('/api/contracts');
const contracts = await contractsResponse.json();

// Get specific contract ABI
const abiResponse = await fetch('/api/contracts/relay-payment-router/abi');
const abiData = await abiResponse.json();

// Get contract address
const addressResponse = await fetch('/api/contracts/relay-payment-router/address');
const addressData = await addressResponse.json();

// Use with ethers.js
const contract = new ethers.Contract(
  addressData.address,
  abiData.abi,
  provider
);
```

### cURL Examples

```bash
# Get all contracts
curl https://your-relay.com/api/contracts

# Get relay payment router ABI
curl https://your-relay.com/api/contracts/relay-payment-router/abi

# Get contract address
curl https://your-relay.com/api/contracts/relay-payment-router/address

# Get complete configuration
curl https://your-relay.com/api/contracts/config
```

## Configuration

The APIs automatically use the chain ID specified in the `CHAIN_ID` environment variable, defaulting to `11155111` (Sepolia testnet) if not set.

```bash
# Set chain ID for mainnet
export CHAIN_ID=1

# Set chain ID for Sepolia testnet
export CHAIN_ID=11155111
```

## Integration with Frontend

These APIs can be used to dynamically load contract configurations in your frontend applications, eliminating the need to hardcode ABIs and addresses.

```javascript
// Dynamic contract loading
async function loadContractConfig(contractName) {
  const [abiResponse, addressResponse] = await Promise.all([
    fetch(`/api/contracts/${contractName}/abi`),
    fetch(`/api/contracts/${contractName}/address`)
  ]);
  
  const abiData = await abiResponse.json();
  const addressData = await addressResponse.json();
  
  if (abiData.success && addressData.success) {
    return {
      abi: abiData.abi,
      address: addressData.address
    };
  }
  
  throw new Error('Failed to load contract configuration');
}
```

## Benefits

1. **Centralized Management**: All contract configurations are managed in one place
2. **Dynamic Updates**: Contract addresses and ABIs are automatically updated when deployments change
3. **Multi-Chain Support**: Easy switching between different blockchain networks
4. **Reduced Maintenance**: No need to manually update hardcoded values in frontend code
5. **Consistency**: Ensures all applications use the same contract configurations 