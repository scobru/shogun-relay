# Quick Test Guide - Shogun Relay Fixes

## Test Rapido dei Fix Implementati

### Prerequisiti
- Shogun Relay in esecuzione (Docker o locale)
- Token admin configurato
- Browser con console aperta (F12)

---

## Fix 1: WebUI Kubo Tunnel

### Test Locale (senza tunnel)
```bash
# Apri nel browser
http://localhost:8765/webui?_auth_token=YOUR_ADMIN_PASSWORD
```

### Test con Tunnel (ngrok/cloudflare)
```bash
# Apri nel browser
https://your-tunnel-url.ngrok.io/webui?_auth_token=YOUR_ADMIN_PASSWORD
```

### Verifica Successo
- [ ] La WebUI di Kubo si carica completamente
- [ ] Non ci sono errori nella console del browser
- [ ] Puoi navigare tra le sezioni (Files, Peers, Settings)
- [ ] Nel terminal/log del relay vedi messaggi: `🔧 WebUI proxy request:`

### Problemi Comuni

**"IPFS WebUI unavailable"**
```bash
# Verifica che IPFS sia in esecuzione
curl -X POST http://localhost:5001/api/v0/version

# Se IPFS non risponde, riavvia il container
docker-compose restart
```

**Pagina bianca o errori CORS**
- Pulisci la cache del browser (Ctrl+Shift+R)
- Verifica che il token sia corretto nel URL
- Controlla i log del relay per errori specifici

---

## Fix 2: Nomi File in Pin Manager

### Test Upload
1. **Vai su Upload**
   ```
   http://localhost:8765/upload
   ```

2. **Apri la Console del Browser** (F12 → Console)

3. **Carica un file** (es. `test-document.pdf`)

4. **Verifica i log nella console:**
   ```javascript
   💾 Adding file to system hashes...
   💾 System hash data: {
     hash: "Qm...",
     fileName: "test-document.pdf",
     displayName: "test-document.pdf",
     ...
   }
   ✅ File added to system hashes
   ```

### Test Pin Manager
1. **Vai su Pin Manager**
   ```
   http://localhost:8765/pin-manager
   ```

2. **Clicca "🔄 Aggiorna"**

3. **Verifica i log nella console:**
   ```javascript
   📋 Pin Qm... - Name: "test-document.pdf", Metadata: { ... }
   ```

4. **Verifica visivamente:**
   - [ ] Il nome del file appare nella card del pin
   - [ ] Non vedi "Senza nome" per i file appena caricati
   - [ ] Il nome è corretto (non troncato, non hash)

### Test Completo
```bash
# 1. Carica diversi tipi di file
- test.pdf
- image.png
- document.txt
- video.mp4

# 2. Per ogni file verifica:
- [ ] Upload mostra nome corretto nel messaggio di successo
- [ ] Pin Manager mostra nome corretto nella lista
- [ ] Preview funziona correttamente
- [ ] Download mantiene il nome originale
```

---

## Verifica Logs Server

### Docker
```bash
# Vedi tutti i log
docker-compose logs -f shogun-relay

# Filtra per WebUI
docker-compose logs -f | grep "WebUI"

# Filtra per System Hash
docker-compose logs -f | grep "Saving hash"
```

### Sviluppo Locale
```bash
cd shogun-relay/relay
npm run dev

# I log appaiono direttamente nel terminal
```

### Log Chiave da Cercare

**Upload riuscito:**
```
💾 Saving hash to systemhash node: Qm... for user: admin-upload
💾 Saving hash record: {
  "hash": "Qm...",
  "fileName": "test.pdf",
  "displayName": "test.pdf",
  ...
}
✅ Hash Qm... saved to systemhash node successfully with metadata
```

**WebUI funzionante:**
```
🔧 WebUI root path rewrite: /webui/ -> /webui/
🔧 WebUI proxy request: GET /webui/ -> http://127.0.0.1:5001/webui/
🔧 WebUI proxy response: 200 for /webui/
```

---

## Test Avanzati

### Test 1: File Cifrati
1. Upload file con checkbox "Encrypt" abilitato
2. Verifica in Pin Manager:
   - [ ] Nome file termina con `.enc`
   - [ ] Metadata `isEncrypted: true`
   - [ ] Preview richiede token

### Test 2: File Multipli
1. Upload 3-5 file in rapida successione
2. Verifica in Pin Manager:
   - [ ] Tutti i file appaiono con nome corretto
   - [ ] Nessun nome duplicato o mancante
   - [ ] L'ordine è per data di upload (più recenti prima)

### Test 3: Batch Operations
1. Upload alcuni file
2. In Pin Manager, usa "Unpin All Files"
3. Con "Preserva file di sistema" ATTIVO:
   - [ ] I file caricati NON vengono rimossi
4. Ricarica i file e riprova con checkbox DISATTIVO:
   - [ ] Tutti i file vengono rimossi

---

## Rollback (se necessario)

Se i fix causano problemi:

```bash
# 1. Torna alla versione precedente
cd shogun-relay
git checkout HEAD~1 relay/src/routes/ipfs.js
git checkout HEAD~1 relay/src/routes/uploads.js
git checkout HEAD~1 relay/src/public/upload.html
git checkout HEAD~1 relay/src/public/pin-manager.html

# 2. Riavvia il servizio
docker-compose restart
# oppure
npm run dev
```

---

## Riporta Problemi

Se trovi problemi, raccogli queste informazioni:

1. **Log del server** (ultimi 50 righe)
   ```bash
   docker-compose logs --tail=50 shogun-relay
   ```

2. **Console del browser** (screenshot o copia/incolla)

3. **Dettagli dell'ambiente:**
   - OS (Windows/Linux/Mac)
   - Browser e versione
   - Tipo di deployment (Docker/Locale)
   - Con/senza tunnel

4. **File di test usato:**
   - Nome file
   - Dimensione
   - Tipo (PDF, immagine, video, etc.)

---

## Successo!

Se tutti i test passano:
- ✅ WebUI Kubo accessibile tramite tunnel
- ✅ Nomi file corretti in Pin Manager
- ✅ Upload e gestione file funzionanti
- ✅ Nessun errore nei log

**Congratulazioni! I fix sono stati applicati con successo!**

---

*Ultimo aggiornamento: 2025-11-14*

