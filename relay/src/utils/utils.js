/**
 * Utility functions for the test-env
 */

import crypto from 'crypto';

/**
 * Converts a GunDB public key (base64) to Ethereum hex format
 * @param {string} pubKey - GunDB public key in base64 format
 * @returns {string} Ethereum hex format (0x prefix) or empty string on error
 */
export function gunPubKeyToHex(pubKey) {
  try {
    if (!pubKey) return '';
    
    // Remove any prefix that might be part of the pubKey
    const cleanPubKey = pubKey.replace(/^~/, "");
    
    // Convert to Buffer
    const pubKeyBuffer = Buffer.from(cleanPubKey, 'base64');
    
    // Convert to hex and ensure it has 0x prefix
    const hexKey = '0x' + pubKeyBuffer.toString('hex');
    
    return hexKey;
  } catch (error) {
    console.error("Error converting Gun pubKey to hex:", error);
    return "";
  }
}

/**
 * Converts a hex string to a GunDB public key format
 * @param {string} hexString - Hex string, with or without 0x prefix
 * @returns {string} GunDB public key in base64 format or empty string on error
 */
export function hexToGunPubKey(hexString) {
  try {
    if (!hexString) return '';
    
    // Remove 0x prefix if present
    const cleanHex = hexString.startsWith('0x') ? hexString.substring(2) : hexString;
    
    // Convert hex to Buffer
    const buffer = Buffer.from(cleanHex, 'hex');
    
    // Convert to base64
    return buffer.toString('base64');
  } catch (error) {
    console.error("Error converting hex to Gun pubKey:", error);
    return "";
  }
}

/**
 * Converts a hex string to a Buffer
 * 
 * @param {string} hexString - The hex string to convert
 * @returns {Buffer} - The resulting Buffer
 */
export function hexToBuffer(hexString) {
  // Remove 0x prefix if present
  const hex = hexString.startsWith('0x') ? hexString.slice(2) : hexString;
  
  // Ensure even length
  const paddedHex = hex.length % 2 === 0 ? hex : '0' + hex;
  
  return Buffer.from(paddedHex, 'hex');
}