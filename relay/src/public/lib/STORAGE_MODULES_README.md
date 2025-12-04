# Storage Modules - Architecture

## Overview

Il sistema di storage è stato modularizzato per unificare subscriptions e deals in una singola interfaccia con suggerimenti intelligenti.

## Struttura Moduli

### 1. `storage-common.js` ✅
**Funzioni condivise:**
- Network configurations (Base, Polygon, etc.)
- Wallet connection manager
- Message system
- Utility functions (formatDate, formatFileSize, etc.)
- Global state management

**Export:**
- `NETWORK_CONFIG` - Configurazioni blockchain
- `USDC_ABI` - ABI USDC
- `StorageState` - Stato globale condiviso
- `Utils` - Funzioni utility
- `WalletManager` - Gestione wallet
- `X402Config` - Configurazione x402
- `walletManager` - Istanza singleton
- `messageSystem` - Sistema messaggi

### 2. `storage-auto-suggest.js` ✅
**Suggerimenti intelligenti:**
- Analizza file size e durata
- Suggerisce subscription vs deal
- Mostra confronto costi
- Banner UI per raccomandazioni

**Export:**
- `AutoSuggest` - Classe principale
- `autoSuggest` - Istanza singleton

**API utilizzata:**
- `GET /api/v1/x402/recommend?fileSizeMB=X&durationDays=Y&userAddress=Z`

### 3. `storage-subscriptions.js` (DA CREARE)
**Logica subscriptions:**
- Gestione tier selection
- Purchase flow
- Upload con subscription
- File management

**Dipendenza da:**
- `storage-common.js`
- `storage-auto-suggest.js`

### 4. `storage-deals.js` (DA CREARE)
**Logica deals:**
- Deal creation flow
- Payment activation
- Deal management
- Erasure coding calculator

**Dipendenza da:**
- `storage-common.js`
- `storage-auto-suggest.js`

### 5. `storage.html` (DA CREARE)
**Container principale:**
- Toggle tra subscriptions/deals
- Header unificato
- Loading dei moduli
- Coordinamento tra moduli

## Flusso di Utilizzo

1. Utente apre `/storage`
2. `storage.html` carica i moduli JavaScript
3. Utente connette wallet (via `storage-common.js`)
4. Utente sceglie modalità (subscriptions o deals)
5. Seleziona file → auto-suggest attivato
6. Sistema suggerisce la modalità migliore
7. Utente procede con la scelta suggerita o alternativa

## API Endpoints Utilizzati

### Subscriptions
- `GET /api/v1/x402/tiers` - Lista tier
- `GET /api/v1/x402/subscription/:address` - Status subscription
- `POST /api/v1/x402/subscribe` - Purchase subscription
- `GET /api/v1/x402/payment-requirements/:tier` - Payment requirements

### Deals
- `GET /api/v1/deals/pricing` - Pricing deals
- `POST /api/v1/deals/create` - Crea deal
- `POST /api/v1/deals/:dealId/activate` - Attiva deal
- `GET /api/v1/deals/by-client/:address` - Lista deals utente

### Auto-Suggest
- `GET /api/v1/x402/recommend` - Raccomandazione intelligente ✅

## Prossimi Passi

1. ✅ Creare storage-common.js
2. ✅ Creare storage-auto-suggest.js
3. ⏳ Creare storage-subscriptions.js
4. ⏳ Creare storage-deals.js
5. ⏳ Creare storage.html container
6. ⏳ Testare integrazione completa

## Note

- I moduli sono ES6 modules (import/export)
- Stato condiviso tramite `StorageState`
- Wallet manager centralizzato per evitare duplicazioni
- Auto-suggest può essere utilizzato da entrambe le modalità

