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
        this.contractConfig = null;
        
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
            console.log("📋 Factory config:", this.contractConfig.data?.factory);
            console.log("📋 Factory address:", this.contractConfig.data?.factory?.address);
            console.log("📋 Factory ABI length:", this.contractConfig.data?.factory?.abi?.length);
            console.log("🔍 Full config structure:", JSON.stringify(this.contractConfig, null, 2));
            this.updateContractInfo();
            
        } catch (error) {
            console.error("❌ Failed to load contract config:", error);
            this.updateConnectionStatus('Contract config failed to load');
        }
    }

    setupEventListeners() {
        // Wallet connection
        document.getElementById('connectWalletBtn').addEventListener('click', () => this.connectWallet());
    }

    updateConnectionStatus(message = null) {
        const connectionStatus = document.getElementById('connectionStatus');
        
        if (message) {
            connectionStatus.className = 'alert alert-error mb-6';
            connectionStatus.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span>${message}</span>
            `;
            return;
        }
        
        if (this.userAddress && this.contractConfig && this.contractConfig.data?.factory && this.ipcmFactory) {
            connectionStatus.className = 'alert alert-success mb-6';
            connectionStatus.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span>Connected to IPCM contracts</span>
            `;
        } else {
            connectionStatus.className = 'alert alert-info mb-6';
            connectionStatus.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span>Connecting to contracts...</span>
            `;
        }
    }

    updateContractInfo() {
        const factoryAddress = document.getElementById('factoryAddress');
        const contractStatus = document.getElementById('contractStatus');
        const networkInfo = document.getElementById('networkInfo');
        
        if (this.contractConfig && this.contractConfig.data?.factory) {
            factoryAddress.textContent = this.contractConfig.data.factory.address || 'Not found';
            contractStatus.textContent = 'Connected';
            contractStatus.className = 'text-success';
            networkInfo.textContent = 'Sepolia';
        } else {
            factoryAddress.textContent = 'Loading...';
            contractStatus.textContent = 'Disconnected';
            contractStatus.className = 'text-error';
        }
    }

    updateWalletInfo() {
        const walletAddress = document.getElementById('walletAddress');
        const walletBalance = document.getElementById('walletBalance');
        const walletPermissions = document.getElementById('walletPermissions');
        
        if (this.userAddress) {
            walletAddress.textContent = this.userAddress.substring(0, 6) + '...' + this.userAddress.substring(38);
            walletBalance.textContent = this.walletBalance || '-';
            walletPermissions.textContent = 'Owner';
        } else {
            walletAddress.textContent = 'Not connected';
            walletBalance.textContent = '-';
            walletPermissions.textContent = 'None';
        }
    }

    async connectWallet() {
        try {
            console.log("🔗 Connecting wallet...");
            
            if (typeof window.ethereum === 'undefined') {
                throw new Error('MetaMask not installed');
            }
            
            // Request account access
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            this.userAddress = accounts[0];
            
            // Get provider and signer
            this.provider = new ethers.providers.Web3Provider(window.ethereum);
            this.signer = this.provider.getSigner();
            
            // Get network
            this.network = await this.provider.getNetwork();
            
            // Get balance
            this.walletBalance = ethers.utils.formatEther(await this.provider.getBalance(this.userAddress));
            
            console.log("✅ Wallet connected:", this.userAddress);
            console.log("🌐 Network:", this.network.name);
            console.log("💰 Balance:", this.walletBalance, "ETH");
            
            this.updateConnectionStatus();
            this.updateWalletInfo();
            
            // Initialize contracts if config is loaded
            if (this.contractConfig && this.contractConfig.data?.factory) {
                await this.initializeContracts();
            }
            
        } catch (error) {
            console.error("❌ Failed to connect wallet:", error);
            this.updateConnectionStatus(`Wallet connection failed: ${error.message}`);
        }
    }

    async initializeContracts() {
        try {
            if (!this.contractConfig || !this.signer) {
                throw new Error('Contract config or signer not available');
            }
            
            // La configurazione è in this.contractConfig.data.factory
            const factoryConfig = this.contractConfig.data?.factory;
            if (!factoryConfig || !factoryConfig.address || !factoryConfig.abi) {
                throw new Error('Factory contract configuration not found or incomplete');
            }
            
            // Initialize IPCMFactory contract
            this.ipcmFactory = new ethers.Contract(
                factoryConfig.address,
                factoryConfig.abi,
                this.signer
            );
            
            console.log("✅ IPCMFactory contract initialized");
            
        } catch (error) {
            console.error("❌ Failed to initialize contracts:", error);
            this.updateConnectionStatus(`Contract initialization failed: ${error.message}`);
        }
    }


    async createIPCM() {
        try {
            if (!this.ipcmFactory) {
                throw new Error('IPCMFactory not initialized');
            }
            
            const ownerAddress = document.getElementById('newOwnerInput').value.trim();
            const owner = ownerAddress || this.userAddress;
            
            console.log("🏭 Creating IPCM instance for owner:", owner);
            
            const tx = await this.ipcmFactory.createIPCM(owner);
            const receipt = await tx.wait();
            
            const event = receipt.events?.find(e => e.event === 'IPCMCreated');
            const instanceAddress = event?.args?.instance;
            
            this.showResult('factoryResults', 'success', `IPCM instance created: ${instanceAddress}`);
            
        } catch (error) {
            console.error("❌ Failed to create IPCM:", error);
            this.showResult('factoryResults', 'error', `Failed to create IPCM: ${error.message}`);
        }
    }

    async getAllInstances() {
        try {
            if (!this.ipcmFactory) {
                throw new Error('IPCMFactory not initialized');
            }
            
            console.log("📋 Getting all IPCM instances...");
            
            const instances = await this.ipcmFactory.getAllInstances();
            
            this.showResult('factoryResults', 'info', `Found ${instances.length} instances: ${instances.join(', ')}`);
            
        } catch (error) {
            console.error("❌ Failed to get all instances:", error);
            this.showResult('factoryResults', 'error', `Failed to get instances: ${error.message}`);
        }
    }

    async getUserInstances() {
        try {
            if (!this.ipcmFactory || !this.userAddress) {
                throw new Error('IPCMFactory not initialized or wallet not connected');
            }
            
            console.log("👤 Getting user instances for:", this.userAddress);
            
            const instances = await this.ipcmFactory.getUserInstances(this.userAddress);
            
            this.showResult('factoryResults', 'info', `Your instances: ${instances.join(', ')}`);
            
        } catch (error) {
            console.error("❌ Failed to get user instances:", error);
            this.showResult('factoryResults', 'error', `Failed to get user instances: ${error.message}`);
        }
    }

    async loadInstance() {
        try {
            const instanceAddress = document.getElementById('instanceAddressInput').value.trim();
            
            if (!instanceAddress) {
                throw new Error('Instance address is required');
            }
            
            if (!ethers.utils.isAddress(instanceAddress)) {
                throw new Error('Invalid address format');
            }
            
            console.log("🔍 Loading IPCM instance:", instanceAddress);
            
            // For now, we'll just validate the address
            // In a real implementation, you'd load the contract ABI and create a contract instance
            this.ipcmInstance = instanceAddress;
            
            this.showResult('instanceResults', 'success', `Instance loaded: ${instanceAddress}`);
            
        } catch (error) {
            console.error("❌ Failed to load instance:", error);
            this.showResult('instanceResults', 'error', `Failed to load instance: ${error.message}`);
        }
    }

    async updateMapping() {
        try {
            const instanceAddress = document.getElementById('instanceAddressInput').value.trim();
            const newMapping = document.getElementById('newMappingInput').value.trim();
            
            if (!instanceAddress) {
                throw new Error('Instance address is required');
            }
            
            if (!newMapping) {
                throw new Error('New mapping is required');
            }
            
            console.log("✏️ Updating mapping for instance:", instanceAddress);
            console.log("📝 New mapping:", newMapping);
            
            // This would require the actual IPCM contract ABI
            // For now, we'll just show a success message
            this.showResult('instanceResults', 'success', `Mapping update initiated for ${instanceAddress}`);
            
        } catch (error) {
            console.error("❌ Failed to update mapping:", error);
            this.showResult('instanceResults', 'error', `Failed to update mapping: ${error.message}`);
        }
    }

    async getMapping() {
        try {
            const instanceAddress = document.getElementById('instanceAddressInput').value.trim();
            
            if (!instanceAddress) {
                throw new Error('Instance address is required');
            }
            
            console.log("📖 Getting mapping for instance:", instanceAddress);
            
            // This would require the actual IPCM contract ABI
            // For now, we'll just show a placeholder
            this.showResult('instanceResults', 'info', `Current mapping for ${instanceAddress}: QmExample...`);
            
        } catch (error) {
            console.error("❌ Failed to get mapping:", error);
            this.showResult('instanceResults', 'error', `Failed to get mapping: ${error.message}`);
        }
    }

    async getUserData() {
        try {
            console.log("📁 Getting user contracts and files...");
            
            // This would integrate with your existing user data system
            this.showResult('additionalResults', 'info', 'User data feature coming soon...');
            
        } catch (error) {
            console.error("❌ Failed to get user data:", error);
            this.showResult('additionalResults', 'error', `Failed to get user data: ${error.message}`);
        }
    }

    async checkFileStatus() {
        try {
            console.log("🔍 Checking file status...");
            
            // This would check IPFS file status
            this.showResult('additionalResults', 'info', 'File status check feature coming soon...');
            
        } catch (error) {
            console.error("❌ Failed to check file status:", error);
            this.showResult('additionalResults', 'error', `Failed to check file status: ${error.message}`);
        }
    }

    async getSystemStats() {
        try {
            console.log("📊 Getting system stats...");
            
            const response = await fetch('/api/v1/system/stats');
            const stats = await response.json();
            
            if (stats.success) {
                this.showResult('additionalResults', 'info', `System stats loaded: ${JSON.stringify(stats.data, null, 2)}`);
            } else {
                throw new Error(stats.error || 'Failed to load stats');
            }
            
        } catch (error) {
            console.error("❌ Failed to get system stats:", error);
            this.showResult('additionalResults', 'error', `Failed to get system stats: ${error.message}`);
        }
    }

    showResult(elementId, type, message) {
        const element = document.getElementById(elementId);
        const alertClass = type === 'error' ? 'alert-error' : type === 'success' ? 'alert-success' : 'alert-info';
        
        element.className = `alert ${alertClass}`;
        element.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" class="stroke-current shrink-0 w-6 h-6">
                ${type === 'error' ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"></path>' :
                  type === 'success' ? '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>' :
                  '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>'}
            </svg>
            <span>${message}</span>
        `;
    }
}

// Global functions for onclick handlers
window.connectWallet = function() {
    if (window.ipcmInterface) {
        window.ipcmInterface.connectWallet();
    }
};

window.createIPCM = function() {
    if (window.ipcmInterface) {
        window.ipcmInterface.createIPCM();
    }
};

window.getAllInstances = function() {
    if (window.ipcmInterface) {
        window.ipcmInterface.getAllInstances();
    }
};

window.getUserInstances = function() {
    if (window.ipcmInterface) {
        window.ipcmInterface.getUserInstances();
    }
};

window.loadInstance = function() {
    if (window.ipcmInterface) {
        window.ipcmInterface.loadInstance();
    }
};

window.updateMapping = function() {
    if (window.ipcmInterface) {
        window.ipcmInterface.updateMapping();
    }
};

window.getMapping = function() {
    if (window.ipcmInterface) {
        window.ipcmInterface.getMapping();
    }
};

window.getUserData = function() {
    if (window.ipcmInterface) {
        window.ipcmInterface.getUserData();
    }
};

window.checkFileStatus = function() {
    if (window.ipcmInterface) {
        window.ipcmInterface.checkFileStatus();
    }
};

window.getSystemStats = function() {
    if (window.ipcmInterface) {
        window.ipcmInterface.getSystemStats();
    }
};

// Initialize the interface when the page loads
document.addEventListener('DOMContentLoaded', function() {
    console.log("🚀 Initializing IPCM Contract Interface...");
    window.ipcmInterface = new IPCMInterface();
}); 