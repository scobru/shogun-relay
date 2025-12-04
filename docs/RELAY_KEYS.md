# Relay SEA Keypair Configuration

## Panoramica

Il relay usa una coppia di chiavi SEA (Signed Encrypted Authenticated) di GunDB per firmare i dati "frozen" e prevenire errori "Signature did not match".

Esistono **3 modi** per configurare le chiavi:

---

## Opzione 1: Variabile d'Ambiente (JSON) ⭐ CONSIGLIATO

Passa il keypair direttamente come variabile d'ambiente in formato JSON.

### Passi:

1. **Genera le chiavi:**
   ```bash
   node scripts/generate-relay-keys.js
   ```

2. **Copia il JSON generato**

3. **Aggiungi al tuo `.env` o Docker compose:**
   ```bash
   RELAY_SEA_KEYPAIR='{"pub":"...","priv":"...","epub":"...","epriv":"..."}'
   ```

### Esempio Docker Compose:

```yaml
services:
  relay:
    environment:
      - RELAY_SEA_KEYPAIR='{"pub":"abc123...","priv":"def456...","epub":"ghi789...","epriv":"jkl012..."}'
```

### Esempio Docker Run:

```bash
docker run -e RELAY_SEA_KEYPAIR='{"pub":"...","priv":"...","epub":"...","epriv":"..."}' ...
```

---

## Opzione 2: File Path

Salva il keypair in un file JSON e passa il percorso.

### Passi:

1. **Genera e salva le chiavi:**
   ```bash
   node scripts/generate-relay-keys-standalone.js /path/to/relay-keypair.json
   ```

2. **Aggiungi al tuo `.env`:**
   ```bash
   RELAY_SEA_KEYPAIR_PATH=/path/to/relay-keypair.json
   ```

### Esempio Docker Compose (con volume):

```yaml
services:
  relay:
    volumes:
      - ./keys:/app/keys:ro  # Read-only mount
    environment:
      - RELAY_SEA_KEYPAIR_PATH=/app/keys/relay-keypair.json
```

### Esempio Dockerfile (build-time):

Nel `Dockerfile`, puoi generare le chiavi durante il build:

```dockerfile
ARG GENERATE_RELAY_KEYS=false
RUN if [ "$GENERATE_RELAY_KEYS" = "true" ]; then \
      node scripts/generate-relay-keys-standalone.js /app/keys/relay-keypair.json; \
    fi
```

Poi build con:
```bash
docker build --build-arg GENERATE_RELAY_KEYS=true -t my-relay .
```

---

## Opzione 3: Generazione Automatica (Docker Build)

Genera le chiavi automaticamente durante il build del Docker container.

### Passi:

1. **Build con flag:**
   ```bash
   docker build --build-arg GENERATE_RELAY_KEYS=true -t my-relay .
   ```

2. **Le chiavi saranno generate in:**
   ```
   /app/keys/relay-keypair.json
   ```

3. **Mount il file o copialo:**
   ```bash
   # Opzione A: Mount come volume
   docker run -v $(pwd)/keys:/app/keys my-relay
   
   # Opzione B: Copia dal container
   docker cp <container-id>:/app/keys/relay-keypair.json ./keys/
   ```

4. **Usa con RELAY_SEA_KEYPAIR_PATH:**
   ```bash
   docker run -e RELAY_SEA_KEYPAIR_PATH=/app/keys/relay-keypair.json \
              -v $(pwd)/keys:/app/keys my-relay
   ```

---

## Fallback: Username/Password

Se né `RELAY_SEA_KEYPAIR` né `RELAY_SEA_KEYPAIR_PATH` sono configurati, il relay usa il metodo tradizionale username/password:

```bash
RELAY_GUN_USERNAME=shogun-relay
RELAY_GUN_PASSWORD=your_password
```

⚠️ **Nota**: Questo metodo può causare errori "Signature did not match" se il login non funziona correttamente.

---

## Script Disponibili

### 1. `scripts/generate-relay-keys.js`
- Versione completa con ES modules
- Output formattato con istruzioni
- Salva automaticamente in `./keys/relay-keypair.json`

### 2. `scripts/generate-relay-keys-standalone.js`
- Versione CommonJS (compatibile con Dockerfile)
- Output JSON pulito (perfetto per catturare in variabili)
- Può salvare in un percorso personalizzato

**Esempi:**
```bash
# Genera e mostra JSON (per copiare in env var)
node scripts/generate-relay-keys-standalone.js

# Genera e salva in file
node scripts/generate-relay-keys-standalone.js /path/to/keys.json
```

---

## Priorità di Configurazione

Il relay controlla nell'ordine:

1. ✅ `RELAY_SEA_KEYPAIR` (env var JSON) - **PRIMA PRIORITÀ**
2. ✅ `RELAY_SEA_KEYPAIR_PATH` (file path) - **SECONDA PRIORITÀ**
3. ⚠️ `RELAY_GUN_USERNAME` + `RELAY_GUN_PASSWORD` - **FALLBACK**

---

## Sicurezza

### ⚠️ IMPORTANTE:

- **NON** committare le chiavi private (`priv`, `epriv`) in git
- Usa un secret manager per produzione (es. Docker secrets, Kubernetes secrets)
- Le chiavi private danno accesso completo ai dati del relay
- La chiave pubblica (`pub`) può essere condivisa

### Best Practices:

1. **Sviluppo locale:**
   - Usa file locale in `./keys/`
   - Aggiungi `keys/` al `.gitignore`

2. **Produzione:**
   - Usa variabili d'ambiente o secret manager
   - Non salvare in file sul filesystem se possibile
   - Usa Docker secrets o Kubernetes secrets

3. **Docker:**
   - Passa via env var o mount read-only
   - Non hardcodare nel Dockerfile

---

## Verifica Configurazione

Dopo aver configurato le chiavi, controlla i log del relay:

```
✅ Relay GunDB user initialized with SEA keypair
🔑 Relay public key: abc123...
```

Se vedi errori "Signature did not match", significa che:
- Le chiavi non sono configurate correttamente
- O stai usando username/password ma il login è fallito

---

## Risoluzione Problemi

### Errore: "Signature did not match"

**Soluzione:**
1. Verifica che `RELAY_SEA_KEYPAIR` o `RELAY_SEA_KEYPAIR_PATH` siano configurati
2. Controlla che il JSON sia valido
3. Se usi file path, verifica che il file esista e sia leggibile
4. Riconfigura con nuove chiavi se necessario

### Errore: "Failed to parse RELAY_SEA_KEYPAIR"

**Soluzione:**
- Verifica che il JSON sia valido (usa `JSON.parse()` per testare)
- Assicurati di usare apici singoli per wrappare il JSON in env var:
  ```bash
  RELAY_SEA_KEYPAIR='{"pub":"..."}'  # ✅ Corretto
  RELAY_SEA_KEYPAIR="{'pub':'...'}"  # ❌ Errato
  ```

### Le chiavi non vengono usate

**Soluzione:**
- Controlla i log del relay all'avvio
- Verifica che non ci siano errori nel parsing
- Assicurati che le chiavi abbiano tutti i campi: `pub`, `priv`, `epub`, `epriv`

---

## Esempi Completi

### Docker Compose (Produzione)

```yaml
version: '3.8'

services:
  relay:
    image: my-relay:latest
    environment:
      - RELAY_SEA_KEYPAIR_PATH=/run/secrets/relay_keypair
    secrets:
      - relay_keypair
    volumes:
      - ./keys:/run/secrets:ro

secrets:
  relay_keypair:
    file: ./keys/relay-keypair.json
```

### Kubernetes Secret

```bash
# Crea secret
kubectl create secret generic relay-keypair \
  --from-file=keypair=./keys/relay-keypair.json

# Usa nel deployment
env:
  - name: RELAY_SEA_KEYPAIR_PATH
    value: /etc/secrets/keypair
volumeMounts:
  - name: keypair-secret
    mountPath: /etc/secrets
    readOnly: true
volumes:
  - name: keypair-secret
    secret:
      secretName: relay-keypair
```

### CapRover (One-Click Deploy)

Passa come environment variable nella UI di CapRover o nel `docker-compose.yml`:

```yaml
services:
  relay:
    environment:
      - RELAY_SEA_KEYPAIR='{"pub":"...","priv":"...","epub":"...","epriv":"..."}'
```

---

## Riferimenti

- [GunDB SEA Documentation](https://gun.eco/docs/SEA)
- [Provider Guide](./PROVIDER_GUIDE.md)
- [README](../README.md)

