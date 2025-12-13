# L2 Bridge - Shogun Protocol

## Overview

The **GunL2Bridge** is a trustless bridge that enables ETH transfers between L1 (Ethereum/Base) and L2 (GunDB). It uses **Merkle Proofs** to ensure withdrawals are mathematically verifiable without trusting the sequencer.

## Architecture

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│   L1 (ETH)  │────────▶│ GunL2Bridge  │────────▶│ L2 (GunDB)  │
│  Contract   │ Deposit │   Contract   │ Event    │   State     │
└─────────────┘         └──────────────┘         └─────────────┘
                              ▲
                              │ Merkle Root
                              │ (Batch Submission)
                              │
                        ┌─────┴─────┐
                        │ Sequencer │
                        └──────────┘
```

## Features

### 1. Deposits (L1 → L2)

Users send ETH to the `GunL2Bridge` contract. The contract emits a `Deposit` event that GunDB nodes listen to for crediting L2 balance.

**Flow:**
1. User calls `deposit()` on contract with ETH
2. Contract emits `Deposit(user, amount, timestamp)` event
3. Event listener in relay processes the event
4. L2 balance is credited in GunDB

### 2. Batch Submission (Sequencer)

The sequencer collects all pending withdrawals, builds a Merkle Tree, and publishes only the root on the contract.

**Flow:**
1. Sequencer collects pending withdrawals from GunDB
2. Builds Merkle Tree with all withdrawals
3. Calls `submitBatch(root)` on contract
4. Batch is saved in GunDB for future proof generation

### 3. Withdrawals (L2 → L1)

Users can withdraw ETH only by providing a Merkle Proof that proves their withdrawal is included in the root published by the sequencer.

**Flow:**
1. User requests withdrawal via API (decrements L2 balance)
2. Withdrawal is added to pending queue
3. Sequencer includes withdrawal in next batch
4. User obtains Merkle Proof from API
5. User calls `withdraw(amount, nonce, proof)` on contract
6. Contract verifies proof and transfers ETH

## API Endpoints

### POST `/api/v1/bridge/deposit`
Informational endpoint. Deposits must be made directly on the contract.

**Request:**
```json
{
  "amount": "1000000000000000000"  // 1 ETH in wei
}
```

**Response:**
```json
{
  "success": true,
  "contractAddress": "0x...",
  "instructions": "Call deposit() on the contract with the ETH amount"
}
```

### POST `/api/v1/bridge/withdraw`
Request a withdrawal from L2. Decrements L2 balance and adds to pending queue.

**Request:**
```json
{
  "user": "0x...",
  "amount": "500000000000000000",  // 0.5 ETH in wei
  "nonce": "1"
}
```

**Response:**
```json
{
  "success": true,
  "withdrawal": {
    "user": "0x...",
    "amount": "500000000000000000",
    "nonce": "1",
    "timestamp": 1234567890
  },
  "message": "Withdrawal queued. Wait for batch submission to generate proof."
}
```

### POST `/api/v1/bridge/submit-batch`
Sequencer endpoint: submits a batch with Merkle root.

**Request:**
```json
{}
```

**Response:**
```json
{
  "success": true,
  "batch": {
    "batchId": "1",
    "root": "0x...",
    "withdrawalCount": 5,
    "txHash": "0x...",
    "blockNumber": 12345
  }
}
```

### GET `/api/v1/bridge/balance/:user`
Get user's L2 balance.

**Response:**
```json
{
  "success": true,
  "user": "0x...",
  "balance": "1000000000000000000",
  "balanceEth": "1.0"
}
```

### GET `/api/v1/bridge/pending-withdrawals`
Get all pending withdrawals (waiting for batch submission).

**Response:**
```json
{
  "success": true,
  "withdrawals": [
    {
      "user": "0x...",
      "amount": "500000000000000000",
      "nonce": "1",
      "timestamp": 1234567890
    }
  ],
  "count": 1
}
```

### GET `/api/v1/bridge/proof/:user/:amount/:nonce`
Generate Merkle Proof for a withdrawal included in the latest batch.

**Response:**
```json
{
  "success": true,
  "proof": ["0x...", "0x...", "0x..."],
  "batchId": "1",
  "root": "0x...",
  "withdrawal": {
    "user": "0x...",
    "amount": "500000000000000000",
    "nonce": "1"
  }
}
```

### GET `/api/v1/bridge/state`
Get current bridge state (root, batchId, balance, etc.).

**Response:**
```json
{
  "success": true,
  "state": {
    "currentStateRoot": "0x...",
    "currentBatchId": "1",
    "sequencer": "0x...",
    "contractBalance": "10000000000000000000",
    "contractBalanceEth": "10.0"
  }
}
```

## Configuration

### Environment Variables

```bash
# Bridge Contract Address
BRIDGE_CONTRACT_ADDRESS=0x...

# RPC URL for blockchain
BRIDGE_RPC_URL=https://sepolia.base.org
BRIDGE_CHAIN_ID=84532

# Sequencer Private Key (for submitBatch)
BRIDGE_SEQUENCER_PRIVATE_KEY=0x...

# Block to start listening events from (optional)
BRIDGE_START_BLOCK=12345
```

### Event Listener

The `Deposit` event listener starts automatically on relay startup if configured. To disable:

```bash
BRIDGE_LISTENER_ENABLED=false
```

## Security

### Anti-Replay Protection

Each withdrawal uses a unique `nonce`. The contract maintains a `processedWithdrawals[leaf]` mapping to prevent double withdrawals.

### Merkle Proof Verification

The contract mathematically verifies that:
1. The leaf (hash of user+amount+nonce) belongs to the root
2. The proof is valid (reconstructs the root)
3. The root matches `currentStateRoot`

### Sequencer Authorization

Only the `sequencer` address can call `submitBatch()`. It can only be updated by the contract `owner`.

## Complete Usage Example

### 1. Deposit

```javascript
// Client side (web3)
const bridge = new ethers.Contract(bridgeAddress, bridgeABI, signer);
const tx = await bridge.deposit({ value: ethers.parseEther("1.0") });
await tx.wait();
// The relay will listen to the event and credit L2 balance
```

### 2. Withdrawal

```javascript
// 1. Request withdrawal via API
const response = await fetch(`${relayEndpoint}/api/v1/bridge/withdraw`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user: userAddress,
    amount: ethers.parseEther("0.5").toString(),
    nonce: "1"
  })
});

// 2. Wait for batch submission (sequencer)

// 3. Get proof
const proofResponse = await fetch(
  `${relayEndpoint}/api/v1/bridge/proof/${userAddress}/500000000000000000/1`
);
const { proof, root } = await proofResponse.json();

// 4. Call withdraw on contract
const tx = await bridge.withdraw(
  ethers.parseEther("0.5"),
  "1",
  proof
);
await tx.wait();
```

### 3. Batch Submission (Sequencer)

```javascript
// Sequencer side
const response = await fetch(`${relayEndpoint}/api/v1/bridge/submit-batch`, {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${sequencerToken}`
  }
});
```

## Testing

### Contract Deployment

```bash
cd shogun-contracts
npx hardhat compile
npx hardhat run scripts/deploy-bridge.js --network baseSepolia
```

### Bridge Testing

```bash
# Test deposit
curl -X POST http://localhost:8765/api/v1/bridge/deposit \
  -H "Content-Type: application/json" \
  -d '{"amount": "1000000000000000000"}'

# Test withdrawal
curl -X POST http://localhost:8765/api/v1/bridge/withdraw \
  -H "Content-Type: application/json" \
  -d '{
    "user": "0x...",
    "amount": "500000000000000000",
    "nonce": "1"
  }'

# Test state
curl http://localhost:8765/api/v1/bridge/state
```

## Technical Notes

- **Leaf Hash**: `keccak256(abi.encodePacked(user, amount, nonce))`
- **Merkle Tree**: Uses sorted pairs (left <= right) for deterministic structure
- **Proof Format**: Array of sibling hashes from leaf to root
- **Nonce**: Must be unique per user (incremental or random)

## Troubleshooting

### "Insufficient balance"
Verify the user has sufficient L2 balance in GunDB.

### "Withdrawal not found in latest batch"
The withdrawal hasn't been included in a batch yet. Wait for sequencer to submit a batch.

### "Invalid Merkle proof"
The proof might be stale if a new batch was submitted. Get a new proof.

### "Bridge not configured"
Ensure `BRIDGE_CONTRACT_ADDRESS` and `BRIDGE_RPC_URL` are configured.
