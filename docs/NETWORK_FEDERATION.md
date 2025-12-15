# Network Federation & Storage Proofs

Shogun Relay supports decentralized storage protocol features inspired by Swarm and Filecoin.

## Architecture

```
┌────────────────┐      GunDB Sync      ┌────────────────┐
│   Relay A      │◀────────────────────▶│   Relay B      │
│   (IPFS Node)  │                      │   (IPFS Node)  │
└───────┬────────┘                      └───────┬────────┘
        │         Pin Coordination              │
        └───────────────────────────────────────┘
```

## Relay Discovery

Relays automatically announce themselves via GunDB's native sync:

```bash
# List all active relays
curl http://localhost:8765/api/v1/network/relays

# Network-wide statistics
curl http://localhost:8765/api/v1/network/stats
```

## Storage Proofs

Verify that a relay actually stores specific content:

```bash
# Generate storage proof for a CID
curl http://localhost:8765/api/v1/network/proof/QmHash123

# Verify a proof from another relay
curl -X POST http://localhost:8765/api/v1/network/verify-proof \
  -H "Content-Type: application/json" \
  -d '{"proof": {...}}'
```

## Pin Coordination

Request other relays to replicate content:

```bash
# Request network to pin a CID (admin)
curl -X POST http://localhost:8765/api/v1/network/pin-request \
  -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
  -d '{"cid": "QmHash123", "replicationFactor": 3}'
```

## Key Points

1. **No Replication Duplication**: Uses GunDB's native sync
2. **IPFS Independent**: Storage proofs verify IPFS content separately
3. **Decentralized Coordination**: Pin requests propagate via GunDB pub/sub
4. **Challenge-Response Proofs**: SHA256-based proofs with expiration

---

# Reputation System

Tracks and scores relays based on reliability.

## Score Components

| Component | Weight | Description |
|-----------|--------|-------------|
| Uptime | 30% | Pulse consistency over time |
| Proof Success | 25% | Storage proof reliability |
| Response Time | 20% | Speed of proof generation |
| Pin Fulfillment | 15% | Honoring replication requests |
| Longevity | 10% | Time in network |

## Reputation Tiers

| Tier | Score | Description |
|------|-------|-------------|
| Excellent | 90-100 | Preferred for critical data |
| Good | 75-89 | Suitable for most replication |
| Average | 50-74 | May have occasional issues |
| Poor | 25-49 | Avoid for important data |
| Unreliable | 0-24 | Do not use |

## API

```bash
# Get reputation leaderboard
curl http://localhost:8765/api/v1/network/reputation

# Get best relays for replication
curl "http://localhost:8765/api/v1/network/best-relays?count=3&minScore=70"
```

---

# Verified (Frozen) Data System

Immutable, cryptographically verified data using GunDB's SEA.

## Why Frozen Data?

Regular GunDB nodes can be modified by anyone. Frozen data provides:
1. **Content-Addressed Storage**: Data stored at hash derived from content
2. **Cryptographic Signatures**: Each entry signed by author using SEA
3. **Verification**: Anyone can verify without trusting the source

## API

```bash
# List verified relay announcements
curl http://localhost:8765/api/v1/network/verified/relays

# Get verified announcement for specific relay
curl http://localhost:8765/api/v1/network/verified/relay/192.168.1.100
```

## Security Guarantees

| Threat | Protection |
|--------|------------|
| Data tampering | Content hash changes if data modified |
| Impersonation | Signature verification requires private key |
| Replay attacks | Timestamps in signed data |
| Spam | Entries traceable to public keys |
