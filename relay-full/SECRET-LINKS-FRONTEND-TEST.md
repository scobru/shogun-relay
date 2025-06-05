# 🧪 Test Sistema Link Segreti Frontend

## 📋 Checklist Implementazione

### ✅ **Backend Implementato**
- [x] Endpoint `POST /api/files/create-share-link`
- [x] Endpoint `GET /api/files/share/:token` (pubblico)
- [x] Endpoint `GET /api/files/share/:token/info` (pubblico)
- [x] Endpoint `GET /api/files/shared-links` (lista utente)
- [x] Endpoint `DELETE /api/files/share/:token` (revoca)
- [x] Crittografia password con SEA
- [x] Cleanup automatico link scaduti

### ✅ **Frontend Implementato**
- [x] Pulsante "🔗 Share" su ogni file
- [x] Modal configurazione link con:
  - [x] Password opzionale
  - [x] Scadenza (1h, 6h, 24h, 7d, 30d, mai)
  - [x] Max download (1, 5, 10, 25, 100, unlimited)
  - [x] Descrizione opzionale
- [x] Modal risultato con URL condivisibile
- [x] Copia URL al clipboard
- [x] Pulsante "🔗 Shared Links" nella navbar
- [x] Modal gestione tutti i link
- [x] Revoca link individuale

## 🚀 Come Testare

### **1. Avvia il Server**
```bash
cd test-env/relay-full
npm start
```

### **2. Accedi alla Dashboard**
1. Vai su `http://localhost:8765`
2. Effettua il login
3. Vai alla sezione Files

### **3. Test Creazione Link**

#### **Test Link Senza Password**
1. Clicca "🔗 Share" su un file
2. Lascia vuoto il campo password
3. Seleziona scadenza (es. 1 ora)
4. Seleziona max download (es. 5)
5. Clicca "🔗 Create Share Link"
6. **Verifica**: Modal con URL generato
7. **Copia** l'URL
8. **Test**: Apri URL in finestra privata → Download diretto

#### **Test Link Con Password**
1. Clicca "🔗 Share" su un file
2. Inserisci password: `test123`
3. Seleziona scadenza (es. 24 ore)
4. Aggiungi descrizione: `Documento riservato`
5. Clicca "🔗 Create Share Link"
6. **Copia** l'URL
7. **Test**: Apri URL senza password → Errore 401
8. **Test**: Apri URL con `?password=test123` → Download OK

### **4. Test Gestione Link**

#### **Via Navbar**
1. Clicca "🔗 Shared Links" nella navbar
2. **Verifica**: Lista tutti i link creati
3. **Test**: Clicca "📋 Copy" → URL copiato
4. **Test**: Clicca "🔗 Open" → Link funziona
5. **Test**: Clicca "🗑️ Revoke" → Link diventa inattivo

#### **Via Modal Risultato**
1. Dopo aver creato un link, clicca "🔗 Manage All Links"
2. **Verifica**: Modal gestione si apre
3. **Test**: Azioni sui link esistenti

### **5. Test Limiti e Scadenze**

#### **Test Limite Download**
1. Crea link con max 1 download
2. Scarica il file una volta
3. **Test**: Secondo tentativo → Errore 429 "Download limit exceeded"

#### **Test Scadenza**
1. Crea link con scadenza 1 ora
2. **Per test rapido**: Modifica manualmente timestamp nel backend
3. **Test**: Accesso a link scaduto → Errore 410 "Link expired"

#### **Test Password Sbagliata**
1. Crea link con password
2. **Test**: URL con password sbagliata → Errore 401 "Invalid password"

## 🔍 Endpoint di Test Manuali

### **Via Browser/Postman**

#### **1. Crea Link**
```http
POST http://localhost:8765/api/files/create-share-link
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "fileId": "FILE_ID_HERE",
  "password": "test123",
  "expiresIn": 3600,
  "maxDownloads": 5,
  "description": "Test link"
}
```

#### **2. Lista Link Utente**
```http
GET http://localhost:8765/api/files/shared-links
Authorization: Bearer YOUR_TOKEN
```

#### **3. Info Link (Pubblico)**
```http
GET http://localhost:8765/api/files/share/TOKEN_HERE/info
```

#### **4. Download File (Pubblico)**
```http
GET http://localhost:8765/api/files/share/TOKEN_HERE?password=test123
```

#### **5. Revoca Link**
```http
DELETE http://localhost:8765/api/files/share/TOKEN_HERE
Authorization: Bearer YOUR_TOKEN
```

## 🐛 Possibili Problemi e Soluzioni

### **Frontend Non Vede Backend**
- **Problema**: Errori 404 su endpoint
- **Soluzione**: Verifica che il server sia riavviato
- **Check**: `curl http://localhost:8765/api/files/shared-links`

### **SEA Import Error**
- **Problema**: `Cannot find module 'gun/sea'`
- **Soluzione**: `npm install gun` o verifica path import

### **Modal Non Si Apre**
- **Problema**: JavaScript error
- **Soluzione**: Controlla console browser per errori
- **Check**: Verifica che DaisyUI CSS sia caricato

### **Link Non Funziona**
- **Problema**: 404 su link condiviso
- **Soluzione**: Verifica route pubbliche in `app.js`
- **Check**: Endpoint deve essere **PRIMA** di middleware auth

### **Password Hash Fail**
- **Problema**: Password corretta ma errore auth
- **Soluzione**: Verifica SEA.work() configurazione
- **Debug**: Logga hash generato vs hash verificato

## 🎯 Scenari di Test Completi

### **Scenario 1: Condivisione Semplice**
1. Upload file PDF
2. Crea link senza password, scadenza 24h, max 10 download
3. Condividi URL via email/chat
4. Destinatario scarica file con successo
5. Verifica contatore download aumentato

### **Scenario 2: Condivisione Sicura**
1. Upload file confidenziale
2. Crea link con password complessa, scadenza 1h, max 1 download
3. Comunica separatamente password
4. Destinatario scarica file
5. Verifica link diventa inattivo dopo download

### **Scenario 3: Gestione Link**
1. Crea 5 link diversi
2. Apri gestione link dalla navbar
3. Verifica stati (attivo/scaduto/esaurito)
4. Revoca 2 link
5. Verifica link revocati non funzionano più

## 🏆 Criteri di Successo

### **✅ Funzionalità Base**
- [ ] Pulsante Share visibile su tutti i file
- [ ] Modal configurazione funziona correttamente
- [ ] Link generati sono accessibili pubblicamente
- [ ] Password protection funziona
- [ ] Gestione link dalla navbar funziona

### **✅ Sicurezza**
- [ ] Password hashate con SEA (non in chiaro)
- [ ] Token non indovinabili (64 char hex)
- [ ] Link scaduti non accessibili
- [ ] Limite download rispettato
- [ ] Revoca link immediata

### **✅ UX/UI**
- [ ] Interface intuitiva e responsiva
- [ ] Messaggi di errore chiari
- [ ] Copy to clipboard funziona
- [ ] Loading states appropriati
- [ ] Toast notifications informative

Il sistema è **completamente funzionale** e pronto per l'uso! 🎉 