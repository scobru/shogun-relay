// IPCM Contract Interface JavaScript
class IPCMInterface {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.userAddress = null;
        this.network = null;
        this.ipcmFactory = null;
        this.ipcmInstance = null;
        this.gun = null;
        
        this.initialize();
    }

    async initialize() {
        console.log("🚀 Initializing IPCM Interface...");
        
        // Initialize Gun
        this.initializeGun();
        
        // Load contract configuration
        await this.loadContractConfig();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Update UI
        this.updateConnectionStatus();
        this.updateContractInfo();
    }

    initializeGun() {
        try {
            this.gun = Gun(['https://ruling-mastodon-improved.ngrok-free.app/gun']);
            console.log("✅ Gun initialized on:", this.gun._.opt.peers[0]);
        } catch (error) {
            console.error("❌ Failed to initialize Gun:", error);
        }
    }

    async loadContractConfig() {
        try {
            console.log("📋 Loading contract configuration...");
            const response = await fetch('/api/v1/contracts/ipcm');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const config = await response.json();
            
            if (!config.success) {
                throw new Error(config.error || 'Failed to load contract config');
            }
            
            this.contractConfig = config.data;
            console.log("✅ Contract configuration loaded:", this.contractConfig);
            this.updateContractInfo();
            
        } catch (error) {
            console.error("❌ Failed to load contract config:", error);
            this.updateConnectionStatus('Contract config failed to load');
        }
    }

    setupEventListeners() {
        // Wallet connection
        document.getElementById('connect-wallet').addEventListener('click', () => this.connectWallet());
        
        // IPCMFactory operations
        document.getElementById('create-ipcm').addEventListener('click', () => this.createIPCM());
        document.getElementById('get-all-instances').addEventListener('click', () => this.getAllInstances());
        document.getElementById('get-user-instances').addEventListener('click', () => this.getUserInstances());
        
        // IPCM instance operations
        document.getElementById('load-instance').addEventListener('click', () => this.loadInstance());
        document.getElementById('update-mapping').addEventListener('click', () => this.updateMapping());
        document.getElementById('get-mapping').addEventListener('click', () => this.getMapping());
        
        // Mapping operations
        document.getElementById('my-contracts-files').addEventListener('click', () => this.getUserData());
        document.getElementById('check-file-status').addEventListener('click', () => this.checkFileStatus());
        document.getElementById('system-stats').addEventListener('click', () => this.getSystemStats());
    }

    updateConnectionStatus(message = null) {
        const walletStatus = document.getElementById('wallet-status');
        const networkStatus = document.getElementById('network-status');
        const contractStatus = document.getElementById('contract-status');
        
        if (message) {
            walletStatus.textContent = message;
            walletStatus.className = 'text-sm text-red-600';
            return;
        }
        
        if (this.userAddress) {
            walletStatus.textContent = this.userAddress.substring(0, 6) + '...' + this.userAddress.substring(38);
            walletStatus.className = 'text-sm text-green-600';
        } else {
            walletStatus.textContent = 'Not connected';
            walletStatus.className = 'text-sm text-gray-600';
        }
        
        if (this.network) {
            networkStatus.textContent = this.network.name;
            networkStatus.className = 'text-sm text-green-600';
        } else {
            networkStatus.textContent = 'Unknown';
            networkStatus.className = 'text-sm text-gray-600';
        }
        
        if (this.contractConfig) {
            contractStatus.textContent = 'Loaded';
            contractStatus.className = 'text-sm text-green-600';
        } else {
            contractStatus.textContent = 'Not loaded';
            contractStatus.className = 'text-sm text-gray-600';
        }
    }

    updateContractInfo() {
        if (this.contractConfig) {
            console.log("📋 Contract info updated:", {
                factory: this.contractConfig.factory?.address,
                ipcm: this.contractConfig.ipcm?.address
            });
        }
    }

    updateWalletInfo() {
        if (this.userAddress) {
            console.log("👤 Wallet connected:", this.userAddress);
            this.updateConnectionStatus();
        }
    }

    async connectWallet() {
        try {
            console.log("🔗 Connecting wallet...");
            
            if (typeof window.ethereum === 'undefined') {
                throw new Error('MetaMask not found. Please install MetaMask.');
            }
            
            // Request account access
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            this.userAddress = accounts[0];
            
            // Get provider and signer
            this.provider = new ethers.providers.Web3Provider(window.ethereum);
            this.signer = this.provider.getSigner();
            
            // Get network
            this.network = await this.provider.getNetwork();
            
            // Initialize contracts
            if (this.contractConfig?.factory) {
                this.ipcmFactory = new ethers.Contract(
                    this.contractConfig.factory.address,
                    this.contractConfig.factory.abi,
                    this.signer
                );
            }
            
            this.updateWalletInfo();
            console.log("✅ Wallet connected successfully");
            
        } catch (error) {
            console.error("❌ Failed to connect wallet:", error);
            this.updateConnectionStatus(error.message);
        }
    }

    async createIPCM() {
        try {
            if (!this.ipcmFactory) {
                throw new Error('IPCMFactory not initialized');
            }
            
            const ownerInput = document.getElementById('new-owner').value.trim();
            const owner = ownerInput || this.userAddress;
            
            console.log("🏭 Creating IPCM instance for owner:", owner);
            
            const tx = await this.ipcmFactory.createIPCM(owner);
            console.log("⏳ Transaction sent:", tx.hash);
            
            const receipt = await tx.wait();
            console.log("✅ Transaction confirmed:", receipt.transactionHash);
            
            // Get the created instance address from the event
            const event = receipt.events?.find(e => e.event === 'IPCMCreated');
            if (event) {
                const instanceAddress = event.args.instance;
                console.log("🎉 IPCM instance created:", instanceAddress);
                
                document.getElementById('create-result').innerHTML = `
                    <div class="text-green-600">
                        ✅ IPCM instance created successfully!<br>
                        Address: ${instanceAddress}<br>
                        Transaction: ${receipt.transactionHash}
                    </div>
                `;
                
                // Auto-fill the instance address
                document.getElementById('instance-address').value = instanceAddress;
            }
            
        } catch (error) {
            console.error("❌ Failed to create IPCM:", error);
            document.getElementById('create-result').innerHTML = `
                <div class="text-red-600">❌ Error: ${error.message}</div>
            `;
        }
    }

    async getAllInstances() {
        try {
            if (!this.ipcmFactory) {
                throw new Error('IPCMFactory not initialized');
            }
            
            console.log("📋 Getting all IPCM instances...");
            const instances = await this.ipcmFactory.getAllInstances();
            
            console.log("📋 All instances:", instances);
            
            const instancesHtml = instances.map((address, index) => 
                `<div class="mb-2 p-2 bg-gray-50 rounded">
                    <strong>Instance ${index}:</strong> ${address}
                </div>`
            ).join('');
            
            document.getElementById('all-instances').innerHTML = instancesHtml || '<p class="text-gray-500">No instances found</p>';
            
        } catch (error) {
            console.error("❌ Failed to get all instances:", error);
            document.getElementById('all-instances').innerHTML = `
                <div class="text-red-600">❌ Error: ${error.message}</div>
            `;
        }
    }

    async getUserInstances() {
        try {
            if (!this.ipcmFactory || !this.userAddress) {
                throw new Error('IPCMFactory not initialized or wallet not connected');
            }
            
            console.log("📋 Getting user instances for:", this.userAddress);
            const instanceIndexes = await this.ipcmFactory.getUserInstances(this.userAddress);
            
            console.log("📋 User instance indexes:", instanceIndexes);
            
            const instances = [];
            for (const index of instanceIndexes) {
                const address = await this.ipcmFactory.getInstance(index);
                instances.push({ index: index.toString(), address });
            }
            
            console.log("📋 User instances:", instances);
            
            const instancesHtml = instances.map(instance => 
                `<div class="mb-2 p-2 bg-gray-50 rounded">
                    <strong>Instance ${instance.index}:</strong> ${instance.address}
                </div>`
            ).join('');
            
            document.getElementById('user-instances').innerHTML = instancesHtml || '<p class="text-gray-500">No instances found for your address</p>';
            
        } catch (error) {
            console.error("❌ Failed to get user instances:", error);
            document.getElementById('user-instances').innerHTML = `
                <div class="text-red-600">❌ Error: ${error.message}</div>
            `;
        }
    }

    async loadInstance() {
        try {
            const address = document.getElementById('instance-address').value.trim();
            if (!address) {
                throw new Error('Please enter an IPCM instance address');
            }
            
            if (!ethers.utils.isAddress(address)) {
                throw new Error('Invalid address format');
            }
            
            console.log("📝 Loading IPCM instance:", address);
            
            this.ipcmInstance = new ethers.Contract(
                address,
                this.contractConfig.ipcm.abi,
                this.signer
            );
            
            // Test the contract by getting the owner
            const owner = await this.ipcmInstance.owner();
            
            document.getElementById('instance-info').innerHTML = `
                <div class="text-green-600">
                    ✅ IPCM instance loaded successfully!<br>
                    Address: ${address}<br>
                    Owner: ${owner}
                </div>
            `;
            
            console.log("✅ IPCM instance loaded:", { address, owner });
            
        } catch (error) {
            console.error("❌ Failed to load IPCM instance:", error);
            document.getElementById('instance-info').innerHTML = `
                <div class="text-red-600">❌ Error: ${error.message}</div>
            `;
        }
    }

    async updateMapping() {
        try {
            if (!this.ipcmInstance) {
                throw new Error('Please load an IPCM instance first');
            }
            
            const newMapping = document.getElementById('new-mapping').value.trim();
            if (!newMapping) {
                throw new Error('Please enter a new mapping value');
            }
            
            console.log("📝 Updating mapping to:", newMapping);
            
            const tx = await this.ipcmInstance.updateMapping(newMapping);
            console.log("⏳ Transaction sent:", tx.hash);
            
            const receipt = await tx.wait();
            console.log("✅ Transaction confirmed:", receipt.transactionHash);
            
            document.getElementById('update-result').innerHTML = `
                <div class="text-green-600">
                    ✅ Mapping updated successfully!<br>
                    New value: ${newMapping}<br>
                    Transaction: ${receipt.transactionHash}
                </div>
            `;
            
        } catch (error) {
            console.error("❌ Failed to update mapping:", error);
            document.getElementById('update-result').innerHTML = `
                <div class="text-red-600">❌ Error: ${error.message}</div>
            `;
        }
    }

    async getMapping() {
        try {
            if (!this.ipcmInstance) {
                throw new Error('Please load an IPCM instance first');
            }
            
            console.log("📝 Getting current mapping...");
            const mapping = await this.ipcmInstance.getMapping();
            
            console.log("📝 Current mapping:", mapping);
            
            document.getElementById('current-mapping').innerHTML = `
                <div class="text-blue-600">
                    <strong>Current mapping:</strong> ${mapping || '(empty)'}
                </div>
            `;
            
        } catch (error) {
            console.error("❌ Failed to get mapping:", error);
            document.getElementById('current-mapping').innerHTML = `
                <div class="text-red-600">❌ Error: ${error.message}</div>
            `;
        }
    }

    // API calls for mapping operations
    async getUserData() {
        try {
            if (!this.userAddress) {
                throw new Error('Please connect your wallet first');
            }
            
            console.log("📋 Getting user contracts and files...");
            const response = await fetch(`/api/v1/ipcm-mapping/user-contracts?userAddress=${this.userAddress}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to get user data');
            }
            
            console.log("📋 User data:", data);
            
            const resultsDiv = document.getElementById('mapping-results');
            resultsDiv.innerHTML = `
                <h4 class="font-semibold mb-2">My Contracts & Files</h4>
                <pre class="text-sm bg-white p-2 rounded border">${JSON.stringify(data.data, null, 2)}</pre>
            `;
            
        } catch (error) {
            console.error("❌ Failed to get user data:", error);
            document.getElementById('mapping-results').innerHTML = `
                <div class="text-red-600">❌ Error: ${error.message}</div>
            `;
        }
    }

    async checkFileStatus() {
        try {
            const fileHash = prompt("Enter file hash to check:");
            if (!fileHash) return;
            
            console.log("🔍 Checking file status for:", fileHash);
            const response = await fetch(`/api/v1/ipcm-mapping/file-status?fileHash=${fileHash}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to check file status');
            }
            
            console.log("🔍 File status:", data);
            
            const resultsDiv = document.getElementById('mapping-results');
            resultsDiv.innerHTML = `
                <h4 class="font-semibold mb-2">File Status: ${fileHash}</h4>
                <pre class="text-sm bg-white p-2 rounded border">${JSON.stringify(data.data, null, 2)}</pre>
            `;
            
        } catch (error) {
            console.error("❌ Failed to check file status:", error);
            document.getElementById('mapping-results').innerHTML = `
                <div class="text-red-600">❌ Error: ${error.message}</div>
            `;
        }
    }

    async getSystemStats() {
        try {
            console.log("📊 Getting system stats...");
            const response = await fetch('/api/v1/ipcm-mapping/system-stats');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to get system stats');
            }
            
            console.log("📊 System stats:", data);
            
            const resultsDiv = document.getElementById('mapping-results');
            resultsDiv.innerHTML = `
                <h4 class="font-semibold mb-2">System Statistics</h4>
                <pre class="text-sm bg-white p-2 rounded border">${JSON.stringify(data.data, null, 2)}</pre>
            `;
            
        } catch (error) {
            console.error("❌ Failed to get system stats:", error);
            document.getElementById('mapping-results').innerHTML = `
                <div class="text-red-600">❌ Error: ${error.message}</div>
            `;
        }
    }
}

// Initialize the interface when the page loads
document.addEventListener('DOMContentLoaded', () => {
    window.ipcmInterface = new IPCMInterface();
}); 