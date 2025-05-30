import { MerkleTree } from "merkletreejs";
import keccak from "keccak";
import fs from "fs";
import path from "path";

// The key and root to verify
const keyToVerify = "WkTv8VdQy99R3Of3_vTNLa9gP0ai_53XPbMFOQkWoa4.IGY1jEXYM11AVsNLoGzcGDpcmMWBLSp56o1YyIHih-o";
const rootToCheck = "7a14c8857ff22071b6a93d9df6ffee432f6862abbf83443101181e2b572ade75";

// Path to the Merkle root file
const merkleRootFilePath = path.resolve("./merkle-root.json");

// Function to convert a GunDB key to the correct buffer format
function convertKeyToBuffer(rawKey) {
  if (!rawKey || typeof rawKey !== 'string') {
    console.log(`Invalid key type: ${typeof rawKey}`);
    return null;
  }
  
  try {
    // Extract the key parts for Gun format [pubkey].[otherstuff]
    let mainKey = rawKey;
    
    if (rawKey.startsWith('~') && rawKey.includes('.')) {
      const parts = rawKey.split('.');
      mainKey = parts[0].substring(1); // Remove the ~ prefix
    } else if (rawKey.startsWith('~')) {
      mainKey = rawKey.substring(1); // Remove the ~ prefix
    } else if (rawKey.includes('.')) {
      mainKey = rawKey.split('.')[0];
    }
    
    console.log(`Extracted main key: ${mainKey}`);
    
    // GunDB keys are typically base64 encoded
    // Convert base64url to base64 standard
    const base64Standard = mainKey
      .replace(/-/g, '+')
      .replace(/_/g, '/');
      
    // Add padding if needed
    const paddedBase64 = base64Standard.padEnd(
      base64Standard.length + (4 - (base64Standard.length % 4 || 4)) % 4, 
      '='
    );
    
    console.log(`Converted to standard base64: ${paddedBase64}`);
    
    // Now convert from base64 to buffer
    const keyBuffer = Buffer.from(paddedBase64, 'base64');
    console.log(`Successfully converted to buffer of length: ${keyBuffer.length}`);
    
    return keyBuffer;
  } catch (error) {
    console.error(`Error converting key: ${error.message}`);
    return null;
  }
}

// Hash function to match what's used in MerkleManager
function hashFn(data) {
  return keccak("keccak256").update(data).digest();
}

// Function to check if the current Merkle tree includes the key
async function checkIfKeyInCurrentTree() {
  try {
    // Load the current Merkle tree data
    if (fs.existsSync(merkleRootFilePath)) {
      const data = JSON.parse(fs.readFileSync(merkleRootFilePath, 'utf8'));
      console.log(`Current Merkle root: ${data.root}`);
      console.log(`Generated at: ${data.generatedAt} with ${data.pubKeysCount} pub keys`);
      
      if (data.root === rootToCheck) {
        console.log("The provided root matches the current Merkle tree root!");
      } else {
        console.log("The provided root does NOT match the current Merkle tree root.");
      }
    } else {
      console.log("No Merkle root file found. Cannot compare with current tree.");
    }
  } catch (error) {
    console.error(`Error reading Merkle root file: ${error.message}`);
  }
}

// Function to extract keys from radata for verification
async function extractKeysFromRadata(radataPath = "./radata") {
  const pubKeys = [];
  
  try {
    console.log(`Scanning radata directory: ${path.resolve(radataPath)}`);
    
    // List all files in radata
    const entries = fs.readdirSync(radataPath);
    console.log(`Found ${entries.length} entries in radata`);
    
    // Process each file
    for (const entry of entries) {
      const entryPath = path.join(radataPath, entry);
      const stats = fs.statSync(entryPath);
      
      if (stats.isFile()) {
        try {
          const content = fs.readFileSync(entryPath, "utf8");
          
          // Try to find pub keys
          const pubKeyRegex = /\"pub\"\s*:\s*\"([^\"]+)\"/g;
          let match;
          while ((match = pubKeyRegex.exec(content)) !== null) {
            const pubKey = match[1];
            if (pubKey && pubKey.length > 20) {
              if (pubKey === keyToVerify.split('.')[0] || pubKey === keyToVerify) {
                console.log(`FOUND THE KEY in file ${entry}!`);
                return true;
              }
            }
          }
        } catch (fileError) {
          // Ignore file read errors
        }
      }
    }
    
    console.log("Key not found in radata files");
    return false;
  } catch (error) {
    console.error(`Error scanning radata: ${error.message}`);
    return false;
  }
}

// Main verification function
async function verifyKey() {
  console.log("=== Merkle Tree Key Verification ===");
  console.log(`Key to verify: ${keyToVerify}`);
  console.log(`Root to check against: ${rootToCheck}`);
  
  // Convert the key to buffer format
  const keyBuffer = convertKeyToBuffer(keyToVerify);
  if (!keyBuffer) {
    console.error("Failed to convert key to buffer format");
    return;
  }
  
  // Check the current Merkle tree
  await checkIfKeyInCurrentTree();
  
  // Scan radata for the key
  console.log("\nScanning radata for the key...");
  const foundInRadata = await extractKeysFromRadata();
  
  // Create a new Merkle tree with all extracted keys
  console.log("\nVerifying key against provided root...");
  
  // Try direct key verification
  try {
    // Create a test Merkle tree with just this key
    const singleKeyTree = new MerkleTree([keyBuffer], hashFn, { sort: true });
    const singleKeyRoot = Buffer.from(singleKeyTree.getRoot()).toString("hex");
    
    console.log(`Single key Merkle root: ${singleKeyRoot}`);
    console.log(`Target root: ${rootToCheck}`);
    
    if (singleKeyRoot === rootToCheck) {
      console.log("MATCH! The key is the only key in the Merkle tree with this root");
      return;
    }
    
    // If we have the full tree, try to check if the key is in it
    if (fs.existsSync('./merkle-keys.json')) {
      console.log("Found stored keys, checking if key is in the full tree...");
      const allKeys = JSON.parse(fs.readFileSync('./merkle-keys.json', 'utf8'));
      
      const buffers = allKeys.map(key => {
        if (typeof key === 'string') {
          return Buffer.from(key, 'hex');
        }
        return Buffer.from(key);
      });
      
      // Add our key to check
      const hasKey = buffers.some(buf => buf.equals(keyBuffer));
      if (!hasKey) {
        buffers.push(keyBuffer);
      }
      
      // Create a full tree
      const fullTree = new MerkleTree(buffers, hashFn, { sort: true });
      const fullRoot = Buffer.from(fullTree.getRoot()).toString("hex");
      
      console.log(`Full tree root with our key: ${fullRoot}`);
      
      if (fullRoot === rootToCheck) {
        console.log("MATCH! The key is part of the Merkle tree with this root");
      } else if (hasKey) {
        console.log("The key is in our list but does not match the target root");
      } else {
        console.log("The key is not in our list and adding it changes the root");
      }
    } else {
      console.log("No stored keys found, cannot verify against full tree");
    }
    
    console.log("\nConclusion: The key cannot be verified against the provided root with available data");
    
  } catch (error) {
    console.error(`Error during verification: ${error.message}`);
  }
}

// Run the verification
verifyKey(); 