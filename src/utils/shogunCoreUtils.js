import { ShogunCore, EntryPoint, Registry, SimpleRelay, RelayVerifier } from "shogun-core";
import { log, logError } from "./logger.js";

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
      log("ShogunCore initialized successfully");
    } catch (error) {
      logError("Error initializing ShogunCore:", error);
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
  
  // Use the RelayVerifier class directly from shogun-core
  return new RelayVerifier(registry, entryPoint, simpleRelay);
} 
}; 