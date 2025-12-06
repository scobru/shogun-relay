# Punti di Sincronizzazione con GunDB

Questo documento elenca tutti i punti del protocollo Shogun Relay dove avviene la sincronizzazione con GunDB.

## 1. Storage Deals (Storage Deals)

### 1.1 Creazione e Salvataggio Deal
**File**: `routes/deals.js`, `utils/storage-deals.js`

- **POST `/api/v1/deals/create`**: Crea un nuovo deal e lo salva in GunDB
  - Usa `StorageDeals.saveDeal()` che salva in frozen space
  - Indice per CID: `shogun-index/deals-by-cid/{cid}/{dealId}`
  - Indice per client: `shogun-index/deals-by-client/{clientAddress}/{dealId}`

- **POST `/api/v1/deals/:dealId/activate`**: Attiva un deal dopo il pagamento
  - Salva il deal attivato in GunDB con `StorageDeals.saveDeal()`
  - Aggiorna gli indici

### 1.2 Sincronizzazione On-Chain → GunDB
**File**: `utils/deal-sync.js`, `index.js`

- **Sincronizzazione automatica periodica** (ogni 6 ore, configurabile):
  - Fetcha tutti i deal attivi on-chain per questo relay
  - Converte i deal on-chain nel formato GunDB
  - Salva in GunDB se non esistono già
  - Trigger: `DEAL_SYNC_ENABLED=true` + job periodico in `index.js`

- **Sincronizzazione manuale**:
  - **POST `/api/v1/deals/sync`**: Trigger manuale della sincronizzazione
  - Sincronizza deal on-chain → GunDB + IPFS pins

**Percorsi GunDB**:
- `storage-deals/{dealId}` (frozen entry)
- `shogun-index/deals-by-cid/{cid}/{dealId}`
- `shogun-index/deals-by-client/{clientAddress}/{dealId}`

---

## 2. X402 Subscriptions (Abbonamenti)

### 2.1 Creazione Subscription
**File**: `routes/x402.js`, `utils/x402-merchant.js`, `utils/relay-user.js`

- **POST `/api/v1/x402/subscribe`**: Crea una subscription dopo verifica pagamento
  - Verifica pagamento x402 (EIP-3009 transferWithAuthorization)
  - Esegue settlement (facilitator o direct)
  - Salva subscription in GunDB tramite `RelayUser.saveSubscription()`
  - Usa il relay user (SEA keypair) per firmare i dati
  - Path: `relayUser.x402.subscriptions[userAddress]`

**Percorsi GunDB**:
- `relayUser.x402.subscriptions[userAddress]` = {
  - `tier`: tier name
  - `storageMB`: storage limit
  - `storageUsedMB`: storage used
  - `expiresAt`: expiration timestamp
  - `purchasedAt`: purchase timestamp
  - `paymentTx`: transaction hash
  - `paymentNetwork`: network name
}
- `relayUser.x402.uploads[userAddress][hash]` = {
  - `hash`: IPFS hash
  - `name`: filename
  - `size`: file size
  - `sizeMB`: size in MB
  - `uploadedAt`: upload timestamp
}

### 2.2 Aggiornamento Storage Usage
**File**: `routes/ipfs.js`, `routes/uploads.js`, `utils/relay-user.js`

- **POST `/api/v1/ipfs/upload`**: Quando un utente carica un file (subscription)
  - Salva upload in `relayUser.x402.uploads[userAddress][hash]` tramite `RelayUser.saveUpload()`
  - Aggiorna `relayUser.x402.subscriptions[userAddress].storageUsedMB` tramite `X402Merchant.updateStorageUsage()`
  - Usa `relayUser.get('x402').get('uploads').get(userAddress).get(hash).put()`

- **DELETE `/api/v1/user-uploads/:hash`**: Quando un file viene eliminato
  - Rimuove da `relayUser.x402.uploads[userAddress][hash]` tramite `RelayUser.deleteUpload()`
  - Aggiorna `relayUser.x402.subscriptions[userAddress].storageUsedMB`

- **POST `/api/v1/x402/update-usage/:userAddress`**: Aggiornamento manuale storage usage
  - Aggiorna `relayUser.x402.subscriptions[userAddress].storageUsedMB`
  - Usa `RelayUser.updateSubscriptionField()`

---

## 3. Reputation System (Sistema di Reputazione)

### 3.1 Inizializzazione
**File**: `index.js`, `utils/relay-reputation.js`

- **All'avvio**: `Reputation.initReputationTracking(gun, host)`
  - Crea/aggiorna `shogun-network/reputation/{host}`

### 3.2 Tracking Eventi
**File**: `utils/relay-reputation.js`, `index.js`

- **Pulse periodico** (ogni 30 secondi):
  - `Reputation.recordPulse(gun, host)`: Registra uptime pulse
  - `Reputation.updateStoredScore(gun, host)`: Aggiorna score calcolato (periodicamente)

- **Pin requests fulfillment**:
  - `Reputation.recordPinFulfillment(gun, host, success)`: Quando si risponde a pin requests
  - Triggerato in `index.js` durante auto-replication

- **Storage proofs**:
  - `Reputation.recordStorageProof(gun, host, success)`: Quando si verifica uno storage proof
  - Triggerato dalle route di verifica deal

**Percorsi GunDB**:
- `shogun-network/reputation/{host}` = {
  - `metrics`: uptime, proofs, response times, pin fulfillment
  - `calculatedScore`: score totale e breakdown
  - `storedScore`: ultimo score calcolato (cached)
  - `firstSeenTimestamp`: quando il relay è stato visto per la prima volta
  - `lastPulseTimestamp`: ultimo pulse ricevuto
}

---

## 4. Network Pin Requests (Auto-Replication)

### 4.1 Ricezione Pin Requests
**File**: `index.js`

- **Listener**: `gun.get('shogun-network').get('pin-requests').map().on()`
  - Ascolta pin requests da altri relay
  - Pins automaticamente i CID richiesti
  - Pubblica response in `shogun-network/pin-responses/{responseId}`

**Percorsi GunDB**:
- `shogun-network/pin-requests/{requestId}` = {
  - `cid`: IPFS CID da pinnare
  - `requester`: GunDB pub key del relay richiedente
  - `status`: 'pending'
  - `timestamp`: quando è stata fatta la richiesta
}
- `shogun-network/pin-responses/{responseId}` = {
  - `requestId`: ID della richiesta originale
  - `responder`: GunDB pub key del relay che ha risposto
  - `status`: 'completed' o 'failed'
  - `timestamp`: quando è stata data la risposta
}

### 4.2 Invio Pin Requests
**File**: `routes/deals.js`

- **POST `/api/v1/deals/:dealId/activate`**: Quando un deal viene attivato
  - Pubblica pin request in `shogun-network/pin-requests/{requestId}`
  - Altri relay possono automaticamente pinare il CID

---

## 5. Relay Announcements (Annunci Relay)

### 5.1 Frozen Announcements
**File**: `index.js`

- **Pulse periodico** (ogni ~5 minuti, 10% probabilità):
  - `FrozenData.createFrozenEntry()`: Crea annuncio firmato
  - Contiene: host, port, name, version, uptime, connections, capabilities

**Percorsi GunDB**:
- `relay-announcements/{host}` (frozen entry) = {
  - `type`: 'relay-announcement'
  - `host`: relay hostname
  - `port`: relay port
  - `name`: relay name
  - `version`: relay version
  - `uptime`: process uptime
  - `connections`: active connections
  - `ipfs`: IPFS status
  - `capabilities`: supported features
}

---

## 6. User Uploads (Upload Utenti)

### 6.1 Salvataggio Upload
**File**: `routes/ipfs.js`, `utils/x402-merchant.js`, `utils/relay-user.js`

- **POST `/api/v1/ipfs/upload`**: Quando un utente carica un file (subscription)
  - **Sistema legacy**: Salva in `shogun/uploads/{userAddress}/{hash}` (per compatibilità)
  - **Sistema x402**: Salva in `relayUser.x402.uploads[userAddress][hash]` tramite `X402Merchant.saveUploadRecord()`
  - Aggiorna `shogun/mbUsage/{userAddress}` (legacy)
  - Aggiorna `relayUser.x402.subscriptions[userAddress].storageUsedMB` tramite `X402Merchant.updateStorageUsage()`

- **GET `/api/v1/user-uploads/:identifier`**: Recupera uploads di un utente
  - Legge da `shogun/uploads/{identifier}/` (legacy)
  - Legge da `relayUser.x402.uploads[userAddress]/` (x402)

- **DELETE `/api/v1/user-uploads/:hash`**: Elimina un upload
  - Rimuove da `shogun/uploads/{userAddress}/{hash}` (legacy)
  - Rimuove da `relayUser.x402.uploads[userAddress][hash]` tramite `RelayUser.deleteUpload()`
  - Aggiorna storage usage

**Percorsi GunDB**:
- **Legacy**:
  - `shogun/uploads/{userAddress}/{hash}` = {
    - `hash`: IPFS hash
    - `name`: filename
    - `size`: file size in bytes
    - `sizeMB`: size in MB
    - `uploadedAt`: upload timestamp
    - `userAddress`: user wallet address
  }
  - `shogun/mbUsage/{userAddress}` = {
    - `mbUsed`: total MB used
    - `lastUpdated`: timestamp
    - `updatedBy`: source
  }
- **x402 (Relay User Space)**:
  - `relayUser.x402.uploads[userAddress][hash]` = {
    - `hash`: IPFS hash
    - `name`: filename
    - `size`: file size in bytes
    - `sizeMB`: size in MB
    - `uploadedAt`: upload timestamp
    - `userAddress`: user wallet address
    - `savedAt`: timestamp when saved to GunDB
    - `savedBy`: relay pub key
  }

---

## 7. System Hashes (Hash di Sistema)

### 7.1 Salvataggio System Hashes
**File**: `routes/uploads.js`, `routes/ipfs.js`

- **POST `/api/v1/user-uploads/save-system-hash`**: Salva un hash nel nodo systemhash
  - Usato per tracciare tutti gli hash caricati sul sistema
  - Path: `shogun/systemhash/{hash}`
  - Contiene: hash, userAddress, timestamp, fileName, fileSize, isEncrypted, contentType, relayUrl

- **GET `/api/v1/user-uploads/system-hashes`**: Recupera tutti gli system hashes
  - Legge da `shogun/systemhash/`

- **DELETE `/api/v1/user-uploads/remove-system-hash/:hash`**: Rimuove un hash dal systemhash
  - Rimuove da `shogun/systemhash/{hash}`

**Percorsi GunDB**:
- `shogun/systemhash/{hash}` = {
  - `hash`: IPFS hash
  - `userAddress`: user wallet address
  - `timestamp`: when saved
  - `fileName`: filename
  - `fileSize`: file size
  - `isEncrypted`: encryption flag
  - `contentType`: MIME type
  - `relayUrl`: relay URL
  - `originalName`: original filename
}

---

## 8. System Nodes (Nodi di Sistema)

### 8.1 Creazione Nodi Manuali
**File**: `routes/system.js`

- **POST `/api/v1/system/node/*`**: Crea/aggiorna nodi arbitrari in GunDB
  - Permette di salvare dati custom in qualsiasi path
  - Usa `gun.get(path).put(data)`

---

## 9. Sincronizzazione Bidirezionale

### 8.1 On-Chain ↔ GunDB
- **On-Chain → GunDB**: 
  - Deal sync automatico (`deal-sync.js`)
  - Deal activation salva in GunDB
  
- **GunDB → On-Chain**:
  - Deal creation può essere registrato on-chain
  - Subscription payments sono on-chain (x402), ma stato è in GunDB

### 8.2 IPFS ↔ GunDB
- **IPFS → GunDB**:
  - Upload files salva metadata in GunDB
  - Deal sync verifica pins IPFS
  
- **GunDB → IPFS**:
  - Pin requests da GunDB triggerano pin IPFS
  - Deal activation pinna automaticamente su IPFS

### 8.3 Network ↔ GunDB
- **GunDB → Network**:
  - Pin requests pubblicate in GunDB sono lette da altri relay
  - Reputation scores sono condivisi via GunDB
  
- **Network → GunDB**:
  - Altri relay pubblicano pin requests che questo relay legge
  - Reputation tracking aggrega dati da network

---

## Struttura Dati GunDB

### Namespace Principali

```
gun/
├── shogun/
│   ├── uploads/
│   │   └── {userAddress}/
│   │       └── {hash}/
│   ├── mbUsage/
│   │   └── {userAddress}/
│   ├── systemhash/
│   │   └── {hash}/
│   └── index/
│       ├── deals-by-cid/
│       │   └── {cid}/
│       │       └── {dealId}/
│       └── deals-by-client/
│           └── {clientAddress}/
│               └── {dealId}/
│
├── shogun-network/
│   ├── reputation/
│   │   └── {host}/
│   ├── pin-requests/
│   │   └── {requestId}/
│   └── pin-responses/
│       └── {responseId}/
│
├── storage-deals/
│   └── {dealId}/ (frozen entry)
│
├── relay-announcements/
│   └── {host}/ (frozen entry)
│
├── relays/
│   └── {host}/
│
└── relayUser/ (relay user space, firmato con SEA)
    └── x402/
        ├── subscriptions/
        │   └── {userAddress}/
        └── uploads/
            └── {userAddress}/
                └── {hash}/
```

---

## Persistenza

Tutti i dati GunDB sono persistenti tramite:
- **SQLite** (default): `DATA_DIR/gun.db`
- **RADISK** (legacy): `DATA_DIR/radata/`

I volumi Docker devono montare `/app/relay/data` per preservare i dati tra i deploy.

---

## Note Importanti

1. **Frozen Data**: Deal e announcements usano frozen entries (immutabili, firmati)
2. **Relay User**: Le subscription sono nello spazio del relay user (solo il relay può modificarle)
3. **Network Sync**: Reputation e pin requests sono condivisi via GunDB peers
4. **Indici**: I deal sono indicizzati per CID e client address per lookup veloce
5. **Auto-Replication**: Pin requests triggerano automaticamente pin IPFS su altri relay

