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
      uploadsDir: config.uploadsDir || "./uploads"
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
      console.log('[IpfsManager] IPFS not enabled in configuration');
      return null;
    }

    try {
      console.log('[IpfsManager] Initializing IPFS with configuration:', JSON.stringify(this._maskSensitiveData(this.config)));
      
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
          console.error('[IpfsManager] JWT Pinata missing or invalid');
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
        console.error(`[IpfsManager] IPFS service not supported: ${this.config.service}`);
        throw new Error(`IPFS service not supported: ${this.config.service}`);
      }

      // Verify ShogunIpfs is defined
      if (typeof ShogunIpfs !== "function") {
        console.error('[IpfsManager] ShogunIpfs not available, check module import');
        throw new Error("ShogunIpfs not available, check module import");
      }

      // Create IPFS instance
      console.log('[IpfsManager] Creating ShogunIpfs instance');
      const ipfsInstance = new ShogunIpfs(ipfsConfig.storage);

      // Verify instance is valid
      if (!ipfsInstance || typeof ipfsInstance.uploadJson !== "function") {
        console.error('[IpfsManager] ShogunIpfs instance does not have uploadJson method');
        throw new Error("ShogunIpfs instance does not have uploadJson method");
      }

      // Add missing methods if needed
      this._addMissingMethods(ipfsInstance);

      this.shogunIpfs = ipfsInstance;
      console.log('[IpfsManager] IPFS successfully initialized');
      return ipfsInstance;
    } catch (error) {
      // Log detailed error
      console.error('[IpfsManager] Failed to initialize IPFS service:', error.message);
      
      // Disable IPFS in case of initialization error
      this.config.enabled = false;
      this.shogunIpfs = null;
      return null;
    }
  }
  
  /**
   * Attempt to reinitialize IPFS connection
   * @returns {Promise<boolean>} Success state
   */
  async reinitialize() {
    console.log('[IpfsManager] Attempting to reinitialize IPFS connection');
    
    // Force enabled to true for this attempt
    const wasEnabled = this.config.enabled;
    this.config.enabled = true;
    
    // Try to initialize
    const ipfsInstance = this.initialize();
    
    // If initialization failed, restore previous enabled state
    if (!ipfsInstance) {
      this.config.enabled = wasEnabled;
      console.error('[IpfsManager] Reinitialization failed');
      return false;
    }
    
    // Test connection with a simple operation
    try {
      // Simple test with a basic JSON upload
      const testResult = await this.testConnection();
      if (!testResult.success) {
        throw new Error(testResult.error || 'Connection test failed');
      }
      
      console.log('[IpfsManager] IPFS reinitialized and tested successfully');
      return true;
    } catch (error) {
      console.error('[IpfsManager] IPFS reinitialization test failed:', error.message);
      this.config.enabled = wasEnabled;
      return false;
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
    if (!this.isEnabled()) {
      throw new Error("IPFS not enabled or not initialized");
    }
    
    try {
      console.log(`[IpfsManager] Starting IPFS upload with options:`, {
        name: options.name,
        service: this.config.service,
        hasMetadata: !!options.metadata
      });
      
      const result = await this.shogunIpfs.uploadFile(filePathOrBuffer, options);
      
      if (result && result.id) {
        console.log(`[IpfsManager] IPFS upload successful: ${result.id}`);
        return result;
      } else {
        throw new Error("Upload completed but no hash received");
      }
    } catch (error) {
      console.error(`[IpfsManager] IPFS upload failed:`, {
        error: error.message,
        service: this.config.service,
        enabled: this.config.enabled
      });
      
      // Re-throw with more context
      throw new Error(`IPFS upload failed (${this.config.service}): ${error.message}`);
    }
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
   * Check if a file exists in IPFS
   * @param {string} hash - IPFS hash/CID to check
   * @returns {Promise<boolean>} True if file exists
   */
  async fileExists(hash) {
    if (!this.isEnabled()) {
      return false;
    }
    
    try {
      // Try to fetch the file metadata or content to check existence
      const gatewayUrl = this.getGatewayUrl(hash);
      const client = gatewayUrl.startsWith("https") ? https : http;
      
      return new Promise((resolve) => {
        const req = client.request(gatewayUrl, { method: 'HEAD' }, (res) => {
          resolve(res.statusCode === 200);
        });
        
        req.on('error', () => {
          resolve(false);
        });
        
        req.setTimeout(5000, () => {
          req.destroy();
          resolve(false);
        });
        
        req.end();
      });
    } catch (error) {
      console.error(`[IpfsManager] Error checking file existence for ${hash}:`, error.message);
      return false;
    }
  }
  
  /**
   * Get file information from IPFS
   * @param {string} hash - IPFS hash/CID to get info for
   * @returns {Promise<Object|null>} File information or null if not found
   */
  async getFileInfo(hash) {
    if (!this.isEnabled()) {
      return null;
    }
    
    try {
      // Check if file exists first
      const exists = await this.fileExists(hash);
      if (!exists) {
        return null;
      }
      
      // Try to get additional information
      const isPinned = await this.isPinned(hash);
      const gatewayUrl = this.getGatewayUrl(hash);
      
      return {
        hash,
        exists: true,
        isPinned,
        gatewayUrl,
        service: this.config.service,
        gateway: this.getDefaultGateway(),
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`[IpfsManager] Error getting file info for ${hash}:`, error.message);
      return null;
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
    if (!this.config.enabled || !this.shogunIpfs) {
      return false;
    }
    
    // Additional verification to ensure IPFS instance is properly configured
    try {
      // Check that the required methods exist
      if (typeof this.shogunIpfs.uploadFile !== 'function' || 
          typeof this.shogunIpfs.uploadJson !== 'function') {
        console.error('[IpfsManager] IPFS instance missing required methods');
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('[IpfsManager] Error checking IPFS initialization:', error.message);
      return false;
    }
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
  
  /**
   * Get the uploads directory
   * @returns {string} Path to uploads directory
   */
  getUploadsDir() {
    return this.config.uploadsDir;
  }
  
  /**
   * Check if IPFS is connected
   * @returns {boolean} True if connected to an IPFS node
   */
  isConnected() {
    if (!this.isEnabled()) {
      return false;
    }
    
    // If we have a shogunIpfs instance, consider it connected
    // The actual connection status will be verified with testConnection()
    return this.shogunIpfs !== null;
  }
  
  /**
   * Get the default gateway URL
   * @returns {string} Default gateway URL
   */
  getDefaultGateway() {
    if (this.config.service === "PINATA" && this.config.pinataGateway) {
      return this.config.pinataGateway;
    }
    return this.config.gateway || 'https://ipfs.io/ipfs';
  }
  
  /**
   * Get the node type (IPFS-CLIENT or PINATA)
   * @returns {string} Node type
   */
  getNodeType() {
    return this.config.service || 'IPFS-CLIENT';
  }
}

export default IpfsManager;
