/**
 * Storage Common Utilities
 * 
 * Shared functions and configuration for storage subscriptions and deals.
 * Used by both storage-subscriptions.js and storage-deals.js
 */

// Network configurations
export const NETWORK_CONFIG = {
  'base': { chainId: 8453, chainIdHex: '0x2105', name: 'Base', usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
  'base-sepolia': { chainId: 84532, chainIdHex: '0x14a34', name: 'Base Sepolia', usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
  'polygon': { chainId: 137, chainIdHex: '0x89', name: 'Polygon', usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359' },
  'polygon-amoy': { chainId: 80002, chainIdHex: '0x13882', name: 'Polygon Amoy', usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582' },
};

export const USDC_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
  'function version() view returns (string)',
  'function nonces(address) view returns (uint256)',
];

// Global state (shared across modules)
export const StorageState = {
  provider: null,
  signer: null,
  connectedAddress: null,
  x402Config: null,
  networkConfig: null,
};

/**
 * Utility Functions
 */
export const Utils = {
  formatDate(dateStr) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  },

  shortenAddress(addr) {
    if (!addr) return '0x...';
    return `${addr.substring(0, 6)}...${addr.substring(addr.length - 4)}`;
  },

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  },

  formatUSDC(amount) {
    return parseFloat(amount).toFixed(6) + ' USDC';
  },

  copyToClipboard(text) {
    return navigator.clipboard.writeText(text).then(() => {
      return true;
    }).catch(err => {
      console.error('Copy failed:', err);
      return false;
    });
  },
};

/**
 * Message Display System
 */
export class MessageSystem {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`Message container ${containerId} not found`);
    }
  }

  show(text, type = 'error', duration = 5000) {
    if (!this.container) return;
    
    this.container.innerHTML = text;
    this.container.className = `message ${type}`;
    this.container.style.display = 'block';
    this.container.scrollIntoView({ behavior: 'smooth', block: 'center' });

    if (duration > 0) {
      setTimeout(() => this.hide(), duration);
    }
  }

  hide() {
    if (!this.container) return;
    this.container.style.display = 'none';
  }

  success(text, duration) {
    this.show(text, 'success', duration);
  }

  error(text, duration) {
    this.show(text, 'error', duration);
  }

  info(text, duration) {
    this.show(text, 'info', duration);
  }
}

/**
 * Wallet Connection Manager
 */
export class WalletManager {
  constructor() {
    this.onConnectCallbacks = [];
    this.onDisconnectCallbacks = [];
    this.onAccountChangeCallbacks = [];
  }

  async connect() {
    if (typeof window.ethereum === 'undefined') {
      throw new Error('MetaMask not found. Please install MetaMask to continue.');
    }

    try {
      StorageState.provider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await StorageState.provider.send('eth_requestAccounts', []);
      StorageState.signer = await StorageState.provider.getSigner();
      StorageState.connectedAddress = await StorageState.signer.getAddress();

      // Listen for account changes
      if (window.ethereum) {
        window.ethereum.on('accountsChanged', (accounts) => {
          if (accounts.length === 0) {
            this.disconnect();
          } else {
            this.connect();
          }
        });

        window.ethereum.on('chainChanged', () => {
          if (StorageState.connectedAddress) {
            this.updateNetworkInfo();
          }
        });
      }

      // Notify callbacks
      this.onConnectCallbacks.forEach(cb => cb(StorageState.connectedAddress));

      return StorageState.connectedAddress;
    } catch (error) {
      console.error('Wallet connection error:', error);
      throw error;
    }
  }

  disconnect() {
    StorageState.provider = null;
    StorageState.signer = null;
    const oldAddress = StorageState.connectedAddress;
    StorageState.connectedAddress = null;
    
    this.onDisconnectCallbacks.forEach(cb => cb(oldAddress));
  }

  isConnected() {
    return !!StorageState.connectedAddress;
  }

  getAddress() {
    return StorageState.connectedAddress;
  }

  async updateNetworkInfo() {
    if (!StorageState.provider) return null;

    try {
      const network = await StorageState.provider.getNetwork();
      const chainId = Number(network.chainId);
      
      // Find matching network config
      for (const [key, config] of Object.entries(NETWORK_CONFIG)) {
        if (config.chainId === chainId) {
          StorageState.networkConfig = config;
          return config;
        }
      }

      return { chainId, name: `Chain ${chainId}` };
    } catch (error) {
      console.error('Error updating network info:', error);
      return null;
    }
  }

  async getUSDCBalance() {
    if (!StorageState.provider || !StorageState.connectedAddress || !StorageState.networkConfig) {
      return null;
    }

    try {
      const usdc = new ethers.Contract(StorageState.networkConfig.usdc, USDC_ABI, StorageState.provider);
      const balance = await usdc.balanceOf(StorageState.connectedAddress);
      const decimals = await usdc.decimals();
      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      console.error('Error getting USDC balance:', error);
      return null;
    }
  }

  async switchNetwork(networkKey) {
    const networkConfig = NETWORK_CONFIG[networkKey];
    if (!networkConfig) {
      throw new Error(`Network ${networkKey} not supported`);
    }

    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: networkConfig.chainIdHex }],
      });
      await this.updateNetworkInfo();
    } catch (error) {
      if (error.code === 4902) {
        throw new Error(`Please add ${networkConfig.name} network to MetaMask`);
      } else {
        throw error;
      }
    }
  }

  onConnect(callback) {
    this.onConnectCallbacks.push(callback);
  }

  onDisconnect(callback) {
    this.onDisconnectCallbacks.push(callback);
  }

  onAccountChange(callback) {
    this.onAccountChangeCallbacks.push(callback);
  }
}

/**
 * X402 Configuration Loader
 */
export class X402Config {
  static async load() {
    try {
      const response = await fetch('/api/v1/x402/config');
      const data = await response.json();

      if (!data.success || !data.configured) {
        return { configured: false };
      }

      StorageState.x402Config = data;
      StorageState.networkConfig = NETWORK_CONFIG[data.network];
      
      return data;
    } catch (error) {
      console.error('Error loading x402 config:', error);
      return { configured: false, error: error.message };
    }
  }

  static get() {
    return StorageState.x402Config;
  }

  static isConfigured() {
    return StorageState.x402Config?.configured === true;
  }
}

// Export singleton instances
export const walletManager = new WalletManager();
export const messageSystem = new MessageSystem('globalMessage');

