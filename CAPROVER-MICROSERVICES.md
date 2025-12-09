# Deploy Microservizi su CapRover

Questa guida spiega come deployare ogni microservizio come applicazione separata su CapRover.

## Struttura dei Servizi

1. **gun-relay** - Porta 8765 (GunDB Relay)
2. **ipfs-api** - Porta 8768 (IPFS API Service)
3. **holster-relay** - Porta 8766 (Holster Relay)
4. **data-api** - Porta 8767 (Data API)
5. **ipfs-service** - Porte 5001, 8080, 4001 (IPFS Kubo Node) - **OPZIONALE** (può essere esterno)

## Prerequisiti

- CapRover installato e configurato
- Accesso SSH o Git al repository
- Conoscenza base di CapRover

## Deploy dei Servizi

### 1. Gun Relay

**Directory:** `relay/`

**Configurazione CapRover:**
- **App Name:** `shogun-gun-relay` (o il nome che preferisci)
- **Repository:** URL del tuo repository Git
- **Branch:** `main` (o il branch che usi)
- **Root Directory:** `shogun-relay/relay`
- **Port:** `8765`

**Variabili d'Ambiente:**
```
NODE_ENV=production
RELAY_PORT=8765
DATA_DIR=/app/data
IPFS_API_URL=http://shogun-ipfs-service:5001
IPFS_GATEWAY_URL=http://shogun-ipfs-service:8080
IPFS_SERVICE_URL=http://shogun-ipfs-api:8768
ADMIN_PASSWORD=shogun2025
RELAY_PEERS=ws://shogun-holster-relay:8766/holster
```

**Note:**
- Sostituisci `shogun-ipfs-service`, `shogun-ipfs-api`, `shogun-holster-relay` con i nomi reali delle tue app CapRover
- CapRover risolve automaticamente i nomi delle app come hostname nella rete interna

### 2. IPFS API Service

**Directory:** `ipfs/`

**Configurazione CapRover:**
- **App Name:** `shogun-ipfs-api`
- **Repository:** URL del tuo repository Git
- **Branch:** `main`
- **Root Directory:** `shogun-relay/ipfs`
- **Port:** `8768`

**Variabili d'Ambiente:**
```
NODE_ENV=production
IPFS_API_HOST=0.0.0.0
IPFS_API_PORT=8768
IPFS_API_URL=http://shogun-ipfs-service:5001
IPFS_GATEWAY_URL=http://shogun-ipfs-service:8080
IPFS_API_TOKEN=opzionale
ADMIN_PASSWORD=shogun2025
GUN_RELAY_URL=http://shogun-gun-relay:8765
```

### 3. Holster Relay

**Directory:** `holster-relay/`

**Configurazione CapRover:**
- **App Name:** `shogun-holster-relay`
- **Repository:** URL del tuo repository Git
- **Branch:** `main`
- **Root Directory:** `shogun-relay/holster-relay`
- **Port:** `8766`

**Variabili d'Ambiente:**
```
NODE_ENV=production
HOLSTER_RELAY_HOST=0.0.0.0
HOLSTER_RELAY_PORT=8766
HOLSTER_RELAY_STORAGE=true
HOLSTER_RELAY_STORAGE_PATH=/app/holster-data
HOLSTER_MAX_CONNECTIONS=100
```

### 4. Data API

**Directory:** `data-api/`

**Configurazione CapRover:**
- **App Name:** `shogun-data-api`
- **Repository:** URL del tuo repository Git
- **Branch:** `main`
- **Root Directory:** `shogun-relay/data-api`
- **Port:** `8767`

**Variabili d'Ambiente:**
```
NODE_ENV=production
DATA_API_HOST=0.0.0.0
DATA_API_PORT=8767
GUN_PEER_URL=http://shogun-gun-relay:8765/gun
HOLSTER_PEER_URL=ws://shogun-holster-relay:8766/holster
IPFS_API_URL=http://shogun-ipfs-service:5001
IPFS_GATEWAY_URL=http://shogun-ipfs-service:8080
IPFS_API_TOKEN=opzionale
```

## IPFS Service (Kubo Node)

**IMPORTANTE:** IPFS Kubo richiede un volume persistente per i dati. Su CapRover, puoi:

1. **Opzione A:** Usare un servizio IPFS esterno (consigliato per produzione)
2. **Opzione B:** Deployare IPFS come app CapRover con volume persistente

Se scegli l'opzione B, crea un Dockerfile per IPFS:

```dockerfile
FROM ipfs/kubo:latest

# IPFS esporrà le porte 5001 (API), 8080 (Gateway), 4001 (Swarm)
EXPOSE 5001 8080 4001
```

E configura un volume persistente in CapRover per `/data/ipfs`.

## Ordine di Deploy

Deploy i servizi in questo ordine:

1. **IPFS Service** (se lo deployi su CapRover)
2. **IPFS API** (dipende da IPFS Service)
3. **Holster Relay** (indipendente)
4. **Gun Relay** (dipende da IPFS API e Holster Relay)
5. **Data API** (dipende da Gun Relay e Holster Relay)

## Configurazione DNS/Proxy

Dopo il deploy, configura i domini in CapRover:

- `gun-relay.scobrudot.dev` → `shogun-gun-relay` (porta 8765)
- `ipfs-api.scobrudot.dev` → `shogun-ipfs-api` (porta 8768)
- `holster-relay.scobrudot.dev` → `shogun-holster-relay` (porta 8766)
- `data-api.scobrudot.dev` → `shogun-data-api` (porta 8767)

Oppure usa un unico dominio con path routing (richiede configurazione nginx personalizzata).

## Verifica del Deploy

Dopo il deploy, verifica che ogni servizio risponda:

```bash
# Gun Relay
curl https://gun-relay.scobrudot.dev/health

# IPFS API
curl https://ipfs-api.scobrudot.dev/health

# Holster Relay
curl https://holster-relay.scobrudot.dev/health

# Data API
curl https://data-api.scobrudot.dev/health
```

## Troubleshooting

### Servizi non si connettono tra loro

- Verifica che i nomi delle app in `IPFS_API_URL`, `GUN_RELAY_URL`, etc. corrispondano esattamente ai nomi delle app in CapRover
- CapRover risolve i nomi delle app come hostname nella rete interna Docker
- Usa `http://app-name:port` per la comunicazione interna

### Porte non esposte

- Verifica che la porta nel `captain-definition` corrisponda alla porta esposta nel Dockerfile
- Verifica che la porta sia configurata correttamente in CapRover

### Health check falliscono

- Verifica che gli endpoint `/health` siano implementati in ogni servizio
- Controlla i log in CapRover per vedere gli errori

## Note Importanti

1. **Comunicazione Interna:** I servizi comunicano tra loro usando i nomi delle app CapRover come hostname (es. `http://shogun-gun-relay:8765`)
2. **Comunicazione Esterna:** Gli utenti accedono ai servizi tramite i domini configurati in CapRover
3. **Volumi Persistenti:** Configura volumi persistenti per i dati che devono persistere (es. dati IPFS, dati Holster)
4. **Secrets:** Usa le variabili d'ambiente di CapRover per gestire password e token sensibili


