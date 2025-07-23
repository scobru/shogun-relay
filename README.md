# Shogun Relay

Un relay server completo per IPFS con autenticazione integrata.

## Autenticazione IPFS

Il relay utilizza l'autenticazione nativa di IPFS Kubo con JWT tokens per proteggere l'API IPFS.

### Come funziona

1. **Inizializzazione**: Durante l'avvio del container, IPFS genera automaticamente un JWT token per l'autenticazione API
2. **Storage**: Il token viene salvato in `/tmp/ipfs-jwt-token` all'interno del container
3. **Utilizzo**: Il relay legge il token e lo usa per autenticare tutte le richieste API IPFS
4. **Fallback**: Se il JWT token non è disponibile, il relay usa il token di ambiente `IPFS_API_TOKEN`

### Configurazione

Per abilitare l'autenticazione, imposta la variabile d'ambiente:

```bash
IPFS_API_TOKEN=your-secret-token
```

Se non viene impostato `IPFS_API_TOKEN`, l'API IPFS sarà pubblicamente accessibile.

### Sicurezza

- Il JWT token viene generato automaticamente da IPFS
- Il token ha permessi di amministratore per tutte le operazioni API
- Il token è accessibile solo all'interno del container
- Tutte le richieste API IPFS sono autenticate con il token

### Test dell'autenticazione

Per testare che l'autenticazione funzioni:

```bash
# Senza token (dovrebbe fallire)
curl http://localhost:5001/api/v0/version

# Con token (dovrebbe funzionare)
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:5001/api/v0/version
```

## Installazione e Avvio

```bash
# Clona il repository
git clone <repository-url>
cd shogun-relay

# Configura le variabili d'ambiente
cp .env.example .env
# Modifica .env con le tue configurazioni

# Avvia con Docker
docker-compose up -d

# Verifica che tutto funzioni
curl http://localhost:8765/health
```

## Struttura del Progetto

```
shogun-relay/
├── relay/                 # Codice del relay server
├── docker/               # File di configurazione Docker
├── docker-compose.yml    # Configurazione Docker Compose
├── Dockerfile           # Immagine Docker
└── README.md           # Questo file
```

## Porte

- `8765`: Relay server
- `5001`: IPFS API (protetta da autenticazione)
- `8080`: IPFS Gateway
- `4001`: IPFS Swarm

## Logs

I logs sono disponibili in:
- `/var/log/supervisor/` all'interno del container
- `./logs/` nella directory del progetto (se montata)

## Troubleshooting

### Problemi di autenticazione

1. Verifica che `IPFS_API_TOKEN` sia impostato
2. Controlla i logs di IPFS: `docker logs shogun-relay-stack`
3. Verifica che il JWT token sia stato generato: `docker exec shogun-relay-stack cat /tmp/ipfs-jwt-token`

### Problemi di connessione

1. Verifica che tutte le porte siano esposte correttamente
2. Controlla che i volumi Docker siano configurati
3. Verifica i permessi delle directory

## Sviluppo

Per sviluppo locale:

```bash
# Installa dipendenze
cd relay
npm install

# Avvia in modalità sviluppo
npm run dev
```

## Licenza

MIT License
