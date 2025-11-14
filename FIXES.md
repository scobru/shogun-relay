# Fix Log - Shogun Relay

## Data: 2025-11-14

### Modifiche Implementate

#### 1. Rimozione Proxy WebUI Kubo (Sicurezza)

**Motivo:** Il proxy per `/webui` è stato rimosso per ragioni di sicurezza. Esporre la WebUI di Kubo attraverso il relay può creare vulnerabilità.

**Soluzione:**
- Rimosso completamente il proxy `/webui` da `relay/src/routes/ipfs.js`
- Rimosso il link dalla pagina admin
- Aggiunto commento nel codice per indicare la rimozione

**Accesso alternativo:**
Se necessario, è possibile accedere alla WebUI di Kubo direttamente:
- Locale: `http://localhost:5001/webui`
- Via SSH tunnel: `ssh -L 5001:localhost:5001 user@server`

---

#### 2. Inconsistenza tra Upload e Pin Manager per i nomi dei file

**Problema:** I file caricati tramite `/upload` non mostravano il nome corretto nel Pin Manager (`/pin-manager`).

**Causa:**
- I metadati salvati nel nodo `systemhash` non includevano tutti i campi necessari
- Il campo `displayName` non era sempre popolato
- Mancava il campo `uploadedAt` per la cronologia
- Il Pin Manager non tentava tutti i campi possibili per recuperare il nome

**Soluzione implementata:**

##### A. Frontend Upload (`relay/src/public/upload.html`)

1. Aggiunto campo `displayName` esplicito nei metadati
2. Migliorato l'oggetto `systemHashData` con tutti i campi necessari:
   ```javascript
   {
     hash: hash,
     userAddress: 'admin-upload',
     timestamp: Date.now(),
     fileName: uploadFileName,
     displayName: uploadFileName,  // Aggiunto
     originalName: file.name,
     fileSize: fileSize,
     isEncrypted: isEncrypted,
     contentType: contentType,
     relayUrl: finalIpfsUrl,
     uploadedAt: Date.now()  // Aggiunto
   }
   ```
3. Aggiunto log di debug per tracciare i dati salvati

##### B. Backend Upload Handler (`relay/src/routes/uploads.js`)

1. Aggiunto campo `uploadedAt` al record hash:
   ```javascript
   const now = Date.now();
   const hashRecord = {
     hash: hash,
     userAddress: userAddress,
     timestamp: timestamp || now,
     uploadedAt: timestamp || now,  // Aggiunto
     savedAt: new Date().toISOString(),
     // ... altri campi
   };
   ```

2. Aggiunto log dettagliato del record salvato:
   ```javascript
   console.log(`💾 Saving hash record:`, JSON.stringify(hashRecord, null, 2));
   ```

3. Migliorato il messaggio di conferma del salvataggio

##### C. Frontend Pin Manager (`relay/src/public/pin-manager.html`)

1. Ampliato il fallback per il nome del file:
   ```javascript
   const displayName =
     metadata.displayName ||      // Primo tentativo
     metadata.fileName ||         // Secondo tentativo
     metadata.originalName ||     // Terzo tentativo
     metadata.name ||             // Quarto tentativo
     info.Name ||                 // Quinto tentativo
     info.Metadata?.name ||       // Sesto tentativo
     '';                          // Fallback vuoto
   ```

2. Aggiunto log di debug per ogni pin caricato:
   ```javascript
   console.log(`📋 Pin ${cid.substring(0, 12)}... - Name: "${displayName}", Metadata:`, metadata);
   ```

3. Migliorato il timestamp per includere `uploadedAt` come fallback

**Test:**
1. Carica un file tramite `/upload`
2. Verifica nel browser console i log:
   - `💾 System hash data:` - deve mostrare fileName e displayName
   - `✅ File added to system hashes` - conferma del salvataggio
3. Vai su `/pin-manager` e verifica:
   - Il nome del file appare correttamente nella card del pin
   - Il log `📋 Pin ...` mostra i metadati completi

---

## Come Applicare i Fix

### Metodo 1: Docker (Raccomandato)

```bash
# Rebuild del container
cd shogun-relay
docker-compose down
docker-compose build --no-cache
docker-compose up -d

# Verifica i log
docker-compose logs -f shogun-relay
```

### Metodo 2: Sviluppo Locale

```bash
cd shogun-relay/relay

# Installa dipendenze (se necessario)
npm install

# Riavvia il server
npm run dev
```

---

## Verifiche Post-Fix

### WebUI Tunnel
- [ ] Accedi a `https://your-tunnel/webui?_auth_token=YOUR_PASSWORD`
- [ ] Verifica che la WebUI di Kubo si carichi correttamente
- [ ] Controlla i log del server per i messaggi `🔧 WebUI...`
- [ ] Testa la navigazione nelle sezioni della WebUI (Files, Peers, Settings)

### Upload & Pin Manager
- [ ] Carica un file via `/upload`
- [ ] Apri la console del browser e verifica i log di sistema hash
- [ ] Vai su `/pin-manager`
- [ ] Verifica che il file appena caricato mostri il nome corretto
- [ ] Controlla i log del Pin Manager per i metadati completi

---

## Note Tecniche

### Struttura dati GunDB

Il nodo `systemhash` ora ha questa struttura:

```
shogun
  └── systemhash
       └── <IPFS_HASH>
            ├── hash: string
            ├── userAddress: string
            ├── timestamp: number
            ├── uploadedAt: number
            ├── savedAt: string (ISO)
            ├── fileName: string
            ├── displayName: string
            ├── originalName: string
            ├── fileSize: number
            ├── isEncrypted: boolean
            ├── contentType: string
            └── relayUrl: string
```

### Log Chiave

- `🔧 WebUI...` - Messaggi del proxy WebUI
- `💾 Saving hash...` - Salvataggio metadati file
- `📋 Pin ...` - Caricamento pin nel Pin Manager
- `✅ Hash ... saved...` - Conferma salvataggio nel sistema

---

## Troubleshooting

### WebUI non si carica

1. Verifica che IPFS sia in esecuzione:
   ```bash
   curl http://localhost:5001/api/v0/version -X POST
   ```

2. Controlla i log del proxy:
   ```bash
   docker-compose logs -f | grep "WebUI"
   ```

3. Verifica il token admin nel URL:
   ```
   /webui?_auth_token=YOUR_PASSWORD
   ```

### Nomi dei file non appaiono

1. Verifica i log di upload:
   - Cerca `💾 System hash data:` nella console del browser
   - Verifica che `fileName` e `displayName` siano presenti

2. Verifica i log del Pin Manager:
   - Cerca `📋 Pin ...` nella console del browser
   - Controlla che i metadati siano popolati

3. Forza un refresh dei pin:
   - Clicca sul bottone "🔄 Aggiorna" nel Pin Manager
   - Verifica i nuovi log

4. Verifica il database GunDB:
   - Accedi al Visual Graph Explorer (`/visualGraph`)
   - Naviga a `shogun > systemhash > <HASH>`
   - Verifica che i metadati siano presenti

---

## Prossimi Miglioramenti

- [ ] Aggiungere cache dei metadati nel Pin Manager
- [ ] Implementare ricerca per nome file
- [ ] Aggiungere ordinamento per data/nome
- [ ] Implementare modifica del nome file
- [ ] Aggiungere bulk operations per i metadati

---

## Autore

Shogun Team - 2025-11-14

