/**
 * IPFS Client Utility with automatic retry and health checking
 * Handles ECONNREFUSED errors gracefully when IPFS daemon is starting up
 * 
 * @module utils/ipfs-client
 */

import http from 'http';
import https from 'https';

const IPFS_API_URL = process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN;

// Parse IPFS API URL
const url = new URL(IPFS_API_URL);
const isHttps = url.protocol === 'https:';
const httpModule = isHttps ? https : http;
const hostname = url.hostname;
const port = parseInt(url.port) || (isHttps ? 443 : 80);

// Cache for IPFS readiness status
let ipfsReadyCache = {
  isReady: false,
  lastCheck: 0,
  checkInterval: 5000, // Check every 5 seconds
};

/**
 * Check if IPFS daemon is ready
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>}
 */
async function checkIpfsReady(timeout = 2000) {
  return new Promise((resolve) => {
    const options = {
      hostname,
      port,
      path: '/api/v0/version',
      method: 'POST',
      headers: { 'Content-Length': '0' },
      timeout,
    };

    if (IPFS_API_TOKEN) {
      options.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const req = httpModule.request(options, (res) => {
      resolve(res.statusCode === 200);
    });

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

/**
 * Wait for IPFS to be ready with exponential backoff
 * @param {number} maxWaitTime - Maximum time to wait in milliseconds (default: 30s)
 * @param {number} initialDelay - Initial delay in milliseconds (default: 500ms)
 * @returns {Promise<boolean>} True if IPFS is ready, false if timeout
 */
async function waitForIpfs(maxWaitTime = 30000, initialDelay = 500) {
  const startTime = Date.now();
  let delay = initialDelay;
  const maxDelay = 2000; // Max 2 seconds between retries

  while (Date.now() - startTime < maxWaitTime) {
    const isReady = await checkIpfsReady(1000);
    if (isReady) {
      ipfsReadyCache.isReady = true;
      ipfsReadyCache.lastCheck = Date.now();
      return true;
    }

    // Exponential backoff with max cap
    await new Promise(resolve => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.5, maxDelay);
  }

  return false;
}

/**
 * Make an IPFS API request with automatic retry on ECONNREFUSED
 * @param {string} path - API path (e.g., '/api/v0/version')
 * @param {Object} options - Request options
 * @param {string} [options.method='POST'] - HTTP method
 * @param {Object} [options.headers={}] - Additional headers
 * @param {number} [options.timeout=60000] - Request timeout
 * @param {number} [options.maxRetries=3] - Maximum retry attempts
 * @param {number} [options.retryDelay=1000] - Initial retry delay in ms
 * @param {boolean} [options.waitForReady=true] - Wait for IPFS to be ready before first attempt
 * @returns {Promise<Object|string>} Response data (parsed JSON or raw string)
 */
async function ipfsRequest(path, options = {}) {
  const {
    method = 'POST',
    headers = {},
    timeout = 60000,
    maxRetries = 3,
    retryDelay = 1000,
    waitForReady = true,
  } = options;

  // Check cache first (if recent check)
  const cacheAge = Date.now() - ipfsReadyCache.lastCheck;
  if (waitForReady && (!ipfsReadyCache.isReady || cacheAge > ipfsReadyCache.checkInterval)) {
    const isReady = await checkIpfsReady(1000);
    if (!isReady) {
      console.log('⏳ IPFS daemon not ready, waiting...');
      const ready = await waitForIpfs(10000); // Wait up to 10 seconds
      if (!ready) {
        console.warn('⚠️ IPFS daemon not ready after waiting, proceeding anyway...');
      }
    }
    ipfsReadyCache.isReady = isReady;
    ipfsReadyCache.lastCheck = Date.now();
  }

  let lastError;
  let currentDelay = retryDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const requestOptions = {
          hostname,
          port,
          path,
          method,
          headers: {
            'Content-Length': '0',
            ...headers,
          },
          timeout,
        };

        if (IPFS_API_TOKEN) {
          requestOptions.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
        }

        const req = httpModule.request(requestOptions, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const buffer = Buffer.concat(chunks);
            if (res.statusCode === 200) {
              if (options.responseType === 'arraybuffer') {
                resolve(buffer);
              } else {
                const data = buffer.toString();
                try {
                  resolve(JSON.parse(data));
                } catch {
                  resolve(data);
                }
              }
            } else {
              reject(new Error(`IPFS API returned status ${res.statusCode}: ${buffer.toString()}`));
            }
          });
        });

        req.on('error', (err) => {
          reject(err);
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Request timeout'));
        });

        req.end();
      });

      // Success - update cache
      ipfsReadyCache.isReady = true;
      ipfsReadyCache.lastCheck = Date.now();
      return result;
    } catch (error) {
      lastError = error;

      // Only retry on connection errors (ECONNREFUSED, ECONNRESET, etc.)
      const isConnectionError =
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.message?.includes('timeout');

      if (!isConnectionError || attempt === maxRetries) {
        throw error;
      }

      // Update cache on connection error
      ipfsReadyCache.isReady = false;

      console.log(
        `⚠️ IPFS request failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.code || error.message}. Retrying in ${currentDelay}ms...`
      );

      // Wait before retry with exponential backoff
      await new Promise((resolve) => setTimeout(resolve, currentDelay));
      currentDelay = Math.min(currentDelay * 1.5, 5000); // Max 5 seconds
    }
  }

  throw lastError;
}

/**
 * Make an IPFS API request with file upload (multipart/form-data)
 * @param {string} path - API path (e.g., '/api/v0/add')
 * @param {FormData} formData - FormData object with file
 * @param {Object} options - Request options
 * @param {number} [options.timeout=60000] - Request timeout
 * @param {number} [options.maxRetries=3] - Maximum retry attempts
 * @returns {Promise<Object>} Response data
 */
async function ipfsUpload(path, formData, options = {}) {
  const { timeout = 60000, maxRetries = 3, retryDelay = 1000 } = options;

  // Wait for IPFS to be ready first
  if (!ipfsReadyCache.isReady || Date.now() - ipfsReadyCache.lastCheck > ipfsReadyCache.checkInterval) {
    const isReady = await checkIpfsReady(1000);
    if (!isReady) {
      console.log('⏳ IPFS daemon not ready, waiting before upload...');
      await waitForIpfs(10000);
    }
    ipfsReadyCache.isReady = isReady;
    ipfsReadyCache.lastCheck = Date.now();
  }

  let lastError;
  let currentDelay = retryDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        const requestOptions = {
          hostname,
          port,
          path,
          method: 'POST',
          headers: formData.getHeaders(),
          timeout,
        };

        if (IPFS_API_TOKEN) {
          requestOptions.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
        }

        const req = httpModule.request(requestOptions, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                // IPFS add returns newline-delimited JSON
                const lines = data.trim().split('\n');
                const lastLine = lines[lines.length - 1];
                resolve(JSON.parse(lastLine));
              } catch (e) {
                reject(new Error(`Failed to parse IPFS response: ${data}`));
              }
            } else {
              reject(new Error(`IPFS upload failed with status ${res.statusCode}: ${data}`));
            }
          });
        });

        req.on('error', (err) => {
          reject(err);
        });

        req.on('timeout', () => {
          req.destroy();
          reject(new Error('Upload timeout'));
        });

        formData.pipe(req);
      });

      // Success
      ipfsReadyCache.isReady = true;
      ipfsReadyCache.lastCheck = Date.now();
      return result;
    } catch (error) {
      lastError = error;

      const isConnectionError =
        error.code === 'ECONNREFUSED' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ETIMEDOUT' ||
        error.message?.includes('timeout');

      if (!isConnectionError || attempt === maxRetries) {
        throw error;
      }

      ipfsReadyCache.isReady = false;

      console.log(
        `⚠️ IPFS upload failed (attempt ${attempt + 1}/${maxRetries + 1}): ${error.code || error.message}. Retrying in ${currentDelay}ms...`
      );

      await new Promise((resolve) => setTimeout(resolve, currentDelay));
      currentDelay = Math.min(currentDelay * 1.5, 5000);
    }
  }

  throw lastError;
}

export { ipfsRequest, ipfsUpload, checkIpfsReady, waitForIpfs };

