# Shogun Relay Authentication System

Il relay Shogun implementa un sistema di autenticazione a più livelli per garantire la sicurezza dell'accesso alle API.

## Livelli di Autenticazione

### 1. HTTP Basic Authentication (Opzionale)
Il primo livello di sicurezza, se abilitato, richiede credenziali HTTP Basic Auth standard.

**Configurazione:**
```json
{
  "BASIC_AUTH_USER": "admin",
  "BASIC_AUTH_PASSWORD": "secure-password-here"
}
```

**Variabili d'ambiente alternative:**
```bash
BASIC_AUTH_USER=admin
BASIC_AUTH_PASSWORD=secure-password-here
```

**Utilizzo con curl:**
```bash
curl -u admin:secure-password-here \
  -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/status
```

### 2. Token Authentication (Sempre Attivo)
Il secondo livello richiede sempre un token valido.

**Token di Sistema:**
- Configurato via `SECRET_TOKEN` nel config.json
- Fornisce accesso completo alle API admin
- Sempre richiesto dopo Basic Auth (se abilitato)

**Modalità di invio del token:**
1. Header Authorization Bearer: `Authorization: Bearer your-token`
2. Header token: `token: your-token`
3. Query parameter: `?token=your-token`
4. Body parameter: `{"token": "your-token"}`

### 3. Blockchain Verification (Per Utenti)
Il terzo livello verifica le chiavi pubbliche sulla blockchain per utenti specifici.

**Abilitazione:**
```json
{
  "ONCHAIN_MEMBERSHIP_ENABLED": true,
  "RELAY_REGISTRY_CONTRACT": "0x...",
  "ETHEREUM_PROVIDER_URL": "https://sepolia.infura.io/v3/..."
}
```

## Flusso di Autenticazione

```
1. [HTTP Basic Auth] → Se configurato, verifica username/password
   ↓ (se passa)
2. [Token Auth] → Verifica SECRET_TOKEN o token utente
   ↓ (se passa)  
3. [Accesso API] → Richiesta elaborata con successo
```

## Endpoint di Test

### Verifica Status Autenticazione
```bash
# Solo con token (se Basic Auth disabilitato)
curl -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/auth/status

# Con Basic Auth + Token (se Basic Auth abilitato)
curl -u admin:password \
  -H "Authorization: Bearer your-token" \
  http://localhost:8765/api/auth/status
```

**Risposta:**
```json
{
  "success": true,
  "authentication": {
    "basicAuth": {
      "enabled": true,
      "description": "HTTP Basic Auth is enabled"
    },
    "tokenAuth": {
      "enabled": true,
      "description": "Token-based authentication is always enabled"
    },
    "layers": ["HTTP Basic Auth", "Token Authentication"]
  },
  "message": "Authentication status retrieved successfully"
}
```

### Verifica On-Chain
```bash
curl -u admin:password \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"pubKey": "~public-key-here"}' \
  http://localhost:8765/api/auth/verify-onchain
```

## Configurazione Sicurezza

### Raccomandazioni
1. **Sempre usare HTTPS in produzione**
2. **Password Basic Auth complesse** (min. 16 caratteri)
3. **SECRET_TOKEN crittograficamente sicuro** (min. 32 caratteri)
4. **Rotazione periodica delle credenziali**

### Esempio Configurazione Produzione
```json
{
  "BASIC_AUTH_USER": "relay-admin-2024",
  "BASIC_AUTH_PASSWORD": "Kx9#mP2$vL8@nR5%tQ1!zW4^uI7&cE3*",
  "SECRET_TOKEN": "sha256-generated-token-here-64-chars-minimum",
  "HTTPS_PORT": 8443,
  "PRIVKEY_PATH": "./certs/privkey.pem",
  "CERT_PATH": "./certs/cert.pem"
}
```

## Troubleshooting

### Basic Auth non funziona
1. Verificare che `BASIC_AUTH_USER` e `BASIC_AUTH_PASSWORD` siano configurati
2. Controllare i log per messaggi "[AuthenticationManager] HTTP Basic Auth layer enabled"
3. Testare con endpoint `/api/auth/status`

### Token non accettato
1. Verificare che il token corrisponda esattamente al `SECRET_TOKEN`
2. Controllare che il token sia passato correttamente (header/query/body)
3. Verificare che non ci siano spazi o caratteri nascosti

### Errori On-Chain
1. Verificare che `ONCHAIN_MEMBERSHIP_ENABLED` sia `true`
2. Controllare la configurazione dei contratti
3. Verificare che il provider Ethereum sia raggiungibile 