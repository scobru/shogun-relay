# Shogun Relay API Route Tester

Script completo per testare tutte le route dell'API del Shogun Relay.

## Utilizzo

### Base

```bash
node scripts/test-all-routes.js
```

### Con parametri

```bash
node scripts/test-all-routes.js <baseUrl> [adminToken] [testWallet]
```

### Esempi

```bash
# Test locale (default)
node scripts/test-all-routes.js

# Test con URL custom
node scripts/test-all-routes.js http://localhost:8765

# Test con admin token
node scripts/test-all-routes.js http://localhost:8765 myAdminToken

# Test completo
node scripts/test-all-routes.js http://localhost:8765 myAdminToken 0x1234...abcd
```

### Con variabili d'ambiente

```bash
export RELAY_URL=http://localhost:8765
export ADMIN_TOKEN=myAdminToken
export TEST_WALLET=0x1234...abcd
node scripts/test-all-routes.js
```

## Endpoint testati

### 1. Health & System
- `GET /health` - Health check semplice
- `GET /api/v1/system/health` - Health check dettagliato
- `GET /api/v1/system/relay-info` - Info relay
- `GET /api/v1/system/stats` - Statistiche sistema
- `GET /api/v1/system/peers` - Lista peer GunDB
- `GET /api/v1/services/status` - Status servizi

### 2. IPFS
- `GET /api/v1/ipfs/status` - Status nodo IPFS
- `GET /api/v1/ipfs/version` - Versione IPFS
- `GET /api/v1/ipfs/repo/stat` - Statistiche repo (admin)
- `GET /ipfs/:cid` - Gateway IPFS

### 3. X402 Subscriptions
- `GET /api/v1/x402/tiers` - Lista tier disponibili
- `GET /api/v1/x402/subscription/:address` - Status subscription
- `GET /api/v1/x402/payment-requirements/:tier` - Requisiti pagamento
- `GET /api/v1/x402/can-upload/:address` - Check upload permission
- `GET /api/v1/x402/storage/:address` - Info storage utente
- `GET /api/v1/x402/config` - Configurazione x402
- `GET /api/v1/x402/relay-storage` - Storage globale relay

### 4. Storage Deals
- `GET /api/v1/deals/pricing` - Pricing tiers
- `GET /api/v1/deals/by-client/:address` - Deal per cliente
- `GET /api/v1/ipfs/stat/:cid` - Statistiche CID

### 5. Network & Federation
- `GET /api/v1/network/relays` - Discovery relay
- `GET /api/v1/network/stats` - Statistiche network
- `GET /api/v1/network/reputation` - Leaderboard reputation
- `GET /api/v1/network/best-relays` - Migliori relay
- `GET /api/v1/network/verified/relays` - Relay verificati
- `GET /api/v1/network/proof/:cid` - Storage proof

### 6. On-Chain Registry
- `GET /api/v1/network/onchain/relays` - Relay on-chain
- `GET /api/v1/network/onchain/params` - Parametri registry
- `GET /api/v1/network/onchain/relay/:address` - Info relay on-chain
- `GET /api/v1/network/onchain/deals/client/:address` - Deal cliente on-chain

### 7. Registry Management (Admin)
- `GET /api/v1/registry/status` - Status registrazione
- `GET /api/v1/registry/balance` - Balance USDC
- `GET /api/v1/registry/params` - Parametri
- `GET /api/v1/registry/config` - Configurazione
- `GET /api/v1/registry/deals` - Deal del relay

### 8. User Uploads
- `GET /api/v1/user-uploads/system-hashes` - Hash sistema
- `GET /api/v1/user-uploads/:identifier` - Upload utente

### 9. Holster Relay
- `GET /holster-status` - Status Holster

### 10. Debug (Admin)
- `GET /api/v1/debug/mb-usage/:address` - Uso storage
- `GET /api/v1/debug/user-uploads/:identifier` - Upload dettagliati

## Output

Lo script fornisce un output colorato con:

- ✅ **Passed** (verde) - Test passato
- ❌ **Failed** (rosso) - Test fallito
- ⊘ **Skipped** (giallo) - Test saltato (es. auth richiesta)

### Esempio Output

```
🚀 Starting Shogun Relay API Route Tests
Base URL: http://localhost:8765
Admin Token: ***configured***
Test Wallet: 0x0000000000000000000000000000000000000000

============================================================
1. Health & System Endpoints
============================================================
✓ GET /health
  Status: 200
✓ GET /api/v1/system/health
  Status: 200
...

============================================================
Test Summary
============================================================
Total Tests: 45
Passed: 42
Failed: 0
Skipped: 3

✅ All tests passed!
```

## Note

1. **Admin Token**: Alcuni endpoint richiedono autenticazione admin. Fornisci `ADMIN_TOKEN` per testarli.

2. **404 Expected**: Alcuni endpoint possono restituire 404 se i dati non esistono (es. deal non trovati). Questo è normale e viene contato come "skipped".

3. **Timeout**: Ogni richiesta ha un timeout di 30 secondi.

4. **Test Wallet**: Usa un wallet address valido per testare endpoint specifici dell'utente.

5. **File Upload**: Il test per file upload non è incluso (richiede multipart/form-data). Test manuale consigliato.

## Troubleshooting

### Connection refused
- Verifica che il relay sia in esecuzione
- Controlla che l'URL base sia corretto
- Verifica firewall/porte

### 401 Unauthorized
- Alcuni endpoint richiedono admin token
- Fornisci `ADMIN_TOKEN` come parametro o variabile d'ambiente

### Timeout
- Il relay potrebbe essere lento o sovraccaricato
- Aumenta il timeout nello script se necessario

## Estensioni

Per test aggiuntivi:

1. **File Upload Test**: Aggiungi test con `FormData` per `/api/v1/ipfs/upload`
2. **Deal Creation**: Test completo per creazione e attivazione deal
3. **Payment Flow**: Test del flusso di pagamento x402
4. **On-Chain Operations**: Test per registrazione relay on-chain

## Contribuire

Aggiungi nuovi test nell'array `testSuite` o crea nuove sezioni seguendo lo stesso pattern.

