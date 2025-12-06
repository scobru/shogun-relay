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

### Problema: IPFS non trova i pins dopo un deploy

**Causa**: Il repository IPFS non è persistente.

**Soluzione**:
1. Verifica che il volume `ipfs-data` sia montato su `/data/ipfs`
2. Verifica che `IPFS_PATH=/data/ipfs` sia configurato
3. Controlla che IPFS non stia usando un repository temporaneo

## Best Practices

1. **Backup regolari**: Crea backup automatici dei volumi critici
2. **Monitoraggio**: Monitora lo spazio utilizzato dai volumi
3. **Test**: Testa i backup e restore in un ambiente di staging prima di usarli in produzione
4. **Documentazione**: Documenta dove sono salvati i backup e come ripristinarli

## Note Importanti

- **Non condividere i volumi tra container**: Ogni istanza del relay deve avere i propri volumi
- **Permessi**: Assicurati che i permessi dei volumi siano corretti (il container deve poter scrivere)
- **Spazio**: Monitora lo spazio disponibile sui volumi, specialmente per IPFS che può crescere rapidamente

