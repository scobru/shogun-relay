#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');

console.log('🚀 Starting Shogun Relay Full Stack (FakeS3 + Relay Server)');
console.log('='.repeat(60));

// Start fake S3 server
console.log('📦 Starting FakeS3 server...');
const fakeS3 = spawn('node', ['index.js'], {
  cwd: path.join(__dirname, 'fakes3'),
  stdio: ['inherit', 'pipe', 'pipe']
});

fakeS3.stdout.on('data', (data) => {
  console.log(`[FakeS3] ${data.toString().trim()}`);
});

fakeS3.stderr.on('data', (data) => {
  console.error(`[FakeS3 Error] ${data.toString().trim()}`);
});

// Wait for FakeS3 to start before starting relay
setTimeout(() => {
  console.log('\n🔗 Starting Relay server...');
  const relay = spawn('yarn', ['start'], {
    cwd: path.join(__dirname, 'relay'),
    stdio: ['inherit', 'pipe', 'pipe']
  });

  relay.stdout.on('data', (data) => {
    console.log(`[Relay] ${data.toString().trim()}`);
  });

  relay.stderr.on('data', (data) => {
    console.error(`[Relay Error] ${data.toString().trim()}`);
  });

  relay.on('close', (code) => {
    console.log(`\n🔴 Relay server exited with code ${code}`);
    fakeS3.kill();
    process.exit(code);
  });

}, 3000); // Give FakeS3 3 seconds to start

fakeS3.on('close', (code) => {
  console.log(`\n🔴 FakeS3 server exited with code ${code}`);
  process.exit(code);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down servers...');
  fakeS3.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down servers...');
  fakeS3.kill();
  process.exit(0);
}); 