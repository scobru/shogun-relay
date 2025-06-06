# 🚀 Shogun Relay Server

Un relay server completo per il sistema Shogun con funzionalità WebRTC, IPFS, autenticazione blockchain e gestione file distribuita.

## 📋 Panoramica

Il Shogun Relay è un server Node.js che combina:
- **GunDB**: Database decentralizzato peer-to-peer
- **IPFS**: Archiviazione distribuita di file
- **WebRTC**: Comunicazione peer-to-peer real-time
- **Blockchain Authentication**: Verifica on-chain delle autorizzazioni
- **File Management**: Sistema completo di gestione file con link condivisi

## 🛠️ Installazione e Avvio

```bash
# Installa dipendenze
npm install

# Configura il server
cp config.example.json config.json

# Avvia il server
npm start

# Modalità sviluppo
npm run dev
```

## 🌐 API Endpoints

### 📊 Sistema e Status

#### `GET /api/status`
Stato generale del server
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/status
```

#### `GET /api/config`
Configurazione attuale del server
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/config
```

#### `POST /api/config/reload`
Ricarica configurazione da file
```bash
curl -X POST -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/config/reload
```

### 🔐 Autenticazione

#### `GET /api/auth/status`
Stato del sistema di autenticazione
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/auth/status
```

#### `POST /api/auth/verify-onchain`
Verifica on-chain di una chiave pubblica
```bash
curl -X POST \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"pubKey": "~your-public-key"}' \
  http://localhost:8765/api/auth/verify-onchain
```

### 🌐 Sistema Relay

#### `GET /api/relay/status`
Stato del sistema relay
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/relay/status
```

#### `GET /api/relay/all`
Lista di tutti i relay disponibili
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/relay/all
```

#### `GET /api/relay/check-subscription/:relayAddress/:userAddress`
Verifica sottoscrizione utente a un relay
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/relay/check-subscription/0x.../0x...
```

#### `GET /api/relay/user-active-relays/:userAddress`
Relay attivi per un utente
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/relay/user-active-relays/0x...
```

#### `GET /api/relay/peers`
Informazioni sui peer connessi
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/relay/peers
```

#### `GET /api/relay/network-status`
Stato della rete relay
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/relay/network-status
```

#### `POST /api/relay/peers/:peerUrl/test`
Test connessione a un peer specifico
```bash
curl -X POST \
  -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/relay/peers/http%3A%2F%2Flocalhost%3A8765/test
```

### 📁 Gestione File

#### `GET /api/files/all`
Lista tutti i file gestiti
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/files/all
```

#### `POST /api/files/create-share-link`
Crea un link di condivisione per un file
```bash
curl -X POST \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{
    "fileHash": "QmXXX...",
    "fileName": "document.pdf",
    "password": "optional-password",
    "expiresIn": "24h",
    "maxDownloads": 5
  }' \
  http://localhost:8765/api/files/create-share-link
```

#### `GET /api/files/shared-links`
Lista dei link condivisi dall'utente
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/files/shared-links
```

#### `GET /api/files/share/:token`
Download file tramite link condiviso
```bash
curl "http://localhost:8765/api/files/share/secure-token-here?password=optional"
```

#### `GET /api/files/share/:token/info`
Informazioni su un link condiviso
```bash
curl "http://localhost:8765/api/files/share/secure-token-here/info"
```

#### `DELETE /api/files/share/:token`
Revoca un link condiviso
```bash
curl -X DELETE \
  -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/files/share/secure-token-here
```

### 📦 IPFS Integration

#### `GET /api/ipfs/status`
Stato della connessione IPFS
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/ipfs/status
```

#### `POST /api/ipfs/upload`
Upload file su IPFS
```bash
curl -X POST \
  -H "Authorization: Bearer your-token" \
  -F "file=@document.pdf" \
  http://localhost:8765/api/ipfs/upload
```

#### `GET /api/ipfs/files`
Lista file IPFS indipendenti
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/ipfs/files
```

#### `DELETE /api/ipfs/files/:ipfsHash`
Rimuove file IPFS indipendente
```bash
curl -X DELETE \
  -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/ipfs/files/QmXXX...
```

#### `POST /api/ipfs/sync-fallback`
Sincronizza file fallback con GunDB
```bash
curl -X POST \
  -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/ipfs/sync-fallback
```

### 🌉 Gateway IPFS

#### `GET /gateway/ipfs/:hash`
Gateway IPFS autenticato
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/gateway/ipfs/QmXXX...
```

### 📤 Upload File

#### `GET /uploads/:filename`
Download file caricato
```bash
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/uploads/filename.pdf
```

## 🎛️ Interfacce Web

### Dashboard Principale
```
http://localhost:8765
```
- Gestione file completa
- Sistema link condivisi
- Monitoring relay

### GunDB Interface
```
http://localhost:8765/gun
```
- Interface diretta GunDB
- Debug messaggi

### GunDB Client
```
http://localhost:8765/gundb/client
```
- Client GunDB avanzato

### WebRTC Client
```
http://localhost:8765/rtc/client
```
- Comunicazione P2P WebRTC

## 🔧 Configurazione

### File `config.json`
```json
{
  "NODE_ENV": "development",
  "PORT": 8765,
  "HTTPS_PORT": 8443,
  "SECRET_TOKEN": "your-secure-token",
  "BASIC_AUTH_USER": "admin",
  "BASIC_AUTH_PASSWORD": "secure-password",
  "IPFS_ENABLED": true,
  "IPFS_SERVICE": "IPFS-CLIENT",
  "IPFS_NODE_URL": "http://localhost:5001",
  "IPFS_GATEWAY": "http://127.0.0.1:8080/ipfs/",
  "ONCHAIN_MEMBERSHIP_ENABLED": true,
  "relay": {
    "onchainMembership": true,
    "registryAddress": "0x...",
    "providerUrl": "https://sepolia.infura.io/v3/..."
  },
  "PEERS": [
    "http://localhost:8765/gun"
  ],
  "ALLOWED_ORIGINS": "http://localhost:3000,https://app.example.com"
}
```

## 🔐 Sistema di Autenticazione

### Livelli di Sicurezza
1. **HTTP Basic Auth** (opzionale)
2. **Token Authentication** (sempre attivo)
3. **Blockchain Verification** (per utenti on-chain)

### Modalità Token
- Header: `Authorization: Bearer token`
- Header: `token: your-token`
- Query: `?token=your-token`
- Body: `{"token": "your-token"}`

## 📊 Logging e Monitoring

### Log Categories
- **Server**: Operazioni server generali
- **IPFS**: Operazioni IPFS
- **Gun**: Messaggi GunDB
- **Auth**: Autenticazione
- **Backup**: Backup operazioni

### File di Log
```
logs/
├── app-YYYY-MM-DD.log          # Log applicazione
├── error-YYYY-MM-DD.log        # Solo errori
└── backup-YYYY-MM-DD.log       # Operazioni backup
```

## 🚀 Funzionalità Principali

### 📁 Sistema File Condivisi
- Creazione link sicuri con password
- Scadenza temporale configurabile
- Limite download
- Gestione avanzata permessi

### 🔗 WebRTC Messaging
- Comunicazione P2P real-time
- Chat sicura end-to-end
- Condivisione file diretta

### 🌐 IPFS Integration
- Upload/download distribuito
- Gateway personalizzato
- Fallback storage locale

### ⛓️ Blockchain Integration
- Verifica on-chain autorizzazioni
- Smart contract interaction
- Relay network management

## 🧪 Testing

### Test Rapido
```bash
# Test autenticazione
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/auth/status

# Test IPFS
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/ipfs/status

# Test file system
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/files/all
```

### Debug Console
- Browser DevTools (F12)
- Network tab per API calls
- Console per JavaScript errors

## 📚 Documentazione Aggiuntiva

- [`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md) - Sistema autenticazione dettagliato
- [`docs/logging.md`](docs/logging.md) - Configurazione logging
- [`QUICK-TEST.md`](QUICK-TEST.md) - Test sistema link condivisi
- [`SECRET-LINKS-SYSTEM.md`](SECRET-LINKS-SYSTEM.md) - Sistema link segreti
- [`IPFS-FILES-FIX.md`](IPFS-FILES-FIX.md) - Fix IPFS

## 🔄 Scripts Disponibili

```json
{
  "start": "node src/index.js",
  "dev": "nodemon src/index.js",
  "get-deployed-contracts": "node scripts/getDeployedContraacts.js",
  "generate-certs": "node scripts/generate-ssl-certs.js",
  "clean-all": "node scripts/clean-all-data.js"
}
```

## 📞 Support

Per problemi e supporto:
1. Controlla i log in `logs/`
2. Verifica configurazione in `config.json`
3. Consulta la documentazione in `docs/`
4. Test endpoints con curl

---

**Sviluppato per l'ecosistema Shogun** 🥷 