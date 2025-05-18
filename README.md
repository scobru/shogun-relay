# Shogun Relay

Un relay server avanzato che integra GunDB, IPFS ed Ethereum per la gestione decentralizzata di dati, file e autenticazione.

## Caratteristiche Principali

### Architettura Decentralizzata

- **GunDB**: Database decentralizzato per sincronizzazione dati in tempo reale
- **IPFS**: Storage distribuito e persistente per file e contenuti
- **Ethereum**: Verifica on-chain opzionale per autenticazione membri

### Sicurezza

- Autenticazione basata su token
- Supporto per verifica on-chain tramite RelayVerifier
- Gestione sicura delle connessioni WebSocket
- Supporto per HTTPS con certificati personalizzati

### API Complete

- REST API per gestione file e configurazione
- WebSocket per sincronizzazione in tempo reale
- Supporto per upload e gestione file
- Endpoint per integrazione IPFS

## Architettura

### Core Components

1. **Server Relay (`src/index.js`)**

   - Gestione delle connessioni WebSocket per GunDB
   - Routing delle richieste HTTP/HTTPS
   - Supporto per autenticazione multi-livello
   - Configurazione CORS avanzata

2. **Authentication Manager (`src/managers/AuthenticationManager.js`)**

   - Validazione token
   - Integrazione con RelayVerifier per verifica on-chain
   - Controllo accessi per API e WebSocket

3. **IPFS Manager (`src/managers/IpfsManager.js`)**

   - Integrazione nativa con IPFS
   - Supporto per Pinata e nodi IPFS locali
   - Gestione file e metadati

4. **File Manager (`src/managers/FileManager.js`)**
   - Gestione file locale e distribuita
   - Sistema di upload multi-part
   - Backup e sincronizzazione

### API Routes

1. **Auth Routes (`src/routes/authRoutes.js`)**

   - Autenticazione utenti
   - Gestione token
   - Verifica on-chain

2. **IPFS Routes (`src/routes/ipfsApiRoutes.js`)**

   - Endpoint per operazioni IPFS
   - Gestione metadati
   - Controllo stato IPFS

3. **File Routes (`src/routes/fileManagerRoutes.js`)**

   - Interrogazione e ricerca file
   - Accesso ai dettagli dei file
   - Query avanzate

4. **Relay Routes (`src/routes/relayApiRoutes.js`)**
   - Configurazione relay
   - Stato e diagnostica
   - Gestione sottoscrizioni

## API Endpoints

### Autenticazione

- `POST /auth/register`: Registrazione utente
- `POST /auth/login`: Login utente
- `POST /auth/verify-onchain`: Verifica on-chain di chiavi pubbliche

### File

- `GET /api/files/all`: Lista di tutti i file
- `GET /api/files/search`: Ricerca file con criteri personalizzati
- `GET /api/files/:id`: Dettagli di un file specifico

### IPFS

- `GET /api/ipfs/status`: Stato del servizio IPFS
- `GET /api/ipfs/health-check`: Controllo salute del sistema IPFS
- `GET /api/ipfs/metadata`: Metadati dei file IPFS
- `GET /api/ipfs/pin-status/:hash`: Stato di pin per un hash specifico
- `POST /api/ipfs/pin`: Aggiunge pin a contenuto
- `POST /api/ipfs/unpin`: Rimuove pin da contenuto
- `POST /api/ipfs/toggle`: Attiva/disattiva il servizio IPFS
- `POST /api/ipfs/update-config`: Aggiorna configurazione IPFS

### Relay

- `GET /api/relay/status`: Stato del relay server
- `GET /api/relay/all`: Lista di tutti i relay disponibili
- `GET /api/relay/check-subscription/:relayAddress/:userAddress`: Verifica sottoscrizione
- `GET /api/relay/user-active-relays/:userAddress`: Relays attivi per un utente
- `GET /api/relay/subscription-info/:relayAddress/:userAddress`: Info sottoscrizione
- `POST /api/relay/update-relay-config`: Aggiorna configurazione relay
- `POST /api/relay/auth/update-config`: Aggiorna configurazione autenticazione

### WebSocket

- `/gun`: Endpoint WebSocket GunDB

## Configurazione

Il server utilizza un file di configurazione `config.json` che contiene tutte le opzioni necessarie.

```json
{
    "NODE_ENV": "production",
    "PORT": 8765,
    "SECRET_TOKEN": "",
    "ALLOWED_ORIGINS": "",
    "IPFS_ENABLED": false,
    "IPFS_SERVICE": "IPFS-CLIENT",
    "IPFS_NODE_URL": "http://127.0.0.1:5001",
    "IPFS_GATEWAY": "http://127.0.0.1:8080/ipfs",
    "PINATA_GATEWAY": "https://gateway.pinata.cloud", 
    "PINATA_JWT": "your_pinata_jwt_here",
    "ETHEREUM_PROVIDER_URL": "",
    "ETHEREUM_PRIVATE_KEY": "",
    "ONCHAIN_MEMBERSHIP_ENABLED": false,
    "RELAY_REGISTRY_CONTRACT": "",
    "INDIVIDUAL_RELAY": "",
    "RELAY_ENTRY_POINT_CONTRACT": "",
    "ACTIVITYPUB_USER": "admin",
    "ACTIVITYPUB_PASS": "admin",
    "ACTIVITYPUB_DOMAIN": "localhost",
    "ACTIVITYPUB_PORT": 8765,
    "PRIVKEY_PATH": "",
    "CERT_PATH": "",
    "ADMIN_USER": "admin",
    "ADMIN_PASS": "admin"
}
```

### Opzioni Principali

- **PORT**: Porta del server (default: 8765)
- **SECRET_TOKEN**: Token per autenticazione API
- **ALLOWED_ORIGINS**: Domini autorizzati per CORS (separati da virgole)
- **IPFS_ENABLED**: Abilita funzionalità IPFS
- **ETHEREUM_PROVIDER_URL**: URL provider Ethereum
- **ONCHAIN_MEMBERSHIP_ENABLED**: Abilita verifica membri on-chain
- **PRIVKEY_PATH/CERT_PATH**: Percorsi per certificati HTTPS

## Installazione

### Prerequisiti

- Node.js >= 16
- IPFS node (opzionale)
- Accesso a provider Ethereum (opzionale)

### Setup

```bash
# Clona il repository
git clone https://github.com/yourusername/shogun-relay.git
cd shogun-relay

# Installa dipendenze
npm install

# Copia e configura il file di configurazione
cp config.json.example config.json
# Modifica config.json con i tuoi parametri

# Genera una coppia di chiavi (opzionale)
npm run generate-keypair

# Avvia il server
npm start
```

## Comandi

Il server offre diversi script npm:

- `npm start`: Avvia il server
- `npm run dev`: Avvia il server in modalità sviluppo con hot-reload
- `npm run generate-keypair`: Genera coppia di chiavi per autenticazione
- `npm run get-deployed-contracts`: Ottiene indirizzi contratti deployati
- `npm run clean-all`: Pulisce tutti i dati (GunDB, file, etc)

## Debug

Per attivare la modalità debug:

```bash
# Avvia con debug options
DEBUG=shogun-relay:* npm start
```

### Console Debug

- `/debug` - Attiva modalità debug nella console (se in ambiente web)
- Cerca `DEBUG=true` nei logs per info diagnostiche
- Utilizza `bullet-catcher.js` per catturare gli errori imprevisti

## Sicurezza

### Best Practices

1. **Configura HTTPS**
   - Imposta `PRIVKEY_PATH` e `CERT_PATH` per abilitare HTTPS

2. **Abilita Autenticazione On-chain**
   - Imposta `ONCHAIN_MEMBERSHIP_ENABLED=true`
   - Configura gli indirizzi dei contratti rilevanti

3. **Limita CORS**
   - Specifica solo i domini necessari in `ALLOWED_ORIGINS`

4. **Proteggi API Admin**
   - Modifica `ADMIN_USER` e `ADMIN_PASS` con credenziali sicure

## Troubleshooting

### Problemi Comuni

1. **GunDB non sincronizza**
   - Verifica configurazione WebSocket
   - Controlla permessi directory `radata`
   - Verifica connessione con i peer

2. **IPFS non funziona**
   - Verifica che IPFS sia in esecuzione all'indirizzo specificato
   - Controlla token JWT Pinata se utilizzi servizio remoto
   - Verifica connettività gateway IPFS

3. **Autenticazione fallisce**
   - Verifica SECRET_TOKEN
   - Controlla configurazione RelayVerifier per auth on-chain
   - Verifica permessi e directory chiavi

## Utility

### Utils

1. **ShogunCore Utils (`src/utils/shogunCoreUtils.js`)**
   - Inizializzazione ed interazione con ShogunCore
   - Setup dei contratti Relay
   - Gestione del RelayVerifier

2. **GunDB Utils (`src/utils/gunIpfsUtils.js`)**
   - Middleware per integrazione GunDB con IPFS
   - Gestione dati sincronizzati

3. **Debug Utils (`src/utils/debugUtils.js`)**
   - Strumenti di diagnostica
   - Logging avanzato

4. **Bullet Catcher (`src/utils/bullet-catcher.js`)**
   - Gestione globale eccezioni non catturate
   - Prevenzione crash del server

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
