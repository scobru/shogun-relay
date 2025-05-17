/**
 * GunDB Write Test Utility
 * 
 * This module provides functions to test writing to GunDB
 * after authentication has been completed.
 */

/**
 * Tests writing to GunDB after authentication
 * @param {Object} gun - The Gun instance
 * @param {string} pubKey - The public key of the authenticated user
 * @returns {Promise<Object>} - Results of the write tests
 */
export async function testWriteAfterAuth(gun, pubKey) {
  console.log("=== STARTING GUN WRITE TEST ===");
  console.log("Testing with public key:", pubKey);
  
  const results = {
    publicWrite: false,
    userWrite: false,
    errors: []
  };
  
  try {
    // Test 1: Write to a public space
    await writeToPublicSpace(gun, pubKey, results);
    
    // Test 2: Write to user space
    if (gun.user().is) {
      await writeToUserSpace(gun, results);
    } else {
      console.error("User is not authenticated, skipping user space write test");
      results.errors.push("User not authenticated for user space test");
    }
    
    console.log("=== GUN WRITE TEST COMPLETE ===");
    console.log("Results:", results);
    return results;
  } catch (error) {
    console.error("Error during write test:", error);
    results.errors.push(error.message);
    return results;
  }
}

/**
 * Write to public space in Gun
 * @param {Object} gun - The Gun instance
 * @param {string} pubKey - Public key for attribution
 * @param {Object} results - Results object to update
 * @returns {Promise<void>}
 */
async function writeToPublicSpace(gun, pubKey, results) {
  console.log("Testing write to public space...");
  
  const testData = {
    message: "Test public write",
    timestamp: Date.now(),
    pubKey: pubKey,
    random: Math.random().toString(36).substring(2)
  };
  
  return new Promise((resolve) => {
    gun.get("gun-test-public").put(testData, (ack) => {
      if (ack.err) {
        console.error("Error writing to public space:", ack.err);
        results.errors.push(`Public write error: ${ack.err}`);
        resolve();
      } else {
        console.log("Successfully wrote to public space!");
        results.publicWrite = true;
        
        // Verify by reading back
        gun.get("gun-test-public").once((data) => {
          console.log("Read back public data:", data);
          resolve();
        });
      }
    });
  });
}

/**
 * Write to user space in Gun
 * @param {Object} gun - The Gun instance
 * @param {Object} results - Results object to update
 * @returns {Promise<void>}
 */
async function writeToUserSpace(gun, results) {
  console.log("Testing write to user space...");
  
  const userData = {
    message: "Test user write",
    timestamp: Date.now(),
    random: Math.random().toString(36).substring(2)
  };
  
  return new Promise((resolve) => {
    gun.user().get("gun-test-user").put(userData, (ack) => {
      if (ack.err) {
        console.error("Error writing to user space:", ack.err);
        results.errors.push(`User write error: ${ack.err}`);
        resolve();
      } else {
        console.log("Successfully wrote to user space!");
        results.userWrite = true;
        
        // Verify by reading back
        gun.user().get("gun-test-user").once((data) => {
          console.log("Read back user data:", data);
          resolve();
        });
      }
    });
  });
}

/**
 * Utility function to perform diagnostics on Gun configuration
 * @param {Object} gun - The Gun instance
 * @param {Object} config - Server configuration object
 * @returns {Object} - Diagnostic information
 */
export function diagnoseGunConfiguration(gun, config) {
  const gunOptions = gun.opt || {};
  
  return {
    peerCount: Object.keys(gun._.opt.peers || {}).length,
    peers: Object.keys(gun._.opt.peers || {}),
    storageEnabled: !!gunOptions.file,
    storagePath: gunOptions.file || null,
    radiskEnabled: !!gunOptions.radisk,
    configSecretToken: config?.SECRET_TOKEN ? "Configured" : "Missing",
    configJwtSecret: config?.JWT_SECRET ? "Configured" : "Missing",
    relayEnabled: config?.RELAY_CONFIG?.relay?.onchainMembership === true,
  };
}

/**
 * Add this to your server code after successful authentication
 * 
 * Example usage:
 * 
 * import { testWriteAfterAuth } from './utils/gunWriteTest.js';
 * 
 * // After authentication succeeds:
 * const results = await testWriteAfterAuth(gun, publicKey);
 * console.log(results);
 */ 