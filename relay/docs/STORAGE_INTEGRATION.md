# Storage System Integration

## Architettura Finale

Il sistema di storage mantiene **due dashboard separate** con suggerimenti intelligenti integrati:

- **`/subscription`** - Dashboard subscriptions (subscription.html)
- **`/deals`** - Dashboard deals (deals-dashboard.html)

## Auto-Suggest Integration

### Come Funziona

Entrambe le dashboard ora includono un sistema di **suggerimenti intelligenti** che:

1. **Nella subscription dashboard:**
   - Quando l'utente seleziona un file >100MB
   - Mostra un banner che suggerisce di usare Storage Deals
   - Link diretto a `/deals`

2. **Nella deals dashboard:**
   - Quando l'utente carica un file <100MB
   - Mostra un banner che suggerisce di usare Subscriptions
   - Link diretto a `/subscription`

### API Endpoint

**GET `/api/v1/x402/recommend`**

Parametri:
- `fileSizeMB` (required) - Dimensione file in MB
- `durationDays` (required) - Durata desiderata in giorni
- `userAddress` (optional) - Indirizzo utente per verificare subscription attiva

Response:
```json
{
  "success": true,
  "recommendation": {
    "recommended": "subscription" | "deal",
    "reasons": ["reason1", "reason2", ...],
    "alternatives": [...],
    "comparison": {
      "subscription": { "totalCostUSDC": 0.001, ... },
      "deal": { "totalCostUSDC": 0.0005, ... }
    }
  },
  "input": {
    "fileSizeMB": 150,
    "durationDays": 30,
    "userAddress": "0x..."
  }
}
```

### Logica di Raccomandazione

Il sistema suggerisce **Deals** quando:
- File >500MB (very large)
- File >100MB (large)
- Durata >365 giorni (long-term)
- Combinazione di file medio-grandi con durata media-lunga

Il sistema suggerisce **Subscriptions** quando:
- File <100MB (small/medium)
- Durata ≤30 giorni (short-term)
- L'utente ha già una subscription attiva con spazio disponibile

## Moduli Condivisi

I moduli nella directory `lib/` possono essere utilizzati da entrambe le dashboard:

- `storage-common.js` - Funzioni condivise (wallet, network, utilities)
- `storage-auto-suggest.js` - Sistema suggerimenti (può essere importato se necessario)

**Nota:** Attualmente l'auto-suggest è integrato direttamente nelle dashboard HTML, ma i moduli sono disponibili per uso futuro.

## Vantaggi di Mantenere Dashboard Separate

1. **Semplicità** - Ogni dashboard è focalizzata su un caso d'uso specifico
2. **Performance** - Caricamento più veloce, solo il codice necessario
3. **Manutenibilità** - Più facile mantenere e aggiornare separatamente
4. **Chiarezza UX** - L'utente sa sempre dove si trova

## Suggerimenti Intelligenti

I banner di suggerimento appaiono automaticamente quando:
- La dimensione del file suggerisce l'altra modalità
- La durata suggerisce l'altra modalità
- Il costo sarebbe migliore con l'altra modalità

L'utente può:
- Chiudere il banner se non interessato
- Cliccare il link per andare all'altra dashboard
- Continuare con la modalità corrente

## Documentazione Completa

Vedi `STORAGE_COMPARISON.md` per la guida completa su quando usare subscriptions vs deals.

