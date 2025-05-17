// GunDB Diagnostic script
// Run this with: node diagnose-gun.js

import fs from 'fs';
import path from 'path';
import Gun from 'gun';
import "gun/sea.js";
import dotenv from 'dotenv';

dotenv.config();

// Configuration for this test
const GUN_PORT = process.env.PORT || 8765;
const GUN_HOST = process.env.HOST || 'localhost';
const KEYPAIR_JSON = process.env.APP_KEY_PAIR || null;
const API_SECRET_TOKEN = process.env.API_SECRET_TOKEN || 'thisIsTheTokenForReals';
const RADATA_PATH = './radata';

// Verify the radata directory exists
if (!fs.existsSync(RADATA_PATH)) {
  console.log(`Creating radata directory at ${path.resolve(RADATA_PATH)}`);
  fs.mkdirSync(RADATA_PATH, { recursive: true });
} else {
  console.log(`Radata directory exists at ${path.resolve(RADATA_PATH)}`);
  
  // Check permissions
  try {
    const testFile = path.join(RADATA_PATH, 'test-write-permission.txt');
    fs.writeFileSync(testFile, 'Test permission write');
    console.log('Successfully wrote test file to radata directory');
    fs.unlinkSync(testFile);
    console.log('Successfully deleted test file from radata directory');
  } catch (err) {
    console.error('ERROR: Cannot write to radata directory:', err.message);
    console.log('This may be causing your GunDB data to not be saved!');
  }
}

// List all files in radata
console.log('\nListing files in radata directory:');
const radataFiles = fs.readdirSync(RADATA_PATH);
console.log(radataFiles);

// Create a gun instance directly pointing to radata
console.log('\nInitializing Gun with direct radata path...');
const gun = Gun({
  file: RADATA_PATH,
  radisk: true,
  localStorage: false,
  peers: [`http://${GUN_HOST}:${GUN_PORT}/gun`]
});

// Add token to headers for authentication
gun._.opt.headers = {
  token: API_SECRET_TOKEN,
  Authorization: `Bearer ${API_SECRET_TOKEN}`
};

// Parse the keypair if available
let keypair = null;
if (KEYPAIR_JSON) {
  try {
    keypair = JSON.parse(KEYPAIR_JSON);
    console.log('Using keypair with pub:', keypair.pub);
  } catch (err) {
    console.error('Error parsing keypair JSON:', err.message);
  }
}

async function runDiagnostics() {
  console.log('\n=== STARTING GUN DIAGNOSTICS ===');
  
  // Test 1: Direct write to public space
  console.log('\nTEST 1: Writing to public space...');
  const testData = {
    message: 'Diagnostic test data',
    timestamp: Date.now(),
    random: Math.random().toString(36).substring(2)
  };
  
  await new Promise((resolve) => {
    gun.get('test-diagnostic').put(testData, (ack) => {
      console.log('Public write result:', ack);
      
      gun.get('test-diagnostic').once((data) => {
        console.log('Read back data:', data);
        resolve();
      });
    });
  });
  
  // Check if we have a keypair for authentication
  if (keypair) {
    // Test 2: Authenticate with keypair and write
    console.log('\nTEST 2: Authenticating with keypair...');
    
    await new Promise((resolve) => {
      gun.user().auth(keypair, (ack) => {
        console.log('Authentication result:', ack);
        
        if (!ack.err) {
          console.log('Authentication successful, writing user data...');
          
          gun.user().get('test-diagnostic').put({
            message: 'User diagnostic data',
            timestamp: Date.now()
          }, (userPutAck) => {
            console.log('User write result:', userPutAck);
            
            gun.user().get('test-diagnostic').once((userData) => {
              console.log('Read back user data:', userData);
              resolve();
            });
          });
        } else {
          resolve();
        }
      });
    });
  }
  
  // Test 3: Force write with admin token
  console.log('\nTEST 3: Writing with admin token in headers...');
  
  // Make a new put with admin token in headers
  await new Promise((resolve) => {
    gun.get('test-admin-write').put({
      message: 'Admin token authenticated write',
      timestamp: Date.now(),
      withToken: true
    }, (ack) => {
      console.log('Admin token write result:', ack);
      
      gun.get('test-admin-write').once((data) => {
        console.log('Read back admin token data:', data);
        resolve();
      });
    });
  });
  
  // Check the radata directory again after writes
  console.log('\nChecking radata directory after writes:');
  const radataFilesAfter = fs.readdirSync(RADATA_PATH);
  console.log(radataFilesAfter);
  
  if (radataFilesAfter.length > radataFiles.length) {
    console.log('SUCCESS: New files were created in radata directory');
  } else {
    console.log('WARNING: No new files created in radata directory');
    
    // Check file sizes to see if existing files were modified
    let changes = false;
    for (const file of radataFilesAfter) {
      const filePath = path.join(RADATA_PATH, file);
      const stats = fs.statSync(filePath);
      console.log(`${file}: ${stats.size} bytes`);
      
      // Try to read the file content
      if (stats.size > 0) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          if (content.includes('test-diagnostic') || 
              content.includes('test-admin-write')) {
            console.log(`Found test data in file: ${file}`);
            changes = true;
          }
        } catch (err) {
          console.error(`Error reading file ${file}:`, err.message);
        }
      }
    }
    
    if (changes) {
      console.log('SUCCESS: Test data was written to existing files');
    } else {
      console.error('ERROR: No evidence of data being written to radata');
      console.log('Possible issues:');
      console.log('1. File permissions problem');
      console.log('2. GunDB configuration error');
      console.log('3. Authentication/validation rejecting writes');
      console.log('4. Wrong radata directory being used');
    }
  }
  
  console.log('\n=== DIAGNOSTICS COMPLETE ===');
}

// Run all diagnostics and exit when done
runDiagnostics().then(() => {
  console.log('\nKeeping process alive for 5 seconds to allow for any async operations...');
  setTimeout(() => {
    console.log('Exiting diagnostic script.');
    process.exit(0);
  }, 5000);
}).catch(error => {
  console.error('Diagnostic error:', error);
  process.exit(1);
}); 