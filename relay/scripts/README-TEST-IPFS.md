# IPFS Endpoints Test Script

Script dedicato per testare tutti gli endpoint IPFS del Shogun Relay. IPFS è critico per il progetto, quindi tutti gli endpoint devono funzionare correttamente.

## Utilizzo

### Test su server remoto (default)
```bash
yarn test:ipfs
```

### Test su server locale
```bash
yarn test:ipfs:local
```

### Uso manuale
```bash
node scripts/test-ipfs-routes.js [base-url] [admin-token] [test-wallet]
```

### Con variabili d'ambiente
```bash
TEST_BASE_URL=https://shogun-relay.scobrudot.dev \
ADMIN_TOKEN=shogun2025 \
TEST_WALLET=0xA6591dCDff5C7616110b4f84207184aef7835048 \
node scripts/test-ipfs-routes.js
```

## Parametri

- `base-url` (opzionale): URL base del relay (default: `https://shogun-relay.scobrudot.dev`)
- `admin-token` (opzionale): Token di autenticazione admin (default: `shogun2025`)
- `test-wallet` (opzionale): Indirizzo wallet per i test (default: `0xA6591dCDff5C7616110b4f84207184aef7835048`)

## Endpoint testati

### 1. Basic IPFS Status & Info
- `GET /api/v1/ipfs/status` - Stato del nodo IPFS
- `GET /api/v1/ipfs/version` - Versione IPFS
- `GET /api/v1/ipfs/repo/stat` - Statistiche repository IPFS

### 2. File Upload & Storage
- `POST /api/v1/ipfs/upload` - Carica file su IPFS

### 3. CID Verification & Statistics
- `GET /api/v1/ipfs/stat/:cid` - Statistiche di un CID
- `GET /ipfs/:cid` - Gateway IPFS (proxy)

### 4. Content Retrieval (CAT)
- `GET /api/v1/ipfs/cat/:cid` - Recupera contenuto di un CID
- `GET /api/v1/ipfs/cat/:cid/json` - Recupera contenuto come JSON
- `GET /api/v1/ipfs/cat/:cid/decrypt` - Recupera e decripta contenuto

### 5. Pin Management
- `GET /api/v1/ipfs/pin/ls` - Lista pin
- `POST /api/v1/ipfs/pin/add` - Aggiungi pin
- `POST /api/v1/ipfs/pin/rm` - Rimuovi pin

### 6. Repository Management
- `GET /api/v1/ipfs/repo/stat` - Statistiche repository
- `POST /api/v1/ipfs/repo/gc` - Garbage collection

### 7. User Uploads
- `GET /api/v1/ipfs/user-uploads/:userAddress` - Upload di un utente
- `DELETE /api/v1/ipfs/user-uploads/:userAddress/:hash` - Elimina upload

### 8. Test Endpoint
- `GET /api/v1/ipfs/test` - Endpoint di test

## Output

Lo script fornisce:
- ✓ Test passati (verde)
- ✗ Test falliti (rosso)
- ⊘ Test saltati (giallo) - generalmente perché richiedono autenticazione o dati non disponibili

Alla fine mostra un riepilogo con il conteggio dei test passati, falliti e saltati.

## Note

- Il test carica automaticamente un file di test su IPFS per testare gli endpoint che richiedono un CID
- Alcuni endpoint possono restituire 404 o 503 se IPFS non è disponibile o configurato - questo è normale in alcuni ambienti
- Gli endpoint che richiedono autenticazione admin sono segnati come `auth: true`

