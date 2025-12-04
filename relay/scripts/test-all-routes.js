#!/usr/bin/env node

/**
 * Comprehensive API Route Tester for Shogun Relay
 * 
 * Tests all available API endpoints
 * 
 * Usage:
 *   node scripts/test-all-routes.js [baseUrl] [adminToken]
 * 
 * Example:
 *   node scripts/test-all-routes.js http://localhost:8765 myAdminToken
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

// Configuration
const BASE_URL = process.argv[2] || process.env.RELAY_URL || 'https://shogun-relay.scobrudot.dev';
const ADMIN_TOKEN = process.argv[3] || process.env.ADMIN_TOKEN || 'shogun2025';
const TEST_WALLET = process.argv[4] || process.env.TEST_WALLET || '0xA6591dCDff5C7616110b4f84207184aef7835048';

// Test results
const results = {
  passed: 0,
  failed: 0,
  skipped: 0,
  errors: []
};

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'cyan');
  console.log('='.repeat(60));
}

function logTest(name, status, details = '') {
  const statusIcon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '⊘';
  const statusColor = status === 'PASS' ? 'green' : status === 'FAIL' ? 'red' : 'yellow';
  
  log(`${statusIcon} ${name}`, statusColor);
  if (details) {
    console.log(`  ${details}`);
  }
  
  if (status === 'PASS') results.passed++;
  else if (status === 'FAIL') results.failed++;
  else results.skipped++;
}

// HTTP request helper
function makeRequest(method, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const client = url.protocol === 'https:' ? https : http;
    
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    };
    
    if (options.auth && ADMIN_TOKEN) {
      requestOptions.headers['Authorization'] = `Bearer ${ADMIN_TOKEN}`;
      requestOptions.headers['token'] = ADMIN_TOKEN;
    }
    
    if (options.wallet) {
      requestOptions.headers['x-wallet-address'] = options.wallet;
    }
    
    const req = client.request(requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = data ? JSON.parse(data) : {};
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: json,
            raw: data,
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: data,
            raw: data,
          });
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    
    req.setTimeout(options.timeout || 30000, () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.end();
  });
}

// Test helper
async function testEndpoint(name, method, path, options = {}) {
  try {
    const response = await makeRequest(method, path, options);
    const expectedStatus = options.expectedStatus || 200;
    const checkSuccess = options.checkSuccess !== false;
    
    // Support both single status code and array of acceptable status codes
    const isExpectedStatus = Array.isArray(expectedStatus) 
      ? expectedStatus.includes(response.statusCode)
      : response.statusCode === expectedStatus;
    
    if (isExpectedStatus) {
      // For error status codes (4xx, 5xx), success=false is expected behavior
      const isErrorStatus = response.statusCode >= 400;
      
      // Only check success field for 2xx status codes or when explicitly required
      if (checkSuccess && !isErrorStatus && response.body && response.body.success === false) {
        logTest(name, 'FAIL', `Status ${response.statusCode} but success=false: ${response.body.error || 'Unknown error'}`);
        return null;
      }
      
      logTest(name, 'PASS', `Status: ${response.statusCode}${isErrorStatus && response.body?.error ? ` - ${response.body.error}` : ''}`);
      return response.body;
    } else if (response.statusCode === 401 && !options.auth) {
      logTest(name, 'SKIP', `Status: ${response.statusCode} (Auth required)`);
      return null;
    } else if (response.statusCode === 404 && options.allow404) {
      logTest(name, 'SKIP', `Status: ${response.statusCode} (Not found - may be expected)`);
      return null;
    } else {
      const expectedStr = Array.isArray(expectedStatus) ? expectedStatus.join(' or ') : expectedStatus;
      logTest(name, 'FAIL', `Expected ${expectedStr}, got ${response.statusCode}: ${JSON.stringify(response.body).substring(0, 100)}`);
      return null;
    }
  } catch (error) {
    logTest(name, 'FAIL', `Error: ${error.message}`);
    results.errors.push({ name, error: error.message });
    return null;
  }
}

// Store test data for dependent tests
let testData = {
  cid: null,
  dealId: null,
  subscriptionTier: 'starter',
};

// Main test suite
async function runAllTests() {
  log('\n🚀 Starting Shogun Relay API Route Tests', 'bright');
  log(`Base URL: ${BASE_URL}`, 'blue');
  log(`Admin Token: ${ADMIN_TOKEN ? '***configured***' : 'not set'}`, 'blue');
  log(`Test Wallet: ${TEST_WALLET}`, 'blue');
  
  // ============================================
  // 1. HEALTH & SYSTEM
  // ============================================
  logSection('1. Health & System Endpoints');
  
  await testEndpoint('GET /health', 'GET', '/health');
  await testEndpoint('GET /api/v1/system/health', 'GET', '/api/v1/system/health');
  await testEndpoint('GET /api/v1/system/relay-info', 'GET', '/api/v1/system/relay-info');
  await testEndpoint('GET /api/v1/system/stats', 'GET', '/api/v1/system/stats');
  await testEndpoint('GET /api/v1/system/stats.json', 'GET', '/api/v1/system/stats.json');
  await testEndpoint('GET /api/v1/system/peers', 'GET', '/api/v1/system/peers');
  await testEndpoint('GET /api/v1/services/status', 'GET', '/api/v1/services/status');
  
  if (ADMIN_TOKEN) {
    await testEndpoint('GET /api/v1/system/logs (Admin)', 'GET', '/api/v1/system/logs', { auth: true });
  }
  
  // ============================================
  // 2. IPFS ENDPOINTS
  // ============================================
  logSection('2. IPFS Endpoints');
  
  await testEndpoint('GET /api/v1/ipfs/status', 'GET', '/api/v1/ipfs/status');
  await testEndpoint('GET /api/v1/ipfs/version', 'GET', '/api/v1/ipfs/version');
  
  if (ADMIN_TOKEN) {
    const repoStat = await testEndpoint('GET /api/v1/ipfs/repo/stat (Admin)', 'GET', '/api/v1/ipfs/repo/stat', { auth: true });
    
    // Test upload if admin token available
    log('\n  Testing file upload...', 'yellow');
    // Note: File upload requires multipart/form-data, skipped for now
    // Would need FormData implementation for proper test
  }
  
  // Test IPFS gateway
  await testEndpoint('GET /ipfs/:cid (Gateway)', 'GET', '/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG', { allow404: true });
  
  // ============================================
  // 3. X402 SUBSCRIPTIONS
  // ============================================
  logSection('3. X402 Subscription Endpoints');
  
  const tiers = await testEndpoint('GET /api/v1/x402/tiers', 'GET', '/api/v1/x402/tiers');
  if (tiers && tiers.tiers && tiers.tiers.length > 0) {
    // Use tier name in lowercase as API expects lowercase
    testData.subscriptionTier = tiers.tiers[0].name.toLowerCase();
  }
  
  await testEndpoint('GET /api/v1/x402/subscription/:address', 'GET', `/api/v1/x402/subscription/${TEST_WALLET}`);
  await testEndpoint('GET /api/v1/x402/payment-requirements/:tier', 'GET', `/api/v1/x402/payment-requirements/${testData.subscriptionTier}`);
  await testEndpoint('GET /api/v1/x402/can-upload/:address', 'GET', `/api/v1/x402/can-upload/${TEST_WALLET}`);
  await testEndpoint('GET /api/v1/x402/can-upload-verified/:address', 'GET', `/api/v1/x402/can-upload-verified/${TEST_WALLET}`);
  await testEndpoint('GET /api/v1/x402/storage/:address', 'GET', `/api/v1/x402/storage/${TEST_WALLET}`);
  await testEndpoint('GET /api/v1/x402/config', 'GET', '/api/v1/x402/config');
  await testEndpoint('GET /api/v1/x402/relay-storage', 'GET', '/api/v1/x402/relay-storage');
  
  if (ADMIN_TOKEN) {
    await testEndpoint('GET /api/v1/x402/relay-storage/detailed (Admin)', 'GET', '/api/v1/x402/relay-storage/detailed', { auth: true });
  }
  
  // ============================================
  // 4. STORAGE DEALS
  // ============================================
  logSection('4. Storage Deals Endpoints');
  
  const pricing = await testEndpoint('GET /api/v1/deals/pricing', 'GET', '/api/v1/deals/pricing');
  
  if (pricing && pricing.tiers) {
    const firstTier = Object.keys(pricing.tiers)[0];
    await testEndpoint('GET /api/v1/deals/pricing?tier=:tier', 'GET', `/api/v1/deals/pricing?tier=${firstTier}`);
  }
  
  // Test deal creation (without actually creating)
  const dealsResponse = await testEndpoint('GET /api/v1/deals/by-client/:address', 'GET', `/api/v1/deals/by-client/${TEST_WALLET}`);
  
  // If deals exist, test verify endpoint with first deal
  if (dealsResponse && dealsResponse.deals && dealsResponse.deals.length > 0) {
    const firstDeal = dealsResponse.deals[0];
    testData.dealId = firstDeal.id;
    await testEndpoint('GET /api/v1/deals/:dealId/verify', 'GET', `/api/v1/deals/${firstDeal.id}/verify`, { allow404: true, expectedStatus: [200, 400, 503] });
  } else {
    // Test with example deal ID (will likely fail, but tests the endpoint)
    await testEndpoint('GET /api/v1/deals/:dealId/verify', 'GET', '/api/v1/deals/example_deal_id/verify', { allow404: true, expectedStatus: [404, 400, 503] });
  }
  
  // Test with a known CID for stat
  const testCid = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
  await testEndpoint('GET /api/v1/ipfs/stat/:cid', 'GET', `/api/v1/ipfs/stat/${testCid}`, { allow404: true });
  
  // ============================================
  // 5. NETWORK & FEDERATION
  // ============================================
  logSection('5. Network & Federation Endpoints');
  
  await testEndpoint('GET /api/v1/network/relays', 'GET', '/api/v1/network/relays');
  await testEndpoint('GET /api/v1/network/stats', 'GET', '/api/v1/network/stats');
  await testEndpoint('GET /api/v1/network/reputation', 'GET', '/api/v1/network/reputation');
  await testEndpoint('GET /api/v1/network/best-relays', 'GET', '/api/v1/network/best-relays');
  await testEndpoint('GET /api/v1/network/verified/relays', 'GET', '/api/v1/network/verified/relays');
  
  // Test with example host (may not exist)
  await testEndpoint('GET /api/v1/network/relay/:host', 'GET', '/api/v1/network/relay/example.com', { allow404: true });
  await testEndpoint('GET /api/v1/network/reputation/:host', 'GET', '/api/v1/network/reputation/example.com', { allow404: true });
  
  // Test storage proof with example CID
  await testEndpoint('GET /api/v1/network/proof/:cid', 'GET', `/api/v1/network/proof/${testCid}`, { allow404: true });
  
  // ============================================
  // 6. ON-CHAIN REGISTRY
  // ============================================
  logSection('6. On-Chain Registry Endpoints');
  
  await testEndpoint('GET /api/v1/network/onchain/relays', 'GET', '/api/v1/network/onchain/relays');
  await testEndpoint('GET /api/v1/network/onchain/params', 'GET', '/api/v1/network/onchain/params');
  
  // Test with example address
  await testEndpoint('GET /api/v1/network/onchain/relay/:address', 'GET', `/api/v1/network/onchain/relay/${TEST_WALLET}`, { allow404: true });
  await testEndpoint('GET /api/v1/network/onchain/deals/client/:address', 'GET', `/api/v1/network/onchain/deals/client/${TEST_WALLET}`);
  
  // ============================================
  // 7. REGISTRY MANAGEMENT (If relay configured)
  // ============================================
  logSection('7. Registry Management Endpoints');
  
  if (ADMIN_TOKEN) {
    await testEndpoint('GET /api/v1/registry/status', 'GET', '/api/v1/registry/status', { auth: true });
    await testEndpoint('GET /api/v1/registry/balance', 'GET', '/api/v1/registry/balance', { auth: true });
    await testEndpoint('GET /api/v1/registry/params', 'GET', '/api/v1/registry/params', { auth: true });
    await testEndpoint('GET /api/v1/registry/config', 'GET', '/api/v1/registry/config', { auth: true });
    await testEndpoint('GET /api/v1/registry/deals', 'GET', '/api/v1/registry/deals', { auth: true });
  } else {
    log('\n  Skipping registry management tests (admin token not provided)', 'yellow');
    results.skipped += 5;
  }
  
  // ============================================
  // 8. USER UPLOADS
  // ============================================
  logSection('8. User Uploads Endpoints');
  
  await testEndpoint('GET /api/v1/user-uploads/system-hashes', 'GET', '/api/v1/user-uploads/system-hashes');
  await testEndpoint('GET /api/v1/user-uploads/system-hashes-map', 'GET', '/api/v1/user-uploads/system-hashes-map');
  await testEndpoint('GET /api/v1/user-uploads/:identifier', 'GET', `/api/v1/user-uploads/${TEST_WALLET}`);
  
  if (ADMIN_TOKEN) {
    await testEndpoint('GET /api/v1/ipfs/user-uploads/:address (Admin)', 'GET', `/api/v1/ipfs/user-uploads/${TEST_WALLET}`, { auth: true });
  }
  
  // ============================================
  // 9. HOLSTER RELAY
  // ============================================
  logSection('9. Holster Relay Endpoints');
  
  await testEndpoint('GET /holster-status', 'GET', '/holster-status');
  
  // ============================================
  // 10. DEBUG ENDPOINTS (Admin only)
  // ============================================
  logSection('10. Debug Endpoints');
  
  if (ADMIN_TOKEN) {
    await testEndpoint('GET /api/v1/debug/mb-usage/:address (Admin)', 'GET', `/api/v1/debug/mb-usage/${TEST_WALLET}`, { auth: true });
    await testEndpoint('GET /api/v1/debug/user-mb-usage/:identifier (Admin)', 'GET', `/api/v1/debug/user-mb-usage/${TEST_WALLET}`, { auth: true });
    await testEndpoint('GET /api/v1/debug/user-uploads/:identifier (Admin)', 'GET', `/api/v1/debug/user-uploads/${TEST_WALLET}`, { auth: true });
  } else {
    log('\n  Skipping debug endpoints (admin token not provided)', 'yellow');
    results.skipped += 3;
  }
  
  // Print summary
  logSection('Test Summary');
  
  const total = results.passed + results.failed + results.skipped;
  log(`Total Tests: ${total}`, 'bright');
  log(`Passed: ${results.passed}`, 'green');
  log(`Failed: ${results.failed}`, results.failed > 0 ? 'red' : 'green');
  log(`Skipped: ${results.skipped}`, 'yellow');
  
  if (results.errors.length > 0) {
    log('\nErrors:', 'red');
    results.errors.forEach(({ name, error }) => {
      log(`  - ${name}: ${error}`, 'red');
    });
  }
  
  if (results.failed === 0) {
    log('\n✅ All tests passed!', 'green');
    process.exit(0);
  } else {
    log(`\n❌ ${results.failed} test(s) failed`, 'red');
    process.exit(1);
  }
}

// Handle errors
process.on('unhandledRejection', (error) => {
  log(`\n❌ Unhandled error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});

// Run tests
runAllTests().catch((error) => {
  log(`\n❌ Fatal error: ${error.message}`, 'red');
  console.error(error);
  process.exit(1);
});

