import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';

// Create a directory for the keys if it doesn't exist
const keysDir = path.join(process.cwd(), 'keys');
if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { recursive: true });
}

console.log('Generating SSL certificate for ActivityPub server...');

// Method 1: Using OpenSSL directly (more reliable for SSL certs)
try {
  console.log('Trying OpenSSL method...');
  
  // Generate private key
  const privateKeyPath = path.join(keysDir, 'private.key');
  execSync(`openssl genrsa -out "${privateKeyPath}" 2048`);
  
  // Generate self-signed certificate
  const certPath = path.join(keysDir, 'cert.pem');
  execSync(`openssl req -new -x509 -key "${privateKeyPath}" -out "${certPath}" -days 365 -subj "/CN=localhost"`);
  
  console.log('SSL keys generated successfully using OpenSSL!');
  console.log(`Private key saved to: ${privateKeyPath}`);
  console.log(`Certificate saved to: ${certPath}`);
  
  // Provide relative paths for config.json
  const relativePrivKeyPath = path.relative(process.cwd(), privateKeyPath).replace(/\\/g, '/');
  const relativeCertPath = path.relative(process.cwd(), certPath).replace(/\\/g, '/');
  
  console.log('\nUpdate your config.json file with these paths:');
  console.log(`"PRIVKEY_PATH": "${relativePrivKeyPath}",`);
  console.log(`"CERT_PATH": "${relativeCertPath}"`);
  
  process.exit(0);
} catch (err) {
  console.warn('OpenSSL not available, falling back to Node.js crypto:', err.message);
}

// Method 2: Using Node.js crypto (fallback)
crypto.generateKeyPair('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem'
  }
}, (err, publicKey, privateKey) => {
  if (err) {
    console.error('Error generating keys:', err);
    process.exit(1);
  }
  
  // Save the private key
  const privateKeyPath = path.join(keysDir, 'private.key');
  fs.writeFileSync(privateKeyPath, privateKey);
  
  // Save the public key (certificate)
  const certPath = path.join(keysDir, 'cert.pem');
  fs.writeFileSync(certPath, publicKey);
  
  console.log('SSL keys generated successfully using Node.js crypto!');
  console.log(`Private key saved to: ${privateKeyPath}`);
  console.log(`Certificate saved to: ${certPath}`);
  
  // Provide relative paths for config.json
  const relativePrivKeyPath = path.relative(process.cwd(), privateKeyPath).replace(/\\/g, '/');
  const relativeCertPath = path.relative(process.cwd(), certPath).replace(/\\/g, '/');
  
  console.log('\nUpdate your config.json file with these paths:');
  console.log(`"PRIVKEY_PATH": "${relativePrivKeyPath}",`);
  console.log(`"CERT_PATH": "${relativeCertPath}"`);
}); 