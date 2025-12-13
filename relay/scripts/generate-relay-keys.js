#!/usr/bin/env node

/**
 * Generate SEA Key Pair for Relay Admin
 * 
 * This script generates a GunDB SEA key pair that can be used
 * as the relay's admin keypair. This avoids the need for
 * username/password login and prevents "Signature did not match" errors.
 * 
 * Usage:
 *   node scripts/generate-relay-keys.js
 * 
 * The script will output:
 *   1. A JSON object with the key pair (save this securely!)
 *   2. Instructions for adding it to your .env file
 */

import Gun from 'gun';
import 'gun/sea';

async function generateRelayKeys() {
  console.log('🔑 Generating SEA key pair for relay admin...\n');

  try {
    // Generate new SEA key pair
    const pair = await Gun.SEA.pair();
    
    console.log('✅ Key pair generated successfully!\n');
    console.log('═══════════════════════════════════════════════════════');
    console.log('⚠️  IMPORTANT: SAVE THIS KEYPAIR IN A SECURE PLACE! ⚠️');
    console.log('═══════════════════════════════════════════════════════\n');
    
    // Output the key pair as JSON
    const keyPairJson = JSON.stringify(pair, null, 2);
    console.log('Key Pair JSON (add to your .env file):');
    console.log('───────────────────────────────────────────────────────');
    console.log(keyPairJson);
    console.log('───────────────────────────────────────────────────────\n');
    
    // Output just the public key for reference
    console.log('Public Key (for reference):');
    console.log(`  ${pair.pub}\n`);
    
    // Instructions
    console.log('📝 Instructions:');
    console.log('───────────────────────────────────────────────────────');
    console.log('1. Copy the JSON above');
    console.log('2. Add it to your .env file as:');
    console.log('   RELAY_SEA_KEYPAIR=\'{"pub":"...","priv":"...","epub":"...","epriv":"..."}\'');
    console.log('3. Or save it to a file and set:');
    console.log('   RELAY_SEA_KEYPAIR_PATH=/path/to/keypair.json');
    console.log('4. Restart your relay\n');
    
    console.log('🔒 Security Notes:');
    console.log('───────────────────────────────────────────────────────');
    console.log('- Keep the private key (priv, epriv) SECRET!');
    console.log('- Never commit this to version control');
    console.log('- Use environment variables or a secure secret manager');
    console.log('- The public key (pub) can be shared\n');
    
    // Also save to file for convenience (optional)
    const fs = await import('fs');
    const path = await import('path');
    
    const outputDir = path.join(process.cwd(), 'keys');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const outputFile = path.join(outputDir, 'relay-keypair.json');
    fs.writeFileSync(outputFile, keyPairJson, 'utf8');
    
    console.log(`💾 Key pair also saved to: ${outputFile}`);
    console.log('   (Make sure this file is in .gitignore!)\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error generating key pair:', error.message);
    process.exit(1);
  }
}

generateRelayKeys();

