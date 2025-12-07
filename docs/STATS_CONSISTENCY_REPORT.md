# Report Consistenza Statistiche - Relay

**Data analisi:** 2025-01-27

## Problemi Trovati

### 1. ⚠️ Duplicazione: `mbUsage` e `storageUsedMB`

**Problema:** Esistono due sistemi paralleli per tracciare l'uso dello storage:

1. **`mbUsage`** (legacy) - in `shogun.mbUsage.{userAddress}`
   - Aggiornato in: `routes/ipfs.js` (upload), `routes/uploads.js` (delete)
   - Usato per: tracking generale uploads

2. **`storageUsedMB`** (x402) - in subscription data via `RelayUser.updateSubscriptionField()`
   - Aggiornato in: `utils/x402-merchant.js`, `routes/ipfs.js` (delete)
   - Usato per: tracking storage per subscription x402

**Impatto:** I due sistemi possono divergere e creare confusione.

**Raccomandazione:** 
- Unificare in un unico sistema
- Se `mbUsage` è legacy, deprecarlo gradualmente
- Se serve per compatibilità, sincronizzarli

### 2. ❌ Inconsistenza: Aggiornamento `storageUsedMB` in `routes/ipfs.js`

**File:** `routes/ipfs.js` (linea 2575-2589)

**Problema:** Quando si elimina un file, `storageUsedMB` viene aggiornato direttamente invece di usare `X402Merchant.updateStorageUsage()`:

```javascript
// ❌ Aggiornamento diretto (inconsistente)
const currentSub = await X402Merchant.getSubscriptionStatus(gun, userAddress);
const newUsage = Math.max(0, (currentSub.storageUsedMB || 0) - fileSizeMB);
await RelayUser.updateSubscriptionField(userAddress, 'storageUsedMB', newUsage);
```

**Dovrebbe essere:**
```javascript
// ✅ Usare il metodo centralizzato
await X402Merchant.updateStorageUsage(gun, userAddress, -fileSizeMB);
```

**Impatto:** 
- Logica duplicata
- Possibili inconsistenze se la logica cambia
- Difficile mantenere

**Fix necessario:** Usare `X402Merchant.updateStorageUsage()` anche per le eliminazioni.

### 3. ⚠️ `mbUsage` aggiornato in più posti senza centralizzazione

**Problema:** `mbUsage` viene aggiornato direttamente in:
- `routes/ipfs.js` (linea 408-428) - upload
- `routes/uploads.js` (linea 119-134, 609-637) - delete

**Impatto:** Nessuna validazione centralizzata, logica duplicata.

**Raccomandazione:** Creare una funzione helper centralizzata per aggiornare `mbUsage`.

### 4. ✅ Deal Stats - Corretto

**File:** `utils/storage-deals.js` (linea 426-459)

**Status:** ✅ Le statistiche dei deals sono calcolate centralmente con `getDealStats()` e usate correttamente in `routes/deals.js`.

### 5. ✅ Network Stats - Corretto

**File:** `index.js` (linea 1396-1418), `routes/network.js` (linea 135-233)

**Status:** ✅ Le statistiche di rete sono aggiornate correttamente:
- Pulse salvato in GunDB (`relays.{host}.pulse`)
- Aggregazione fatta in `routes/network.js`
- Reputation tracking in `utils/relay-reputation.js`

### 6. ✅ System Stats - Corretto

**File:** `index.js` (linea 1420-1421), `routes/system.js` (linea 135-165)

**Status:** ✅ Le statistiche di sistema sono aggiornate correttamente:
- `addTimeSeriesPoint()` centralizzato
- Endpoint `/api/v1/system/stats/update` per aggiornamenti esterni

## Analisi Dettagliata per Tipo di Statistica

### Storage Usage (mbUsage)

**Dove viene aggiornato:**
1. ✅ `routes/ipfs.js:408-428` - Upload file (aggiorna `mbUsage`)
2. ✅ `routes/uploads.js:119-134` - Delete upload (aggiorna `mbUsage`)
3. ✅ `routes/uploads.js:609-637` - Delete upload (aggiorna `mbUsage`)

**Problema:** Aggiornamento diretto senza funzione helper centralizzata.

**Raccomandazione:** Creare `updateMBUsage(userAddress, deltaMB)` in un modulo utils.

### Storage Usage (storageUsedMB - x402)

**Dove viene aggiornato:**
1. ✅ `utils/x402-merchant.js:657` - `updateStorageUsage()` (metodo centralizzato)
2. ✅ `routes/ipfs.js:508` - Upload con subscription (usa `updateStorageUsage()`)
3. ❌ `routes/ipfs.js:2581-2584` - Delete file (aggiornamento diretto - INCONSISTENTE)
4. ✅ `routes/x402.js:452` - Endpoint `/update-usage` (usa `updateStorageUsage()`)

**Problema:** Un punto di aggiornamento non usa il metodo centralizzato.

**Fix necessario:** Modificare `routes/ipfs.js:2575-2589` per usare `X402Merchant.updateStorageUsage()`.

### Deal Statistics

**Dove viene calcolato:**
1. ✅ `utils/storage-deals.js:426-459` - `getDealStats()` (funzione centralizzata)
2. ✅ `routes/deals.js:1051` - `/by-client` (usa `getDealStats()`)
3. ✅ `routes/deals.js:1096` - `/relay/active` (usa `getDealStats()`)
4. ✅ `routes/deals.js:1143` - `/stats` (usa `getDealStats()`)
5. ✅ `routes/deals.js:1218` - `/leaderboard` (usa `getDealStats()`)

**Status:** ✅ Tutto corretto - calcolo centralizzato e usato consistentemente.

### Network Statistics

**Dove viene aggiornato:**
1. ✅ `index.js:1396-1418` - Pulse salvato in GunDB
2. ✅ `index.js:1420-1421` - Time series points
3. ✅ `index.js:1424-1432` - Reputation tracking
4. ✅ `routes/network.js:135-233` - Aggregazione network stats

**Status:** ✅ Tutto corretto - aggiornamento centralizzato nel pulse.

### System Statistics

**Dove viene aggiornato:**
1. ✅ `index.js:113-161` - `addTimeSeriesPoint()` (funzione centralizzata)
2. ✅ `index.js:1420-1421` - Aggiornamento automatico (connections, memory)
3. ✅ `routes/system.js:135-165` - Endpoint `/stats/update` (usa `addTimeSeriesPoint()`)

**Status:** ✅ Tutto corretto - aggiornamento centralizzato.

## Riepilogo Problemi

### Critici
1. ❌ **`routes/ipfs.js:2575-2589`** - Aggiornamento diretto di `storageUsedMB` invece di usare `X402Merchant.updateStorageUsage()`

### Importanti
1. ⚠️ **Duplicazione `mbUsage` e `storageUsedMB`** - Due sistemi paralleli che possono divergere
2. ⚠️ **`mbUsage` aggiornato direttamente** - Nessuna funzione helper centralizzata

### Minori
- Nessuno

## Raccomandazioni

### Priorità Alta
1. **Fix immediato:** Modificare `routes/ipfs.js:2575-2589` per usare `X402Merchant.updateStorageUsage(gun, userAddress, -fileSizeMB)` invece di aggiornamento diretto
2. **Centralizzare `mbUsage`:** Creare funzione helper `updateMBUsage(userAddress, deltaMB)` in `utils/storage-utils.js` o simile

### Priorità Media
1. **Unificare sistemi:** Decidere se mantenere `mbUsage` (legacy) o migrare tutto a `storageUsedMB`
2. **Documentazione:** Documentare quale sistema usare per cosa

### Priorità Bassa
1. **Deprecazione:** Se `mbUsage` è legacy, pianificare deprecazione graduale

## Fix Proposti

### Fix 1: Usare metodo centralizzato per delete

**File:** `routes/ipfs.js`

**Linea:** ~2575-2589

**Cambio:**
```javascript
// PRIMA (❌)
const currentSub = await X402Merchant.getSubscriptionStatus(gun, userAddress);
const newUsage = Math.max(0, (currentSub.storageUsedMB || 0) - fileSizeMB);
await RelayUser.updateSubscriptionField(userAddress, 'storageUsedMB', newUsage);

// DOPO (✅)
try {
  await X402Merchant.updateStorageUsage(gun, userAddress, -fileSizeMB);
  console.log(`✅ Storage updated via X402Merchant`);
} catch (updateError) {
  console.warn(`⚠️ Failed to update storage:`, updateError.message);
}
```

### Fix 2: Creare helper per mbUsage

**File:** `utils/storage-utils.js` (nuovo file)

```javascript
/**
 * Update MB usage for a user (legacy system)
 * @param {object} gun - GunDB instance
 * @param {string} userAddress - User address
 * @param {number} deltaMB - Change in MB (positive for add, negative for subtract)
 * @returns {Promise<number>} - New MB usage
 */
export async function updateMBUsage(gun, userAddress, deltaMB) {
  return new Promise((resolve, reject) => {
    const mbUsageNode = gun.get("shogun").get("mbUsage").get(userAddress);
    mbUsageNode.once((currentData) => {
      const currentMB = currentData ? (currentData.mbUsed || 0) : 0;
      const newMB = Math.max(0, currentMB + deltaMB);
      
      mbUsageNode.put({
        mbUsed: newMB,
        lastUpdated: Date.now(),
        userAddress: userAddress,
        updatedBy: "storage-utils"
      }, (ack) => {
        if (ack && ack.err) {
          reject(new Error(ack.err));
        } else {
          resolve(newMB);
        }
      });
    });
  });
}
```

Poi usare questa funzione in `routes/ipfs.js` e `routes/uploads.js` invece di aggiornare direttamente.

## Conclusione

**Stato Generale:** ⚠️ **Buono con alcune inconsistenze**

La maggior parte delle statistiche sono aggiornate correttamente nei moduli giusti. Tuttavia, ci sono due problemi principali:

1. **Inconsistenza nell'aggiornamento di `storageUsedMB`** - Un punto non usa il metodo centralizzato
2. **Duplicazione tra `mbUsage` e `storageUsedMB`** - Due sistemi paralleli che possono divergere

**Prossimi Passi:**
1. Fix immediato: Usare `X402Merchant.updateStorageUsage()` in `routes/ipfs.js` per delete
2. Centralizzare aggiornamento `mbUsage` con funzione helper
3. Valutare unificazione dei due sistemi di tracking storage
