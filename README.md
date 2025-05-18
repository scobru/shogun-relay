# Shogun Relay

Un relay server avanzato che integra GunDB, IPFS e SQLite per la gestione distribuita di dati e file.

## Caratteristiche Principali

### Storage Multi-Layer

- **IPFS Storage**: Storage distribuito per file e dati
- **SQLite Storage**: Database locale per dati strutturati e file
- **Filesystem Locale**: Fallback per storage locale

### Sicurezza

- Autenticazione basata su token
- Supporto per crittografia dei dati su IPFS
- Gestione sicura delle connessioni WebSocket

### Interfaccia Web

- Dashboard moderna e reattiva
- Gestione file con upload/download
- Esploratore GunDB integrato
- Pannello di configurazione IPFS

## Architettura

### Core Components

1. **Server Relay (`index.js`)**

   - Gestione delle connessioni WebSocket
   - Routing delle richieste HTTP
   - Middleware di autenticazione
   - Configurazione CORS

2. **SQLite Adapter (`sqlite-adapter.js`)**

   - Persistenza dati per GunDB
   - Gestione delle relazioni tra nodi
   - Supporto per query complesse
   - Sistema di cache integrato

3. **IPFS Adapter (`ipfs-adapter.js`)**

   - Integrazione con IPFS network
   - Supporto per Pinata e nodi IPFS locali
   - Crittografia dei file
   - Gestione metadati

4. **Router (`routes.js`)**
   - API RESTful
   - Endpoint per gestione file
   - Endpoint per configurazione
   - Healthcheck e diagnostica

### Interfacce

1. **Dashboard (`index.html`)**

   - Statistiche di sistema
   - Gestione file
   - Esploratore GunDB
   - Configurazione IPFS
   - Debug logs

2. **Login (`login.html`)**
   - Autenticazione utente
   - Gestione token
   - Persistenza sessione

## API Endpoints

### File Management

- `POST /upload`: Upload file
- `GET /files`: Lista file
- `GET /files/:id`: Dettagli file
- `DELETE /files/:id`: Rimozione file

### IPFS

- `GET /api/ipfs/status`: Stato IPFS
- `POST /api/ipfs/toggle`: Attiva/disattiva IPFS
- `POST /api/ipfs/config`: Configurazione IPFS

### GunDB

- `GET /api/gundb/explore`: Esplora nodi
- `POST /api/gundb/create-node`: Crea nodo
- `GET /gun`: Endpoint WebSocket GunDB

### Sistema

- `GET /api/status`: Stato server
- `GET /api/info`: Info API
- `GET /websocket-test`: Test WebSocket

## Configurazione

### Variabili Ambiente

```env
PORT=8765
SECRET_TOKEN=your_token
ALLOWED_ORIGINS=http://localhost:3001,http://localhost:5173

# IPFS Config
IPFS_SERVICE=IPFS-CLIENT
IPFS_NODE_URL=http://127.0.0.1:5001
IPFS_GATEWAY=http://127.0.0.1:8080/ipfs
PINATA_GATEWAY=https://gateway.pinata.cloud
PINATA_JWT=your_jwt_token
ENCRYPTION_ENABLED=false
ENCRYPTION_KEY=your_key
ENCRYPTION_ALGORITHM=aes-256-gcm

# SQLite Config
SQLITE_ENABLED=true
SQLITE_PATH=./sqlitedata
SQLITE_FILE=shogun.db
SQLITE_VERBOSE=false
SQLITE_FILES_ENABLED=true
SQLITE_MAX_FILE_SIZE=10485760
```

### Storage Priorities

1. IPFS (se abilitato)
2. SQLite (se abilitato)
3. Filesystem locale (fallback)

## Sicurezza

### Autenticazione

- Token-based authentication
- CORS configurabile
- Validazione richieste WebSocket

### Crittografia

- Supporto per crittografia file su IPFS
- Algoritmo configurabile (default: aes-256-gcm)
- Chiavi di crittografia personalizzabili

## Sviluppo

### Prerequisiti

- Node.js >= 14
- SQLite3
- IPFS node (opzionale)

### Installazione

```bash
git clone <repository>
cd shogun-relay
npm install
```

### Avvio

```bash
npm start
```

### Debug

- Log dettagliati via console
- UI debug integrata
- Monitoraggio WebSocket
- Tracciamento operazioni IPFS/SQLite

## Best Practices

### Storage

- Usa IPFS per file distribuiti
- SQLite per dati strutturati
- Filesystem per file temporanei

### Performance

- Cache SQLite attiva
- Chunking per file grandi
- Connessioni WebSocket persistenti
- Ottimizzazione query GunDB

### Sicurezza

- Validazione input
- Sanitizzazione percorsi
- Rate limiting
- Token rotation

## Troubleshooting

### Problemi Comuni

1. **Connessione WebSocket**

   - Verifica CORS
   - Controlla token
   - Verifica porte

2. **Upload File**

   - Controlla permessi
   - Verifica limiti dimensione
   - Controlla storage disponibile

3. **IPFS**

   - Verifica nodo IPFS
   - Controlla credenziali Pinata
   - Verifica gateway

4. **SQLite**
   - Controlla permessi DB
   - Verifica spazio disco
   - Monitora lock file

## Estensioni Possibili

### Implementazione Indexer

Per migliorare le performance di ricerca e l'organizzazione dei dati, è possibile implementare un indexer con le seguenti caratteristiche:

1. **Indicizzazione File**

   - Metadati (nome, dimensione, tipo)
   - Hash contenuto
   - Tag e categorie
   - Relazioni tra file

2. **Storage Options**

   - SQLite (tabella dedicata)
   - Elasticsearch
   - MongoDB

3. **Funzionalità**

   - Ricerca full-text
   - Filtri avanzati
   - Aggregazioni
   - Suggerimenti

4. **Esempio Implementazione SQLite**

```sql
CREATE TABLE file_index (
    id INTEGER PRIMARY KEY,
    file_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    content_hash TEXT,
    mime_type TEXT,
    size INTEGER,
    tags TEXT,
    metadata TEXT,
    created_at INTEGER,
    updated_at INTEGER,
    UNIQUE(file_id)
);

CREATE INDEX idx_filename ON file_index(filename);
CREATE INDEX idx_content_hash ON file_index(content_hash);
CREATE INDEX idx_mime_type ON file_index(mime_type);
```

5. **API Endpoints Suggeriti**

```javascript
// Ricerca avanzata
GET /api/search
{
  query: string,
  filters: {
    mimeType: string[],
    size: { min: number, max: number },
    tags: string[],
    dateRange: { start: Date, end: Date }
  },
  sort: { field: string, order: 'asc' | 'desc' },
  page: number,
  limit: number
}

// Gestione tag
POST /api/files/:id/tags
DELETE /api/files/:id/tags/:tag

// Aggregazioni
GET /api/stats/by-type
GET /api/stats/by-date
```
