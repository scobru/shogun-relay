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
      console.log("IPFS not enabled, initialization skipped");
      return null;
    }

    try {
      console.log("Initializing IPFS with configuration:", {
        service: this.config.service,
        nodeUrl: this.config.nodeUrl,
        gateway: this.config.gateway,
        hasCredentials:
          this.config.service === "PINATA" &&
          this.config.pinataJwt &&
          this.config.pinataJwt.length > 10,
      });

      // Configuration according to documentation
      const ipfsConfig = {
        storage: {
          service: this.config.service || "IPFS-CLIENT", // Ensure service always has a value
          config: {
            url: this.config.nodeUrl,
            apiKey: this.config.apiKey, // Pass secret token as apiKey
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
        console.log("Configured IPFS with Pinata service");
      } else if (this.config.service === "IPFS-CLIENT") {
        ipfsConfig.storage.config = {
          url: this.config.nodeUrl,
          apiKey: this.config.apiKey,
        };
        console.log(
          "Configured IPFS with IPFS-CLIENT, URL:",
          this.config.nodeUrl
        );
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

      // Add pin/unpin methods if they don't exist
      this._addMissingMethods(ipfsInstance);

      // Verify connection if possible
      if (typeof ipfsInstance.isConnected === "function") {
        ipfsInstance
          .isConnected()
          .then((connected) => {
            console.log(
              `IPFS connection verified: ${connected ? "OK" : "Failed"}`
            );
          })
          .catch((err) => {
            console.warn("Unable to verify IPFS connection:", err.message);
          });
      }

      console.log("ShogunIpfs initialized successfully");
      this.shogunIpfs = ipfsInstance;
      return ipfsInstance;
    } catch (error) {
      console.error("IPFS initialization error:", error);
      console.error("Error details:", error.message);

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
    // Add pin method if missing
    if (!ipfsInstance.pin) {
      console.log("pin method not found, added fallback");
      ipfsInstance.pin = async (hash) => {
        if (
          ipfsInstance.getStorage &&
          typeof ipfsInstance.getStorage === "function"
        ) {
          const storage = ipfsInstance.getStorage();
          if (storage && typeof storage.pin === "function") {
            return storage.pin(hash);
          }
        }
        console.warn(
          "IPFS library method pin not supported, returning simulated success"
        );
        return { success: true, simulated: true };
      };
    }

    // Add unpin method if missing
    if (!ipfsInstance.unpin) {
      console.log("unpin method not found, added fallback");
      ipfsInstance.unpin = async (hash) => {
        if (
          ipfsInstance.getStorage &&
          typeof ipfsInstance.getStorage === "function"
        ) {
          const storage = ipfsInstance.getStorage();
          if (storage && typeof storage.unpin === "function") {
            return storage.unpin(hash);
          }
        }
        console.warn(
          "IPFS library method unpin not supported, returning simulated success"
        );
        return { success: true, simulated: true };
      };
    }

    // Add isPinned method if missing
    if (!ipfsInstance.isPinned) {
      console.log("isPinned method not found, added fallback");
      ipfsInstance.isPinned = async (hash) => {
        if (
          ipfsInstance.getStorage &&
          typeof ipfsInstance.getStorage === "function"
        ) {
          const storage = ipfsInstance.getStorage();
          if (storage && typeof storage.isPinned === "function") {
            return storage.isPinned(hash);
          }
        }

        try {
          // Try to verify if the file is pinned
          if (
            typeof ipfsInstance.pin === "function" &&
            typeof ipfsInstance.pin.ls === "function"
          ) {
            const pins = await ipfsInstance.pin.ls({ paths: [hash] });
            let found = false;

            // Convert to array if needed
            if (pins && pins.length) {
              for (const pin of pins) {
                if (pin.cid && pin.cid.toString() === hash) {
                  found = true;
                  break;
                }
              }
            }

            return found;
          } else {
            console.warn(
              "IPFS library method pin.ls not supported, returning false"
            );
            return false;
          }
        } catch (error) {
          // If the error contains "not pinned", it means the file is simply not pinned
          if (error.message && error.message.includes("not pinned")) {
            console.log(
              `File ${hash} not pinned, normal error:`,
              error.message
            );
            return false;
          }

          console.warn(
            `Error during pin verification for ${hash}:`,
            error.message
          );
          return false;
        }
      };
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
      previousConfig: {
        ...previousConfig,
        pinataJwt: previousConfig.pinataJwt ? "********" : "",
        apiKey: previousConfig.apiKey ? "********" : "",
      },
      currentConfig: {
        ...this.config,
        pinataJwt: this.config.pinataJwt ? "********" : "",
        apiKey: this.config.apiKey ? "********" : "",
      }
    };
  }
  
  /**
   * Upload a JSON object to IPFS
   * @param {Object} jsonData - The JSON data to upload
   * @param {Object} options - Upload options
   * @returns {Promise<Object>} Upload result
   */
  async uploadJson(jsonData, options = {}) {
    if (!this.isEnabled()) {
      throw new Error("IPFS not enabled or not initialized");
    }
    
    try {
      const result = await this.shogunIpfs.uploadJson(jsonData, options);
      return result;
    } catch (error) {
      console.error("Error uploading JSON to IPFS:", error);
      throw error;
    }
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
      const result = await this.shogunIpfs.uploadFile(filePathOrBuffer, options);
      return result;
    } catch (error) {
      console.error("Error uploading file to IPFS:", error);
      throw error;
    }
  }
  
  /**
   * Pin a file on IPFS
   * @param {string} hash - IPFS hash/CID to pin
   * @returns {Promise<Object>} Pin result
   */
  async pin(hash) {
    if (!this.isEnabled()) {
      throw new Error("IPFS not enabled or not initialized");
    }
    
    try {
      return await this.shogunIpfs.pin(hash);
    } catch (error) {
      console.error(`Error pinning hash ${hash}:`, error);
      throw error;
    }
  }
  
  /**
   * Unpin a file from IPFS
   * @param {string} hash - IPFS hash/CID to unpin
   * @returns {Promise<Object>} Unpin result
   */
  async unpin(hash) {
    if (!this.isEnabled()) {
      throw new Error("IPFS not enabled or not initialized");
    }
    
    try {
      return await this.shogunIpfs.unpin(hash);
    } catch (error) {
      console.error(`Error unpinning hash ${hash}:`, error);
      throw error;
    }
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
      console.error(`Error checking pin status for hash ${hash}:`, error);
      return false;
    }
  }
  
  /**
   * Fetch JSON data from IPFS
   * @param {string} hash - IPFS hash/CID to fetch
   * @returns {Promise<Object>} The fetched data
   */
  async fetchJson(hash) {
    if (!this.isEnabled()) {
      throw new Error("IPFS not enabled or not initialized");
    }
    
    try {
      return await this.shogunIpfs.fetchJson(hash);
    } catch (error) {
      console.error(`Error fetching JSON from hash ${hash}:`, error);
      throw error;
    }
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
      console.error("IPFS connection test failed:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default IpfsManager;
