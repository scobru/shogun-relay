# x402 Payment Implementation

Shogun Relay implements the [x402 payment protocol](https://x402.org) to enable paid IPFS storage subscriptions. Users can purchase subscriptions using USDC (EIP-3009) payments directly from their wallet without requiring approval transactions.

## Payment Flow

```
User → Request Subscription → Get Payment Requirements → Sign Authorization → Submit Payment → Verify → Settle → Activate
```

1. **Payment Requirements**: Client requests subscription via `/api/v1/x402/payment-requirements/:tier`
2. **Authorization Signing**: User signs an EIP-3009 `transferWithAuthorization` message (no gas required)
3. **Payment Submission**: Signed authorization sent to `/api/v1/x402/subscribe`
4. **Settlement**: Payment settled on-chain via facilitator or direct settlement
5. **Storage Activation**: Subscription saved to GunDB in relay's user space

## Subscription Tiers

| Tier | Storage | Price (USDC) | Duration |
|------|---------|--------------|----------|
| Basic | 100 MB | 0.001 | 30 days |
| Standard | 500 MB | 0.004 | 30 days |
| Premium | 2000 MB | 0.01 | 30 days |

## Settlement Modes

**Facilitator Mode** (default):
- Uses x402.org facilitator service
- Requires `X402_FACILITATOR_URL`
- Falls back to direct settlement if facilitator fails

**Direct Mode**:
- Relay settles payments directly on-chain
- Requires `X402_PRIVATE_KEY` configured
- Wallet must have ETH for gas fees

## Configuration

| Variable | Description | Required |
|----------|-------------|----------|
| `X402_PAY_TO_ADDRESS` | Ethereum address to receive payments | Yes |
| `X402_NETWORK` | Blockchain network (base-sepolia, base, polygon, polygon-amoy) | Yes |
| `X402_SETTLEMENT_MODE` | 'facilitator' or 'direct' | No (default: facilitator) |
| `X402_FACILITATOR_URL` | Facilitator service URL | No |
| `X402_PRIVATE_KEY` | Private key for direct settlement | Required for direct mode |
| `RELAY_MAX_STORAGE_GB` | Maximum total IPFS storage in GB (0 = unlimited) | No |

## Supported Networks

| Network | Chain ID | USDC Contract |
|---------|----------|---------------|
| Base | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Polygon | 137 | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| Polygon Amoy | 80002 | `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582` |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/x402/tiers` | GET | List available subscription tiers |
| `/api/v1/x402/subscription/:userAddress` | GET | Get subscription status |
| `/api/v1/x402/subscribe` | POST | Purchase/renew subscription |
| `/api/v1/x402/payment-requirements/:tier` | GET | Get payment requirements |
| `/api/v1/x402/can-upload/:userAddress` | GET | Check upload permission |
| `/api/v1/x402/storage/:userAddress` | GET | Get storage info |
| `/api/v1/x402/relay-storage` | GET | Get relay global storage status |

## Data Storage Architecture

Subscription data is stored in GunDB using the relay's dedicated user account:

```javascript
relayUser.x402.subscriptions[userAddress] = {
  tier: 'basic',
  storageMB: 100,
  storageUsedMB: 45.2,
  expiresAt: timestamp,
  purchasedAt: timestamp,
  paymentTx: '0x...',
  paymentNetwork: 'base-sepolia'
}
```

This ensures only the relay can modify subscription data (ownership model).

## Security Considerations

1. **Relay User Isolation**: Users cannot modify their own subscriptions
2. **Payment Verification**: All payments verified before activation
3. **Storage Limits**: Uploads checked against subscription limits
4. **Time Windows**: Payment authorizations have expiration times
5. **On-Chain Settlement**: Cryptographic proof via actual USDC transfer
