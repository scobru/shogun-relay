import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { spawnSync } from 'child_process';

// Create a directory for the keys if it doesn't exist
const keysDir = path.join(process.cwd(), 'keys');
if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { recursive: true });
}

console.log('Generating SSL certificate for ActivityPub server...');

// Function to create a self-signed certificate using OpenSSL commands manually
function generateWithOpenSSLCommands() {
  try {
    // Windows-compatible paths
    const keyPath = path.join(keysDir, 'private.key');
    const certPath = path.join(keysDir, 'cert.pem');
    const configPath = path.join(keysDir, 'openssl.cnf');
    
    // Create a minimal OpenSSL config
    const opensslConfig = `
[req]
distinguished_name = req_distinguished_name
req_extensions = v3_req
prompt = no

[req_distinguished_name]
CN = localhost

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
`;
    
    // Write the config file
    fs.writeFileSync(configPath, opensslConfig);
    
    // Generate the key
    console.log('Generating private key...');
    const keyResult = spawnSync('openssl', [
      'genrsa',
      '-out', keyPath,
      '2048'
    ], { encoding: 'utf8' });
    
    if (keyResult.error) {
      throw new Error(`Failed to generate key: ${keyResult.error.message}`);
    }
    
    // Generate the certificate
    console.log('Generating self-signed certificate...');
    const certResult = spawnSync('openssl', [
      'req',
      '-new',
      '-x509',
      '-key', keyPath,
      '-out', certPath,
      '-days', '365',
      '-config', configPath
    ], { encoding: 'utf8' });
    
    if (certResult.error) {
      throw new Error(`Failed to generate certificate: ${certResult.error.message}`);
    }
    
    console.log('SSL keys generated successfully!');
    console.log(`Private key saved to: ${keyPath}`);
    console.log(`Certificate saved to: ${certPath}`);
    
    // Clean up config
    fs.unlinkSync(configPath);
    
    return { 
      privateKeyPath: keyPath, 
      certPath: certPath 
    };
  } catch (error) {
    console.error('Error using OpenSSL commands:', error.message);
    return null;
  }
}

// Function to create a very basic self-signed certificate using Node.js only
function generateWithNodeJS() {
  try {
    console.log('Generating key material using Node.js...');
    
    // Create paths for the files
    const privateKeyPath = path.join(keysDir, 'private.key');
    const certPath = path.join(keysDir, 'cert.pem');
    
    // Use a matching key-certificate pair (these are guaranteed to match)
    // This is a self-signed certificate for development use only
    const privateKey = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDV7Z3rx/iHigKh
I07BHHpkl9bkPIvA3yidUQw+UKtONVH9jC8XZKPtNAJBT3lbHa/Xb92OcB8UU31e
vQXKYrA94vGrFJuCMvVYP2Fef7Xah06V/FW7JlKPW6o+M52jxOVimxeNVVZ1kSFw
xz4yl3aO2k2a1LGnrJJEB5kiiVQuvGHl02KD0YyTHsU6CWvT9kGQTfgKKjGJcO84
0wGLBOk5EQh9u028pUMGEYpKupx2/V+J7IeMxk8V6x4WAr+lkCbF94lSAl3qZ0Q5
Q1XbMzKS1LqZDQ8qDgNvQEt6NHa/DNXKZX21QlWgQcXwQgQNGzI4wEIKxFXpWmtG
GPTkOsYJAgMBAAECggEAFlrUMhAsNYnD9Xz30yHJLXkVctmvYnZNZ/gTWfyUQFCG
eUKbFm/OKdHyLQc4IrHMnlCDlJJrqQSMTcGqm7AlxFW6w2JFP/xJHiJyXuQ5U/1r
T3/X1pxASjC20AibSGBVNbK0xSiBLn+yDR3CMmZYQkqXhXJEUJN6DJxQCDtcA9QV
P2qKtgUvFHc+m9GsAWA92+ZEACPmM9LAXcfM4xaPdCQGxfZ/xsgZKjhmYcREKXQs
Yv+SPvGnCif/AD2U4vxbJOlECBEDGYNTtc8ZEu9N7PGlN7JLUFvoZHSKnuP2r6F2
4Kp5XWQzKPTZ8yecAcw+AI/f9s4sMCLNV0Eo+NV3sQKBgQD0VGD6Yxz322y/qj8Y
hV/i55DDgbxNgB7OgBBB2dZe7gpQQHxmNBqImClYA3Q10TMsBdPGEYLSjGzA1Qnc
8U5JdTmF3XMFTnQHDxZCQF0g0hYYZO7J3FbK1JOdAmZ0SLXSx9QlqZ7mrw/H82Gz
jc4F4yMDKr7YRR/ZF1C30XfdJQKBgQDf96DzQnMrTCz1GPKjZJV8Qdbd4A0x3lMS
AZsVQZ1ePf2f0oQKZL9qyQ0xVI8x23qdKN9U+ksXJKYvnIEnwQX1OGJLlnK0oaDe
/+iAD8BzpnUlI1lpNy8/x4+G4V0RFoFJgm4C2GCjgPBSw2DE1aQpJJ+nN1lELHrE
G7j6B8zQ1QKBgQDYm4G7gQ2Xw5I86NUGFCZJNUoyQ/ZnJIBWQvZBrVP9IqSQUTaB
BUAwDI3KJjJUDEG54+W9rL8KQRHvKr1IzUFTiPZCSf0buuOyfDiD1I1PwDPmLqAr
FNj1zzCdlz3kGmbmqqhIveXsb4yb1QRbxTUPxPXn4ROBCnT2ZiKcCgKMfQKBgEJ+
LXmMpjeH3bFOxTHQAwB6VhLWMICDNi96VIopYH2CqYwxTCUTdXGJeLVZxM0n8hkd
w67TOA4xKUvfnGZOLW5d4q46mqCzOdAOJO5hRZRZqAYGJ7UUGLM5iqgYFllJSo9h
OXxR/qfQvYLIZeKQD6G+xHMpDw7vQRVDBTFnY2PVAoGAb/2W1Oi/xM07RsVupzE7
tRU9HbJuQkFkLKXyHgQQ4YDJPnmoChzL+4a/B3NNE0GOKdCJm5TA1PrRP+cw0o1Z
LQhUCN7VZ3XHkMHFzHEIQGkPe4+b4k0nJpbqlcqRnFcYBmG7pUHAwtDc95MTMX5f
fhHlMgvd60MCKr0RcqPD+0g=
-----END PRIVATE KEY-----`;

    const certificate = `-----BEGIN CERTIFICATE-----
MIIDazCCAlOgAwIBAgIUMDEavXKZ3Ko8uelYt9jgGjfOo2IwDQYJKoZIhvcNAQEL
BQAwRTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUxITAfBgNVBAoM
GEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAeFw0yMzA2MDQwMzU1MjhaFw0yNDA2
MDMwMzU1MjhaMEUxCzAJBgNVBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEw
HwYDVQQKDBhJbnRlcm5ldCBXaWRnaXRzIFB0eSBMdGQwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQDV7Z3rx/iHigKhI07BHHpkl9bkPIvA3yidUQw+UKtO
NVH9jC8XZKPtNAJBT3lbHa/Xb92OcB8UU31evQXKYrA94vGrFJuCMvVYP2Fef7Xa
h06V/FW7JlKPW6o+M52jxOVimxeNVVZ1kSFwxz4yl3aO2k2a1LGnrJJEB5kiiVQu
vGHl02KD0YyTHsU6CWvT9kGQTfgKKjGJcO840wGLBOk5EQh9u028pUMGEYpKupx2
/V+J7IeMxk8V6x4WAr+lkCbF94lSAl3qZ0Q5Q1XbMzKS1LqZDQ8qDgNvQEt6NHa/
DNXKZX21QlWgQcXwQgQNGzI4wEIKxFXpWmtGGPTkOsYJAgMBAAGjUzBRMB0GA1Ud
DgQWBBTafIMVnHXltA9C/JDXDP0G7EWXpzAfBgNVHSMEGDAWgBTafIMVnHXltA9C
/JDXDP0G7EWXpzAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBK
f+lXVkfANQUZyRFZm773DfkfaGOxPh7gJc4OCJQrPVRZhP7+xhAzVZ5yk5MmGJyO
kQGQ7QfQO7ncV5iwOxTiUcX+9hZVkIiCtLI5W9EJcbOJZO7bHYtGXGRpjCHELGGc
lWnKVcnUE7TYNyWVGsRGBFQXnWn3xWZUxuUxHZi5tOQmK7yKQtV5rJZOfw2YErny
7NUx61n7DdqWGlvxHnpcgm5dlaGpeSJKf+7bHXEEpqEWtD/mJYcyhr2mqOK1Vutk
OL0mwVZNkrDyjTc+/LyWFJOAWoD0MtJAFF2PPFjKAj+12GIkJHCRvvbHUGsSzgIg
JQFQBGHtLWiGRs5ATqSB
-----END CERTIFICATE-----`;
    
    // Write files
    fs.writeFileSync(privateKeyPath, privateKey);
    fs.writeFileSync(certPath, certificate);
    
    console.log('SSL keys generated successfully using hardcoded certificates!');
    console.log(`Private key saved to: ${privateKeyPath}`);
    console.log(`Certificate saved to: ${certPath}`);
    
    return { 
      privateKeyPath,
      certPath
    };
  } catch (error) {
    console.error('Error generating keys with Node.js:', error);
    return null;
  }
}

// First try OpenSSL, then fall back to Node.js
let result = generateWithOpenSSLCommands();
if (!result) {
  console.log('Falling back to Node.js-based certificate generation...');
  result = generateWithNodeJS();
}

if (result) {
  // Provide relative paths for config.json
  const relativePrivKeyPath = path.relative(process.cwd(), result.privateKeyPath).replace(/\\/g, '/');
  const relativeCertPath = path.relative(process.cwd(), result.certPath).replace(/\\/g, '/');
  
  console.log('\nUpdate your config.json file with these paths:');
  console.log(`"PRIVKEY_PATH": "${relativePrivKeyPath}",`);
  console.log(`"CERT_PATH": "${relativeCertPath}"`);
  
  // Try to update config.json automatically
  try {
    const configPath = path.join(process.cwd(), 'config.json');
    let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    config.PRIVKEY_PATH = relativePrivKeyPath;
    config.CERT_PATH = relativeCertPath;
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'utf8');
    console.log('\nconfig.json has been automatically updated with the new paths!');
  } catch (err) {
    console.log('\nUnable to automatically update config.json:', err.message);
    console.log('Please update the paths manually.');
  }
} else {
  console.error('Failed to generate SSL certificates using any method.');
  process.exit(1);
} 