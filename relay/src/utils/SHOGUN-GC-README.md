# Shogun-GC: Garbage Collector per Relay Server

## Panoramica

Shogun-GC è un modulo di garbage collection personalizzato per il relay server Shogun, basato su LES.js ma ottimizzato per le specifiche esigenze del sistema Shogun.

## Caratteristiche

- **Gestione intelligente della memoria**: Monitora l'utilizzo della memoria e attiva la pulizia quando necessario
- **Protezione dei namespace critici**: Protegge automaticamente i namespace importanti come `shogun`, `relays`, `pulse`, `logs`
- **Tracciamento degli accessi**: Monitora i pattern di accesso ai nodi per decisioni di pulizia più intelligenti
- **Configurazione flessibile**: Parametri configurabili tramite variabili d'ambiente
- **Dashboard di monitoraggio**: Interfaccia web per monitorare e controllare il GC
- **API endpoints**: Endpoint REST per controllo e monitoraggio

## Configurazione

### Variabili d'Ambiente

```bash
# Abilita/disabilita il garbage collector
GC_ENABLE=true

# Intervallo tra le esecuzioni del GC (millisecondi)
GC_DELAY=30000

# Soglia di utilizzo memoria per attivare il GC (0.0-1.0)
GC_THRESHOLD=0.8

# Abilita logging delle informazioni
GC_INFO_ENABLE=true

# Intervallo tra i log informativi (millisecondi)
GC_INFO_INTERVAL=60000

# Numero massimo di nodi da tracciare
GC_MAX_NODES=10000

# Namespace protetti (separati da virgola)
GC_PROTECTED_NAMESPACES=shogun,relays,pulse,logs
```

### Configurazione Gun

Il modulo si integra automaticamente con Gun tramite le opzioni:

```javascript
const gunConfig = {
  // ... altre opzioni
  gc_enable: true,
  gc_delay: 30000,
  gc_threshold: 0.8,
  gc_info_enable: true,
  gc_info_interval: 60000,
  gc_max_nodes: 10000,
  gc_namespace_protection: ['shogun', 'relays', 'pulse', 'logs']
};
```

## API Endpoints

### GET /gc-status
Restituisce le statistiche del garbage collector.

**Risposta:**
```json
{
  "success": true,
  "status": "enabled",
  "stats": {
    "totalRuns": 150,
    "totalFreed": 1250,
    "trackedNodes": 500,
    "config": {
      "gc_enable": true,
      "gc_delay": 30000,
      "gc_threshold": 0.8
    }
  }
}
```

### POST /gc-trigger
Attiva manualmente il garbage collector (richiede autenticazione admin).

**Headers:**
```
Authorization: Bearer <admin-token>
```

**Risposta:**
```json
{
  "success": true,
  "message": "Manual garbage collection triggered",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## Dashboard Web

Accesso tramite: `http://your-relay:port/gc-dashboard`

**Funzionalità:**
- Monitoraggio in tempo reale delle statistiche
- Trigger manuale del GC
- Visualizzazione dei log di attività
- Configurazione dei parametri (richiede riavvio)

## Algoritmo di Importanza

Il modulo utilizza un algoritmo personalizzato per calcolare l'importanza di un nodo:

```javascript
function calculateNodeImportance(nodeInfo, currentTime, memoryRatio) {
  var timeSinceAccess = (currentTime - nodeInfo.timestamp) * 0.001;
  var accessWeight = Math.log(nodeInfo.accessCount + 1);
  var namespaceWeight = gcConfig.gc_namespace_protection.includes(nodeInfo.namespace) ? 1000 : 1;
  
  var importance = (timeSinceAccess * 0.1) * (memoryRatio * memoryRatio) / (accessWeight * namespaceWeight);
  return importance;
}
```

**Fattori considerati:**
- Tempo dall'ultimo accesso
- Frequenza di accesso
- Namespace di appartenenza
- Pressione della memoria

## Monitoraggio

### Log Console

Il modulo produce log dettagliati:

```
🧹 Shogun-GC: Freed 25 nodes (45.2KB) in 15ms | Memory ratio: 85.3% | Tracked: 500
```

### Integrazione Health Check

Le informazioni del GC sono incluse nell'endpoint `/health`:

```json
{
  "success": true,
  "status": "healthy",
  "garbageCollection": {
    "enabled": true,
    "trackedNodes": 500,
    "totalRuns": 150,
    "totalFreed": 1250,
    "lastRun": 1704067200000,
    "avgRunTime": 12.5
  }
}
```

## Best Practices

1. **Monitora le statistiche**: Usa il dashboard per monitorare l'efficacia del GC
2. **Configura i namespace protetti**: Assicurati che i dati critici siano protetti
3. **Aggiusta la soglia**: Modifica `GC_THRESHOLD` in base alle tue esigenze
4. **Monitora la memoria**: Controlla l'utilizzo della memoria del sistema
5. **Testa in produzione**: Verifica che il GC non interferisca con le operazioni critiche

## Troubleshooting

### GC non si attiva
- Verifica che `GC_ENABLE=true`
- Controlla che la memoria non superi la soglia
- Verifica i log per errori

### Troppi nodi vengono raccolti
- Aumenta `GC_THRESHOLD`
- Aggiungi namespace alla protezione
- Riduci `GC_DELAY`

### Performance degradate
- Aumenta `GC_MAX_NODES`
- Riduci la frequenza con `GC_DELAY`
- Monitora i tempi di esecuzione

## Sviluppo

Per modificare o estendere il modulo:

1. Modifica `shogun-gc.js`
2. Testa le modifiche
3. Aggiorna la documentazione
4. Verifica l'integrazione con il relay server

## Licenza

Questo modulo è parte del progetto Shogun e segue la stessa licenza.
