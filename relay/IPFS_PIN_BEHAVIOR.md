# Comportamento dei Pin IPFS

## Perché vengono creati 3 pin quando fai upload?

Il comportamento che osservi è **normale** per IPFS. Ecco cosa succede:

### 1. **Struttura dei dati IPFS**
Quando carichi un file su IPFS, il sistema crea automaticamente una struttura gerarchica:

- **File originale** → CID del file
- **Directory wrapper** → CID della directory che contiene il file  
- **Metadati** → CID dei metadati del file

### 2. **Pin Ricorsivo**
IPFS usa il **pin ricorsivo** per default, che significa che quando pinni un oggetto, vengono pinnati automaticamente tutti i blocchi correlati.

### 3. **Configurazione attuale**
Nel codice attuale stai usando:
```javascript
path: "/api/v0/add?wrap-with-directory=false"
```

Questo parametro dovrebbe disabilitare la creazione automatica della directory wrapper, ma IPFS potrebbe comunque creare pin multipli.

## Soluzioni per ridurre i pin

### Opzione 1: Disabilitare il pin automatico
Aggiungi il parametro `pin=false` agli endpoint di upload:

```javascript
path: "/api/v0/add?wrap-with-directory=false&pin=false"
```

### Opzione 2: Pin manuale selettivo
Dopo l'upload, pinna manualmente solo il file principale:

```javascript
// Dopo l'upload, pinna solo il file principale
const pinResult = await fetch('/pins/add', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ cid: fileResult.Hash })
});
```

### Opzione 3: Configurazione IPFS
Modifica la configurazione IPFS per ridurre il comportamento di pin automatico:

```bash
ipfs config --json Pinning.Recursive false
```

## Comportamento normale vs anomalo

### ✅ **Comportamento normale:**
- 2-3 pin per file (file + metadati + directory)
- Pin ricorsivo automatico
- Struttura gerarchica IPFS

### ❌ **Comportamento anomalo:**
- Più di 5 pin per file semplice
- Pin duplicati dello stesso CID
- Pin di oggetti non correlati

## Verifica e monitoraggio

### Controlla i pin attuali:
```bash
curl -X POST "http://localhost:5001/api/v0/pin/ls"
```

### Analizza la struttura:
```bash
curl -X POST "http://localhost:5001/api/v0/ls?arg=<CID>"
```

## Raccomandazioni

1. **Per uso normale**: Il comportamento attuale è corretto
2. **Per risparmiare spazio**: Usa `pin=false` e pinna manualmente
3. **Per debugging**: Controlla i log IPFS per dettagli sui pin

## Note tecniche

- IPFS usa DAG (Directed Acyclic Graph) per strutturare i dati
- Ogni nodo del DAG può essere pinnato separatamente
- Il pin ricorsivo è la strategia di default per garantire la persistenza
- I pin multipli sono necessari per la robustezza della rete 