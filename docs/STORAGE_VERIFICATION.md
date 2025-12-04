# Storage Verification & Slashing Guide

## Panoramica

Questo documento spiega come gli utenti possono verificare che i loro file siano realmente memorizzati nei relay e come funziona il meccanismo di slashing quando un relay non rispetta i suoi obblighi.

---

## 🔍 Verifica Storage (Proof of Storage)

### Come un utente verifica che il file esista

Un cliente con un **storage deal** attivo può verificare che il relay stia realmente memorizzando il file in 3 modi:

#### 1. **Verifica Base (IPFS Check)**
```
GET /api/v1/deals/:dealId/verify
```

Questo endpoint verifica:
- ✅ Il CID esiste nel nodo IPFS del relay
- ✅ Il file è pinato (non sarà rimosso)
- ✅ Il contenuto è leggibile

**Esempio risposta:**
```json
{
  "success": true,
  "verification": {
    "dealId": "deal_xxx",
    "cid": "Qm...",
    "verified": true,
    "checks": {
      "existsInIPFS": true,
      "isPinned": true,
      "canRead": true,
      "blockSize": 12345
    },
    "issues": []
  }
}
```

#### 2. **Verifica con Challenge-Response (Storage Proof)**
```
GET /api/v1/deals/:dealId/verify-proof?challenge=RANDOM_STRING
```

Questo endpoint genera una **prova crittografica** che il relay possiede realmente il file:
- Il relay deve rispondere con un hash che include CID, challenge, timestamp e size
- La prova è valida per 5 minuti
- È impossibile falsificare senza avere realmente il file

**Esempio risposta:**
```json
{
  "success": true,
  "proof": {
    "dealId": "deal_xxx",
    "cid": "Qm...",
    "challenge": "abc123...",
    "timestamp": 1234567890,
    "proofHash": "sha256(cid:challenge:timestamp:size)",
    "relayPub": "gun_pubkey...",
    "isPinned": true,
    "verification": {
      "method": "sha256(cid:challenge:timestamp:size)",
      "validFor": 300000,
      "expiresAt": 1234867890
    }
  }
}
```

#### 3. **Verifica tramite On-Chain Registry**

Se il deal è stato registrato on-chain (opzionale), puoi verificare:
```
GET /api/v1/network/onchain/deals/client/:clientAddress
```

Questo mostra tutti i deal del cliente registrati on-chain con:
- Relay address
- CID
- Data di scadenza
- Status attivo/inattivo

---

## ⚠️ Cosa succede se il file NON esiste?

### Scenario 1: File non trovato durante verifica

Quando un cliente chiama `/verify` o `/verify-proof` e il file non esiste:

```json
{
  "success": true,
  "verification": {
    "verified": false,
    "issues": [
      "CID not found in IPFS",
      "CID is not pinned",
      "Cannot read content"
    ]
  }
}
```

### Scenario 2: Relay non risponde al proof challenge

Se il relay non risponde o risponde con un proof invalido:
- Il cliente può **segnalare** il problema
- Un **authorized slasher** (o il contract owner) può eseguire lo **slashing**

---

## 🔨 Slashing: Come Funziona

### Architettura del Sistema di Slashing

Il contratto `ShogunRelayRegistry` implementa due tipi di slashing:

#### 1. **Missed Proof Slashing** (1% dello stake)
Quando un relay non riesce a fornire una prova di storage quando richiesto.

#### 2. **Data Loss Slashing** (10% dello stake)
Quando un relay perde effettivamente i dati (file non recuperabile).

### Flusso Completo

```
┌─────────────┐
│   Cliente   │
│  (Client)   │
└──────┬──────┘
       │
       │ 1. Verifica file
       │ GET /api/v1/deals/:dealId/verify-proof
       │
       ▼
┌─────────────────┐
│     Relay       │
│  (Provider)     │
└──────┬──────────┘
       │
       ├──► File esiste → Ritorna proof valido ✅
       │
       └──► File NON esiste → Ritorna errore ❌
                              │
                              ▼
                       ┌──────────────────┐
                       │ Cliente prepara  │
                       │ report con       │
                       │ evidenza         │
                       └────────┬─────────┘
                                │
                                │ 2. Report violazione
                                │ (off-chain o on-chain)
                                │
                                ▼
                    ┌───────────────────────┐
                    │  Authorized Slasher   │
                    │  (o Contract Owner)   │
                    └───────────┬───────────┘
                                │
                                │ 3. Verifica report
                                │
                                ▼
                    ┌───────────────────────┐
                    │  Smart Contract       │
                    │  ShogunRelayRegistry  │
                    └───────────┬───────────┘
                                │
                                │ 4. Esegue slashing
                                │ - Sottrae stake (1% o 10%)
                                │ - Aggiorna status relay
                                │ - Se stake < minStake → deattiva
                                │
                                ▼
                    ┌───────────────────────┐
                    │  Stake slashed        │
                    │  va al Treasury       │
                    │  (contract owner)     │
                    └───────────────────────┘
```

### Chi può fare slashing?

Dal contratto `ShogunRelayRegistry.sol`:

```solidity
function reportMissedProof(
    address _relay,
    bytes32 _dealId,
    string calldata _evidence
) external {
    // Solo authorized slashers o owner possono fare report
    if (!authorizedSlashers[msg.sender] && msg.sender != owner()) {
        revert NotAuthorizedSlasher();
    }
    _slashRelay(_relay, missedProofSlashBps, _dealId, _evidence);
}
```

**Ruoli:**
1. **Contract Owner**: Può sempre fare slashing
2. **Authorized Slashers**: Indirizzi autorizzati dall'owner (es. servizi di monitoring)

### Limitazioni Attuali

⚠️ **IMPORTANTE**: Attualmente, i clienti **NON possono fare slashing direttamente**. Devono:

1. **Verificare** che il file non esista usando `/verify` o `/verify-proof`
2. **Raccogliere evidenza** (screenshot, log, proof invalido)
3. **Contattare** un authorized slasher o il contract owner
4. Lo **slasher verifica** l'evidenza e esegue lo slashing on-chain

### Perché questa limitazione?

- **Prevenzione di attacchi**: Evita che utenti malintenzionati facciano slashing arbitrario
- **Verifica umana**: Richiede che qualcuno verifichi l'evidenza prima dello slashing
- **Dispute**: Permette di risolvere dispute prima dello slashing automatico

### Slashing Automatico (Futuro)

In futuro, possiamo implementare:
- **Oracle network** che verifica automaticamente i proof
- **Bonding mechanism** per clienti che vogliono fare report (devono stake)
- **Multi-sig slashing** (richiede N slashers per eseguire)

---

## 📝 Esempio Pratico

### Step 1: Cliente verifica il suo deal

```bash
curl "https://relay.example.com/api/v1/deals/deal_abc123/verify-proof?challenge=test123"
```

**Risposta (file NON esiste):**
```json
{
  "success": false,
  "error": "CID not found on this relay",
  "cid": "Qm...",
  "dealId": "deal_abc123"
}
```

### Step 2: Cliente raccoglie evidenza

```javascript
// Cliente salva:
const evidence = {
  dealId: "deal_abc123",
  cid: "Qm...",
  relay: "0x...",
  timestamp: Date.now(),
  verificationFailed: true,
  error: "CID not found on this relay",
  challenge: "test123"
};
```

### Step 3: Cliente contatta authorized slasher

Il cliente invia l'evidenza a un servizio di monitoring o al contract owner.

### Step 4: Authorized slasher esegue slashing on-chain

```solidity
// Via contratto (richiede authorizedSlasher o owner)
registry.reportDataLoss(
    relayAddress,      // 0x...
    dealId,            // bytes32 deal ID
    evidenceJSON       // JSON string con evidenza
);
```

### Step 5: Slashing eseguito

- ✅ 10% dello stake viene sottratto al relay
- ✅ Lo stake va al treasury (owner)
- ✅ Se stake < minStake, il relay viene deattivato
- ✅ Event emesso: `RelaySlashed(reportId, relay, reporter, amount, reason)`

---

## 🔐 Sicurezza

### Prevenzione di Attacchi

1. **Solo authorized slashers** possono fare slashing
2. **Evidenza richiesta**: Ogni slash deve includere evidenza verificabile
3. **Disputes**: Il relay può contestare lo slash (in futuro)
4. **Gradual slashing**: Piccoli slash (1-10%) invece di tutto lo stake

### Best Practices per Clienti

1. **Verifica regolarmente** i tuoi deal (es. una volta al giorno)
2. **Salva le evidenze** quando una verifica fallisce
3. **Contatta il relay** prima di fare report (potrebbe essere un problema temporaneo)
4. **Usa multiple verifiche** per confermare che il problema persiste

---

## 📊 Monitoring e Dashboard

### Futuro: Dashboard di Verifica

Un'interfaccia web dove:
- ✅ Vedi tutti i tuoi deal
- ✅ Verifica automaticamente ogni X ore
- ✅ Alert quando una verifica fallisce
- ✅ Report one-click a authorized slashers

---

## 🔗 Riferimenti

- **Storage Proof Endpoint**: `/api/v1/deals/:dealId/verify-proof`
- **Base Verification**: `/api/v1/deals/:dealId/verify`
- **Network Proof**: `/api/v1/network/proof/:cid`
- **Smart Contract**: `ShogunRelayRegistry.sol` (Base Sepolia)
- **Registry Dashboard**: `/registry-dashboard.html`

---

## ❓ FAQ

**Q: Posso verificare deal di altri clienti?**  
A: No, solo i tuoi deal. Il deal è legato al tuo `clientAddress`.

**Q: Cosa succede se il relay viene slashed?**  
A: Perde parte dello stake (1-10%). Se lo stake scende sotto `minStake`, viene deattivato.

**Q: Posso recuperare il mio pagamento se il relay perde i dati?**  
A: Attualmente no (il pagamento è già stato fatto). Il slashing è una penalità per il relay, non un rimborso. In futuro possiamo aggiungere assicurazione.

**Q: Quanto tempo ha un relay per rispondere a una verifica?**  
A: La proof è valida per 5 minuti. Se il relay non risponde in tempo, può essere considerato un "missed proof".

**Q: Come divento un authorized slasher?**  
A: Devi essere autorizzato dal contract owner chiamando `setAuthorizedSlasher(address, true)`.

