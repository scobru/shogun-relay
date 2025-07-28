# Shogun Relay Routes - Struttura Modulare

Questo documento descrive la nuova struttura modulare delle routes del Shogun Relay Server.

## Panoramica

Il file `index.js` principale è stato refactorizzato per utilizzare un sistema modulare di routes, rendendo il codice più organizzato e manutenibile. Il file originale (5122 righe) è stato ridotto significativamente e le routes sono state organizzate in moduli separati.

## Struttura delle Routes

### File Principale
- `index.js` - File principale del server (versione pulita e modulare)

### Moduli delle Routes

#### 1. `routes/index.js`
- **Funzione**: Router principale che organizza tutti i moduli
- **Responsabilità**: 
  - Importa e configura tutti i moduli delle routes
  - Applica rate limiting generale
  - Gestisce le route legacy per compatibilità
  - Fornisce health check e gestione errori 404

#### 2. `routes/contracts.js`
- **Endpoint**: `/api/contracts/*`
- **Responsabilità**: Gestione dei contratti smart contract
- **Routes**:
  - `GET /config` - Configurazione completa dei contratti
  - `GET /:contractName` - Dettagli di un contratto specifico
  - `GET /:contractName/abi` - ABI di un contratto
  - `GET /:contractName/address` - Indirizzo di un contratto
  - `GET /` - Lista di tutti i contratti disponibili

#### 3. `routes/uploads.js`
- **Endpoint**: `/api/user-uploads/*`
- **Responsabilità**: Gestione degli upload degli utenti
- **Routes**:
  - `GET /:identifier` - Recupera upload di un utente
  - `DELETE /:identifier/:hash` - Elimina un upload specifico
  - `GET /debug/:identifier` - Debug del contenuto Gun di un utente

#### 4. `routes/ipfs.js`
- **Endpoint**: `/api/ipfs/*`
- **Responsabilità**: Gestione delle operazioni IPFS
- **Routes**:
  - `POST /api/:endpoint` - Proxy per API IPFS
  - `POST /upload` - Upload file su IPFS
  - `GET /status` - Status del servizio IPFS
  - `GET /content/:cid` - Recupera contenuto IPFS
  - `GET /content-json/:cid` - Recupera contenuto JSON da IPFS
  - `POST /pins/add` - Aggiunge pin IPFS
  - `POST /pins/rm` - Rimuove pin IPFS
  - `POST /pins/ls` - Lista pin IPFS
  - `POST /repo/gc` - Garbage collection IPFS

#### 5. `routes/system.js`
- **Endpoint**: `/api/system/*`
- **Responsabilità**: Operazioni di sistema e debug
- **Routes**:
  - `GET /health` - Health check del server
  - `GET /relay-info` - Informazioni del relay
  - `GET /contract-config` - Configurazione contratti
  - `GET /contract-status` - Status dei contratti
  - `GET /user-subscription/:userAddress` - Sottoscrizione utente
  - `GET /subscription-status/:identifier` - Status sottoscrizione
  - `GET /user-subscription-details/:userAddress` - Dettagli sottoscrizione
  - `GET /alldata` - Tutti i dati (richiede autenticazione)
  - `GET /stats` - Statistiche del sistema
  - `POST /gc/trigger` - Trigger garbage collection
  - `POST /stats/update` - Aggiorna statistiche
  - `GET /stats.json` - Statistiche in formato JSON
  - `POST /derive` - Operazione derive
  - `GET /node/*` - Operazioni sui nodi Gun
  - `POST /node/*` - Operazioni sui nodi Gun
  - `DELETE /node/*` - Operazioni sui nodi Gun
  - `GET /peers` - Lista peers
  - `POST /peers/add` - Aggiungi peer

#### 6. `routes/notes.js`
- **Endpoint**: `/api/notes/*`
- **Responsabilità**: Gestione delle note degli utenti
- **Routes**:
  - `GET /` - Recupera tutte le note
  - `POST /` - Crea una nuova nota
  - `DELETE /` - Elimina una nota
  - `PUT /:id` - Aggiorna una nota
  - `GET /:id` - Recupera una nota specifica

#### 7. `routes/debug.js`
- **Endpoint**: `/api/debug/*`
- **Responsabilità**: Operazioni di debug e gestione MB usage
- **Routes**:
  - `GET /mb-usage/:userAddress` - Debug utilizzo MB
  - `GET /user-mb-usage/:identifier` - Utilizzo MB utente
  - `GET /user-uploads/:identifier` - Debug upload utente
  - `POST /user-mb-usage/:identifier/reset` - Reset utilizzo MB
  - `GET /test-gun` - Test operazioni Gun
  - `GET /test-gun-save/:identifier/:hash` - Test salvataggio Gun

#### 8. `routes/auth.js`
- **Endpoint**: `/api/auth/*`
- **Responsabilità**: Autenticazione utenti
- **Routes**:
  - `POST /register` - Registrazione utente
  - `POST /login` - Login utente
  - `POST /logout` - Logout utente
  - `POST /forgot` - Recupero password
  - `POST /reset` - Reset password
  - `POST /change-password` - Cambio password

#### 9. `routes/users.js`
- **Endpoint**: `/api/users/*`
- **Responsabilità**: Gestione profili utenti
- **Routes**:
  - `GET /profile` - Profilo utente corrente
  - `PUT /profile` - Aggiorna profilo utente
  - `GET /:pubkey` - Profilo utente specifico
  - `GET /search/:query` - Ricerca utenti
  - `GET /` - Lista utenti

## Compatibilità

Il sistema mantiene la compatibilità con le route esistenti attraverso:

1. **Route Legacy**: Le route originali sono ancora disponibili (es. `/api/contracts/*`)
2. **Route Moderne**: Nuove route organizzate (es. `/api/v1/contracts/*`)
3. **Middleware**: Tutti i middleware di autenticazione sono preservati

## Vantaggi della Nuova Struttura

1. **Modularità**: Ogni modulo gestisce un dominio specifico
2. **Manutenibilità**: Codice più facile da mantenere e aggiornare
3. **Scalabilità**: Facile aggiungere nuove route e moduli
4. **Organizzazione**: Struttura chiara e logica
5. **Riusabilità**: Moduli possono essere riutilizzati
6. **Testing**: Più facile testare singoli moduli

## Come Aggiungere Nuove Routes

1. Crea un nuovo file nella cartella `routes/` (es. `routes/new-feature.js`)
2. Esporta un router Express con `export default router`
3. Importa il nuovo modulo in `routes/index.js`
4. Aggiungi la route nel router principale

### Esempio

```javascript
// routes/new-feature.js
import express from 'express';
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ success: true, message: 'New feature' });
});

export default router;
```

```javascript
// routes/index.js
import newFeatureRouter from './new-feature.js';

// ... nel router principale
app.use(`${baseRoute}/new-feature`, newFeatureRouter);
```

## File di Backup

Il file originale è stato salvato come `index-old.js` per riferimento e rollback se necessario.

## Note Tecniche

- Tutti i moduli utilizzano ES6 modules (`import`/`export`)
- Rate limiting è applicato a livello globale e per moduli specifici
- Middleware di autenticazione sono condivisi tra i moduli
- Le funzioni helper sono esposte tramite `app.set()` per accesso globale 