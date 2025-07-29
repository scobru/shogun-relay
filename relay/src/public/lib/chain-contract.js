// Chain Contract Interface JavaScript
// Gestisce l'interazione con il contratto Chain.sol su Sepolia

let provider, signer, contract, gun;
let isListening = false;
let eventListener = null;

// Configurazione
let CONTRACT_ADDRESS = null;
let CONTRACT_ABI = null;

// Testa la connessione al contratto
async function testContractConnection() {
    try {
        if (!contract) {
            updateConnectionStatus('error', 'Contratto non inizializzato');
            return false;
        }
        
        // Testa una chiamata semplice al contratto
        const owner = await contract.owner();
        console.log('✅ Test connessione contratto riuscito, owner:', owner);
        updateConnectionStatus('success', 'Connesso al contratto');
        return true;
        
    } catch (error) {
        console.error('❌ Test connessione contratto fallito:', error);
        updateConnectionStatus('error', 'Errore connessione contratto: ' + error.message);
        return false;
    }
}

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
        gun = Gun([`${currentUrl}/gun`]);
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
                
                // Testa la connessione
                const connectionOk = await testContractConnection();
                if (connectionOk) {
                    updateContractInfo();
                    updateWalletInfo();
                }
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

// Funzioni di utilità per la conversione dei dati
function stringToBytes(str) {
    return ethers.utils.toUtf8Bytes(str);
}

function bytesToString(bytes) {
    return ethers.utils.toUtf8String(bytes);
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
        const soul = soulInput || Date.now().toString();
        const key = keyInput;
        const value = stringToBytes(valueInput);
        
        // Scrivi su contratto (transazione utente)
        const tx = await contract.put(stringToBytes(soul), stringToBytes(key), value);
        addToSyncLog(`⏳ Transazione inviata: ${tx.hash}`);
        
        // Aspetta conferma
        const receipt = await tx.wait();
        addToSyncLog(`✅ Transazione confermata: ${receipt.transactionHash}`);
        
        // Scrivi anche su GunDB localmente (usando i dati originali leggibili)
        await writeToGun(soul, key, valueInput);
        
        addToSyncLog(`✅ Dati scritti su contratto e GunDB. Soul: ${soul}, Key: ${key}`);
        addToEventLog(`📝 Scrittura: Soul=${soul}, Key=${key}, Value=${valueInput}`);
        
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
        
        const soul = soulInput || Date.now().toString();
        const key = keyInput;
        
        await writeToGun(soul, key, valueInput);
        
        addToSyncLog(`✅ Dati scritti solo su GunDB. Soul: ${soul}, Key: ${key}`);
        
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
        
        const soul = soulInput;
        
        // Verifica se il nodo esiste
        try {
            const exists = await contract.nodeExists(stringToBytes(soul));
            if (!exists) {
                document.getElementById('readResult').value = 'Nodo non trovato nel contratto';
                return;
            }
        } catch (error) {
            console.warn('Errore verifica esistenza nodo:', error);
            // Continua comunque, potrebbe essere un problema con il metodo nodeExists
        }
        
        if (keyInput) {
            // Leggi campo specifico
            const key = keyInput;
            try {
                const value = await contract.get(stringToBytes(soul), stringToBytes(key));
                const decodedValue = bytesToString(value);
                
                document.getElementById('readResult').value = JSON.stringify({
                    soul: soulInput,
                    key: keyInput,
                    value: decodedValue
                }, null, 2);
            } catch (error) {
                console.error('Errore lettura campo specifico:', error);
                document.getElementById('readResult').value = JSON.stringify({
                    error: 'Errore lettura campo',
                    details: error.message,
                    soul: soulInput,
                    key: keyInput
                }, null, 2);
            }
        } else {
            // Per ora leggiamo solo un campo di esempio
            // In futuro potremmo implementare una lettura completa del nodo
            document.getElementById('readResult').value = JSON.stringify({
                message: 'Funzionalità di lettura completa non ancora implementata',
                note: 'Per leggere un campo specifico, inserisci anche la chiave',
                soul: soulInput
            }, null, 2);
        }
        
    } catch (error) {
        console.error('Errore lettura contratto:', error);
        document.getElementById('readResult').value = JSON.stringify({
            error: 'Errore lettura contratto',
            details: error.message,
            soul: soulInput || 'non specificato'
        }, null, 2);
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
        
        const soul = soulInput;
        
        if (keyInput) {
            // Leggi campo specifico
            const key = keyInput;
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
            addToSyncLog('✅ Sincronizzazione completata con successo');
            if (result.message) {
                addToSyncLog(`📝 ${result.message}`);
            }
        } else {
            addToSyncLog(`❌ Sincronizzazione fallita: ${result.error}`);
            if (result.details) {
                addToSyncLog(`🔍 Dettagli: ${result.details}`);
            }
        }
        
    } catch (error) {
        console.error('Errore sincronizzazione:', error);
        addToSyncLog('❌ Errore sincronizzazione: ' + error.message);
    }
}

// Sincronizza manualmente un evento specifico (per test)
async function syncSpecificEvent() {
    try {
        const soulInput = document.getElementById('soulInput').value || 'test/node';
        const keyInput = document.getElementById('keyInput').value || 'test';
        
        addToSyncLog(`🔄 Sincronizzazione manuale evento: ${soulInput} -> ${keyInput}`);
        
        // Prima scrivi su GunDB per assicurarci che i dati ci siano
        await writeToGun(soulInput, keyInput, 'Mario');
        addToSyncLog('✅ Dati scritti su GunDB per test');
        
        // Poi prova la sincronizzazione
        await syncContractToGun();
        
    } catch (error) {
        console.error('Errore sincronizzazione manuale:', error);
        addToSyncLog('❌ Errore sincronizzazione manuale: ' + error.message);
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

// Verifica stato server e API
async function checkServerStatus() {
    try {
        addToSyncLog('🔍 Verificando stato server...');
        
        // Test endpoint di base
        const healthResponse = await fetch('/api/v1/health');
        const healthData = await healthResponse.json();
        
        if (healthData.success) {
            addToSyncLog('✅ Server API funzionante');
        } else {
            addToSyncLog('❌ Server API non funzionante');
        }
        
        // Test endpoint chain
        const chainResponse = await fetch('/api/v1/chain/status');
        const chainData = await chainResponse.json();
        
        if (chainData.success) {
            addToSyncLog('✅ Chain API funzionante');
            addToSyncLog(`📋 Contratto: ${chainData.address || 'N/A'}`);
        } else {
            addToSyncLog('❌ Chain API non funzionante');
            if (chainData.error) {
                addToSyncLog(`🔍 Errore: ${chainData.error}`);
            }
        }
        
    } catch (error) {
        console.error('Errore verifica stato server:', error);
        addToSyncLog('❌ Errore verifica stato server: ' + error.message);
    }
}

// Inizializza quando la pagina è caricata
document.addEventListener('DOMContentLoaded', () => {
    // Aspetta che tutte le librerie siano caricate
    setTimeout(async () => {
        await initialize();
        await checkServerStatus();
    }, 1000);
}); 