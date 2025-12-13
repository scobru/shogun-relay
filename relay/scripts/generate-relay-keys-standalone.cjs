#!/usr/bin/env node

/**
 * Generate SEA Key Pair for Relay Admin (Standalone/CommonJS version)
 * 
 * This is a simplified CommonJS version that works in Dockerfile.
 * Uses .cjs extension to work even when package.json has "type": "module"
 * 
 * Usage:
 *   node scripts/generate-relay-keys-standalone.cjs [output-path]
 * 
 * Outputs:
 *   - Prints JSON to stdout (can be captured)
 *   - Optionally saves to file if output-path is provided
 */

const Gun = require('gun');
require('gun/sea');

async function generateRelayKeys(outputPath) {
  try {
    console.log('🔑 Generating SEA key pair for relay admin...\n');

    // Generate new SEA key pair
    const pair = await Gun.SEA.pair();
    
    const keyPairJson = JSON.stringify(pair, null, 2);
    
    // If output path provided, save to file
    if (outputPath) {
      const fs = require('fs');
      const path = require('path');
      
      const dir = path.dirname(outputPath);
      if (dir && dir !== '.') {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      
      fs.writeFileSync(outputPath, keyPairJson, 'utf8');
      console.log(`✅ Key pair saved to: ${outputPath}`);
      console.log(`🔑 Public key: ${pair.pub}\n`);
    } else {
      // Just print JSON to stdout (useful for Dockerfile capture)
      console.log(keyPairJson);
    }
    
    return pair;
  } catch (error) {
    console.error('❌ Error generating key pair:', error.message);
    process.exit(1);
  }
}

// Get output path from command line args
const outputPath = process.argv[2] || null;
const verbose = process.argv.includes('--verbose') || process.argv.includes('-v');

if (verbose && !outputPath) {
  console.log('⚠️  Running in verbose mode (use --verbose only with output path)');
  console.log('   For Dockerfile usage, just run: node scripts/generate-relay-keys-standalone.cjs\n');
}

generateRelayKeys(outputPath)
  .then(() => {
    if (!outputPath) {
      // If no output path, exit silently (JSON is in stdout)
      process.exit(0);
    }
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });

