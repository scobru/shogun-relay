/**
 * Utility to force a write to GunDB with admin credentials
 * This bypasses normal validation by using the admin token directly
 */

/**
 * Perform a forced write to GunDB with admin privileges
 * @param {Object} gun - Gun instance
 * @param {string} path - Path to write to
 * @param {Object} data - Data to write
 * @param {string} adminToken - Admin token (usually from SECRET_TOKEN env var)
 * @returns {Promise<Object>} - Write result
 */
export async function forceGunWrite(gun, path, data, adminToken) {
  if (!gun || !path || !data || !adminToken) {
    throw new Error('Missing required parameters for forceGunWrite');
  }

  console.log(`Force writing to path: ${path}`);
  
  // Ensure we have headers configuration
  if (!gun._.opt.headers) {
    gun._.opt.headers = {};
  }

  // Set admin token in headers
  gun._.opt.headers.token = adminToken;
  gun._.opt.headers.Authorization = `Bearer ${adminToken}`;

  // Add timestamp to data to ensure uniqueness
  const enhancedData = {
    ...data,
    _ts: Date.now(),
    _forced: true
  };

  return new Promise((resolve) => {
    gun.get(path).put(enhancedData, (ack) => {
      console.log('Force write result:', ack);
      
      // Verify the write worked by reading it back
      gun.get(path).once((readData) => {
        console.log('Force write verification:', readData);
        
        resolve({
          success: !ack.err,
          ack: ack,
          data: readData
        });
      });
    });
  });
}

/**
 * Perform a user data write with auto-authentication
 * @param {Object} gun - Gun instance
 * @param {Object} keyPair - The keypair for authentication
 * @param {string} path - The path within user space to write to
 * @param {Object} data - The data to write
 * @returns {Promise<Object>} - Write result
 */
export async function writeUserData(gun, keyPair, path, data) {
  if (!gun || !keyPair || !path || !data) {
    throw new Error('Missing required parameters for writeUserData');
  }

  return new Promise((resolve) => {
    // Authenticate first
    gun.user().auth(keyPair, (authAck) => {
      if (authAck.err) {
        resolve({
          success: false,
          error: authAck.err,
          phase: 'auth'
        });
        return;
      }

      // Now write the data
      gun.user().get(path).put(data, (writeAck) => {
        if (writeAck.err) {
          resolve({
            success: false,
            error: writeAck.err,
            phase: 'write'
          });
          return;
        }

        // Verify by reading back
        gun.user().get(path).once((readData) => {
          resolve({
            success: true,
            data: readData
          });
        });
      });
    });
  });
} 