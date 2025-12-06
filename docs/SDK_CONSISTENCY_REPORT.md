# SDK Consistency Report

## Problemi Trovati

### 1. SystemModule.getStats() - Codice Irraggiungibile
**File:** `sdk/src/modules/system.ts`

**Problema:** Ci sono due `return` statements, il primo alla riga 25 non sarà mai raggiunto.

```typescript
public async getStats(): Promise<any> {
  return this.client.get('/stats'); // ❌ Questo return non sarà mai raggiunto
  // Based on routes/index.js: app.get("/stats", ...) serves HTML.
  // app.get(`${baseRoute}/system/stats`) is the API one.
  // Let's use the API one.
  return this.client.get('/api/v1/system/stats'); // ✅ Questo è quello corretto
}
```

**Fix necessario:** Rimuovere la riga 25.

### 2. DealsModule.grief() - Endpoint nel Modulo Sbagliato
**File:** `sdk/src/modules/deals.ts`

**Problema:** Il metodo `grief()` usa l'endpoint `/api/v1/registry/deal/grief` che appartiene al RegistryModule, non al DealsModule.

**Verifica:** Nel relay, l'endpoint è in `routes/registry.js` come `POST /api/v1/registry/deal/grief`.

**Raccomandazione:** Spostare `grief()` nel RegistryModule per coerenza, oppure mantenere se c'è una logica specifica per i deals.

### 3. Verifica Endpoint System

**SDK:**
- `getHealth()` → `/api/v1/health` ✅
- `getStats()` → `/api/v1/system/stats` ✅ (dopo fix)

**Relay:**
- `/api/v1/health` ✅ (routes/index.js:708)
- `/api/v1/system/stats` ✅ (routes/system.js:64)

**Status:** ✅ Corretto (dopo fix)

### 4. Verifica Endpoint IPFS

**SDK:**
- `getStatus()` → `/api/v1/ipfs/status` ✅
- `uploadFile()` → `/api/v1/ipfs/upload` ✅
- `cat()` → `/api/v1/ipfs/cat/${cid}` ✅
- `pinAdd()` → `/api/v1/ipfs/pin/add?arg=${cid}` ✅
- `pinRm()` → `/api/v1/ipfs/pin/rm?arg=${cid}` ✅
- `pinLs()` → `/api/v1/ipfs/pin/ls${query}` ✅

**Relay:**
- `/api/v1/ipfs/status` ✅ (routes/ipfs.js:614)
- `/api/v1/ipfs/upload` ✅ (routes/ipfs.js:248)
- `/api/v1/ipfs/cat/:cid` ✅ (routes/ipfs.js:683)
- `/api/v1/ipfs/pin/add` ✅ (routes/ipfs.js:942) - Nota: relay accetta POST con body `{cid}`, SDK usa query param
- `/api/v1/ipfs/pin/rm` ✅ (routes/ipfs.js:1027) - Nota: relay accetta POST con body `{cid}`, SDK usa query param
- `/api/v1/ipfs/pin/ls` ✅ (routes/ipfs.js:1253)

**Problema Potenziale:** 
- `pinAdd()` e `pinRm()` usano query params (`?arg=${cid}`) ma il relay si aspetta un body JSON `{cid}`. Questo potrebbe non funzionare correttamente.

**Status:** ⚠️ Richiede fix per pinAdd/pinRm

### 5. Verifica Endpoint X402

**SDK:**
- `getTiers()` → `/api/v1/x402/tiers` ✅
- `getSubscription()` → `/api/v1/x402/subscription/${userAddress}` ✅
- `subscribe()` → `/api/v1/x402/subscribe` ✅
- `getPaymentRequirements()` → `/api/v1/x402/payment-requirements/${tier}` ✅
- `canUpload()` → `/api/v1/x402/can-upload/${userAddress}?size=${sizeMB}` ✅
- `getStorageUsage()` → `/api/v1/x402/storage/${userAddress}` ✅

**Relay:**
- Tutti gli endpoint corrispondono ✅

**Status:** ✅ Corretto

### 6. Verifica Endpoint Network

**SDK:**
- `getRelays()` → `/api/v1/network/relays` ✅
- `getRelay()` → `/api/v1/network/relay/${host}` ✅
- `getStats()` → `/api/v1/network/stats` ✅
- `getProof()` → `/api/v1/network/proof/${cid}` ✅
- `verifyProof()` → `/api/v1/network/verify-proof` ✅
- `getReputation()` → `/api/v1/network/reputation/${host}` ✅
- `getReputationLeaderboard()` → `/api/v1/network/reputation` ✅

**Relay:**
- Tutti gli endpoint corrispondono ✅

**Status:** ✅ Corretto

### 7. Verifica Endpoint Deals

**SDK:**
- `getPricing()` → `/api/v1/deals/pricing` ✅
- `uploadForDeal()` → `/api/v1/deals/upload` ✅
- `createDeal()` → `/api/v1/deals/create` ✅
- `activateDeal()` → `/api/v1/deals/${dealId}/activate` ✅
- `getDealsByCid()` → `/api/v1/deals/by-cid/${cid}` ✅
- `getDealsByClient()` → `/api/v1/deals/by-client/${address}` ✅
- `grief()` → `/api/v1/registry/deal/grief` ⚠️ (vedi punto 2)

**Relay:**
- Tutti gli endpoint corrispondono ✅ (tranne grief che è in registry)

**Status:** ⚠️ grief() endpoint inconsistente

### 8. Verifica Endpoint Registry

**SDK:**
- `getStatus()` → `/api/v1/registry/status` ✅
- `getBalance()` → `/api/v1/registry/balance` ✅
- `registerRelay()` → `/api/v1/registry/register` ✅
- `updateRelay()` → `/api/v1/registry/update` ✅
- `increaseStake()` → `/api/v1/registry/stake/increase` ✅
- `requestUnstake()` → `/api/v1/registry/stake/unstake` ✅
- `withdrawStake()` → `/api/v1/registry/stake/withdraw` ✅
- `getDeals()` → `/api/v1/registry/deals` ✅
- `griefMissedProof()` → `/api/v1/registry/grief/missed-proof` ✅
- `griefDataLoss()` → `/api/v1/registry/grief/data-loss` ✅

**Relay:**
- Tutti gli endpoint corrispondono ✅

**Nota:** `grief()` per deals è in RegistryModule nel relay ma in DealsModule nell'SDK.

**Status:** ✅ Corretto (ma vedi punto 2)

### 9. Verifica Endpoint Uploads

**SDK:**
- `getUserUploads()` → `/api/v1/user-uploads/${identifier}` ✅
- `deleteUpload()` → `/api/v1/user-uploads/${identifier}/${hash}` ✅
- `getSystemHashes()` → `/api/v1/user-uploads/system-hashes` ✅

**Relay:**
- Tutti gli endpoint corrispondono ✅

**Status:** ✅ Corretto

## Riepilogo

### Problemi Critici
1. ❌ **SystemModule.getStats()** - Codice irraggiungibile (riga 25)
2. ⚠️ **IPFS pinAdd/pinRm** - Formato richiesta non corrisponde (query param vs body JSON)
3. ⚠️ **DealsModule.grief()** - Endpoint nel modulo sbagliato

### Problemi Minori
- Nessuno

### Endpoint Mancanti nell'SDK
L'SDK non copre tutti gli endpoint disponibili nel relay. Alcuni endpoint utili mancanti:
- `/api/v1/x402/can-upload-verified/:userAddress`
- `/api/v1/x402/storage/sync/:userAddress`
- `/api/v1/x402/recommend`
- `/api/v1/deals/:dealId/verify`
- `/api/v1/deals/:dealId/renew`
- `/api/v1/deals/:dealId/cancel`
- `/api/v1/deals/:dealId/terminate`
- `/api/v1/deals/relay/active`
- `/api/v1/network/best-relays`
- `/api/v1/network/verified/*` (vari endpoint)
- `/api/v1/network/onchain/*` (vari endpoint)

## Raccomandazioni

1. **Fix immediato:** Rimuovere codice irraggiungibile in SystemModule.getStats()
2. **Fix pinAdd/pinRm:** Cambiare da query params a body JSON per corrispondere al relay
3. **Riorganizzazione:** Spostare `grief()` da DealsModule a RegistryModule o creare un metodo wrapper
4. **Estensione SDK:** Considerare di aggiungere gli endpoint mancanti per completezza

