# Shogun Gun Relay

Il server relay di Shogun fornisce un'istanza Gun persistente e robusta per la sincronizzazione dei dati.

## Funzionalità

### Istanza Persistente
- **Path**: `/gun`
- **Persistenza**: Abilitata con radisk
- **Storage**: Filesystem (`radata/`)
- **Peers**: Configurabile tramite `RELAY_PEERS`
- **Uso**: Dati permanenti, sincronizzazione tra peer
- **Features**: Auto-reconnection, heartbeat, gestione errori robusta

## Configurazione

### Variabili d'Ambiente

```bash
# Abilita logging debug
DEBUG=true

# Disabilita radisk se necessario
DISABLE_RADISK=false

# Pulisci dati corrotti all'avvio
CLEANUP_CORRUPTED_DATA=true
```

## Esempi d'Uso

### Client JavaScript

```javascript
// Connessione al relay Shogun
const gun = Gun({
  peers: ['ws://localhost:8765/gun'],
  // Configurazione ottimizzata per il relay
  wire: true,
  webrtc: true,
  wait: 300,
  retry: 3,
  reconnect: true
});

// I dati sono persistenti e sincronizzati
gun.get('users').get('alice').put({ name: 'Alice' });

// Sincronizzazione real-time
gun.get('messages').map().on((data, key) => {
  console.log('Nuovo messaggio:', data);
});
```

### Gestione Connessioni Robusta

```javascript
// Monitoraggio stato connessione
gun.on('hi', (peer) => {
  console.log('🟢 Connesso al relay:', peer);
});

gun.on('bye', (peer) => {
  console.log('🔴 Disconnesso dal relay:', peer);
});

// Gestione errori e riconnessione automatica
gun.on('out', (msg) => {
  if (msg.put) {
    console.log('📤 Invio dati:', Object.keys(msg.put).length, 'nodi');
  }
});

gun.on('in', (msg) => {
  if (msg.put) {
    console.log('📥 Ricevuto:', Object.keys(msg.put).length, 'nodi');
  }
});
```

## Monitoraggio

### Endpoint API

#### Health Check
```bash
GET /health

Response:
{
  "success": true,
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00.000Z",
  "uptime": 123.45,
  "activeConnections": 5,
  "totalConnections": 12,
  "memoryUsage": {
    "rss": 45678912,
    "heapTotal": 12345678,
    "heapUsed": 8765432
  }
}
```

#### IPFS Status
```bash
GET /ipfs-status

Response:
{
  "success": true,
  "status": "connected",
  "version": "0.20.0",
  "apiUrl": "http://127.0.0.1:5001"
}
```

## Caratteristiche Avanzate

### Auto-Reconnection
- Riconnessione automatica in caso di disconnessione
- Heartbeat per rilevare connessioni stale
- Retry con backoff esponenziale

### Gestione Errori
- Cleanup automatico dati corrotti
- Sanitizzazione dati per GunDB
- Logging dettagliato per debug

### Performance
- Configurazione ottimizzata per real-time sync
- Supporto WebRTC per connessioni dirette
- Batching intelligente per ridurre overhead

## Casi d'Uso

### ✅ Ideale Per

- Applicazioni real-time collaborative
- Sincronizzazione dati multi-dispositivo
- Chat e messaging
- Gaming multiplayer
- Documenti collaborativi
- IoT data streaming

### 🔧 Configurazione Ottimale

```javascript
const gun = Gun({
  peers: ['ws://localhost:8765/gun'],
  // Configurazione ottimizzata
  wire: true,        // Protocollo wire efficiente
  webrtc: true,      // Connessioni dirette P2P
  wait: 300,         // Batch processing veloce
  retry: 3,          // Tentativi di riconnessione
  reconnect: true,   // Auto-reconnection
  heartbeat: 30000   // Heartbeat ogni 30s
});
```

## Architettura

```
┌─────────────────────────────────────────┐
│   Shogun Relay Server                   │
├─────────────────────────────────────────┤
│                                         │
│  /gun (Single Persistent Instance)      │
│  ├─ RadDisk Storage                     │
│  ├─ Peer Sync                           │
│  ├─ WebSocket Server                    │
│  ├─ Auto-Reconnection                   │
│  ├─ Heartbeat Monitoring                │
│  └─ Error Recovery                      │
│                                         │
└─────────────────────────────────────────┘
```

## Vantaggi

### Semplicità
- Una sola istanza Gun da gestire
- Configurazione unificata
- Debugging semplificato

### Affidabilità
- Gestione errori robusta
- Auto-reconnection
- Cleanup automatico dati corrotti

### Performance
- Configurazione ottimizzata
- Supporto WebRTC
- Batching intelligente

## Troubleshooting

### Problemi di Connessione
```bash
# Controlla stato relay
curl http://localhost:8765/health

# Verifica IPFS
curl http://localhost:8765/ipfs-status
```

### Debug Dettagliato
```bash
# Abilita logging debug
export DEBUG=true

# Pulisci dati corrotti
export CLEANUP_CORRUPTED_DATA=true
```

### Performance
```bash
# Disabilita radisk se necessario
export DISABLE_RADISK=true

# Configura peer esterni
export RELAY_PEERS=ws://peer1:8765/gun,ws://peer2:8765/gun
```