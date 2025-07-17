# Shogun Relay - Enhanced Gun Relay Server

Un relay server Gun potenziato con funzionalità avanzate di sottoscrizione smart contract, monitoraggio delle prestazioni e gestione IPFS.

## 🚀 Caratteristiche Principali

### 🔐 Sistema di Sottoscrizioni Smart Contract

- **Sottoscrizioni basate su storage IPFS**: Gli utenti pagano per MB di storage invece di fee fisse
- **Identificazione tramite chiavi Gun**: Supporto per chiavi pubbliche Gun come identificatori principali
- **Compatibilità multi-indirizzo**: Un utente può pagare da diversi indirizzi Ethereum mantenendo la stessa chiave Gun
- **Tracciamento uso storage**: Monitoraggio automatico dei MB utilizzati vs allocati
- **Verifica disponibilità**: Controllo in tempo reale dello spazio disponibile per upload

### 📊 Monitoraggio Avanzato

- **Performance Monitor**: Dashboard in tempo reale con grafici e metriche
- **Sistema di logging migliorato**: Log strutturati con livelli e colori
- **Metriche sistema**: Uptime, memoria, connessioni attive
- **Time-series data**: Storico delle prestazioni con grafici interattivi
- **API RESTful**: Endpoint per monitoraggio programmatico

### 🌐 Integrazione IPFS

- **Upload protetto**: Controllo autorizzazioni prima dell'upload
- **Registrazione automatica**: Tracciamento uso MB dopo upload
- **Gateway proxy**: Accesso trasparente ai file IPFS
- **Pin management**: Gestione pins IPFS con interfaccia web

### 🔧 Funzionalità Avanzate

- **Garbage collection**: Pulizia automatica dei dati non protetti
- **Health checks**: Monitoraggio stato servizi
- **CORS support**: Accesso cross-origin configurato
- **Docker support**: Containerizzazione completa
- **Environment configuration**: Configurazione tramite variabili d'ambiente

## 🏗️ Architettura

### Smart Contract (RelayPaymentRouter.sol)

```solidity
// Struttura sottoscrizione
struct Subscription {
    address user;
    address relay;
    string gunPubKey;
    uint256 startTime;
    uint256 endTime;
    uint256 amountPaid;
    uint256 mbAllocated;
    uint256 mbUsed;
    bool isActive;
}
```

### Backend (index.js)

- **Middleware di autorizzazione**: Verifica sottoscrizioni tramite smart contract
- **Sistema di logging**: Logger strutturato con livelli e persistenza
- **API endpoints**: RESTful APIs per monitoraggio e gestione
- **IPFS integration**: Upload e gestione file con controllo autorizzazioni

### Frontend

- **Performance Monitor**: Dashboard con grafici real-time
- **Subscription Manager**: Interfaccia per gestione sottoscrizioni
- **Upload Interface**: Upload file con verifica autorizzazioni
- **Admin Panel**: Pannello di controllo completo

## 🚀 Quick Start

### Prerequisiti

- Node.js 18+
- IPFS Desktop o IPFS daemon
- MetaMask wallet
- Contratto smart deployato su Sepolia

### Installazione

1. **Clone il repository**

```bash
git clone https://github.com/scobru/shogun-relay.git
cd shogun-relay
```

2. **Installa le dipendenze**

```bash
cd relay
npm install
```

3. **Configura le variabili d'ambiente**

```bash
cp env.example .env
```

Modifica `.env`:

```env
# Smart Contract
RELAY_CONTRACT_ADDRESS=0x...
ALCHEMY_API_KEY=your_alchemy_key

# IPFS
IPFS_API_URL=http://127.0.0.1:5001
IPFS_GATEWAY_URL=http://127.0.0.1:8080

# Admin
ADMIN_PASSWORD=your_admin_password

# Relay
RELAY_HOST=your_host
RELAY_PORT=8765
```

4. **Avvia il server**

```bash
npm start
```

### Docker

```bash
docker-compose up -d
```

## 📖 API Reference

### Endpoint di Monitoraggio

#### GET `/api/performance`

Restituisce metriche di performance del sistema.

```json
{
  "success": true,
  "performance": {
    "uptime": {
      "seconds": 3600,
      "formatted": "1h 0m 0s"
    },
    "memory": {
      "heapUsed": 45,
      "heapTotal": 64
    },
    "connections": {
      "active": 5,
      "total": 25
    }
  }
}
```

#### GET `/api/logs?level=error&limit=50`

Restituisce i log del sistema con filtri opzionali.

#### DELETE `/api/logs`

Pulisce tutti i log del sistema.

### Endpoint di Sottoscrizione

#### GET `/api/subscription-status/:identifier`

Verifica lo stato di una sottoscrizione (supporta indirizzi Ethereum e chiavi Gun).

```json
{
  "success": true,
  "subscription": {
    "isActive": true,
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-01-31T00:00:00.000Z",
    "mbAllocated": 1000,
    "mbUsed": 150,
    "mbRemaining": 850,
    "daysRemaining": 15
  }
}
```

### Endpoint di Upload

#### POST `/ipfs-upload-user`

Upload file con autorizzazione smart contract.

**Headers richiesti:**

- `x-pubkey`: Chiave pubblica Gun
- `x-user-address`: Indirizzo Ethereum (opzionale)
- `x-file-size-mb`: Dimensione file in MB

## 🎯 Utilizzo

### 1. Sottoscrizione al Relay

1. Vai su `/subscribe`
2. Connetti il wallet MetaMask
3. Inserisci la tua chiave pubblica Gun
4. Scegli i MB di storage desiderati
5. Conferma la transazione

### 2. Upload File

1. Vai su `/user-upload`
2. Inserisci la tua chiave Gun
3. Seleziona il file da uploadare
4. Il sistema verificherà automaticamente la disponibilità di spazio
5. Il file verrà uploadato su IPFS e l'uso MB registrato

### 3. Monitoraggio Performance

1. Vai su `/performance`
2. Visualizza metriche in tempo reale
3. Controlla i log del sistema
4. Monitora l'uso delle risorse

## 🔧 Configurazione Avanzata

### Smart Contract

Il contratto `RelayPaymentRouter.sol` gestisce:

- Registrazione relay
- Sottoscrizioni utenti
- Calcolo prezzi basato su MB
- Tracciamento uso storage
- Distribuzione pagamenti

### Garbage Collection

```javascript
// Configurazione GC
const GC_ENABLED = true;
const GC_INTERVAL = 5 * 60 * 1000; // 5 minuti
const GC_EXCLUDED_NAMESPACES = ["~", "!", "relays", "shogun"];
```

### Logging

```javascript
// Livelli di log
logger.info("Info message");
logger.success("Success message");
logger.warning("Warning message");
logger.error("Error message");
logger.debug("Debug message");
```

## 🐛 Troubleshooting

### Problemi Comuni

1. **Contract non inizializzato**

   - Verifica `RELAY_CONTRACT_ADDRESS` e `ALCHEMY_API_KEY`
   - Controlla la connessione a Sepolia

2. **Upload fallisce**

   - Verifica sottoscrizione attiva
   - Controlla spazio disponibile
   - Verifica connessione IPFS

3. **Performance degradate**
   - Controlla uso memoria
   - Verifica connessioni attive
   - Controlla log per errori

### Debug

```bash
# Abilita debug logging
DEBUG=* npm start

# Controlla log in tempo reale
tail -f logs/relay.log
```

## 🤝 Contribuire

1. Fork il repository
2. Crea un branch per la feature
3. Commit le modifiche
4. Push al branch
5. Crea una Pull Request

## 📄 Licenza

MIT License - vedi [LICENSE](LICENSE) per dettagli.

## 🔗 Link Utili

- [Documentazione Shogun](https://shogun-info.vercel.app)
- [Gun.js Documentation](https://gun.eco/docs)
- [IPFS Documentation](https://docs.ipfs.io)
- [Ethereum Sepolia](https://sepolia.etherscan.io)

---

**Sviluppato con ❤️ da [scobru](https://github.com/scobru)**
