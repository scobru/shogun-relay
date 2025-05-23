/**
 * Update Merkle Tree with GunDB Public Keys
 * 
 * This script extracts public keys from GunDB and updates the Merkle tree
 * in the test-env application.
 */

import fs from 'fs';
import path from 'path';
import keccak from 'keccak';
import MerkleTree from 'merkletreejs';

/**
 * Extracts the public key from a Gun ID (e.g., ~pubKey)
 * @param {string} id - Gun ID string containing public key
 * @returns {string|null} Extracted public key or null if not found
 */
function getPub(id) {
  const match = /~([^@][^\.]+\.[^\.]+)/.exec(id);
  return match ? match[1] : null;
}

/**
 * Extracts the first part of the public key (before the dot)
 * @param {string} pubKey - Full public key with dot notation
 * @returns {string} First part of the public key
 */
function getFirstPart(pubKey) {
  if (!pubKey) return null;
  const dotIndex = pubKey.indexOf(".");
  return dotIndex > 0 ? pubKey.substring(0, dotIndex) : pubKey;
}

/**
 * Converts a GunDB public key to hex format
 * @param {string} pubKey - GunDB public key
 * @returns {string} Hex representation with 0x prefix
 */
function gunPubKeyToHex(pubKey) {
  try {
    if (!pubKey) return '';
    
    // Remove ~ prefix if present
    let cleanKey = pubKey;
    if (cleanKey.startsWith("~")) {
      cleanKey = cleanKey.substring(1);
    }
    
    // Remove everything after the first period (if any)
    const dotIndex = cleanKey.indexOf(".");
    if (dotIndex > 0) {
      cleanKey = cleanKey.substring(0, dotIndex);
    }
    
    // Convert from GunDB's URL-safe base64 to standard base64 with padding
    const base64Key = cleanKey.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64Key.length % 4 === 0
      ? base64Key
      : base64Key.padEnd(base64Key.length + (4 - (base64Key.length % 4)), "=");
    
    // Convert to binary and then to hex
    const binaryData = Buffer.from(padded, "base64");
    const hexData = binaryData.toString("hex");
    
    // Add 0x prefix for blockchain compatibility
    return `0x${hexData}`;
  } catch (error) {
    console.error("Error converting GunDB public key to hex:", error);
    return "";
  }
}

/**
 * Process a GunDB key and extract information
 * @param {string} key - GunDB key in format ~pubKey.extraData
 * @returns {Object} Object containing extracted information
 */
function processKey(key) {
  console.log("\nProcessing key:", key);
  
  // Extract the public key
  const pubKey = getPub(key);
  console.log("Extracted public key:", pubKey);
  
  if (!pubKey) return null;
  
  // Get first part (before dot)
  const firstPart = getFirstPart(pubKey);
  console.log("First part (before dot):", firstPart);
  
  // Convert to hex format
  const hexKey = gunPubKeyToHex(pubKey);
  console.log("Hex format (for blockchain):", hexKey);
  
  return {
    original: key,
    pubKey: pubKey,
    firstPart: firstPart,
    hexKey: hexKey
  };
}

/**
 * Read keys from a file
 * @param {string} filePath - Path to the file containing keys
 * @returns {Array<string>} Array of keys
 */
function readKeysFromFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    return fileContent.split('\n').filter(line => line.trim());
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return [];
  }
}

/**
 * Update the Merkle tree in the test-env/src/index.js file
 * @param {Array<string>} hexKeys - Array of hex keys to include in the Merkle tree
 */
function updateMerkleTree(hexKeys) {
  const indexFilePath = path.join(process.cwd(), 'test-env', 'src', 'index.js');
  
  try {
    // Read the current file
    let fileContent = fs.readFileSync(indexFilePath, 'utf8');
    
    // Create the new allowedPubKeys array content
    const newAllowedPubKeys = hexKeys.map(key => `  Buffer.from("${key}", 'hex'),`).join('\n');
    
    // Replace the existing allowedPubKeys array
    const allowedPubKeysRegex = /let allowedPubKeys = \[\n([\s\S]*?)\];/;
    fileContent = fileContent.replace(allowedPubKeysRegex, `let allowedPubKeys = [\n${newAllowedPubKeys}\n];`);
    
    // Write the updated content back to the file
    fs.writeFileSync(indexFilePath, fileContent);
    
    console.log(`\nSuccessfully updated Merkle tree in ${indexFilePath}`);
    
    // Calculate the new Merkle root
    const buffers = hexKeys.map(key => Buffer.from(key.replace(/^0x/, ''), 'hex'));
    const merkleTree = new MerkleTree(buffers, x => keccak('keccak256').update(x).digest(), { sort: true });
    const root = Buffer.from(merkleTree.getRoot()).toString('hex');
    
    console.log(`\nNew Merkle root: ${root}`);
    
  } catch (error) {
    console.error(`Error updating Merkle tree in ${indexFilePath}:`, error.message);
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log("\nUsage: node update-merkle-tree.js <key1> <key2> ... <keyN>");
    console.log("Or: node update-merkle-tree.js --file=keys.txt");
    return;
  }
  
  let keys = [];
  
  // Check if we should read from a file
  const fileArg = args.find(arg => arg.startsWith('--file='));
  if (fileArg) {
    const filePath = fileArg.split('=')[1];
    keys = readKeysFromFile(filePath);
    console.log(`\nProcessing ${keys.length} keys from file: ${filePath}`);
  } else {
    // Use the arguments as keys
    keys = args;
    console.log(`\nProcessing ${keys.length} keys from command line arguments`);
  }
  
  // Process all keys
  const processedKeys = keys
    .map(key => processKey(key))
    .filter(result => result !== null && result.hexKey);
  
  // Extract hex keys
  const hexKeys = processedKeys.map(result => result.hexKey);
  
  if (hexKeys.length === 0) {
    console.log("\nNo valid keys to update the Merkle tree with.");
    return;
  }
  
  // Update the Merkle tree
  updateMerkleTree(hexKeys);
}

// Run the main function
main().catch(error => {
  console.error("Error:", error);
  process.exit(1);
}); 