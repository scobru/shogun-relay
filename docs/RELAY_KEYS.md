# Relay SEA Keypair Configuration

## Overview

The relay uses a GunDB SEA (Signed Encrypted Authenticated) key pair to sign "frozen" data and prevent "Signature did not match" errors.

There are **3 ways** to configure the keys:

---

## Option 1: Environment Variable (JSON) ⭐ RECOMMENDED

Pass the keypair directly as an environment variable in JSON format.

### Steps:

1. **Generate the keys:**
   ```bash
   node scripts/generate-relay-keys.js
   ```

2. **Copy the generated JSON**

3. **Add to your `.env` or Docker compose:**
   ```bash
   RELAY_SEA_KEYPAIR='{"pub":"...","priv":"...","epub":"...","epriv":"..."}'
   ```

### Docker Compose Example:

```yaml
services:
  relay:
    environment:
      - RELAY_SEA_KEYPAIR='{"pub":"abc123...","priv":"def456...","epub":"ghi789...","epriv":"jkl012..."}'
```

### Docker Run Example:

```bash
docker run -e RELAY_SEA_KEYPAIR='{"pub":"...","priv":"...","epub":"...","epriv":"..."}' ...
```

---

## Option 2: File Path

Save the keypair in a JSON file and pass the path.

### Steps:

1. **Generate and save the keys:**
   ```bash
   node scripts/generate-relay-keys-standalone.cjs /path/to/relay-keypair.json
   ```

2. **Add to your `.env`:**
   ```bash
   RELAY_SEA_KEYPAIR_PATH=/path/to/relay-keypair.json
   ```

### Docker Compose Example (with volume):

```yaml
services:
  relay:
    volumes:
      - ./keys:/app/keys:ro  # Read-only mount
    environment:
      - RELAY_SEA_KEYPAIR_PATH=/app/keys/relay-keypair.json
```

### Dockerfile Example (build-time):

In the `Dockerfile`, you can generate keys during build:

```dockerfile
ARG GENERATE_RELAY_KEYS=false
RUN if [ "$GENERATE_RELAY_KEYS" = "true" ]; then \
      node scripts/generate-relay-keys-standalone.cjs /app/keys/relay-keypair.json; \
    fi
```

Then build with:
```bash
docker build --build-arg GENERATE_RELAY_KEYS=true -t my-relay .
```

---

## Option 3: Automatic Generation (Docker Build)

Generate keys automatically during Docker container build.

### Steps:

1. **Build with flag:**
   ```bash
   docker build --build-arg GENERATE_RELAY_KEYS=true -t my-relay .
   ```

2. **Keys will be generated in:**
   ```
   /app/keys/relay-keypair.json
   ```

3. **Mount the file or copy it:**
   ```bash
   # Option A: Mount as volume
   docker run -v $(pwd)/keys:/app/keys my-relay
   
   # Option B: Copy from container
   docker cp <container-id>:/app/keys/relay-keypair.json ./keys/
   ```

4. **Use with RELAY_SEA_KEYPAIR_PATH:**
   ```bash
   docker run -e RELAY_SEA_KEYPAIR_PATH=/app/keys/relay-keypair.json \
              -v $(pwd)/keys:/app/keys my-relay
   ```

---

## Fallback: Username/Password

If neither `RELAY_SEA_KEYPAIR` nor `RELAY_SEA_KEYPAIR_PATH` are configured, the relay uses the traditional username/password method:

```bash
RELAY_GUN_USERNAME=shogun-relay
RELAY_GUN_PASSWORD=your_password
```

⚠️ **Note**: This method can cause "Signature did not match" errors if login doesn't work correctly.

---

## Available Scripts

### 1. `scripts/generate-relay-keys.js`
- Full version with ES modules
- Formatted output with instructions
- Automatically saves to `./keys/relay-keypair.json`

### 2. `scripts/generate-relay-keys-standalone.cjs`
- CommonJS version (compatible with Dockerfile, uses .cjs extension)
- Clean JSON output (perfect for capturing in variables)
- Can save to a custom path

**Examples:**
```bash
# Generate and show JSON (to copy to env var)
node scripts/generate-relay-keys-standalone.cjs

# Generate and save to file
node scripts/generate-relay-keys-standalone.cjs /path/to/keys.json
```

---

## Configuration Priority

The relay checks in this order:

1. ✅ `RELAY_SEA_KEYPAIR` (env var JSON) - **FIRST PRIORITY**
2. ✅ `RELAY_SEA_KEYPAIR_PATH` (file path) - **SECOND PRIORITY**
3. ⚠️ `RELAY_GUN_USERNAME` + `RELAY_GUN_PASSWORD` - **FALLBACK**

---

## Security

### ⚠️ IMPORTANT:

- **DO NOT** commit private keys (`priv`, `epriv`) to git
- Use a secret manager for production (e.g., Docker secrets, Kubernetes secrets)
- Private keys give full access to relay data
- The public key (`pub`) can be shared

### Best Practices:

1. **Local Development:**
   - Use local file in `./keys/`
   - Add `keys/` to `.gitignore`

2. **Production:**
   - Use environment variables or secret manager
   - Don't save to filesystem if possible
   - Use Docker secrets or Kubernetes secrets

3. **Docker:**
   - Pass via env var or mount read-only
   - Don't hardcode in Dockerfile

---

## Verify Configuration

After configuring keys, check relay logs:

```
✅ Relay GunDB user initialized with SEA keypair
🔑 Relay public key: abc123...
```

If you see "Signature did not match" errors, it means:
- Keys are not configured correctly
- Or you're using username/password but login failed

---

## Troubleshooting

### Error: "Signature did not match"

**Solution:**
1. Verify that `RELAY_SEA_KEYPAIR` or `RELAY_SEA_KEYPAIR_PATH` are configured
2. Check that JSON is valid
3. If using file path, verify file exists and is readable
4. Reconfigure with new keys if necessary

### Error: "Failed to parse RELAY_SEA_KEYPAIR"

**Solution:**
- Verify JSON is valid (use `JSON.parse()` to test)
- Make sure to use single quotes to wrap JSON in env var:
  ```bash
  RELAY_SEA_KEYPAIR='{"pub":"..."}'  # ✅ Correct
  RELAY_SEA_KEYPAIR="{'pub':'...'}"  # ❌ Wrong
  ```

### Keys are not being used

**Solution:**
- Check relay logs on startup
- Verify there are no parsing errors
- Make sure keys have all fields: `pub`, `priv`, `epub`, `epriv`

---

## Complete Examples

### Docker Compose (Production)

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
# Create secret
kubectl create secret generic relay-keypair \
  --from-file=keypair=./keys/relay-keypair.json

# Use in deployment
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

Pass as environment variable in CapRover UI or in `docker-compose.yml`:

```yaml
services:
  relay:
    environment:
      - RELAY_SEA_KEYPAIR='{"pub":"...","priv":"...","epub":"...","epriv":"..."}'
```

---

## References

- [GunDB SEA Documentation](https://gun.eco/docs/SEA)
- [Provider Guide](./PROVIDER_GUIDE.md)
- [README](../README.md)
