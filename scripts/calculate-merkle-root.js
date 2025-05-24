import path from "path";
import fs from "fs";
import { MerkleManager } from "../src/utils/merkleUtils.js";

// Get command line arguments
const args = process.argv.slice(2);
const radataPath = args[0] || path.resolve("./radata");
const outputPath = args[1] || path.resolve("./merkle-root.json");

console.log(`Calculating Merkle root from: ${radataPath}`);
console.log(`Output will be saved to: ${outputPath}`);

async function calculateAndSaveMerkleRoot() {
  try {
    // Initialize Merkle Manager with the specified radata path
    const merkleManager = new MerkleManager(radataPath);
    
    console.log("Extracting pub keys and building Merkle tree...");
    await merkleManager.initialize();
    
    // Get the calculated root
    const root = merkleManager.getRoot();
    console.log(`Merkle root calculated: ${root}`);
    
    // Create output data
    const outputData = {
      root,
      timestamp: Date.now(),
      pubKeysCount: merkleManager.allowedPubKeys.length,
      generatedAt: new Date().toISOString()
    };
    
    // Save to JSON file
    fs.writeFileSync(outputPath, JSON.stringify(outputData, null, 2));
    console.log(`Merkle root data saved to ${outputPath}`);
    
    return root;
  } catch (error) {
    console.error("Error calculating Merkle root:", error);
    process.exit(1);
  }
}

// Run the calculation
calculateAndSaveMerkleRoot()
  .then(() => {
    console.log("Merkle root calculation completed successfully");
    process.exit(0);
  })
  .catch(error => {
    console.error("Failed to calculate Merkle root:", error);
    process.exit(1);
  }); 