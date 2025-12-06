/**
 * Post-install script for relay
 * 
 * This script ensures that the shogun-contracts SDK is built
 * if it's installed locally (not from npm registry)
 */

import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const relayRoot = join(__dirname, '..');
const nodeModulesPath = join(relayRoot, 'node_modules', 'shogun-contracts');

// Check if shogun-contracts is installed
if (!existsSync(nodeModulesPath)) {
  console.log('⚠️  shogun-contracts not found in node_modules');
  process.exit(0);
}

// Check if SDK is already compiled
const sdkDistPath = join(nodeModulesPath, 'sdk', 'dist', 'index.js');
if (existsSync(sdkDistPath)) {
  console.log('✅ shogun-contracts SDK already compiled');
  process.exit(0);
}

// Check if SDK source exists (local installation)
const sdkSourcePath = join(nodeModulesPath, 'sdk', 'index.ts');
if (!existsSync(sdkSourcePath)) {
  console.log('⚠️  shogun-contracts SDK source not found (may be installed from npm)');
  process.exit(0);
}

// Try to build the SDK
console.log('🔨 Building shogun-contracts SDK...');
try {
  // Check if TypeScript is available
  const packageJsonPath = join(nodeModulesPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    console.log('⚠️  shogun-contracts package.json not found');
    process.exit(0);
  }

  // Try to run the build script
  const originalCwd = process.cwd();
  process.chdir(nodeModulesPath);
  
  try {
    execSync('npm run build:sdk', { 
      stdio: 'inherit',
      env: { ...process.env, NODE_ENV: 'production' }
    });
    console.log('✅ shogun-contracts SDK built successfully');
  } catch (error) {
    console.warn('⚠️  Failed to build shogun-contracts SDK:', error.message);
    console.warn('   This is normal if shogun-contracts is installed from npm registry');
    console.warn('   The SDK should already be compiled in the published package');
  } finally {
    process.chdir(originalCwd);
  }
} catch (error) {
  console.warn('⚠️  Could not build shogun-contracts SDK:', error.message);
  console.warn('   Make sure TypeScript is installed in shogun-contracts');
}

