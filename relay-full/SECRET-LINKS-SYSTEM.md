# 🔐 Sistema Link Segreti con Password

## Panoramica

Il sistema di condivisione file con link segreti è stato implementato in `fileManagerRoutes.js` utilizzando **SEA (Salt, Encrypt, Authenticate)** di GunDB per la crittografia delle password.

## 🎯 Funzionalità Implementate

### ✅ **Creazione Link Condivisi**
- Endpoint: `POST /api/files/create-share-link`
- Password opzionale con hashing SEA
- Scadenza configurabile
- Limite download personalizzabile
- Token sicuro a 64 caratteri (256-bit)

### ✅ **Accesso Pubblico**
- Endpoint: `GET /api/files/share/:token`
- **Nessuna autenticazione principale richiesta**
- Verifica password se richiesta
- Controllo scadenza automatico
- Controllo limite download

### ✅ **Informazioni Link**
- Endpoint: `GET /api/files/share/:token/info`
- Metadata pubblici del link
- Stato download rimanenti
- **Nessuna autenticazione richiesta**

### ✅ **Gestione Link**
- Endpoint: `GET /api/files/shared-links` (lista link utente)
- Endpoint: `DELETE /api/files/share/:token` (revoca link)
- Cleanup automatico link scaduti (ogni 5 minuti)

## 🔧 API Endpoints

### 1. **Crea Link Condiviso**
```http
POST /api/files/create-share-link
Authorization: Bearer <token>
Content-Type: application/json

{
  "fileId": "file123",
  "password": "mySecret123",      // Opzionale
  "expiresIn": 3600,             // Secondi (default: 1 ora)
  "maxDownloads": 10,            // Default: 10
  "description": "Report Q4"     // Opzionale
}
```

**Risposta:**
```json
{
  "success": true,
  "message": "Shared link created successfully",
  "shareData": {
    "token": "a1b2c3d4e5f6...",
    "shareUrl": "https://domain.com/api/files/share/a1b2c3d4e5f6...",
    "fileName": "report.pdf",
    "hasPassword": true,
    "expiresAt": 1704067200000,
    "maxDownloads": 10,
    "description": "Report Q4",
    "createdAt": 1704063600000
  }
}
```

### 2. **Accesso File Condiviso**
```http
GET /api/files/share/:token?password=mySecret123
```

**Comportamenti:**
- ✅ **Senza password**: Download diretto se non richiesta
- 🔐 **Con password**: Verifica e poi download
- ❌ **Password sbagliata**: Status 401
- ⏰ **Link scaduto**: Status 410
- 📊 **Limite raggiunto**: Status 429

### 3. **Info Link Condiviso**
```http
GET /api/files/share/:token/info
```

**Risposta:**
```json
{
  "success": true,
  "linkInfo": {
    "fileName": "report.pdf",
    "fileSize": 2048576,
    "fileMimeType": "application/pdf",
    "hasPassword": true,
    "expiresAt": 1704067200000,
    "maxDownloads": 10,
    "downloadCount": 3,
    "description": "Report Q4",
    "createdAt": 1704063600000,
    "remainingDownloads": 7
  }
}
```

### 4. **Lista Link Utente**
```http
GET /api/files/shared-links
Authorization: Bearer <token>
```

### 5. **Revoca Link**
```http
DELETE /api/files/share/:token
Authorization: Bearer <token>
```

## 🔒 Sicurezza

### **Crittografia Password**
- **SEA.work()** con PBKDF2 + SHA-256
- Nessuna dipendenza esterna (usa GunDB nativo)
- Hash non reversibili

### **Token Sicuri**
- **64 caratteri hex** (256-bit entropy)
- **crypto.randomBytes(32)** per generazione
- Praticamente impossibili da indovinare

### **Controlli Sicurezza**
- ✅ Verifica esistenza file
- ✅ Controllo scadenza automatico
- ✅ Limite download rispettato
- ✅ Controllo ownership per revoca
- ✅ Cleanup automatico link scaduti

## 🎮 Esempi d'Uso

### **Link Senza Password**
```javascript
// Creare
fetch('/api/files/create-share-link', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    fileId: 'abc123',
    expiresIn: 7200,    // 2 ore
    maxDownloads: 5
  })
});

// Accedere
window.open('https://domain.com/api/files/share/a1b2c3...');
```

### **Link Con Password**
```javascript
// Creare
fetch('/api/files/create-share-link', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    fileId: 'abc123',
    password: 'supersecret',
    expiresIn: 86400,   // 24 ore
    maxDownloads: 1,
    description: 'Documento confidenziale'
  })
});

// Accedere
window.open('https://domain.com/api/files/share/a1b2c3...?password=supersecret');
```

## 📊 Storage e Performance

### **Storage In-Memory**
- `Map()` per link attivi
- Cleanup automatico ogni 5 minuti
- **Production**: Migrare a database persistente

### **Performance**
- Operazioni O(1) per accesso token
- Hash password asincrono (non blocca)
- Stream file per download efficienti

## 🚀 Benefici

### **Per Sviluppatori**
- ✅ **API RESTful** standard
- ✅ **Nessuna dipendenza esterna** (solo SEA)
- ✅ **Integrazione semplice** con frontend
- ✅ **Logging completo** per debug

### **Per Utenti**
- ✅ **Link facili da condividere**
- ✅ **Password opzionali** per sicurezza
- ✅ **Controllo scadenza** e download
- ✅ **Accesso diretto** senza registrazione

### **Per Amministratori**
- ✅ **Gestione centralized** link
- ✅ **Cleanup automatico** risorse
- ✅ **Audit trail** completo
- ✅ **Revoca immediata** se necessario

## 🔄 Prossimi Passi

1. **Database Persistente**: Migrare da Map() a database
2. **UI Frontend**: Interfaccia per creare/gestire link
3. **Analytics**: Statistiche accessi e download
4. **Notifiche**: Alert per download o scadenza
5. **Bulk Operations**: Creare link multipli

Il sistema è **completamente funzionale** e pronto per l'uso! 🎉 