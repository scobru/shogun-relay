// Chain Contract Interface JavaScript
// Gestisce l'interazione con il contratto Chain.sol su Sepolia

let provider, signer, contract, gun;
let isListening = false;
let eventListener = null;

// Configurazione
let CONTRACT_ADDRESS = null;
let CONTRACT_ABI = null;

// Inizializzazione
async function initialize() {
    try {
        // Verifica che Gun sia caricato
        if (typeof Gun === 'undefined') {
            console.error('Gun non è caricato');
            updateConnectionStatus('error', 'Gun non è caricato');
            return;
        }
        
        // Inizializza Gun usando l'indirizzo del browser corrente
        const currentUrl = window.location.origin;
        gun = Gun("https://ruling-mastodon-improved.ngrok-free.app/");
        console.log('✅ Gun inizializzato su:', `${currentUrl}/gun`);
        
        // Ottieni configurazione contratto dal server
        await loadContractConfig();
        
        // Inizializza provider Ethers
        if (typeof window.ethereum !== 'undefined') {
            provider = new ethers.providers.Web3Provider(window.ethereum);
            await provider.send("eth_requestAccounts", []);
            signer = provider.getSigner();
            
            // Inizializza contratto
            if (CONTRACT_ADDRESS && CONTRACT_ABI) {
                contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
                updateConnectionStatus('success', 'Connesso al contratto');
                updateContractInfo();
                updateWalletInfo();
            } else {
                updateConnectionStatus('error', 'Configurazione contratto non disponibile');
            }
        } else {
            updateConnectionStatus('error', 'MetaMask non trovato');
        }
    } catch (error) {
        console.error('Errore inizializzazione:', error);
        updateConnectionStatus('error', 'Errore di connessione: ' + error.message);
    }
}

// Carica configurazione contratto dal server
async function loadContractConfig() {
    try {
        const response = await fetch('/api/v1/contracts/chain');
        const data = await response.json();
        
        if (data.success && data.contract) {
            CONTRACT_ADDRESS = data.contract.address;
            CONTRACT_ABI = data.contract.abi;
            console.log('✅ Configurazione contratto caricata:', CONTRACT_ADDRESS);
        } else {
            console.error('❌ Errore caricamento configurazione contratto:', data.error);
        }
    } catch (error) {
        console.error('❌ Errore caricamento configurazione:', error);
    }
}

// Aggiorna stato connessione
function updateConnectionStatus(type, message) {
    const statusEl = document.getElementById('connectionStatus');
    statusEl.className = `alert alert-${type} mb-6`;
    statusEl.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        <span>${message}</span>
    `;
}

// Aggiorna informazioni contratto
async function updateContractInfo() {
    try {
        if (contract) {
            const owner = await contract.owner();
            document.getElementById('contractAddress').textContent = CONTRACT_ADDRESS;
            document.getElementById('contractOwner').textContent = owner;
            document.getElementById('contractStatus').textContent = 'Connesso';
        }
    } catch (error) {
        console.error('Errore aggiornamento info contratto:', error);
    }
}

// Aggiorna informazioni wallet
async function updateWalletInfo() {
    try {
        const address = await signer.getAddress();
        const balance = await provider.getBalance(address);
        const isOwner = address.toLowerCase() === (await contract.owner()).toLowerCase();
        
        document.getElementById('walletAddress').textContent = address;
        document.getElementById('walletBalance').textContent = ethers.utils.formatEther(balance) + ' ETH';
        document.getElementById('walletPermissions').textContent = isOwner ? 'Owner' : 'Utente';
        
        // Aggiorna pulsante connessione
        const connectBtn = document.getElementById('connectWalletBtn');
        connectBtn.textContent = '🔗 Connesso';
        connectBtn.className = 'btn btn-success btn-sm';
        connectBtn.disabled = true;
    } catch (error) {
        console.error('Errore aggiornamento info wallet:', error);
    }
}

// Connetti wallet
async function connectWallet() {
    try {
        await initialize();
    } catch (error) {
        console.error('Errore connessione wallet:', error);
        updateConnectionStatus('error', 'Errore connessione wallet: ' + error.message);
    }
}

// Genera hash keccak256
function keccak256(input) {
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(input));
}

// Scrivi su contratto (transazione utente)
async function writeToContract() {
    try {
        const soulInput = document.getElementById('soulInput').value;
        const keyInput = document.getElementById('keyInput').value;
        const valueInput = document.getElementById('valueInput').value;
        
        if (!keyInput || !valueInput) {
            alert('Inserisci chiave e valore');
            return;
        }
        
        if (!contract) {
            alert('Contratto non inizializzato');
            return;
        }
        
        // Verifica che l'utente sia owner
        const signerAddress = await signer.getAddress();
        const contractOwner = await contract.owner();
        
        if (signerAddress.toLowerCase() !== contractOwner.toLowerCase()) {
            alert('Solo l\'owner può scrivere sul contratto');
            return;
        }
        
        // Genera soul se non fornito
        const soul = soulInput ? keccak256(soulInput) : keccak256(Date.now().toString());
        const key = keccak256(keyInput);
        const value = ethers.utils.toUtf8Bytes(valueInput);
        
        // Scrivi su contratto (transazione utente)
        const tx = await contract.put(soul, key, value);
        addToSyncLog(`⏳ Transazione inviata: ${tx.hash}`);
        
        // Aspetta conferma
        const receipt = await tx.wait();
        addToSyncLog(`✅ Transazione confermata: ${receipt.transactionHash}`);
        
        // Scrivi anche su GunDB localmente
        await writeToGun(soul, key, valueInput);
        
        addToSyncLog(`✅ Dati scritti su contratto e GunDB. Soul: ${soul}, Key: ${keyInput}`);
        addToEventLog(`📝 Scrittura: Soul=${soul}, Key=${keyInput}, Value=${valueInput}`);
        
    } catch (error) {
        console.error('Errore scrittura contratto:', error);
        alert('Errore scrittura: ' + error.message);
        addToSyncLog(`❌ Errore scrittura: ${error.message}`);
    }
}

// Scrivi solo su GunDB
async function writeToGunOnly() {
    try {
        const soulInput = document.getElementById('soulInput').value;
        const keyInput = document.getElementById('keyInput').value;
        const valueInput = document.getElementById('valueInput').value;
        
        if (!keyInput || !valueInput) {
            alert('Inserisci chiave e valore');
            return;
        }
        
        const soul = soulInput ? keccak256(soulInput) : keccak256(Date.now().toString());
        const key = keccak256(keyInput);
        
        await writeToGun(soul, key, valueInput);
        
        addToSyncLog(`✅ Dati scritti solo su GunDB. Soul: ${soul}, Key: ${keyInput}`);
        
    } catch (error) {
        console.error('Errore scrittura GunDB:', error);
        alert('Errore scrittura GunDB: ' + error.message);
    }
}

// Scrivi su GunDB
async function writeToGun(soul, key, value) {
    return new Promise((resolve, reject) => {
        try {
            if (!gun) {
                reject(new Error('Gun non inizializzato'));
                return;
            }
            
            const node = gun.get(soul);
            node.get(key).put(value, (ack) => {
                if (ack.err) {
                    reject(ack.err);
                } else {
                    resolve();
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

// Leggi dal contratto
async function readFromContract() {
    try {
        const soulInput = document.getElementById('readSoulInput').value;
        const keyInput = document.getElementById('readKeyInput').value;
        
        if (!soulInput) {
            alert('Inserisci soul per leggere');
            return;
        }
        
        if (!contract) {
            alert('Contratto non inizializzato');
            return;
        }
        
        const soul = keccak256(soulInput);
        
        // Verifica se il nodo esiste
        const exists = await contract.nodeExists(soul);
        if (!exists) {
            document.getElementById('readResult').value = 'Nodo non trovato nel contratto';
            return;
        }
        
        if (keyInput) {
            // Leggi campo specifico
            const key = keccak256(keyInput);
            const value = await contract.get(soul, key);
            const decodedValue = ethers.utils.toUtf8String(value);
            
            document.getElementById('readResult').value = JSON.stringify({
                soul: soulInput,
                key: keyInput,
                value: decodedValue
            }, null, 2);
        } else {
            // Per ora leggiamo solo un campo di esempio
            document.getElementById('readResult').value = 'Funzionalità di lettura completa non ancora implementata';
        }
        
    } catch (error) {
        console.error('Errore lettura contratto:', error);
        document.getElementById('readResult').value = 'Errore: ' + error.message;
    }
}

// Leggi da GunDB
async function readFromGun() {
    try {
        const soulInput = document.getElementById('readSoulInput').value;
        const keyInput = document.getElementById('readKeyInput').value;
        
        if (!soulInput) {
            alert('Inserisci soul per leggere');
            return;
        }
        
        if (!gun) {
            alert('Gun non inizializzato');
            return;
        }
        
        const soul = keccak256(soulInput);
        
        if (keyInput) {
            // Leggi campo specifico
            const key = keccak256(keyInput);
            const node = gun.get(soul).get(key);
            
            node.once((data) => {
                if (data) {
                    document.getElementById('readResult').value = JSON.stringify({
                        soul: soulInput,
                        key: keyInput,
                        value: data
                    }, null, 2);
                } else {
                    document.getElementById('readResult').value = 'Campo non trovato in GunDB';
                }
            });
        } else {
            // Leggi tutto il nodo
            const node = gun.get(soul);
            
            node.once((data) => {
                if (data && typeof data === 'object') {
                    // Filtra i campi interni di Gun
                    const cleanData = {};
                    Object.keys(data).forEach(key => {
                        if (!key.startsWith('_') && key !== '#') {
                            cleanData[key] = data[key];
                        }
                    });
                    
                    document.getElementById('readResult').value = JSON.stringify({
                        soul: soulInput,
                        data: cleanData
                    }, null, 2);
                } else {
                    document.getElementById('readResult').value = 'Nodo non trovato in GunDB';
                }
            });
        }
        
    } catch (error) {
        console.error('Errore lettura GunDB:', error);
        document.getElementById('readResult').value = 'Errore: ' + error.message;
    }
}

// Sincronizza da contratto a GunDB (chiama API del relay)
async function syncContractToGun() {
    try {
        addToSyncLog('🔄 Iniziando sincronizzazione Contratto → GunDB...');
        
        const response = await fetch('/api/v1/chain/sync-to-gun', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            addToSyncLog('✅ Sincronizzazione completata');
        } else {
            addToSyncLog(`❌ Sincronizzazione fallita: ${result.error}`);
        }
        
    } catch (error) {
        console.error('Errore sincronizzazione:', error);
        addToSyncLog('❌ Errore sincronizzazione: ' + error.message);
    }
}

// Sincronizza da GunDB a contratto (chiama API del relay)
async function syncGunToContract() {
    try {
        addToSyncLog('🔄 Iniziando sincronizzazione GunDB → Contratto...');
        
        // Per ora implementiamo una sincronizzazione di esempio
        addToSyncLog('⚠️ Funzionalità di sincronizzazione completa non ancora implementata');
        
    } catch (error) {
        console.error('Errore sincronizzazione:', error);
        addToSyncLog('❌ Errore sincronizzazione: ' + error.message);
    }
}

// Inizia ascolto eventi (chiama API del relay)
async function startEventListening() {
    if (isListening) {
        addToSyncLog('⚠️ Ascolto eventi già attivo');
        return;
    }
    
    try {
        addToSyncLog('🎧 Avviando ascolto eventi NodeUpdated...');
        
        const response = await fetch('/api/v1/chain/start-events', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.success) {
            isListening = true;
            addToSyncLog('✅ Ascolto eventi attivo');
        } else {
            addToSyncLog(`❌ Errore avvio ascolto: ${result.error}`);
        }
        
    } catch (error) {
        console.error('Errore avvio ascolto eventi:', error);
        addToSyncLog('❌ Errore avvio ascolto: ' + error.message);
    }
}

// Aggiungi al log sincronizzazione
function addToSyncLog(message) {
    const syncLog = document.getElementById('syncLog');
    const timestamp = new Date().toLocaleTimeString();
    syncLog.value += `[${timestamp}] ${message}\n`;
    syncLog.scrollTop = syncLog.scrollHeight;
}

// Aggiungi al log eventi
function addToEventLog(message) {
    const eventLog = document.getElementById('eventLog');
    const timestamp = new Date().toLocaleTimeString();
    
    const eventDiv = document.createElement('div');
    eventDiv.className = 'text-sm p-2 bg-base-300 rounded';
    eventDiv.innerHTML = `<span class="text-accent">[${timestamp}]</span> ${message}`;
    
    eventLog.insertBefore(eventDiv, eventLog.firstChild);
    
    // Mantieni solo gli ultimi 50 eventi
    while (eventLog.children.length > 50) {
        eventLog.removeChild(eventLog.lastChild);
    }
}

// Pulisci log eventi
function clearEventLog() {
    document.getElementById('eventLog').innerHTML = '<div class="text-sm text-base-content/50">Nessun evento ancora...</div>';
}

// Inizializza quando la pagina è caricata
document.addEventListener('DOMContentLoaded', () => {
    // Aspetta che tutte le librerie siano caricate
    setTimeout(initialize, 1000);
}); 