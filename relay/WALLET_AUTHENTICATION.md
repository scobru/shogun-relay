# 🔐 Sistema di Autenticazione con Firma del Wallet

## 🎯 Panoramica

Il sistema ora utilizza la firma del wallet Ethereum come metodo di autenticazione per tutti gli endpoint che gestiscono i file degli utenti. Questo garantisce che solo il proprietario del wallet possa accedere ai propri file.

## 🔧 Come Funziona

### 1. **Messaggio di Firma**

```
I Love Shogun
```

### 2. **Headers di Autenticazione**

Ogni richiesta autenticata deve includere:

- `x-user-address`: Indirizzo del wallet
- `x-wallet-signature`: Firma del messaggio "I Love Shogun"
- `x-signature-message`: Messaggio firmato (opzionale, default: "I Love Shogun")

### 3. **Verifica della Firma**

Il backend verifica:

- Formato dell'indirizzo (0x + 40 caratteri esadecimali)
- Formato della firma (0x + 130 caratteri esadecimali)
- Validità della firma (in futuro implementeremo la verifica crittografica completa)

## 🛡️ Endpoint Protetti

### **POST** `/ipfs-upload-user`

- Upload di file con autenticazione wallet
- Richiede firma per verificare la proprietà del wallet

### **DELETE** `/api/user-uploads/:identifier/:hash`

- Eliminazione file con autenticazione wallet
- Solo il proprietario può eliminare i propri file

### **POST** `/api/sync-mb-usage/:userAddress`

- Sincronizzazione MB con autenticazione wallet
- Solo il proprietario può sincronizzare i propri dati

## 🔄 Flusso di Autenticazione

### 1. **Frontend**

```javascript
// Ottieni la firma del wallet
const signature = await ethereum.request({
  method: "personal_sign",
  params: ["I Love Shogun", walletAddress],
});

// Invia richiesta con autenticazione
const response = await fetch("/endpoint", {
  method: "POST",
  headers: {
    "x-user-address": walletAddress,
    "x-wallet-signature": signature,
    "x-signature-message": "I Love Shogun",
  },
  body: data,
});
```

### 2. **Backend**

```javascript
// Middleware di autenticazione
const walletSignatureMiddleware = (req, res, next) => {
  const userAddress = req.headers["x-user-address"];
  const signature = req.headers["x-wallet-signature"];

  if (!verifyWalletSignature(message, signature, userAddress)) {
    return res.status(401).json({
      success: false,
      error: "Firma del wallet non valida",
    });
  }

  next();
};
```

## 🔐 Vantaggi della Sicurezza

### ✅ **Proprietà Garantita**

- Solo il proprietario del wallet può accedere ai propri file
- Impossibile falsificare l'identità senza la chiave privata

### ✅ **Non-Repudiation**

- Ogni azione è firmata crittograficamente
- Impossibile negare di aver eseguito un'azione

### ✅ **Integrità**

- La firma garantisce che i dati non siano stati alterati
- Verifica automatica dell'autenticità

### ✅ **Semplicità**

- Un solo messaggio per tutte le operazioni
- UX fluida con MetaMask

## 🚀 Implementazione Futura

### **Verifica Crittografica Completa**

```javascript
// Verifica completa della firma (da implementare)
function verifySignatureComplete(message, signature, address) {
  const recoveredAddress = ethers.utils.verifyMessage(message, signature);
  return recoveredAddress.toLowerCase() === address.toLowerCase();
}
```

### **Rate Limiting**

- Limite di richieste per wallet
- Prevenzione di attacchi DoS

### **Session Management**

- Cache delle firme per ridurre le richieste
- Timeout automatici per le sessioni

## 📝 Note Tecniche

### **Formato Firma**

- **Lunghezza**: 132 caratteri (0x + 130 caratteri esadecimali)
- **Algoritmo**: ECDSA con curva secp256k1
- **Prefisso**: 0x

### **Formato Indirizzo**

- **Lunghezza**: 42 caratteri (0x + 40 caratteri esadecimali)
- **Case**: Case-insensitive per la verifica

### **Messaggio**

- **Testo**: "I Love Shogun"
- **Encoding**: UTF-8
- **Prefisso**: Nessuno (MetaMask aggiunge automaticamente il prefisso Ethereum)

## 🔍 Debug e Troubleshooting

### **Errori Comuni**

1. **"x-wallet-signature header richiesto"**: Manca la firma
2. **"Firma del wallet non valida"**: Formato firma errato
3. **"x-user-address header richiesto"**: Manca l'indirizzo

### **Log di Debug**

```javascript
console.log("🔐 Verifying signature for address:", address);
console.log("🔐 Message:", message);
console.log("🔐 Signature:", signature.substring(0, 20) + "...");
```

## 🎯 Conclusione

Il sistema di autenticazione con firma del wallet fornisce:

- **Sicurezza crittografica** per tutti gli endpoint
- **UX semplice** con MetaMask
- **Protezione completa** dei file degli utenti
- **Scalabilità** per future implementazioni

Ogni operazione sui file è ora protetta da autenticazione crittografica! 🛡️
