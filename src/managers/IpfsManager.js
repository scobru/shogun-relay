import fs from "fs";
import path from "path";
import http from "http";
import https from "https";
import { ShogunIpfs } from "shogun-ipfs";

class IpfsManager {
  constructor(config) {
    this.config = {
      enabled: config.enabled || false,
      service: config.service || "IPFS-CLIENT",
      nodeUrl: config.nodeUrl || "http://127.0.0.1:5001",
      gateway: config.gateway || "http://127.0.0.1:8080/ipfs",
      pinataGateway: config.pinataGateway || "https://gateway.pinata.cloud",
      pinataJwt: config.pinataJwt || "",
      encryptionEnabled: config.encryptionEnabled || false,
      encryptionKey: config.encryptionKey || "",
      encryptionAlgorithm: config.encryptionAlgorithm || "aes-256-gcm",
      apiKey: config.apiKey || "",
    };
    
    this.shogunIpfs = null;
    
    if (this.config.enabled) {
      this.initialize();
    }
  }
  
  /**
   * Initialize IPFS with the current configuration
   * @returns {Object|null} IPFS instance or null if initialization failed
   */
  initialize() {
    if (!this.config.enabled) {
      return null;
    }

    try {
      // Configuration according to documentation
      const ipfsConfig = {
        storage: {
          service: this.config.service || "IPFS-CLIENT",
          config: {
            url: this.config.nodeUrl,
            apiKey: this.config.apiKey,
          },
        },
      };

      // Configure based on chosen service
      if (this.config.service === "PINATA") {
        if (!this.config.pinataJwt || this.config.pinataJwt.length < 10) {
          throw new Error("JWT Pinata missing or invalid");
        }

        ipfsConfig.storage.config = {
          pinataJwt: this.config.pinataJwt,
          pinataGateway: this.config.pinataGateway,
        };
      } else if (this.config.service === "IPFS-CLIENT") {
        ipfsConfig.storage.config = {
          url: this.config.nodeUrl,
          apiKey: this.config.apiKey,
        };
      } else {
        throw new Error(`IPFS service not supported: ${this.config.service}`);
      }

      // Verify ShogunIpfs is defined
      if (typeof ShogunIpfs !== "function") {
        throw new Error("ShogunIpfs not available, check module import");
      }

      // Create IPFS instance
      const ipfsInstance = new ShogunIpfs(ipfsConfig.storage);

      // Verify instance is valid
      if (!ipfsInstance || typeof ipfsInstance.uploadJson !== "function") {
        throw new Error("ShogunIpfs instance does not have uploadJson method");
      }

      // Add missing methods if needed
      this._addMissingMethods(ipfsInstance);

      this.shogunIpfs = ipfsInstance;
      return ipfsInstance;
    } catch (error) {
      // Disable IPFS in case of initialization error
      this.config.enabled = false;
      return null;
    }
  }
  
  /**
   * Add missing methods to the IPFS instance if they don't exist
   * @param {Object} ipfsInstance - The IPFS instance
   * @private
   */
  _addMissingMethods(ipfsInstance) {
    // Add methods that might be missing from the IPFS implementation
    const methodsToAdd = {
      pin: async (hash) => {
        if (ipfsInstance.getStorage && typeof ipfsInstance.getStorage === "function") {
          const storage = ipfsInstance.getStorage();
          if (storage && typeof storage.pin === "function") {
            return storage.pin(hash);
          }
        }
        return { success: true, simulated: true };
      },
      
      unpin: async (hash) => {
        if (ipfsInstance.getStorage && typeof ipfsInstance.getStorage === "function") {
          const storage = ipfsInstance.getStorage();
          if (storage && typeof storage.unpin === "function") {
            return storage.unpin(hash);
          }
        }
        return { success: true, simulated: true };
      },
      
      isPinned: async (hash) => {
        if (ipfsInstance.getStorage && typeof ipfsInstance.getStorage === "function") {
          const storage = ipfsInstance.getStorage();
          if (storage && typeof storage.isPinned === "function") {
            return storage.isPinned(hash);
          }
        }
        
        try {
          // Try to verify if the file is pinned
          if (typeof ipfsInstance.pin === "function" && typeof ipfsInstance.pin.ls === "function") {
            const pins = await ipfsInstance.pin.ls({ paths: [hash] });
            
            if (pins && pins.length) {
              for (const pin of pins) {
                if (pin.cid && pin.cid.toString() === hash) {
                  return true;
                }
              }
            }
          }
          return false;
        } catch (error) {
          // If the error contains "not pinned", it means the file is simply not pinned
          if (error.message && error.message.includes("not pinned")) {
            return false;
          }
          return false;
        }
      }
    };

    // Add each method only if it doesn't already exist
    for (const [methodName, implementation] of Object.entries(methodsToAdd)) {
      if (!ipfsInstance[methodName]) {
        ipfsInstance[methodName] = implementation;
      }
    }
  }
  
  /**
   * Get the current configuration
   * @returns {Object} Current IPFS configuration
   */
  getConfig() {
    // Return a copy to prevent direct modification
    return {
      enabled: this.config.enabled,
      service: this.config.service,
      nodeUrl: this.config.nodeUrl,
      gateway: this.config.gateway,
      pinataGateway: this.config.pinataGateway,
      encryption: this.config.encryptionEnabled,
      // Mask sensitive data
      pinataJwt: this.config.pinataJwt ? "********" : "",
      apiKey: this.config.apiKey ? "********" : "",
    };
  }
  
  /**
   * Update configuration and reinitialize if needed
   * @param {Object} newConfig - New configuration
   * @returns {Object} Result of the update operation
   */
  updateConfig(newConfig) {
    const previousConfig = { ...this.config };
    
    // Update configuration fields if provided
    if (newConfig.enabled !== undefined) this.config.enabled = newConfig.enabled;
    if (newConfig.service) this.config.service = newConfig.service;
    if (newConfig.nodeUrl) this.config.nodeUrl = newConfig.nodeUrl;
    if (newConfig.gateway) this.config.gateway = newConfig.gateway;
    if (newConfig.pinataJwt) this.config.pinataJwt = newConfig.pinataJwt;
    if (newConfig.pinataGateway) this.config.pinataGateway = newConfig.pinataGateway;
    if (newConfig.encryptionEnabled !== undefined) this.config.encryptionEnabled = newConfig.encryptionEnabled;
    if (newConfig.apiKey) this.config.apiKey = newConfig.apiKey;
    
    // Reinitialize IPFS if enabled
    if (this.config.enabled) {
      this.shogunIpfs = this.initialize();
    } else {
      this.shogunIpfs = null;
    }
    
    return {
      success: true,
      previousConfig: this._maskSensitiveData(previousConfig),
      currentConfig: this._maskSensitiveData(this.config)
    };
  }
  
  /**
   * Create a copy of config with sensitive data masked
   * @param {Object} config - Configuration object to mask
   * @returns {Object} Masked configuration
   * @private
   */
  _maskSensitiveData(config) {
    const maskedConfig = { ...config };
    if (maskedConfig.pinataJwt) maskedConfig.pinataJwt = "********";
    if (maskedConfig.apiKey) maskedConfig.apiKey = "********";
    if (maskedConfig.encryptionKey) maskedConfig.encryptionKey = "********";
    return maskedConfig;
  }
  
  /**
   * Execute an IPFS operation safely
   * @param {Function} operation - Operation to execute
   * @param {string} errorMessage - Error message if operation fails
   * @returns {Promise<any>} Operation result
   * @private
   */
  async _safeOperation(operation, errorMessage) {
    if (!this.isEnabled()) {
      throw new Error("IPFS not enabled or not initialized");
    }
    
    try {
      return await operation();
    } catch (error) {
      throw new Error(`${errorMessage}: ${error.message}`);
    }
  }
  
  /**
   * Upload a JSON object to IPFS
   * @param {Object} jsonData - The JSON data to upload
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result
   */
  async uploadJson(jsonData, options = {}) {
    return this._safeOperation(
      () => this.shogunIpfs.uploadJson(jsonData, options),
      "Error uploading JSON to IPFS"
    );
  }
  
  /**
   * Upload a file to IPFS
   * @param {string|Buffer} filePathOrBuffer - File path or buffer
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result
   */
  async uploadFile(filePathOrBuffer, options = {}) {
    return this._safeOperation(
      () => this.shogunIpfs.uploadFile(filePathOrBuffer, options),
      "Error uploading file to IPFS"
    );
  }
  
  /**
   * Pin a file on IPFS
   * @param {string} hash - IPFS hash/CID to pin
   * @returns {Promise<Object>} Pin result
   */
  async pin(hash) {
    return this._safeOperation(
      () => this.shogunIpfs.pin(hash),
      `Error pinning hash ${hash}`
    );
  }
  
  /**
   * Unpin a file from IPFS
   * @param {string} hash - IPFS hash/CID to unpin
   * @returns {Promise<Object>} Unpin result
   */
  async unpin(hash) {
    return this._safeOperation(
      () => this.shogunIpfs.unpin(hash),
      `Error unpinning hash ${hash}`
    );
  }
  
  /**
   * Check if a file is pinned on IPFS
   * @param {string} hash - IPFS hash/CID to check
   * @returns {Promise<boolean>} True if pinned
   */
  async isPinned(hash) {
    if (!this.isEnabled()) {
      return false;
    }
    
    try {
      return await this.shogunIpfs.isPinned(hash);
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Fetch JSON data from IPFS
   * @param {string} hash - IPFS hash/CID to fetch
   * @returns {Promise<Object>} The fetched data
   */
  async fetchJson(hash) {
    return this._safeOperation(
      () => this.shogunIpfs.fetchJson(hash),
      `Error fetching JSON from hash ${hash}`
    );
  }
  
  /**
   * Check if IPFS is enabled and initialized
   * @returns {boolean} True if enabled and initialized
   */
  isEnabled() {
    return this.config.enabled && this.shogunIpfs !== null;
  }
  
  /**
   * Get the IPFS instance
   * @returns {Object|null} The IPFS instance or null if not initialized
   */
  getInstance() {
    return this.shogunIpfs;
  }
  
  /**
   * Get the IPFS gateway URL for a hash
   * @param {string} hash - IPFS hash/CID
   * @returns {string} The complete gateway URL
   */
  getGatewayUrl(hash) {
    if (!hash) return null;
    
    if (this.config.service === "PINATA" && this.config.pinataGateway) {
      return `${this.config.pinataGateway}/${hash}`;
    }
    
    return `${this.config.gateway}/${hash}`;
  }
  
  /**
   * Run a connection test
   * @returns {Promise<Object>} Test result
   */
  async testConnection() {
    if (!this.isEnabled()) {
      return { success: false, error: "IPFS not enabled or not initialized" };
    }
    
    try {
      // Create a simple test object
      const testJson = {
        test: true,
        timestamp: Date.now(),
        message: "Test connection",
      };
      
      // Try to upload it
      const result = await this.shogunIpfs.uploadJson(testJson, {
        name: "test-connection.json",
      });
      
      if (result && result.id) {
        // Test gateway access
        try {
          const gatewayUrl = this.getGatewayUrl(result.id);
          const client = gatewayUrl.startsWith("https") ? https : http;
          
          await new Promise((resolve, reject) => {
            const req = client.get(gatewayUrl, (res) => {
              if (res.statusCode === 200) {
                resolve();
              } else {
                reject(new Error(`Gateway returned status ${res.statusCode}`));
              }
            });
            req.on("error", reject);
            req.end();
          });
          
          return {
            success: true,
            hash: result.id,
            gatewayUrl,
            message: "Connection test successful, file accessible via gateway"
          };
        } catch (gatewayError) {
          return {
            success: true,
            hash: result.id,
            warning: "File uploaded but not accessible from gateway: " + gatewayError.message,
            message: "Gateway might be unavailable or require time for propagation"
          };
        }
      } else {
        throw new Error("Upload test failed, ID not received");
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default IpfsManager;
