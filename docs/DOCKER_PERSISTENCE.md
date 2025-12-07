# Docker Persistence Guide

Questo documento spiega come configurare la persistenza dei dati per evitare la perdita di informazioni ad ogni nuovo deploy Docker.

## Problema

Quando un container Docker viene ricreato (ad esempio durante un nuovo deploy), tutti i dati non persistenti vengono persi. Questo include:
- **Dati GunDB**: Subscription, reputation, frozen data, ecc.
- **Dati IPFS**: Repository, pins, blocks
- **Chiavi del relay**: SEA keypair del relay user
- **Dati Holster**: Stato del relay Holster

## Soluzione: Volumi Docker

I volumi Docker permettono di salvare i dati al di fuori del container, rendendoli persistenti tra i deploy.

## Configurazione con docker-compose

Il file `docker-compose.yml` è già configurato con i volumi necessari:

```yaml
volumes:
  # IPFS repository
  - ipfs-data:/data/ipfs
  
  # GunDB data (SQLite o radata)
  - relay-data:/app/relay/data
  
  # Relay keys (SEA keypair)
  - relay-keys:/app/keys
  
  # Holster data
  - holster-data:/app/relay/holster-data
```

### Verifica dei volumi

Per verificare che i volumi siano configurati correttamente:

```bash
docker-compose ps
docker volume ls | grep shogun
```

## Configurazione per CapRover

Se stai usando CapRover per il deploy, devi configurare i volumi persistenti nell'interfaccia web o nel file `captain-definition`:

### Opzione 1: Interfaccia Web CapRover

1. Vai su **Apps** → **shogun-relay** → **Volumes**
2. Aggiungi i seguenti volumi persistenti:

| Container Path | Volume Name | Description |
|----------------|-------------|-------------|
| `/data/ipfs` | `shogun-ipfs-data` | IPFS repository |
| `/app/relay/data` | `shogun-relay-data` | GunDB data |
| `/app/keys` | `shogun-relay-keys` | Relay keys |
| `/app/relay/holster-data` | `shogun-holster-data` | Holster data |

### Opzione 2: captain-definition

Crea un file `captain-definition` nella root del progetto:

```json
{
  "schemaVersion": 2,
  "dockerfilePath": "./Dockerfile",
  "volumes": [
    {
      "containerPath": "/data/ipfs",
      "volumeName": "shogun-ipfs-data"
    },
    {
      "containerPath": "/app/relay/data",
      "volumeName": "shogun-relay-data"
    },
    {
      "containerPath": "/app/keys",
      "volumeName": "shogun-relay-keys"
    },
    {
      "containerPath": "/app/relay/holster-data",
      "volumeName": "shogun-holster-data"
    }
  ]
}
```

### Variabili d'ambiente importanti

Assicurati che queste variabili d'ambiente siano configurate in CapRover:

```bash
# Data directory (deve corrispondere al volume)
DATA_DIR=/app/relay/data

# Relay keys path (deve corrispondere al volume)
RELAY_SEA_KEYPAIR_PATH=/app/keys/relay-keypair.json

# Holster storage path (deve corrispondere al volume)
HOLSTER_RELAY_STORAGE_PATH=/app/relay/holster-data

# IPFS path (deve corrispondere al volume)
IPFS_PATH=/data/ipfs
```

## Configurazione per Docker Swarm / Kubernetes

### Docker Swarm

```yaml
version: '3.8'
services:
  shogun-relay:
    image: your-registry/shogun-relay:latest
    volumes:
      - type: volume
        source: shogun-ipfs-data
        target: /data/ipfs
      - type: volume
        source: shogun-relay-data
        target: /app/relay/data
      - type: volume
        source: shogun-relay-keys
        target: /app/keys
      - type: volume
        source: shogun-holster-data
        target: /app/relay/holster-data

volumes:
  shogun-ipfs-data:
    driver: local
  shogun-relay-data:
    driver: local
  shogun-relay-keys:
    driver: local
  shogun-holster-data:
    driver: local
```

### Kubernetes

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shogun-ipfs-data
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 50Gi
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: shogun-relay-data
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
---
# ... altri PVC per keys e holster-data
```

## Backup e Restore

### Backup

Per creare un backup dei dati:

```bash
# Backup IPFS
docker run --rm -v shogun-ipfs-data:/data -v $(pwd):/backup alpine tar czf /backup/ipfs-backup.tar.gz /data

# Backup GunDB
docker run --rm -v shogun-relay-data:/data -v $(pwd):/backup alpine tar czf /backup/relay-data-backup.tar.gz /data

# Backup keys
docker run --rm -v shogun-relay-keys:/data -v $(pwd):/backup alpine tar czf /backup/keys-backup.tar.gz /data
```

### Restore

Per ripristinare un backup:

```bash
# Restore IPFS
docker run --rm -v shogun-ipfs-data:/data -v $(pwd):/backup alpine tar xzf /backup/ipfs-backup.tar.gz -C /

# Restore GunDB
docker run --rm -v shogun-relay-data:/data -v $(pwd):/backup alpine tar xzf /backup/relay-data-backup.tar.gz -C /

# Restore keys
docker run --rm -v shogun-relay-keys:/data -v $(pwd):/backup alpine tar xzf /backup/keys-backup.tar.gz -C /
```

## Verifica della Persistenza

Dopo un deploy, verifica che i dati siano persistenti:

1. **Verifica GunDB**: Controlla che le subscription e i dati siano ancora presenti
2. **Verifica IPFS**: Controlla che i pins siano ancora presenti
3. **Verifica keys**: Controlla che il relay user funzioni ancora (nessun errore "Signature did not match")

### Script di Verifica Automatica

Puoi usare lo script `verify-volumes.sh` per verificare automaticamente che tutti i volumi siano montati correttamente:

```bash
# Esegui lo script all'interno del container
docker exec shogun-relay-stack /app/docker/verify-volumes.sh

# Oppure eseguilo durante l'avvio aggiungendolo all'entrypoint
```

Lo script verifica:
- ✅ Che i volumi siano montati (non solo directory nel container)
- ✅ Che IPFS sia inizializzato correttamente
- ✅ Che i dati critici esistano
- ⚠️  Avvisa se ci sono problemi che potrebbero causare perdita di dati

## Troubleshooting

### Problema: I dati vengono persi ad ogni deploy

**Causa**: I volumi non sono configurati correttamente o non sono montati.

**Soluzione**:
1. Verifica che i volumi siano definiti in `docker-compose.yml` o nella configurazione del deploy
2. Verifica che i percorsi nel container corrispondano alle variabili d'ambiente (`DATA_DIR`, `RELAY_SEA_KEYPAIR_PATH`, ecc.)
3. Controlla i log del container per errori di permessi

### Problema: "Signature did not match" dopo un deploy

**Causa**: Il relay user è stato ricreato con un nuovo keypair.

**Soluzione**:
1. Assicurati che `RELAY_SEA_KEYPAIR_PATH` punti a un file nel volume persistente
2. Verifica che il volume `relay-keys` sia montato correttamente
3. Se il keypair è stato perso, devi rigenerarlo e aggiornare tutti i dati criptati

### Problema: IPFS non trova i pins dopo un deploy / Perdo i pins IPFS ad ogni deploy

**Causa**: Il repository IPFS non è persistente o viene reinizializzato.

**Soluzione**:
1. **VERIFICA I VOLUMI**: Assicurati che il volume `ipfs-data` sia montato correttamente:
   ```bash
   # Verifica i volumi esistenti
   docker volume ls | grep ipfs
   
   # Verifica che il volume sia montato nel container
   docker exec shogun-relay-stack ls -la /data/ipfs
   ```

2. **USA IL COMANDO CORRETTO PER IL DEPLOY**:
   ```bash
   # ✅ CORRETTO: Preserva i volumi
   docker-compose up -d --build
   
   # ❌ SBAGLIATO: Rimuove i volumi e perde i dati!
   docker-compose down -v
   docker-compose up -d --build
   ```

3. **VERIFICA LA CONFIGURAZIONE**:
   - Verifica che `IPFS_PATH=/data/ipfs` sia configurato nelle variabili d'ambiente
   - Verifica che il volume sia definito in `docker-compose.yml`:
     ```yaml
     volumes:
       - ipfs-data:/data/ipfs
     ```

4. **PER CAPROVER**: Configura i volumi persistenti nell'interfaccia web:
   - Vai su **Apps** → **shogun-relay** → **Volumes**
   - Aggiungi volume persistente: `/data/ipfs` → `shogun-ipfs-data`

5. **VERIFICA DOPO IL DEPLOY**:
   ```bash
   # Controlla che IPFS sia inizializzato e non reinizializzato
   docker exec shogun-relay-stack cat /data/ipfs/config | grep -i version
   
   # Controlla i pins esistenti
   docker exec shogun-relay-stack ipfs pin ls --type=recursive
   ```

6. **SE I PINS SONO STATI PERSI**: 
   - Se hai un backup, ripristinalo (vedi sezione Backup e Restore)
   - Se non hai backup, i pins sono persi e devi ripinare i contenuti

## Come Fare il Deploy Senza Perdere i Dati

### ✅ Procedura Corretta per il Deploy

```bash
# 1. Ferma il container (preserva i volumi)
docker-compose stop

# 2. Ricostruisci l'immagine (opzionale, solo se hai cambiato il codice)
docker-compose build

# 3. Riavvia il container
docker-compose up -d

# Oppure tutto in uno (raccomandato)
docker-compose up -d --build
```

### ❌ Cosa NON Fare

```bash
# ❌ NON usare -v (rimuove i volumi e perde TUTTI i dati!)
docker-compose down -v

# ❌ NON rimuovere manualmente i volumi
docker volume rm shogun-relay_ipfs-data

# ❌ NON usare docker-compose rm senza verificare i volumi
docker-compose rm -f
```

### 🔍 Verifica Prima del Deploy

Prima di fare un deploy, verifica che i volumi esistano:

```bash
# Lista tutti i volumi
docker volume ls

# Verifica la dimensione dei volumi (per assicurarti che contengano dati)
docker system df -v | grep shogun
```

### 🔄 Deploy con CapRover

Se usi CapRover, assicurati che i volumi persistenti siano configurati nell'interfaccia web **PRIMA** di fare il deploy. Una volta configurati, i volumi vengono preservati automaticamente durante i deploy successivi.

## Best Practices

1. **Backup regolari**: Crea backup automatici dei volumi critici (specialmente prima di un deploy importante)
2. **Monitoraggio**: Monitora lo spazio utilizzato dai volumi
3. **Test**: Testa i backup e restore in un ambiente di staging prima di usarli in produzione
4. **Documentazione**: Documenta dove sono salvati i backup e come ripristinarli
5. **Verifica post-deploy**: Dopo ogni deploy, verifica che i pins IPFS siano ancora presenti

## Note Importanti

- **Non condividere i volumi tra container**: Ogni istanza del relay deve avere i propri volumi
- **Permessi**: Assicurati che i permessi dei volumi siano corretti (il container deve poter scrivere)
- **Spazio**: Monitora lo spazio disponibile sui volumi, specialmente per IPFS che può crescere rapidamente

