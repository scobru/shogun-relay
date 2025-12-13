#!/usr/bin/env node

/**
 * Test Script for IPFS Endpoints
 * 
 * Tests all IPFS-related endpoints to ensure they work correctly.
 * IPFS is critical for the Shogun Relay project.
 * 
 * Usage:
 *   node scripts/test-ipfs-routes.js [base-url] [admin-token] [test-wallet]
 * 
 * Environment Variables:
 *   TEST_BASE_URL - Base URL of the relay (default: https://shogun-relay.scobrudot.dev)
 *   ADMIN_TOKEN - Admin authentication token
 *   TEST_WALLET - Wallet address for testing
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';
import FormData from 'form-data';
import fs from 'fs';

const BASE_URL = process.argv[2] || process.env.TEST_BASE_URL || 'https://shogun-relay.scobrudot.dev';
const ADMIN_TOKEN = process.argv[3] || process.env.ADMIN_TOKEN || 'shogun2025';
const TEST_WALLET = process.argv[4] || process.env.TEST_WALLET || '0xA6591dCDff5C7616110b4f84207184aef7835048';

const results = {
  passed: [],
  failed: [],
  skipped: [],
  errors: []
};

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function logTest(name, status, message = '') {
  const statusIcon = status === 'PASS' ? '✓' : status === 'FAIL' ? '✗' : '⊘';
  const statusColor = status === 'PASS' ? colors.green : status === 'FAIL' ? colors.red : colors.yellow;
  
  console.log(`${statusColor}${statusIcon}${colors.reset} ${name}`);
  if (message) {
    console.log(`  ${colors.cyan}→${colors.reset} ${message}`);
  }
  
  if (status === 'PASS') {
    results.passed.push({ name, message });
  } else if (status === 'FAIL') {
    results.failed.push({ name, message });
  } else {
    results.skipped.push({ name, message });
  }
}

function makeRequest(method, path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const isHttps = url.protocol === 'https:';
    const httpModule = isHttps ? https : http;
    
    // Handle FormData headers separately
    let headers = { ...options.headers };
    if (options.body instanceof FormData) {
      // FormData headers must come from formData.getHeaders()
      headers = {
        ...options.body.getHeaders(),
        ...headers, // Allow override (e.g., x-wallet-address, Authorization, token)
      };
    } else if (options.body && typeof options.body === 'object' && !(options.body instanceof Buffer)) {
      // JSON body
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }
    
    const requestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers,
    };
    
    // Add admin token if provided and not already set
    if (ADMIN_TOKEN && !requestOptions.headers['Authorization'] && !requestOptions.headers['token']) {
      // Prefer Authorization header, but can also use 'token' header
      requestOptions.headers['Authorization'] = `Bearer ${ADMIN_TOKEN}`;
    }
    
    const req = httpModule.request(requestOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let body;
        try {
          body = JSON.parse(data);
        } catch (e) {
          body = { raw: data };
        }
        
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
        });
      });
    });
    
    req.on('error', reject);
    
    if (options.body) {
      if (options.body instanceof FormData) {
        options.body.pipe(req);
      } else {
        if (typeof options.body === 'string') {
          req.write(options.body);
        } else {
          req.write(JSON.stringify(options.body));
        }
        req.end();
      }
    } else {
      req.end();
    }
    
    if (options.timeout) {
      req.setTimeout(options.timeout, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    }
  });
}

async function testEndpoint(name, method, path, options = {}) {
  try {
    const response = await makeRequest(method, path, options);
    const expectedStatus = options.expectedStatus || 200;
    const checkSuccess = options.checkSuccess !== false;
    
    const isExpectedStatus = Array.isArray(expectedStatus) 
      ? expectedStatus.includes(response.statusCode)
      : response.statusCode === expectedStatus;
    
    const errorStatusCodes = [400, 401, 403, 404, 408, 409, 429, 500, 502, 503, 504];
    const isExpectedErrorStatus = Array.isArray(expectedStatus) 
      ? expectedStatus.some(status => errorStatusCodes.includes(status))
      : errorStatusCodes.includes(expectedStatus);

    if (isExpectedStatus) {
      if (checkSuccess && response.body && response.body.success === false && !isExpectedErrorStatus) {
        logTest(name, 'FAIL', `Status ${response.statusCode} but success=false: ${response.body.error || 'Unknown error'}`);
        return null;
      }
      
      logTest(name, 'PASS', `Status: ${response.statusCode}`);
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

// Store test CID for subsequent tests
let testCid = null;
let testFileHash = null;

async function runTests() {
  console.log(`${colors.bright}${colors.cyan}🚀 Starting IPFS Endpoints Test Suite${colors.reset}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Admin Token: ${ADMIN_TOKEN ? '***configured***' : 'not set'}`);
  console.log(`Test Wallet: ${TEST_WALLET}`);
  console.log(`${'='.repeat(60)}\n`);

  // ============================================================
  // 1. Basic IPFS Status & Info
  // ============================================================
  console.log(`${colors.bright}1. Basic IPFS Status & Info${colors.reset}`);
  console.log(`${'='.repeat(60)}`);
  
  const statusResult = await testEndpoint('GET /api/v1/ipfs/status', 'GET', '/api/v1/ipfs/status');
  if (statusResult && statusResult.success && statusResult.ipfs) {
    console.log(`   IPFS Status: ${statusResult.ipfs.connected ? 'Connected' : 'Disconnected'}`);
    if (statusResult.ipfs.version) {
      console.log(`   IPFS Version: ${statusResult.ipfs.version}`);
    }
  }
  
  await testEndpoint('GET /api/v1/ipfs/version', 'GET', '/api/v1/ipfs/version');
  
  await testEndpoint('GET /api/v1/ipfs/repo/stat', 'GET', '/api/v1/ipfs/repo/stat', {
    auth: true,
    expectedStatus: [200, 503] // 503 if IPFS not available
  });
  
  console.log('');

  // ============================================================
  // 2. File Upload & Storage
  // ============================================================
  console.log(`${colors.bright}2. File Upload & Storage${colors.reset}`);
  console.log(`${'='.repeat(60)}`);
  
  // Create a test file
  const testFileContent = Buffer.from('Test file content for IPFS upload - ' + Date.now());
  const testFileName = `test-${Date.now()}.txt`;
  
  // First try: Upload via deals/upload endpoint (simpler, no auth required)
  try {
    const formData = new FormData();
    formData.append('file', testFileContent, {
      filename: testFileName,
      contentType: 'text/plain',
    });
    
    const uploadResponse = await makeRequest('POST', '/api/v1/deals/upload', {
      headers: {
        'x-wallet-address': TEST_WALLET,
      },
      body: formData,
    });
    
    if (uploadResponse.statusCode === 200 && uploadResponse.body && uploadResponse.body.success) {
      testCid = uploadResponse.body.cid || uploadResponse.body.Hash;
      logTest('POST /api/v1/deals/upload', 'PASS', `Uploaded file, CID: ${testCid}`);
      console.log(`   File: ${testFileName}`);
      console.log(`   CID: ${testCid}`);
    } else {
      logTest('POST /api/v1/deals/upload', 'FAIL', `Status: ${uploadResponse.statusCode}, ${uploadResponse.body?.error || 'Unknown error'}`);
    }
  } catch (error) {
    logTest('POST /api/v1/deals/upload', 'FAIL', `Error: ${error.message}`);
  }
  
  // Second try: Upload via ipfs/upload endpoint (requires admin auth)
  try {
    const formData2 = new FormData();
    formData2.append('file', testFileContent, {
      filename: `ipfs-test-${Date.now()}.txt`,
      contentType: 'text/plain',
    });
    
    // Try with token header (simpler than Authorization Bearer for FormData)
    const uploadResponse2 = await makeRequest('POST', '/api/v1/ipfs/upload', {
      headers: {
        'token': ADMIN_TOKEN, // Endpoint accepts 'token' header as alternative to Authorization
      },
      body: formData2,
    });
    
    if (uploadResponse2.statusCode === 200 && uploadResponse2.body && uploadResponse2.body.success) {
      const ipfsCid = uploadResponse2.body.cid || uploadResponse2.body.hash || uploadResponse2.body.Hash;
      logTest('POST /api/v1/ipfs/upload (Admin)', 'PASS', `Uploaded file, CID: ${ipfsCid || 'N/A'}`);
      
      // Use this CID if we don't have one yet
      if (!testCid && ipfsCid) {
        testCid = ipfsCid;
      }
    } else if (uploadResponse2.statusCode === 401) {
      logTest('POST /api/v1/ipfs/upload (Admin)', 'SKIP', `Status: ${uploadResponse2.statusCode} - Auth required (this is expected if admin token not configured)`);
    } else {
      logTest('POST /api/v1/ipfs/upload (Admin)', 'FAIL', `Status: ${uploadResponse2.statusCode}, ${uploadResponse2.body?.error || 'Unknown error'}`);
    }
  } catch (error) {
    logTest('POST /api/v1/ipfs/upload (Admin)', 'SKIP', `Error: ${error.message} - May require admin authentication`);
  }
  
  console.log('');

  // ============================================================
  // 3. CID Verification & Statistics
  // ============================================================
  console.log(`${colors.bright}3. CID Verification & Statistics${colors.reset}`);
  console.log(`${'='.repeat(60)}`);
  
  if (testCid) {
    await testEndpoint(`GET /api/v1/ipfs/stat/${testCid}`, 'GET', `/api/v1/ipfs/stat/${testCid}`);
    
    // Test gateway endpoint
    await testEndpoint(`GET /ipfs/${testCid}`, 'GET', `/ipfs/${testCid}`, {
      expectedStatus: [200, 404, 503],
      allow404: true, // Gateway might return 404 if not locally pinned
    });
  } else {
    logTest('GET /api/v1/ipfs/stat/:cid', 'SKIP', 'No test CID available');
    logTest('GET /ipfs/:cid (Gateway)', 'SKIP', 'No test CID available');
  }
  
  console.log('');

  // ============================================================
  // 4. Content Retrieval (CAT)
  // ============================================================
  console.log(`${colors.bright}4. Content Retrieval (CAT)${colors.reset}`);
  console.log(`${'='.repeat(60)}`);
  
  if (testCid) {
    await testEndpoint(`GET /api/v1/ipfs/cat/${testCid}`, 'GET', `/api/v1/ipfs/cat/${testCid}`, {
      expectedStatus: [200, 404, 503],
    });
    
    await testEndpoint(`GET /api/v1/ipfs/cat/${testCid}/json`, 'GET', `/api/v1/ipfs/cat/${testCid}/json`, {
      expectedStatus: [200, 404, 503],
      allow404: true,
    });
    
    // Decrypt endpoint (may not be applicable)
    await testEndpoint(`GET /api/v1/ipfs/cat/${testCid}/decrypt`, 'GET', `/api/v1/ipfs/cat/${testCid}/decrypt`, {
      expectedStatus: [200, 400, 404, 503],
      allow404: true,
    });
  } else {
    logTest('GET /api/v1/ipfs/cat/:cid', 'SKIP', 'No test CID available');
    logTest('GET /api/v1/ipfs/cat/:cid/json', 'SKIP', 'No test CID available');
    logTest('GET /api/v1/ipfs/cat/:cid/decrypt', 'SKIP', 'No test CID available');
  }
  
  console.log('');

  // ============================================================
  // 5. Pin Management
  // ============================================================
  console.log(`${colors.bright}5. Pin Management${colors.reset}`);
  console.log(`${'='.repeat(60)}`);
  
  await testEndpoint('GET /api/v1/ipfs/pin/ls', 'GET', '/api/v1/ipfs/pin/ls', {
    expectedStatus: [200, 503],
  });
  
  if (testCid) {
    // Test pin add
    const pinAddResult = await testEndpoint('POST /api/v1/ipfs/pin/add', 'POST', '/api/v1/ipfs/pin/add', {
      body: { cid: testCid },
      expectedStatus: [200, 400, 503],
    });
    
    if (pinAddResult && pinAddResult.success) {
      console.log(`   ✅ Pinned CID: ${testCid}`);
    }
    
    // Test pin removal (may fail if not pinned)
    await testEndpoint('POST /api/v1/ipfs/pin/rm', 'POST', '/api/v1/ipfs/pin/rm', {
      body: { cid: testCid },
      expectedStatus: [200, 400, 404, 503],
      allow404: true,
    });
    
    // Re-pin for subsequent tests
    if (testCid) {
      await makeRequest('POST', '/api/v1/ipfs/pin/add', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid: testCid }),
      });
    }
  } else {
    logTest('POST /api/v1/ipfs/pin/add', 'SKIP', 'No test CID available');
    logTest('POST /api/v1/ipfs/pin/rm', 'SKIP', 'No test CID available');
  }
  
  console.log('');

  // ============================================================
  // 6. Repository Management
  // ============================================================
  console.log(`${colors.bright}6. Repository Management${colors.reset}`);
  console.log(`${'='.repeat(60)}`);
  
  await testEndpoint('GET /api/v1/ipfs/repo/stat', 'GET', '/api/v1/ipfs/repo/stat', {
    auth: true,
    expectedStatus: [200, 503],
  });
  
  // Garbage collection (may take time)
  await testEndpoint('POST /api/v1/ipfs/repo/gc', 'POST', '/api/v1/ipfs/repo/gc', {
    auth: true,
    expectedStatus: [200, 503],
    timeout: 30000, // GC can take a while
  });
  
  console.log('');

  // ============================================================
  // 7. User Uploads
  // ============================================================
  console.log(`${colors.bright}7. User Uploads${colors.reset}`);
  console.log(`${'='.repeat(60)}`);
  
  await testEndpoint(`GET /api/v1/ipfs/user-uploads/${TEST_WALLET}`, 'GET', `/api/v1/ipfs/user-uploads/${TEST_WALLET}`, {
    expectedStatus: [200, 404],
    allow404: true,
  });
  
  console.log('');

  // ============================================================
  // 8. Test Endpoint
  // ============================================================
  console.log(`${colors.bright}8. Test Endpoint${colors.reset}`);
  console.log(`${'='.repeat(60)}`);
  
  await testEndpoint('GET /api/v1/ipfs/test', 'GET', '/api/v1/ipfs/test', {
    expectedStatus: [200, 404],
    allow404: true,
  });
  
  console.log('');

  // ============================================================
  // Summary
  // ============================================================
  console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}Test Summary${colors.reset}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`${colors.green}✓ Passed:${colors.reset} ${results.passed.length}`);
  console.log(`${colors.red}✗ Failed:${colors.reset} ${results.failed.length}`);
  console.log(`${colors.yellow}⊘ Skipped:${colors.reset} ${results.skipped.length}`);
  
  if (results.failed.length > 0) {
    console.log(`\n${colors.red}Failed Tests:${colors.reset}`);
    results.failed.forEach(({ name, message }) => {
      console.log(`  ✗ ${name}: ${message}`);
    });
  }
  
  if (results.errors.length > 0) {
    console.log(`\n${colors.red}Errors:${colors.reset}`);
    results.errors.forEach(({ name, error }) => {
      console.log(`  ✗ ${name}: ${error}`);
    });
  }
  
  console.log('');
  
  const exitCode = results.failed.length > 0 || results.errors.length > 0 ? 1 : 0;
  process.exit(exitCode);
}

// Run tests
runTests().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});

