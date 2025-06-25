// Enhanced Gun relay server with Shogun improvements
import Gun from "gun";
// MUST be required after Gun to work

import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";
import ip from "ip";
import qr from "qr";
import setSelfAdjustingInterval from "self-adjusting-interval";

dotenv.config();

import "gun/sea.js";
import "gun/lib/stats.js";
import "gun/lib/then.js";
import "gun/lib/radisk.js";
import "gun/lib/store.js";
import "gun/lib/wire.js";
import "gun/lib/server.js";
import "gun/lib/yson.js";
import "gun/lib/rindexed.js";
import "gun/lib/webrtc.js";
import "gun/lib/rfs.js";
import "gun/lib/multicast.js";
import "gun/lib/rs3.js";

import ShogunCoreModule from "shogun-core";
const { derive } = ShogunCoreModule;
import http from "http";
import { createProxyMiddleware } from 'http-proxy-middleware';
import multer from 'multer';
import FormData from 'form-data';

// ES Module equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Port testing function
const testPort = (port) => {
  return new Promise((resolve, reject) => {
    const server = express()
      .listen(port, () => {
        server.close(() => resolve(true));
      })
      .on("error", () => resolve(false));
  });
};

// Configuration
let host = process.env.RELAY_HOST || ip.address();
let store = process.env.RELAY_STORE !== "false";
let port = process.env.RELAY_PORT || process.env.PORT || 8765;
let path_public = process.env.RELAY_PATH || "public";
let showQr = process.env.RELAY_QR !== "false";

// Main async function to initialize the server
async function initializeServer() {
  console.clear();
  console.log("=== GUN-VUE RELAY SERVER ===\n");

  // Enhanced stats tracking with time-series data
  let customStats = {
    getRequests: 0,
    putRequests: 0,
    startTime: Date.now(),
    timeSeries: {
      // Store last 100 data points for each metric
      maxPoints: 100,
      data: {
        "peers#": [],
        memory: [],
        "gets/s": [],
        "puts/s": [],
        "cpu%": [],
      },
    },
  };

  // Function to add time-series data point
  function addTimeSeriesPoint(key, value) {
    const timestamp = Date.now();
    const series = customStats.timeSeries.data[key];
    if (!series) {
      customStats.timeSeries.data[key] = [];
    }

    customStats.timeSeries.data[key].push([timestamp, value]);

    // Keep only the last maxPoints
    if (
      customStats.timeSeries.data[key].length > customStats.timeSeries.maxPoints
    ) {
      customStats.timeSeries.data[key].shift();
    }
  }

  // Track rates per second
  let lastGetCount = 0;
  let lastPutCount = 0;
  let lastTimestamp = Date.now();

  // Add listener based on the provided example
  Gun.on("opt", function (ctx) {
    if (ctx.once) {
      return;
    }
    // Check all incoming traffic
    ctx.on("in", function (msg) {
      const to = this.to;

      // Track requests in our custom stats
      if (msg.get) {
        customStats.getRequests++;
      }

      // First, let any message that is not a write (`put`) pass through.
      // This includes `get` requests and acknowledgements.
      if (!msg.put) {
        return to.next(msg);
      }

      // Now we know it's a `put` message. We need to determine if it's
      // from an external peer or from the relay's internal storage.

      // Internal puts (from radisk) will NOT have a `headers` object.
      if (!msg.headers) {
        console.log(
          "INTERNAL PUT ALLOWED (from storage):",
          Object.keys(msg.put)
        );
        return to.next(msg);
      }

      // Track PUT requests from peers
      customStats.putRequests++;

      // If we're here, it's a `put` from a peer that MUST be authenticated.
      const valid =
        msg.headers.token && msg.headers.token === process.env.ADMIN_PASSWORD;

      if (valid) {
        console.log("PEER PUT ALLOWED (valid token):", Object.keys(msg.put));
        return to.next(msg);
      } else {
        const error = "Unauthorized: Invalid or missing token.";
        console.log("PEER PUT REJECTED (invalid token):", Object.keys(msg.put));
        return to.next({
          "@": msg["@"],
          err: error,
        });
      }
    });
  });

  const app = express();
  const publicPath = path.resolve(__dirname, path_public);
  const indexPath = path.resolve(publicPath, "index.html");

  // Explicit root route handling
  app.get("/", (req, res) => {
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.send(
        "<h1>Shogun Enhanced Relay Server</h1><p>Server is running!</p>"
      );
    }
  });

  // Connection tracking
  let totalConnections = 0;
  let activeWires = 0;

  // --- Middleware ---
  app.use(cors()); // Allow all cross-origin requests
  app.use(express.json());
  
  // Configure multer for file uploads
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 100 * 1024 * 1024 // 100MB limit
    }
  });

  console.log("ADMIN_PASSWORD", process.env.ADMIN_PASSWORD);

  // --- IPFS Desktop Proxy Configuration ---
  const IPFS_API_URL = process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
  const IPFS_GATEWAY_URL = process.env.IPFS_GATEWAY_URL || 'http://127.0.0.1:8080';
  const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN || process.env.IPFS_API_KEY;
  
  console.log(`🌐 IPFS API Proxy: ${IPFS_API_URL}`);
  console.log(`🌐 IPFS Gateway Proxy: ${IPFS_GATEWAY_URL}`);
  console.log(`🔐 IPFS Auth: ${IPFS_API_TOKEN ? 'configured' : 'not set'}`);

  // --- IPFS Proxy Routes (MUST BE FIRST) ---
  
  // IPFS Gateway Proxy with fallback - for accessing files via IPFS hash
  // Example: /ipfs/QmHash or /ipns/domain
  app.use('/ipfs', createProxyMiddleware({
    target: IPFS_GATEWAY_URL,
    changeOrigin: true,
    pathRewrite: {
      '^/ipfs': '/ipfs'
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(`📁 IPFS Gateway Request: ${req.method} ${req.url} -> ${IPFS_GATEWAY_URL}${req.url}`);
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`📁 IPFS Gateway Response: ${proxyRes.statusCode} for ${req.url}`);
      
      // If local gateway fails with 404, try to add fallback headers
      if (proxyRes.statusCode === 404) {
        const hash = req.url.replace('/ipfs/', '');
        console.log(`⚠️ Local gateway 404 for hash: ${hash}, consider using public gateway`);
        
        // Add custom header to suggest public gateway
        proxyRes.headers['X-IPFS-Fallback'] = `https://ipfs.io/ipfs/${hash}`;
      }
    },
    onError: (err, req, res) => {
      console.error('❌ IPFS Gateway Proxy Error:', err.message);
      
      // Extract hash from URL for fallback
      const hash = req.url.replace('/ipfs/', '');
      
      res.status(502).json({ 
        success: false, 
        error: 'Local IPFS Gateway unavailable',
        details: err.message,
        fallback: {
          publicGateway: `https://ipfs.io/ipfs/${hash}`,
          cloudflareGateway: `https://cloudflare-ipfs.com/ipfs/${hash}`,
          dweb: `https://dweb.link/ipfs/${hash}`
        }
      });
    }
  }));

  app.use('/ipns', createProxyMiddleware({
    target: IPFS_GATEWAY_URL,
    changeOrigin: true,
    pathRewrite: {
      '^/ipns': '/ipns'
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(`📁 IPNS Gateway Request: ${req.method} ${req.url} -> ${IPFS_GATEWAY_URL}${req.url}`);
    },
    onError: (err, req, res) => {
      console.error('❌ IPNS Gateway Proxy Error:', err.message);
      res.status(500).json({ 
        success: false, 
        error: 'IPFS Gateway unavailable',
        details: err.message 
      });
    }
  }));

  const tokenAuthMiddleware = (req, res, next) => {
    const expectedToken = process.env.ADMIN_PASSWORD;
    console.log("expectedToken", expectedToken);

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized: A bearer token is required.",
      });
    }

    const token = authHeader.split(" ")[1];

    if (token === expectedToken) {
      return next();
    }

    return res.status(403).json({
      success: false,
      error: "Forbidden: The provided token is invalid.",
    });
  };

  // --- Start Server Function ---
  async function startServer() {
    // Test and find available port
    let currentPort = parseInt(port);
    while (!(await testPort(currentPort))) {
      console.log(`Port ${currentPort} in use, trying next...`);
      currentPort++;
    }

    const server = app.listen(currentPort, (error) => {
      if (error) {
        return console.log("Error during app startup", error);
      }
      console.log(`Server listening on port ${currentPort}...`);
    });

    port = currentPort; // Update port for later use
    return server;
  }

  const server = await startServer();

  // Initialize Gun with S3 using proper fake S3 configuration
  const s3Config = {
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION || "us-east-1",
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
    endpoint: process.env.S3_ENDPOINT || "http://127.0.0.1:4569",
    s3ForcePathStyle: true,
    address: process.env.S3_ADDRESS || "127.0.0.1",
    port: process.env.S3_PORT || 4569,
    key: process.env.S3_ACCESS_KEY,
    secret: process.env.S3_SECRET_KEY,
  };

  console.log("🔧 Gun.js S3 Configuration:", {
    bucket: s3Config.bucket,
    //endpoint: `"${s3Config.fakes3}"`,  // Show with quotes to see spaces
    region: s3Config.region,
    key: s3Config.key,
    secret: s3Config.secret,
    hasCredentials: !!(s3Config.key && s3Config.secret),
  });

  // Additional debug info
  console.log("🔍 S3 Configuration Debug:");
  //console.log(`  Endpoint length: ${s3Config.fakes3.length}`);
  //console.log(`  Endpoint characters: ${JSON.stringify(s3Config.fakes3.split(''))}`);
  console.log(`  Environment S3_ENDPOINT: "${process.env.S3_ENDPOINT}"`);

  // Let's also try to test the fake S3 connection directly
  console.log("🧪 Testing FakeS3 connectivity...");
  const testReq = http
    .get(s3Config.endpoint.trim(), (res) => {
      console.log(`✅ FakeS3 responds with status: ${res.statusCode}`);
    })
    .on("error", (err) => {
      console.log(`❌ FakeS3 connection error: ${err.message}`);
    });

  // Test S3 connection before initializing Gun
  console.log("🧪 Testing S3 configuration before Gun initialization...");

  // Initialize Gun with conditional S3 support
  const gunConfig = {
    super: false,
    file: "radata",
    radisk: store,
    web: server,
    localStorage: false,
    uuid: "shogun-relay",
    wire: true,
    axe: true,
    rfs: true,
    /* isValid: (msg) => {
      let valid =  msg && msg && msg.headers && msg.headers.token && msg.headers.token ===  process.env.ADMIN_PASSWORD
      console.log("isValid", valid)
      return valid
    }    */ // Explicitly enable RFS (usually automatic in Node.js)
  };

  // Only add S3 if explicitly enabled and configured properly
  const enableS3 = process.env.ENABLE_S3 === "true";
  if (enableS3) {
    console.log("✅ S3 storage enabled");
    gunConfig.s3 = s3Config;
  } else {
    console.log("📁 Using local file storage only (S3 disabled)");
  }

  const gun = new Gun(gunConfig);

  gun.on("hi", () => {
    totalConnections += 1;
    activeWires += 1;
    db?.get("totalConnections").put(totalConnections);
    db?.get("activeWires").put(activeWires);
    console.log(`Connection opened (active: ${activeWires})`);
  });

  gun.on("bye", () => {
    activeWires -= 1;
    db?.get("activeWires").put(activeWires);
    console.log(`Connection closed (active: ${activeWires})`);
  });

  gun.on("out", { get: { "#": { "*": "" } } });

  // Set up relay stats database
  const db = gun.get("relays").get(host);

  // Set up pulse interval for health monitoring
  setSelfAdjustingInterval(() => {
    db?.get("pulse").put(Date.now());
  }, 10000);

  // Collect time-series data every 5 seconds
  setSelfAdjustingInterval(() => {
    const now = Date.now();
    const timeDiff = (now - lastTimestamp) / 1000; // seconds

    // Calculate rates per second
    const getRate = Math.max(
      0,
      (customStats.getRequests - lastGetCount) / timeDiff
    );
    const putRate = Math.max(
      0,
      (customStats.putRequests - lastPutCount) / timeDiff
    );

    // Update time-series data
    addTimeSeriesPoint("peers#", activeWires);
    addTimeSeriesPoint("memory", process.memoryUsage().heapUsed / 1024 / 1024); // MB
    addTimeSeriesPoint("gets/s", getRate);
    addTimeSeriesPoint("puts/s", putRate);

    // Update counters
    lastGetCount = customStats.getRequests;
    lastPutCount = customStats.putRequests;
    lastTimestamp = now;
  }, 5000);

  // Store relay information
  const link = "http://" + host + (port ? ":" + port : "");
  const extLink = "https://" + host;

  db?.get("host").put(host);
  db?.get("port").put(port);
  db?.get("link").put(link);
  db?.get("ext-link").put(extLink);
  db?.get("store").put(store);
  db?.get("status").put("running");
  db?.get("started").put(Date.now());



  // IPFS API Proxy - for API calls to the IPFS node
  // Example: /api/v0/add, /api/v0/cat, etc.
  app.use('/api/v0', createProxyMiddleware({
    target: IPFS_API_URL,
    changeOrigin: true,
    pathRewrite: {
      '^/api/v0': '/api/v0'
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(`🔧 IPFS API Request: ${req.method} ${req.url} -> ${IPFS_API_URL}${req.url}`);
      
      // Add authentication headers for IPFS API
      if (IPFS_API_TOKEN) {
        proxyReq.setHeader('Authorization', `Bearer ${IPFS_API_TOKEN}`);
      }
      
      // IPFS API requires POST method for most endpoints
      // Override GET requests to POST for IPFS API endpoints
      if (req.method === 'GET' && (req.url.includes('/version') || req.url.includes('/id') || req.url.includes('/peers'))) {
        proxyReq.method = 'POST';
        proxyReq.setHeader('Content-Length', '0');
      }
      
      // Add query parameter to get JSON response
      if (req.url.includes('/version')) {
        const originalPath = proxyReq.path;
        proxyReq.path = originalPath + (originalPath.includes('?') ? '&' : '?') + 'format=json';
      }
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`📤 IPFS API Response: ${proxyRes.statusCode} for ${req.method} ${req.url}`);
      
      // Handle non-JSON responses from IPFS
      if (proxyRes.headers['content-type'] && !proxyRes.headers['content-type'].includes('application/json')) {
        console.log(`📝 IPFS Response Content-Type: ${proxyRes.headers['content-type']}`);
      }
    },
    onError: (err, req, res) => {
      console.error('❌ IPFS API Proxy Error:', err.message);
      res.status(500).json({ 
        success: false, 
        error: 'IPFS API unavailable',
        details: err.message 
      });
    }
  }));

  // IPFS WebUI Detection and Proxy
  app.get('/webui-check', async (req, res) => {
    const webUIUrls = [
      'http://127.0.0.1:5001/webui',
      'http://127.0.0.1:5001/',
      'http://127.0.0.1:5001/ipfs/'
    ];
    
    const results = [];
    for (const url of webUIUrls) {
      try {
        const testReq = http.get(url, (response) => {
          results.push({
            url: url,
            status: response.statusCode,
            headers: response.headers,
            working: response.statusCode === 200
          });
          
          if (results.length === webUIUrls.length) {
            res.json({
              success: true,
              webUITests: results,
              recommended: results.find(r => r.working)?.url
            });
          }
        }).on('error', (err) => {
          results.push({
            url: url,
            status: 'error',
            error: err.message,
            working: false
          });
          
          if (results.length === webUIUrls.length) {
            res.json({
              success: true,
              webUITests: results,
              recommended: results.find(r => r.working)?.url
            });
          }
        });
        
        testReq.setTimeout(2000, () => {
          testReq.destroy();
        });
      } catch (error) {
        results.push({
          url: url,
          status: 'error',
          error: error.message,
          working: false
        });
      }
    }
  });

  // IPFS WebUI Proxy - Multiple attempts  
  app.use('/webui*', createProxyMiddleware({
    target: 'http://127.0.0.1:5001',
    changeOrigin: true,
    pathRewrite: {
      '^/webui': '/webui'
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(`🖥️ IPFS WebUI Request: ${req.method} ${req.url} -> ${proxyReq.path}`);
      
      if (IPFS_API_TOKEN) {
        proxyReq.setHeader('Authorization', `Bearer ${IPFS_API_TOKEN}`);
      }
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(`🖥️ WebUI Response: ${proxyRes.statusCode} for ${req.url}`);
    },
    onError: (err, req, res) => {
      console.error('❌ IPFS WebUI Proxy Error:', err.message);
      // Try fallback to direct IPFS node
      res.redirect('http://127.0.0.1:5001/webui');
    }
  }));

  // Alternative WebUI routes
  app.get('/ipfs-webui', (req, res) => {
    res.redirect('http://127.0.0.1:5001/webui');
  });
  
  app.get('/ipfs-dashboard', (req, res) => {
    res.redirect('http://127.0.0.1:5001/');
  });

  // Debug endpoint to test IPFS proxy manually
  app.get('/debug-ipfs/:hash', async (req, res) => {
    const hash = req.params.hash;
    console.log(`🐛 Debug IPFS request for hash: ${hash}`);
    
    try {
      // Test direct connection to gateway
      const testReq = http.get(`${IPFS_GATEWAY_URL}/ipfs/${hash}`, (gatewayRes) => {
        console.log(`🐛 Direct gateway response: ${gatewayRes.statusCode}`);
        console.log(`🐛 Gateway headers:`, gatewayRes.headers);
        
        let data = '';
        gatewayRes.on('data', chunk => data += chunk);
        gatewayRes.on('end', () => {
          res.json({
            success: true,
            hash: hash,
            directGateway: {
              status: gatewayRes.statusCode,
              headers: gatewayRes.headers,
              dataSize: data.length,
              contentType: gatewayRes.headers['content-type']
            },
            urls: {
              relay: `${req.protocol}://${req.get('host')}/ipfs/${hash}`,
              direct: `${IPFS_GATEWAY_URL}/ipfs/${hash}`,
              api: IPFS_API_URL,
              gateway: IPFS_GATEWAY_URL
            }
          });
        });
      }).on('error', (err) => {
        console.error(`🐛 Direct gateway error:`, err);
        res.json({
          success: false,
          error: err.message,
          hash: hash,
          urls: {
            relay: `${req.protocol}://${req.get('host')}/ipfs/${hash}`,
            direct: `${IPFS_GATEWAY_URL}/ipfs/${hash}`,
            api: IPFS_API_URL,
            gateway: IPFS_GATEWAY_URL
          }
        });
      });
      
      testReq.setTimeout(5000, () => {
        testReq.destroy();
        if (!res.headersSent) {
          res.json({
            success: false,
            error: 'Timeout testing direct gateway',
            hash: hash
          });
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
        hash: hash
      });
    }
  });

  // Test endpoint for well-known IPFS hashes
  app.get('/ipfs-test-hashes', async (req, res) => {
    const testHashes = [
      {
        hash: 'QmRJzsvyCQyizr73Gmms8ZRtvNxmgqumxc2KUp71dfEmoj',
        description: 'Hello World text',
        type: 'text'
      },
      {
        hash: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
        description: 'Hello World alternative',
        type: 'text'
      },
      {
        hash: 'Qme7ss3ARVgxv6rXqVPiikMJ8u2NLgmgszg13pYrDKEoiu',
        description: 'Example directory',
        type: 'directory'
      }
    ];

    const results = [];
    for (const testHash of testHashes) {
      try {
        // Test via our relay
        const relayUrl = `http://localhost:${port}/ipfs/${testHash.hash}`;
        const gatewayUrl = `${IPFS_GATEWAY_URL}/ipfs/${testHash.hash}`;
        
        results.push({
          hash: testHash.hash,
          description: testHash.description,
          type: testHash.type,
          relayUrl: relayUrl,
          gatewayUrl: gatewayUrl,
          publicGateway: `https://ipfs.io/ipfs/${testHash.hash}`
        });
      } catch (error) {
        results.push({
          hash: testHash.hash,
          description: testHash.description,
          error: error.message
        });
      }
    }

    res.json({
      success: true,
      testHashes: results,
      note: 'These are well-known IPFS hashes for testing'
    });
  });

  // Custom IPFS API endpoints with better error handling
  app.post('/ipfs-api/:endpoint(*)', async (req, res) => {
    try {
      const endpoint = req.params.endpoint;
      const requestOptions = {
        hostname: '127.0.0.1',
        port: 5001,
        path: `/api/v0/${endpoint}`,
        method: 'POST',
        headers: {
          'Content-Length': '0'
        }
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        let data = '';
        ipfsRes.on('data', chunk => data += chunk);
        ipfsRes.on('end', () => {
          console.log(`📡 IPFS API ${endpoint} raw response:`, data);
          
          try {
            // Try to parse as JSON
            const jsonData = JSON.parse(data);
            res.json({
              success: true,
              endpoint: endpoint,
              data: jsonData
            });
          } catch (parseError) {
            // If not JSON, check if it's a structured response
            if (data.trim()) {
              // Try to clean the response
              const cleanData = data.replace(/^\uFEFF/, ''); // Remove BOM
              try {
                const jsonData = JSON.parse(cleanData);
                res.json({
                  success: true,
                  endpoint: endpoint,
                  data: jsonData
                });
              } catch (cleanParseError) {
                res.json({
                  success: false,
                  endpoint: endpoint,
                  error: 'Invalid JSON response',
                  rawResponse: data,
                  parseError: cleanParseError.message
                });
              }
            } else {
              res.json({
                success: false,
                endpoint: endpoint,
                error: 'Empty response',
                rawResponse: data
              });
            }
          }
        });
      });

      ipfsReq.on('error', (err) => {
        console.error(`❌ IPFS API ${endpoint} error:`, err);
        res.status(500).json({
          success: false,
          endpoint: endpoint,
          error: err.message
        });
      });

      ipfsReq.setTimeout(10000, () => {
        ipfsReq.destroy();
        if (!res.headersSent) {
          res.status(408).json({
            success: false,
            endpoint: endpoint,
            error: 'Request timeout'
          });
        }
      });

      ipfsReq.end();
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // IPFS File Upload endpoint
  app.post('/ipfs-upload', upload.single('file'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file provided'
        });
      }

      const formData = new FormData();
      formData.append('file', req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype
      });

      const requestOptions = {
        hostname: '127.0.0.1',
        port: 5001,
        path: '/api/v0/add?wrap-with-directory=false',
        method: 'POST',
        headers: {
          ...formData.getHeaders()
        }
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        let data = '';
        ipfsRes.on('data', chunk => data += chunk);
        ipfsRes.on('end', () => {
          console.log('📤 IPFS Upload raw response:', data);
          
          try {
            // IPFS add returns NDJSON (one JSON object per line)
            const lines = data.trim().split('\n');
            const results = lines.map(line => JSON.parse(line));
            
            // Get the main file result (not directory)
            const fileResult = results.find(r => r.Name === req.file.originalname) || results[0];
            
            res.json({
              success: true,
              file: {
                name: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype,
                hash: fileResult?.Hash,
                ipfsUrl: `${req.protocol}://${req.get('host')}/ipfs/${fileResult?.Hash}`,
                gatewayUrl: `${IPFS_GATEWAY_URL}/ipfs/${fileResult?.Hash}`,
                publicGateway: `https://ipfs.io/ipfs/${fileResult?.Hash}`
              },
              ipfsResponse: results
            });
          } catch (parseError) {
            console.error('Upload parse error:', parseError);
            res.json({
              success: false,
              error: 'Failed to parse IPFS response',
              rawResponse: data,
              parseError: parseError.message
            });
          }
        });
      });

      ipfsReq.on('error', (err) => {
        console.error('❌ IPFS Upload error:', err);
        res.status(500).json({
          success: false,
          error: err.message
        });
      });

      ipfsReq.setTimeout(30000, () => {
        ipfsReq.destroy();
        if (!res.headersSent) {
          res.status(408).json({
            success: false,
            error: 'Upload timeout'
          });
        }
      });

      // Send the form data
      formData.pipe(ipfsReq);
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });

  // Custom IPFS status endpoint
  app.get('/ipfs-status', async (req, res) => {
    try {
      // Create request options with authentication
      const requestOptions = {
        hostname: '127.0.0.1',
        port: 5001,
        path: '/api/v0/version',
        method: 'POST',  // IPFS API requires POST method
        headers: {
          'Content-Length': '0'
        }
      };

      // Add authentication if available
      if (IPFS_API_TOKEN) {
        requestOptions.headers['Authorization'] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const testReq = http.request(requestOptions, (ipfsRes) => {
        let data = '';
        ipfsRes.on('data', chunk => data += chunk);
        ipfsRes.on('end', () => {
          console.log('IPFS Raw Response:', data);
          
          try {
            // Try to parse as JSON first
            const versionInfo = JSON.parse(data);
            res.json({
              success: true,
              status: 'connected',
              ipfs: {
                version: versionInfo.Version,
                commit: versionInfo.Commit,
                repo: versionInfo.Repo,
                system: versionInfo.System,
                golang: versionInfo.Golang
              },
              endpoints: {
                api: IPFS_API_URL,
                gateway: IPFS_GATEWAY_URL
              }
            });
          } catch (parseError) {
            // If not JSON, check if it's Kubo text response
            if (data.includes('Kubo RPC')) {
              // Parse Kubo text response
              const lines = data.split('\n');
              let version = 'unknown';
              
              for (const line of lines) {
                if (line.includes('Kubo version:')) {
                  version = line.replace('Kubo version:', '').trim();
                  break;
                }
              }
              
              res.json({
                success: true,
                status: 'connected',
                ipfs: {
                  version: version,
                  type: 'Kubo',
                  rawResponse: data
                },
                endpoints: {
                  api: IPFS_API_URL,
                  gateway: IPFS_GATEWAY_URL
                }
              });
            } else {
              res.json({
                success: false,
                status: 'connected_but_invalid_response',
                error: parseError.message,
                rawResponse: data,
                endpoints: {
                  api: IPFS_API_URL,
                  gateway: IPFS_GATEWAY_URL
                }
              });
            }
          }
        });
      }).on('error', (err) => {
        console.error('IPFS Connection Error:', err);
        res.json({
          success: false,
          status: 'disconnected',
          error: err.message,
          endpoints: {
            api: IPFS_API_URL,
            gateway: IPFS_GATEWAY_URL
          }
        });
      });
      
      testReq.setTimeout(5000, () => {
        testReq.destroy();
        if (!res.headersSent) {
          res.json({
            success: false,
            status: 'timeout',
            error: 'IPFS node did not respond within 5 seconds'
          });
        }
      });

      testReq.end();
    } catch (error) {
      res.status(500).json({
        success: false,
        status: 'error',
        error: error.message
      });
    }
  });

  // --- API Routes ---
  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({
      status: "healthy",
      uptime: process.uptime() * 1000,
      activeConnections: activeWires,
      totalConnections: totalConnections,
      memoryUsage: process.memoryUsage(),
      timestamp: Date.now(),
    });
  });

  // All data endpoint - reads directly from radata
  app.get("/api/alldata", (req, res) => {
    try {
      // Try multiple possible paths for the radata file
      const possiblePaths = [
        path.resolve(__dirname, "radata", "!"),
        path.resolve(process.cwd(), "radata", "!"),
        path.resolve(__dirname, "..", "radata", "!"),
        path.resolve("radata", "!"),
      ];

      let actualPath = null;
      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          actualPath = testPath;
          break;
        }
      }

      if (!actualPath) {
        return res.json({
          success: true,
          data: {},
          message: "No data file found",
        });
      }
      const rawData = fs.readFileSync(actualPath, "utf8");
      const parsedData = JSON.parse(rawData);

      // Convert Gun's internal format to a more readable format
      const convertedData = {};

      function convertNode(obj, path = "") {
        if (!obj || typeof obj !== "object") return obj;

        const result = {};

        for (const [key, value] of Object.entries(obj)) {
          if (key === "" && value && typeof value === "object" && value[":"]) {
            // This is a Gun value object with metadata
            return value[":"];
          } else if (typeof value === "object" && value !== null) {
            const converted = convertNode(value, path ? `${path}/${key}` : key);
            if (converted !== undefined && converted !== null) {
              result[key] = converted;
            }
          }
        }

        return Object.keys(result).length > 0 ? result : undefined;
      }

      for (const [nodeId, nodeData] of Object.entries(parsedData)) {
        const converted = convertNode(nodeData);
        if (converted) {
          convertedData[nodeId] = converted;
        }
      }

      res.json({
        success: true,
        data: convertedData,
        rawSize: rawData.length,
        nodeCount: Object.keys(convertedData).length,
      });
    } catch (error) {
      console.error("Error reading radata:", error);
      res.status(500).json({
        success: false,
        error: "Failed to read data: " + error.message,
      });
    }
  });

  // Enhanced stats endpoint with time-series data
  app.get("/api/stats", (req, res) => {
    try {
      const now = Date.now();
      const uptime = now - customStats.startTime;
      const memUsage = process.memoryUsage();

      // Calculate current rates
      const timeDiff = Math.max(1, (now - lastTimestamp) / 1000);
      const currentGetRate =
        (customStats.getRequests - lastGetCount) / timeDiff;
      const currentPutRate =
        (customStats.putRequests - lastPutCount) / timeDiff;

      const cleanStats = {
        peers: {
          count: activeWires,
          time: uptime / 1000 / 60, // minutes
        },
        node: {
          count: Object.keys(customStats.timeSeries.data).length,
          memory: {
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external,
          },
        },
        up: {
          time: uptime,
        },
        memory: memUsage.heapUsed,
        dam: {
          in: {
            count: customStats.getRequests,
            rate: currentGetRate,
          },
          out: {
            count: customStats.putRequests,
            rate: currentPutRate,
          },
        },
        rad: {
          get: { count: customStats.getRequests },
          put: { count: customStats.putRequests },
        },
        // Time-series data for charts
        all: customStats.timeSeries.data,
        over: 5, // Update interval in seconds
      };

      res.json({ success: true, ...cleanStats });
    } catch (error) {
      console.error("Error in /api/stats:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to retrieve stats." });
    }
  });

  // Stats endpoint compatible with the advanced HTML dashboard
  app.get("/stats.json", (req, res) => {
    try {
      const now = Date.now();
      const uptime = now - customStats.startTime;
      const memUsage = process.memoryUsage();

      // Calculate current rates
      const timeDiff = Math.max(1, (now - lastTimestamp) / 1000);
      const currentGetRate =
        (customStats.getRequests - lastGetCount) / timeDiff;
      const currentPutRate =
        (customStats.putRequests - lastPutCount) / timeDiff;

      const statsResponse = {
        peers: {
          count: activeWires,
          time: uptime,
        },
        node: {
          count: Object.keys(customStats.timeSeries.data).length,
        },
        up: {
          time: uptime,
        },
        memory: {
          heapUsed: memUsage.heapUsed,
          heapTotal: memUsage.heapTotal,
          external: memUsage.external,
        },
        dam: {
          in: {
            count: customStats.getRequests,
            done: customStats.getRequests * 1024, // Estimate bytes
          },
          out: {
            count: customStats.putRequests,
            done: customStats.putRequests * 1024, // Estimate bytes
          },
        },
        // Time-series data for charts - each entry is [timestamp, value]
        all: customStats.timeSeries.data,
        over: 5000, // Update interval in milliseconds
      };

      res.json(statsResponse);
    } catch (error) {
      console.error("Error in /stats.json:", error);
      res.status(500).json({ error: "Failed to retrieve stats." });
    }
  });

  app.post("/api/derive", async (req, res) => {
    try {
      const { password, extra, options } = req.body;
      if (!password) {
        return res
          .status(400)
          .json({ success: false, error: "Password is required" });
      }
      const derivedKeys = await derive(password, extra, options);
      return res.json({ success: true, derivedKeys });
    } catch (error) {
      console.error("Error in derive API:", error);
      return res.status(500).json({
        success: false,
        error: error.message || "Failed to derive keys",
      });
    }
  });

  const getGunNodeFromPath = (pathString) => {
    const pathSegments = pathString.split("/").filter(Boolean);
    let node = gun;
    pathSegments.forEach((segment) => {
      node = node.get(segment);
    });
    return node;
  };

  app.get("/node/*", tokenAuthMiddleware, (req, res) => {
    const path = req.params[0];
    if (!path || path.trim() === "") {
      return res
        .status(400)
        .json({ success: false, error: "Node path cannot be empty." });
    }
    const node = getGunNodeFromPath(path);
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({ success: false, error: "Request timed out." });
      }
    }, 5000);
    node.once((data) => {
      clearTimeout(timeout);
      if (!res.headersSent) {
        if (data && data._) {
          delete data._;
        }
        res.json({ success: true, path, data: data === null ? null : data });
      }
    });
  });

  app.post("/node/*", tokenAuthMiddleware, async (req, res) => {
    try {
      let path = req.params[0];
      if (!path || path.trim() === "") {
        return res
          .status(400)
          .json({ success: false, error: "Node path cannot be empty." });
      }
      let data = req.body;
      if (data && typeof data === "object" && Object.keys(data).length === 0) {
        const originalPath = req.params[0];
        const lastSlashIndex = originalPath.lastIndexOf("/");
        if (lastSlashIndex !== -1 && lastSlashIndex < originalPath.length - 1) {
          path = originalPath.substring(0, lastSlashIndex);
          const dataFromPath = decodeURIComponent(
            originalPath.substring(lastSlashIndex + 1)
          );
          try {
            data = JSON.parse(dataFromPath);
          } catch (e) {
            data = dataFromPath;
          }
        }
      }
      if (typeof data === "undefined") {
        return res
          .status(400)
          .json({ success: false, error: "No data provided in body or path." });
      }
      const node = getGunNodeFromPath(path);
      const ack = await new Promise((resolve) =>
        node.put(data, (ack) => resolve(ack))
      );
      if (ack.err) throw new Error(ack.err);
      return res.json({ success: true, path, data });
    } catch (error) {
      console.error("Error in POST /node/*:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  app.delete("/node/*", tokenAuthMiddleware, async (req, res) => {
    try {
      const path = req.params[0];
      if (!path || path.trim() === "") {
        return res
          .status(400)
          .json({ success: false, error: "Node path cannot be empty." });
      }
      const node = getGunNodeFromPath(path);
      const ack = await new Promise((resolve) =>
        node.put(null, (ack) => resolve(ack))
      );
      if (ack.err) throw new Error(ack.err);
      res.json({ success: true, path, message: "Data deleted." });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // --- Static Files & Page Routes ---
  app.use(express.static(publicPath));

  const cleanReturnString = (value) => {
    if (!value) return "";
    return value.replace(/"/g, `'`);
  };

  app.get("/blog/:id", (req, res) => {
    const htmlData = fs.readFileSync(indexPath, "utf8");
    let numberOfTries = 0;
    const chain = gun
      .get(`hal9000/post`)
      .get(req.params.id)
      .on((post) => {
        numberOfTries++;
        if (!post) {
          if (numberOfTries > 1) {
            chain.off();
            return res.sendStatus(404);
          }
          return;
        }
        if (res.writableEnded) {
          chain.off();
          return;
        }
        const finalHtml = `
            <!DOCTYPE html>
            <html>
               <head>
                  <title>${post.title || "Blog Post"}</title>
                  <meta name="description" content="${cleanReturnString(
                    post.description || ""
                  )}" />
               </head>
               <body>
                  ${post.content}
               </body>
            </html>
         `;
        return res.send(finalHtml);
      });
    setTimeout(() => {
      if (!res.writableEnded) {
        res.sendStatus(408);
      }
      chain.off();
    }, 5000);
  });

  app.get("/derive", (req, res) => {
    res.sendFile(path.resolve(publicPath, "derive.html"));
  });
  app.get("/view", (req, res) => {
    res.sendFile(path.resolve(publicPath, "view.html"));
  });
  app.get("/edit", (req, res) => {
    res.sendFile(path.resolve(publicPath, "edit.html"));
  });
  app.get("/stats", (req, res) => {
    res.sendFile(path.resolve(publicPath, "stats.html"));
  });
  app.get("/charts", (req, res) => {
    res.sendFile(path.resolve(publicPath, "charts.html"));
  });
  app.get("/create", (req, res) => {
    res.sendFile(path.resolve(publicPath, "create.html"));
  });
  app.get("/client", (req, res) => {
    res.sendFile(path.resolve(publicPath, "client.html"));
  });
  app.get("/server", (req, res) => {
    res.sendFile(path.resolve(publicPath, "server.html"));
  });
  app.get("/visualGraph", (req, res) => {
    res.sendFile(path.resolve(publicPath, "visualGraph/visualGraph.html"));
  });
  app.get("/graph", (req, res) => {
    res.sendFile(path.resolve(publicPath, "graph.html"));
  });
  app.get("/ipfs-test", (req, res) => {
    res.sendFile(path.resolve(publicPath, "ipfs-test.html"));
  });

  // Fallback to index.html
  app.get("/*", (req, res) => {
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send("Index file not found");
    }
  });

  // Display server information
  console.log(`Internal URL: ${link}/`);
  console.log(`External URL: ${extLink}/`);
  console.log(`Gun peer: ${link}/gun`);
  console.log(`Storage: ${store ? "enabled" : "disabled"}`);
  console.log(
    `Admin password: ${process.env.ADMIN_PASSWORD ? "configured" : "not set"}`
  );
  
  // Display IPFS proxy information
  console.log('\n=== IPFS PROXY ENDPOINTS ===');
  console.log(`📁 IPFS Gateway: ${link}/ipfs/`);
  console.log(`📁 IPNS Gateway: ${link}/ipns/`);
  console.log(`🔧 IPFS API: ${link}/api/v0/`);
  console.log(`🖥️  IPFS WebUI: ${link}/webui/`);
  console.log(`📊 IPFS Status: ${link}/ipfs-status`);
  console.log(`🧪 IPFS Test Page: ${link}/ipfs-test`);
  console.log(`🎯 IPFS Node API: ${IPFS_API_URL}`);
  console.log(`🌐 IPFS Node Gateway: ${IPFS_GATEWAY_URL}`);
  console.log('==============================');

  // Show QR code if enabled
  if (showQr !== false) {
    console.log("\n=== QR CODE ===");
    try {
      console.log(qr(link, "ascii", { border: 1 }));
    } catch (error) {
      console.warn("QR code generation failed:", error.message);
    }
    console.log("===============\n");
  }

  // Graceful shutdown
  async function shutdown() {
    console.log("\nShutting down relay server...");

    if (db) {
      db.get("status").put("stopping");
    }

    if (server) {
      await new Promise((resolve) => {
        server.close(resolve);
      });
    }

    if (db) {
      db.get("status").put("stopped");
      db.get("stopped").put(Date.now());
    }

    console.log("Relay server shutdown complete.");
  }

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    await shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await shutdown();
    process.exit(0);
  });
} // End of initializeServer function

// Start the server
initializeServer().catch(console.error);
