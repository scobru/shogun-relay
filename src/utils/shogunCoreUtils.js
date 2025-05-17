import { ShogunCore, EntryPoint, Registry, SimpleRelay, RelayVerifier } from "shogun-core";

// Singleton for the ShogunCore instance
let shogunCoreInstance = null;

/**
 * Initialize ShogunCore with configuration
 * @param {object} gun - GunDB instance
 * @param {string} authToken - Auth token for ShogunCore
 * @returns {ShogunCore} - The initialized ShogunCore instance
 */
export function initializeShogunCore(gun, authToken) {
  if (!shogunCoreInstance) {
    try {
      const config = {
        gun,
        authToken,
        timeouts: {
          login: 15000,
          signup: 30000,
        }
      };

      shogunCoreInstance = new ShogunCore(config);
      console.log("ShogunCore initialized successfully");
    } catch (error) {
      console.error("Error initializing ShogunCore:", error);
      throw new Error(`ShogunCore initialization failed: ${error.message}`);
    }
  }
  return shogunCoreInstance;
}

/**
 * Get the already initialized ShogunCore instance
 * @returns {ShogunCore|null} The ShogunCore instance or null if not initialized
 */
export function getInitializedShogunCore() {
  return shogunCoreInstance;
}

/**
 * Ensure ShogunCore is initialized, initializing it if necessary
 * @param {object} gun - GunDB instance (optional if already initialized)
 * @param {string} authToken - Auth token (optional if already initialized)
 * @returns {ShogunCore} The ShogunCore instance
 */
export function ensureShogunCoreInitialized(gun, authToken) {
  if (!shogunCoreInstance && gun && authToken) {
    return initializeShogunCore(gun, authToken);
  }
  
  if (!shogunCoreInstance) {
    throw new Error("ShogunCore not initialized and missing required parameters");
  }
  
  return shogunCoreInstance;
}

/**
 * Initialize relay contracts for blockchain verification
 * @param {object} config - Relay configuration
 * @param {ShogunCore} coreInstance - ShogunCore instance
 * @param {ethers.Signer} signer - Optional signer for write operations
 * @returns {object} - Object with relayVerifier and didVerifier instances
 */
export async function initializeRelayContracts(config, coreInstance, signer = null) {
  try {
    const results = {};
    
    // Initialize Registry if address is provided
    if (config.relay?.registryAddress) {
      console.log(`Initializing Registry with address: ${config.relay.registryAddress}`);
      results.registry = new Registry({
        registryAddress: config.relay.registryAddress,
        providerUrl: config.relay.providerUrl,
        signer
      });
    }
    
    // Initialize EntryPoint if registry and entryPoint addresses are provided
    if (config.relay?.registryAddress && config.relay?.entryPointAddress) {
      console.log(`Initializing EntryPoint with address: ${config.relay.entryPointAddress}`);
      results.entryPoint = new EntryPoint({
        entryPointAddress: config.relay.entryPointAddress,
        registryAddress: config.relay.registryAddress,
        providerUrl: config.relay.providerUrl,
        signer
      });
    }
    
    // Initialize SimpleRelay if address is provided
    if (config.relay?.individualRelayAddress) {
      console.log(`Initializing SimpleRelay with address: ${config.relay.individualRelayAddress}`);
      results.simpleRelay = new SimpleRelay({
        relayAddress: config.relay.individualRelayAddress,
        providerUrl: config.relay.providerUrl,
        signer
      });
    }
    
    return results;
  } catch (error) {
    console.error("Error initializing relay contracts:", error);
    throw error;
  }
}

/**
 * Create a unified relay verifier instance using the available contracts
 * @param {object} contracts - Contract instances (registry, entryPoint, simpleRelay)
 * @returns {object} - A relay verifier object with helper methods
 */
export function createRelayVerifier(contracts) {
  const { registry, entryPoint, simpleRelay } = contracts;
  
  // Create a custom RelayVerifier with proper hex format for isSubscribed
  const relayVerifier = new RelayVerifier(registry, entryPoint, simpleRelay);
  
  // Wrap the default isPublicKeyAuthorized method to ensure proper format
  const originalIsPublicKeyAuthorized = relayVerifier.isPublicKeyAuthorized.bind(relayVerifier);
  relayVerifier.isPublicKeyAuthorized = async function(relayAddress, pubKey) {
    try {
      console.log(`Verifying public key authorization: ${pubKey}`);
      
      // If pubKey is a base64 GunDB key, convert it properly to hex
      if (pubKey && !pubKey.startsWith('0x') && pubKey.includes('/') || pubKey.includes('+') || pubKey.includes('=')) {
        // Clean the key - remove anything after '.' if present
        const cleanPubKey = pubKey.split('.')[0].replace(/~/g, '');
        
        // Convert from base64 to hex with proper padding
        const base64Key = cleanPubKey.replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64Key.length % 4 === 0 
          ? base64Key 
          : base64Key.padEnd(base64Key.length + (4 - (base64Key.length % 4)), "=");
        
        const binaryData = Buffer.from(padded, "base64");
        const hexKey = binaryData.toString("hex");
        
        // Always add 0x prefix for ethers.js v6
        const hexKeyWithPrefix = hexKey.startsWith('0x') ? hexKey : `0x${hexKey}`;
        
        console.log(`Hex format with prefix: ${hexKeyWithPrefix}`);
        
        // Call the original method with properly formatted key
        return await originalIsPublicKeyAuthorized(relayAddress, hexKeyWithPrefix);
      }
      
      // If already hex but missing 0x prefix, add it
      if (pubKey && !pubKey.startsWith('0x') && /^[0-9a-fA-F]+$/.test(pubKey)) {
        const hexKeyWithPrefix = `0x${pubKey}`;
        console.log(`Adding 0x prefix to hex key: ${hexKeyWithPrefix}`);
        return await originalIsPublicKeyAuthorized(relayAddress, hexKeyWithPrefix);
      }
      
      // Otherwise use the original key
      return await originalIsPublicKeyAuthorized(relayAddress, pubKey);
    } catch (error) {
      console.error("Error in custom isPublicKeyAuthorized:", error);
      return false;
    }
  };
  
  return relayVerifier;
} 
