import fs from 'fs';
import path from 'path';
import https from 'https';

// Load configuration
let CONFIG = {};
try {
  const configData = fs.readFileSync(path.join(process.cwd(), 'config.json'), 'utf8');
  CONFIG = JSON.parse(configData);
  console.log("Configuration loaded from config.json");
} catch (error) {
  console.error("Error loading config.json:", error.message);
  process.exit(1);
}

// SSL paths from config
const PRIVKEY_PATH = CONFIG.PRIVKEY_PATH || "";
const CERT_PATH = CONFIG.CERT_PATH || "";

if (!PRIVKEY_PATH || !CERT_PATH) {
  console.error("SSL paths not configured in config.json");
  console.log("Please run: node scripts/generate-pem-keys.js");
  process.exit(1);
}

// Resolve full paths
const privKeyPath = path.resolve(process.cwd(), PRIVKEY_PATH);
const certPath = path.resolve(process.cwd(), CERT_PATH);

console.log(`Verifying SSL certificates from config.json:`);
console.log(`Private key: ${privKeyPath}`);
console.log(`Certificate: ${certPath}`);

// Check if files exist
if (!fs.existsSync(privKeyPath)) {
  console.error(`ERROR: Private key file not found: ${privKeyPath}`);
  process.exit(1);
}

if (!fs.existsSync(certPath)) {
  console.error(`ERROR: Certificate file not found: ${certPath}`);
  process.exit(1);
}

// Try to read the files
try {
  const key = fs.readFileSync(privKeyPath, 'utf8');
  const cert = fs.readFileSync(certPath, 'utf8');
  
  console.log(`Successfully read certificate files.`);
  
  // Verify certificates by trying to create an HTTPS server
  try {
    const options = { key, cert };
    const server = https.createServer(options);
    
    // Just start and immediately close
    server.listen(0, () => {
      const port = server.address().port;
      console.log(`SUCCESS: SSL certificates are valid! (Test server started on port ${port})`);
      server.close(() => {
        console.log('Test server closed');
        process.exit(0);
      });
    });
  } catch (err) {
    console.error('ERROR: Certificates could not be used to create HTTPS server:');
    console.error(err);
    process.exit(1);
  }
} catch (err) {
  console.error('ERROR reading certificate files:');
  console.error(err);
  process.exit(1);
} 