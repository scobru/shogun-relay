/**
 * Utility functions for the test-env
 */

import crypto from 'crypto';

/**
 * Converts a GunDB SEA format public key to Ethereum-compatible hex format
 * GunDB uses a modified base64 format for public keys, Ethereum expects hex
 * 
 * @param {string} gunPubKey - The GunDB public key in SEA format
 * @returns {string} - Hex format suitable for Ethereum contracts (without 0x prefix)
 */
function gunPubKeyToHex(gunPubKey) {
  try {
    if (!gunPubKey || typeof gunPubKey !== 'string') {
      console.error('[utils] Invalid public key:', gunPubKey);
      return null;
    }

    // Remove the ~ prefix if present
    if (gunPubKey.startsWith('~')) {
      gunPubKey = gunPubKey.substring(1);
    }

    // Remove anything after a . if present (often used in GunDB for separating pub and epub)
    const dotIndex = gunPubKey.indexOf('.');
    if (dotIndex > 0) {
      gunPubKey = gunPubKey.substring(0, dotIndex);
    }

    // Convert from GunDB's URL-safe base64 to standard base64
    const base64Key = gunPubKey
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    
    // Add padding if needed
    const padded = base64Key.length % 4 === 0
      ? base64Key
      : base64Key.padEnd(base64Key.length + (4 - (base64Key.length % 4)), '=');
    
    // Convert to binary and then to hex
    const binaryData = Buffer.from(padded, 'base64');
    const hexData = binaryData.toString('hex');
    
    return hexData;
  } catch (error) {
    console.error('[utils] Error converting GunDB public key to hex:', error.message);
    return null;
  }
}

/**
 * Converts a hex string to a Buffer
 * 
 * @param {string} hexString - The hex string to convert
 * @returns {Buffer} - The resulting Buffer
 */
function hexToBuffer(hexString) {
  // Remove 0x prefix if present
  const hex = hexString.startsWith('0x') ? hexString.slice(2) : hexString;
  
  // Ensure even length
  const paddedHex = hex.length % 2 === 0 ? hex : '0' + hex;
  
  return Buffer.from(paddedHex, 'hex');
}

/**
 * Converts a hex string to GunDB SEA format
 * 
 * @param {string} hexString - The hex string to convert
 * @returns {string} - The public key in GunDB SEA format
 */
function hexToGunPubKey(hexString) {
  try {
    const buffer = hexToBuffer(hexString);
    return buffer.toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch (error) {
    console.error('[utils] Error converting hex to GunDB public key:', error.message);
    return null;
  }
}

export {
  gunPubKeyToHex,
  hexToGunPubKey,
  hexToBuffer
}; 