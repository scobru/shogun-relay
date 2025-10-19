# Multi-Socket Gun Relay

Il server relay di Shogun supporta istanze Gun multiple con isolamento dei dati tramite path-based routing.

## Funzionalità

### Istanza Persistente (Default)
- **Path**: `/gun`
- **Persistenza**: Abilitata con radisk
- **Storage**: Filesystem (`radata/`)
- **Peers**: Configurabile tramite `RELAY_PEERS`
- **Uso**: Dati permanenti, sincronizzazione tra peer

### Istanze Effimere (Multi-Socket)
- **Path**: Qualsiasi path diverso da `/gun` (es. `/ephemeral/session123`, `/temp/myroom`)
- **Persistenza**: Disabilitata (solo in memoria)
- **Storage**: Nessuno (nomem adapter)
- **Peers**: Isolate, nessun peering
- **Uso**: Sessioni temporanee, chat room, dati volatili
- **Lifecycle**: Cache LRU con eviction automatica

## Configurazione

### Variabili d'Ambiente

```bash
# Abilita logging debug per multi-socket
DEBUG=true

# Numero massimo di istanze effimere (default: 50)
MAX_EPHEMERAL_SOCKETS=100
```

## Esempi d'Uso

### Client JavaScript - Istanza Persistente

```javascript
// Connessione all'istanza persistente principale
const gun = Gun({
  peers: ['ws://localhost:8765/gun']
});

// I dati sono persistenti e sincronizzati
gun.get('users').get('alice').put({ name: 'Alice' });
```

### Client JavaScript - Istanza Effimera

```javascript
// Crea una sessione temporanea isolata
const sessionId = Math.random().toString(36).substring(7);
const ephemeralGun = Gun({
  peers: [`ws://localhost:8765/ephemeral/${sessionId}`],
  localStorage: false
});

// I dati esistono solo in memoria e non vengono persistiti
ephemeralGun.get('chat').get('messages').put({ 
  text: 'Questo messaggio sparirà quando il server riavvia' 
});
```

### Chat Room Isolate

```javascript
// Stanza 1 - dati non condivisi con stanza 2
const room1 = Gun({
  peers: ['ws://localhost:8765/rooms/room-alpha']
});

// Stanza 2 - completamente isolata
const room2 = Gun({
  peers: ['ws://localhost:8765/rooms/room-beta']
});

room1.get('messages').put({ room: 'alpha', msg: 'Ciao!' });
room2.get('messages').put({ room: 'beta', msg: 'Hello!' });
// I messaggi NON vengono condivisi tra le stanze
```

### Sessioni Temporanee per WebRTC Signaling

```javascript
// Ideale per WebRTC signaling ephemeral
const signaling = Gun({
  peers: [`ws://localhost:8765/webrtc/${peerId}`]
});

signaling.get('offer').on(data => {
  // Ricevi offer WebRTC
});

signaling.get('answer').put(myAnswer);
```

## Monitoraggio

### Endpoint API

#### Health Check con Info Multi-Socket
```bash
GET /health

Response:
{
  "success": true,
  "status": "healthy",
  "uptime": 123.45,
  "activeConnections": 5,
  "ephemeralSockets": {
    "count": 3,
    "maxSize": 50
  }
}
```

#### Lista Istanze Effimere Attive
```bash
GET /ephemeral-sockets

Response:
{
  "success": true,
  "count": 3,
  "maxSize": 50,
  "sockets": [
    {
      "path": "/ephemeral/abc123",
      "created": "2025-01-15T10:30:00.000Z",
      "uptime": 300000
    },
    {
      "path": "/rooms/lobby",
      "created": "2025-01-15T10:25:00.000Z",
      "uptime": 600000
    }
  ]
}
```

## Gestione della Cache

Le istanze effimere utilizzano un **LRU (Least Recently Used) cache**:

- Quando si raggiunge `MAX_EPHEMERAL_SOCKETS`, l'istanza meno recentemente usata viene eliminata
- Le connessioni attive tengono "calda" l'istanza nella cache
- Quando un'istanza viene evicted, tutte le connessioni vengono chiuse
- Riconnettersi crea una nuova istanza vuota

## Casi d'Uso

### ✅ Quando Usare Istanze Effimere

- Chat temporanee o room di discussione
- WebRTC signaling
- Sessioni di collaborazione temporanee
- Gaming multiplayer (stato di sessione)
- Form collaborativi temporanei
- Whiteboard condivise effimere

### ✅ Quando Usare Istanza Persistente

- Dati utente permanenti
- Contenuti da pubblicare
- Storico messaggi da conservare
- Configurazioni applicazione
- Dati da sincronizzare tra dispositivi

## Architettura

```
┌─────────────────────────────────────────┐
│   Shogun Relay Server                   │
├─────────────────────────────────────────┤
│                                         │
│  /gun (Persistent)                      │
│  ├─ RadDisk Storage                     │
│  ├─ Peer Sync                           │
│  └─ WebSocket Server                    │
│                                         │
│  /ephemeral/* (Ephemeral)               │
│  ├─ NoMem Adapter                       │
│  ├─ Isolated                            │
│  ├─ LRU Cache (max 50)                  │
│  └─ Dedicated WebSocket Servers         │
│                                         │
└─────────────────────────────────────────┘
```

## Troubleshooting

### Le istanze effimere spariscono

**Causa**: Raggiunto il limite LRU cache  
**Soluzione**: Aumenta `MAX_EPHEMERAL_SOCKETS` o usa l'istanza persistente

### Dati non sincronizzati tra path diversi

**Comportamento previsto**: Le istanze sono isolate per design  
**Soluzione**: Usa lo stesso path per condividere dati

### Memoria elevata

**Causa**: Troppe istanze effimere attive  
**Soluzione**: Riduci `MAX_EPHEMERAL_SOCKETS` o implementa timeout di inattività

## Sicurezza

- Le istanze effimere **NON** supportano autenticazione Gun SEA per default
- Considera l'implementazione di middleware di autenticazione a livello WebSocket
- I dati non vengono persistiti ma restano in memoria fino all'eviction
- Implementa rate limiting per prevenire abuse di creazione istanze

## Performance

- Le istanze effimere sono **più veloci** (no I/O disco)
- Consumano **meno risorse** (no radisk overhead)
- Ideali per **alta frequenza** di messaggi temporanei
- Scalano meglio per **sessioni brevi**

## Compatibilità

Compatibile con:
- Gun.js v0.2020.x
- WebSocket standard
- Tutte le librerie Gun client (browser, Node.js)
- Gun SEA (su istanza persistente)

Non compatibile con:
- Gun RFS (su istanze effimere)
- Gun RadDisk (su istanze effimere)
- Cross-path synchronization

