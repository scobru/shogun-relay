# 🔐 Shogun Relay - Sistema di Autenticazione Admin Centralizzato

## Panoramica

Il nuovo sistema di autenticazione admin centralizzato permette di:

- **🏠 Impostare la password una volta sola** nell'index.html (Control Panel)
- **💾 Salvarla automaticamente** nel localStorage del browser
- **🔄 Utilizzarla automaticamente** in tutte le applicazioni Shogun Relay
- **🔄 Sincronizzarla** tra tutte le tab/finestre del browser

## 🚀 Come Utilizzare

### 1. Impostazione Password (Index Page)

1. Vai su `http://localhost:8765/` (Control Panel)
2. Trova la sezione **"Admin Authentication"**
3. Inserisci la tua password admin (`S3RVER` di default)
4. Clicca **"💾 Save Password"**
5. La password verrà salvata e sarà disponibile per tutte le altre applicazioni

### 2. Utilizzo Automatico

Quando visiti qualsiasi altra pagina del Shogun Relay:

- **✅ Auto-fill automatico**: I campi password vengono riempiti automaticamente
- **🔑 Indicatore visivo**: Mostra se la password è salvata o meno
- **🔄 Sincronizzazione live**: Se cambi la password in una tab, si aggiorna in tutte le altre

### 3. Cancellazione Password

Per rimuovere la password salvata:

1. Torna al Control Panel (`/`)
2. Clicca **"🗑️ Clear"** nella sezione Admin Authentication
3. La password verrà rimossa da tutte le tab/finestre

## 🛠️ Implementazione Tecnica

### Per gli Sviluppatori

Il sistema è implementato tramite:

1. **Libreria Centralizzata**: `lib/admin-auth.js`
2. **API Semplificata**: `ShogunAdmin.getPassword()`, `ShogunAdmin.hasPassword()`
3. **Sincronizzazione**: Usa `BroadcastChannel` per sync tra tab
4. **Auto-inizializzazione**: Include `<script src="lib/admin-auth.js"></script>`

### Esempio di Integrazione

```html
<!-- Include la libreria -->
<script src="lib/admin-auth.js"></script>

<!-- Il campo password verrà auto-riempito -->
<input type="password" id="adminToken" placeholder="Admin Token (auto-loaded if saved)">

<script>
// Inizializzazione (opzionale - avviene automaticamente)
ShogunAdmin.init({
    autoFill: true,
    showIndicator: true,
    fieldId: 'adminToken',
    syncEnabled: true
});

// Utilizzare la password
async function apiCall() {
    const token = ShogunAdmin.getPassword() || document.getElementById('adminToken').value;
    
    if (!token) {
        alert('Admin Token is required. Please set it in the Control Panel.');
        return;
    }
    
    // Effettua la chiamata API...
    const response = await fetch('/api/endpoint', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
}
</script>
```

## 📋 Applicazioni Aggiornate

Le seguenti applicazioni ora supportano il sistema centralizzato:

- ✅ **Index** (Control Panel) - Gestione password
- ✅ **Pin Manager** - Gestione pin IPFS
- ✅ **S3 Dashboard** - Dashboard storage S3
- ✅ **Upload** - Upload file su IPFS
- ✅ **Graph Explorer** - Esplora dati Gun
- ✅ **Notes** - Note admin criptate
- 🔄 **Charts** - (da aggiornare)
- 🔄 **Create/Edit** - (da aggiornare)
- 🔄 **Derive** - (da aggiornare)

## 🔧 Funzioni API

### `ShogunAdmin.getPassword()`
Restituisce la password salvata o stringa vuota.

### `ShogunAdmin.hasPassword()`
Restituisce `true` se la password è salvata.

### `ShogunAdmin.autoFillPassword(fieldId)`
Riempie automaticamente il campo password specificato.

### `ShogunAdmin.getAuthHeader()`
Restituisce l'header di autorizzazione `{ 'Authorization': 'Bearer token' }`.

### `ShogunAdmin.init(options)`
Inizializza il sistema con opzioni personalizzate.

## 🎯 Vantaggi

1. **🎯 User Experience**: Non devi più inserire la password in ogni applicazione
2. **🔄 Sincronizzazione**: Funziona su tutte le tab/finestre
3. **💡 Indicatori Visivi**: Sai sempre se la password è configurata
4. **🛡️ Sicurezza**: Password salvata solo nel localStorage locale
5. **🔧 Facilità di Sviluppo**: API semplice per nuove applicazioni

## 📱 Compatibilità

- ✅ Chrome/Chromium
- ✅ Firefox  
- ✅ Safari
- ✅ Edge
- ✅ Tutti i browser moderni con supporto localStorage e BroadcastChannel

## 🆘 Risoluzione Problemi

### Password non viene auto-riempita
1. Verifica che `lib/admin-auth.js` sia incluso nella pagina
2. Controlla la console per errori JavaScript
3. Assicurati che il campo password abbia uno degli ID supportati: `adminToken`, `authToken`, `adminPassword`

### Sincronizzazione non funziona
1. Verifica che il browser supporti `BroadcastChannel`
2. Ricarica tutte le tab
3. Controlla che non ci siano errori JavaScript

### Password scomparsa
1. Controlla se è stata cancellata dal Control Panel
2. Verifica che il localStorage non sia stato cancellato
3. Re-imposta la password dal Control Panel

---

**💡 Suggerimento**: Per massima sicurezza, usa la password admin solo su localhost e reti sicure. 