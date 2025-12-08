# L2 Bridge - Shogun Protocol

## Overview

Il **GunL2Bridge** è un bridge trustless che permette di trasferire ETH tra L1 (Ethereum/Base) e L2 (GunDB). Utilizza **Merkle Proofs** per garantire che i prelievi siano verificabili matematicamente senza bisogno di fidarsi del sequencer.

## Architettura

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

## Funzionalità

### 1. Depositi (L1 → L2)

Gli utenti inviano ETH al contratto `GunL2Bridge`. Il contratto emette un evento `Deposit` che i nodi GunDB ascoltano per accreditare il saldo L2.

**Flusso:**
1. Utente chiama `deposit()` sul contratto con ETH
2. Contratto emette evento `Deposit(user, amount, timestamp)`
3. Event listener nel relay accede l'evento
4. Saldo L2 viene accreditato in GunDB

### 2. Batch Submission (Sequencer)

Il sequencer raccoglie tutti i prelievi pending, costruisce un Merkle Tree, e pubblica solo la root sul contratto.

**Flusso:**
1. Sequencer raccoglie prelievi pending da GunDB
2. Costruisce Merkle Tree con tutti i prelievi
3. Chiama `submitBatch(root)` sul contratto
4. Batch viene salvato in GunDB per generare proof future

### 3. Prelievi (L2 → L1)

Gli utenti possono prelevare ETH solo fornendo una Merkle Proof che dimostra che il loro prelievo è incluso nella root pubblicata dal sequencer.

**Flusso:**
1. Utente richiede prelievo via API (decrements L2 balance)
2. Prelievo viene aggiunto alla coda pending
3. Sequencer include il prelievo nel prossimo batch
4. Utente ottiene la Merkle Proof dall'API
5. Utente chiama `withdraw(amount, nonce, proof)` sul contratto
6. Contratto verifica la proof e trasferisce ETH

## API Endpoints

### POST `/api/v1/bridge/deposit`
Endpoint informativo. I depositi devono essere fatti direttamente sul contratto.

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
Richiede un prelievo da L2. Decrementa il saldo L2 e aggiunge alla coda pending.

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
Endpoint per il sequencer: sottomette un batch con Merkle root.

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
Ottiene il saldo L2 di un utente.

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
Ottiene tutti i prelievi pending (in attesa di batch submission).

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
Genera la Merkle Proof per un prelievo incluso nell'ultimo batch.

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
Ottiene lo stato corrente del bridge (root, batchId, balance, etc.).

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

## Configurazione

### Variabili d'Ambiente

```bash
# Bridge Contract Address
BRIDGE_CONTRACT_ADDRESS=0x...

# RPC URL per la blockchain
BRIDGE_RPC_URL=https://sepolia.base.org
BRIDGE_CHAIN_ID=84532

# Private Key del Sequencer (per submitBatch)
BRIDGE_SEQUENCER_PRIVATE_KEY=0x...

# Block da cui iniziare ad ascoltare eventi (opzionale)
BRIDGE_START_BLOCK=12345
```

### Event Listener

Il listener per gli eventi `Deposit` viene avviato automaticamente all'avvio del relay se configurato. Per disabilitarlo:

```bash
BRIDGE_LISTENER_ENABLED=false
```

## Sicurezza

### Anti-Replay Protection

Ogni prelievo usa un `nonce` univoco. Il contratto mantiene un mapping `processedWithdrawals[leaf]` per prevenire doppi prelievi.

### Merkle Proof Verification

Il contratto verifica matematicamente che:
1. La leaf (hash di user+amount+nonce) appartiene alla root
2. La proof è valida (ricostruisce la root)
3. La root corrisponde a `currentStateRoot`

### Sequencer Authorization

Solo l'indirizzo `sequencer` può chiamare `submitBatch()`. Può essere aggiornato solo dal `owner` del contratto.

## Esempio d'Uso Completo

### 1. Deposito

```javascript
// Lato client (web3)
const bridge = new ethers.Contract(bridgeAddress, bridgeABI, signer);
const tx = await bridge.deposit({ value: ethers.parseEther("1.0") });
await tx.wait();
// Il relay ascolterà l'evento e accrediterà il saldo L2
```

### 2. Prelievo

```javascript
// 1. Richiedi prelievo via API
const response = await fetch(`${relayEndpoint}/api/v1/bridge/withdraw`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    user: userAddress,
    amount: ethers.parseEther("0.5").toString(),
    nonce: "1"
  })
});

// 2. Attendi batch submission (sequencer)

// 3. Ottieni proof
const proofResponse = await fetch(
  `${relayEndpoint}/api/v1/bridge/proof/${userAddress}/500000000000000000/1`
);
const { proof, root } = await proofResponse.json();

// 4. Chiama withdraw sul contratto
const tx = await bridge.withdraw(
  ethers.parseEther("0.5"),
  "1",
  proof
);
await tx.wait();
```

### 3. Batch Submission (Sequencer)

```javascript
// Lato sequencer
const response = await fetch(`${relayEndpoint}/api/v1/bridge/submit-batch`, {
  method: 'POST',
  headers: { 
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${sequencerToken}`
  }
});
```

## Testing

### Deploy del Contratto

```bash
cd shogun-contracts
npx hardhat compile
npx hardhat run scripts/deploy-bridge.js --network baseSepolia
```

### Test del Bridge

```bash
# Test deposito
curl -X POST http://localhost:8765/api/v1/bridge/deposit \
  -H "Content-Type: application/json" \
  -d '{"amount": "1000000000000000000"}'

# Test prelievo
curl -X POST http://localhost:8765/api/v1/bridge/withdraw \
  -H "Content-Type: application/json" \
  -d '{
    "user": "0x...",
    "amount": "500000000000000000",
    "nonce": "1"
  }'

# Test stato
curl http://localhost:8765/api/v1/bridge/state
```

## Note Tecniche

- **Leaf Hash**: `keccak256(abi.encodePacked(user, amount, nonce))`
- **Merkle Tree**: Usa sorted pairs (left <= right) per struttura deterministica
- **Proof Format**: Array di hash sibling da leaf a root
- **Nonce**: Deve essere univoco per utente (incrementale o random)

## Troubleshooting

### "Insufficient balance"
Verifica che l'utente abbia un saldo L2 sufficiente in GunDB.

### "Withdrawal not found in latest batch"
Il prelievo non è stato ancora incluso in un batch. Attendi che il sequencer sottometta un batch.

### "Invalid Merkle proof"
La proof potrebbe essere obsoleta se è stato sottometto un nuovo batch. Ottieni una nuova proof.

### "Bridge not configured"
Assicurati che `BRIDGE_CONTRACT_ADDRESS` e `BRIDGE_RPC_URL` siano configurati.

