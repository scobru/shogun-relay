import { ShogunCore } from "shogun-core";

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
        },
      };

      // ShogunCore initialized
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
    throw new Error(
      "ShogunCore not initialized and missing required parameters"
    );
  }

  return shogunCoreInstance;
}
