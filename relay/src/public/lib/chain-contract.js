// Chain Contract Interface JavaScript
// Handles interaction with Chain.sol contract on Sepolia

let provider, signer, contract, gun;

// Configuration
let CONTRACT_ADDRESS = null;
let CONTRACT_ABI = null;

// Test contract connection
async function testContractConnection() {
    try {
        if (!contract) {
            updateConnectionStatus('error', 'Contract not initialized');
            return false;
        }
        
        // Test a simple contract call
        const owner = await contract.owner();
        console.log('✅ Contract connection test successful, owner:', owner);
        updateConnectionStatus('success', 'Connected to contract');
        return true;
        
    } catch (error) {
        console.error('❌ Contract connection test failed:', error);
        updateConnectionStatus('error', 'Contract connection error: ' + error.message);
        return false;
    }
}

// Initialization
async function initialize() {
    try {
        // Check if Gun is loaded
        if (typeof Gun === 'undefined') {
            console.error('Gun is not loaded');
            updateConnectionStatus('error', 'Gun is not loaded');
            return;
        }
        
        // Initialize Gun using current browser address
        const currentUrl = window.location.origin;
        gun = Gun([`${currentUrl}/gun`]);
        console.log('✅ Gun initialized on:', `${currentUrl}/gun`);
        
        // Get contract configuration from server
        await loadContractConfig();
        
        // Initialize Ethers provider
        if (typeof window.ethereum !== 'undefined') {
            provider = new ethers.providers.Web3Provider(window.ethereum);
            await provider.send("eth_requestAccounts", []);
            signer = provider.getSigner();
            
            // Initialize contract
            if (CONTRACT_ADDRESS && CONTRACT_ABI) {
                contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
                
                // Test connection
                const connectionOk = await testContractConnection();
                if (connectionOk) {
                    updateContractInfo();
                    updateWalletInfo();
                }
            } else {
                updateConnectionStatus('error', 'Contract configuration not available');
            }
        } else {
            updateConnectionStatus('error', 'MetaMask not found');
        }
    } catch (error) {
        console.error('Initialization error:', error);
        updateConnectionStatus('error', 'Connection error: ' + error.message);
    }
}

// Load contract configuration from server
async function loadContractConfig() {
    try {
        const response = await fetch('/api/v1/contracts/chain');
        const data = await response.json();
        
        if (data.success && data.contract) {
            CONTRACT_ADDRESS = data.contract.address;
            CONTRACT_ABI = data.contract.abi;
            console.log('✅ Contract configuration loaded:', CONTRACT_ADDRESS);
        } else {
            console.error('❌ Error loading contract configuration:', data.error);
        }
    } catch (error) {
        console.error('❌ Error loading configuration:', error);
    }
}

// Update connection status
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

// Update contract information
async function updateContractInfo() {
    try {
        if (contract) {
            const owner = await contract.owner();
            document.getElementById('contractAddress').textContent = CONTRACT_ADDRESS;
            document.getElementById('contractOwner').textContent = owner;
            document.getElementById('contractStatus').textContent = 'Connected';
        }
    } catch (error) {
        console.error('Error updating contract info:', error);
    }
}

// Update wallet information
async function updateWalletInfo() {
    try {
        const address = await signer.getAddress();
        const balance = await provider.getBalance(address);
        const isOwner = address.toLowerCase() === (await contract.owner()).toLowerCase();
        
        document.getElementById('walletAddress').textContent = address;
        document.getElementById('walletBalance').textContent = ethers.utils.formatEther(balance) + ' ETH';
        document.getElementById('walletPermissions').textContent = isOwner ? 'Owner' : 'User';
        
        // Update connection button
        const connectBtn = document.getElementById('connectWalletBtn');
        connectBtn.textContent = '🔗 Connected';
        connectBtn.className = 'btn btn-success btn-sm';
        connectBtn.disabled = true;
    } catch (error) {
        console.error('Error updating wallet info:', error);
    }
}

// Connect wallet
async function connectWallet() {
    try {
        await initialize();
    } catch (error) {
        console.error('Wallet connection error:', error);
        updateConnectionStatus('error', 'Wallet connection error: ' + error.message);
    }
}

// Utility functions for data conversion
function stringToBytes(str) {
    return ethers.utils.toUtf8Bytes(str);
}

function bytesToString(bytes) {
    return ethers.utils.toUtf8String(bytes);
}

// Write to contract (user transaction)
async function writeToContract() {
    try {
        const soulInput = document.getElementById('soulInput').value;
        const keyInput = document.getElementById('keyInput').value;
        const valueInput = document.getElementById('valueInput').value;
        
        if (!keyInput || !valueInput) {
            alert('Enter key and value');
            return;
        }
        
        if (!contract) {
            alert('Contract not initialized');
            return;
        }
        
        // Check if user is owner
        const signerAddress = await signer.getAddress();
        const contractOwner = await contract.owner();
        
        if (signerAddress.toLowerCase() !== contractOwner.toLowerCase()) {
            alert('Only owner can write to contract');
            return;
        }
        
        // Generate soul if not provided
        const soul = soulInput || Date.now().toString();
        const key = keyInput;
        const value = stringToBytes(valueInput);
        
        // Write to contract (user transaction)
        const tx = await contract.put(stringToBytes(soul), stringToBytes(key), value);
        console.log(`⏳ Transaction sent: ${tx.hash}`);
        
        // Wait for confirmation
        const receipt = await tx.wait();
        console.log(`✅ Transaction confirmed: ${receipt.transactionHash}`);
        
        console.log(`✅ Data written to contract and GunDB. Soul: ${soul}, Key: ${key}`);
        alert(`✅ Data written successfully!\nSoul: ${soul}\nKey: ${key}\nValue: ${valueInput}`);
        
    } catch (error) {
        console.error('Contract write error:', error);
        alert('Write error: ' + error.message);
    }
}

// Write only to GunDB
async function writeToGunOnly() {
    try {
        const soulInput = document.getElementById('soulInput').value;
        const keyInput = document.getElementById('keyInput').value;
        const valueInput = document.getElementById('valueInput').value;
        
        if (!keyInput || !valueInput) {
            alert('Enter key and value');
            return;
        }
        
        const soul = soulInput || Date.now().toString();
        const key = keyInput;
        
        await writeToGun(soul, key, valueInput);
        
        console.log(`✅ Data written to GunDB only. Soul: ${soul}, Key: ${key}`);
        alert(`✅ Data written to GunDB!\nSoul: ${soul}\nKey: ${key}\nValue: ${valueInput}`);
        
    } catch (error) {
        console.error('GunDB write error:', error);
        alert('GunDB write error: ' + error.message);
    }
}

// Write to GunDB
async function writeToGun(soul, key, value) {
    return new Promise((resolve, reject) => {
        try {
            if (!gun) {
                reject(new Error('Gun not initialized'));
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

// Read from contract
async function readFromContract() {
    try {
        const soulInput = document.getElementById('readSoulInput').value;
        const keyInput = document.getElementById('readKeyInput').value;
        
        if (!soulInput) {
            alert('Enter soul to read');
            return;
        }
        
        if (!contract) {
            alert('Contract not initialized');
            return;
        }
        
        const soul = soulInput;
        
        // Check if node exists
        try {
            const exists = await contract.nodeExists(stringToBytes(soul));
            if (!exists) {
                document.getElementById('readResult').value = 'Node not found in contract';
                return;
            }
        } catch (error) {
            console.warn('Error checking node existence:', error);
            // Continue anyway, might be an issue with nodeExists method
        }
        
        if (keyInput) {
            // Read specific field
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
                console.error('Error reading specific field:', error);
                document.getElementById('readResult').value = JSON.stringify({
                    error: 'Field read error',
                    details: error.message,
                    soul: soulInput,
                    key: keyInput
                }, null, 2);
            }
        } else {
            // For now we only read one example field
            // In the future we could implement complete node reading
            document.getElementById('readResult').value = JSON.stringify({
                message: 'Complete reading functionality not yet implemented',
                note: 'To read a specific field, also enter the key',
                soul: soulInput
            }, null, 2);
        }
        
    } catch (error) {
        console.error('Contract read error:', error);
        document.getElementById('readResult').value = JSON.stringify({
            error: 'Contract read error',
            details: error.message,
            soul: soulInput || 'not specified'
        }, null, 2);
    }
}

// Read from GunDB
async function readFromGun() {
    try {
        const soulInput = document.getElementById('readSoulInput').value;
        const keyInput = document.getElementById('readKeyInput').value;
        
        if (!soulInput) {
            alert('Enter soul to read');
            return;
        }
        
        if (!gun) {
            alert('Gun not initialized');
            return;
        }
        
        const soul = soulInput;
        
        if (keyInput) {
            // Read specific field
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
                    document.getElementById('readResult').value = 'Field not found in GunDB';
                }
            });
        } else {
            // Read entire node
            const node = gun.get(soul);
            
            node.once((data) => {
                if (data && typeof data === 'object') {
                    // Filter internal Gun fields
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
                    document.getElementById('readResult').value = 'Node not found in GunDB';
                }
            });
        }
        
    } catch (error) {
        console.error('GunDB read error:', error);
        document.getElementById('readResult').value = 'Error: ' + error.message;
    }
}

// Initialize when page is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Wait for all libraries to load
    setTimeout(async () => {
        await initialize();
    }, 1000);
}); 