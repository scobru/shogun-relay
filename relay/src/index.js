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
import AWS from "aws-sdk";

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
const { derive, SEA } = ShogunCoreModule;
import http from "http";
import { createProxyMiddleware } from "http-proxy-middleware";
import multer from "multer";
import FormData from "form-data";

// --- Garbage Collection Configuration ---
const GC_ENABLED = process.env.GC_ENABLED === 'true';
// Namespaces to protect from garbage collection.
const GC_EXCLUDED_NAMESPACES = [
  // --- CRITICAL GUN METADATA ---
  '~', // Protects all user spaces, including user data and aliases (~@username).
  '!', // Protects the root node, often used for system-level pointers.
  'relays', // Protects relay server health-check data.

  // --- APPLICATION DATA ---
  // Add other persistent application namespaces here.
  'public-chat',
  'admin',
  'hal9000' // Example: protect blog posts
];
// Data older than this will be deleted (milliseconds). Default: 24 hours.
const EXPIRATION_AGE = process.env.GC_EXPIRATION_AGE || 24 * 60 * 60 * 1000;
// How often to run the garbage collector (milliseconds). Default: 1 hour.
const GC_INTERVAL = process.env.GC_INTERVAL || 60 * 60 * 1000;

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

  // --- Garbage Collection Service ---
  function runGarbageCollector() {
    if (!GC_ENABLED) {
      console.log('🗑️ Garbage Collector is disabled.');
      return;
    }
    console.log('🗑️ Running Garbage Collector...');
    let cleanedCount = 0;
    const now = Date.now();
    const graph = gun._.graph;

    for (const soul in graph) {
      if (Object.prototype.hasOwnProperty.call(graph, soul)) {
        // Check if the soul is in a protected namespace
        const isProtected = GC_EXCLUDED_NAMESPACES.some(ns => soul.startsWith(ns));

        if (isProtected) {
          continue; // Skip protected data
        }

        const node = graph[soul];
        // Check for expiration timestamp on non-protected data
        if (node && node.createdAt && (now - node.createdAt > EXPIRATION_AGE)) {
          // Nullify the node to delete it from Gun
          gun.get(soul).put(null);
          cleanedCount++;
          console.log(`🗑️ Cleaned up expired node: ${soul}`);
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(`🗑️ Garbage Collector finished. Cleaned ${cleanedCount} expired nodes.`);
    } else {
      console.log('🗑️ Garbage Collector finished. No expired nodes found.');
    }
  }

  // Schedule the garbage collector to run periodically
  if (GC_ENABLED) {
    setInterval(runGarbageCollector, GC_INTERVAL);
    console.log(`✅ Garbage Collector scheduled to run every ${GC_INTERVAL / 1000 / 60} minutes.`);
    // Run once on startup after a delay
    setTimeout(runGarbageCollector, 30 * 1000); // Run 30s after start
  }

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
      if (!msg.put) {
        return to.next(msg);
      }

      // --- Garbage Collection Timestamping ---
      // For every incoming write, check if it's for a protected namespace.
      // If not, inject a `createdAt` timestamp so it can be cleaned up later.
      if (GC_ENABLED) {
        Object.keys(msg.put).forEach(soul => {
            const isProtected = GC_EXCLUDED_NAMESPACES.some(ns => soul.startsWith(ns));
            if (!isProtected) {
                // This is ephemeral data, stamp it for future garbage collection.
                const node = msg.put[soul];
                if (node && typeof node === 'object' && !node.createdAt) {
                    node.createdAt = Date.now();
                }
            }
        });
      }
      // --- End Garbage Collection Timestamping ---

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
      fileSize: 100 * 1024 * 1024, // 100MB limit
    },
  });

  console.log("ADMIN_PASSWORD", process.env.ADMIN_PASSWORD);

  // --- IPFS Desktop Proxy Configuration ---
  const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
  const IPFS_GATEWAY_URL =
    process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";
  const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN || process.env.IPFS_API_KEY;

  console.log(`🌐 IPFS API Proxy: ${IPFS_API_URL}`);
  console.log(`🌐 IPFS Gateway Proxy: ${IPFS_GATEWAY_URL}`);
  console.log(`🔐 IPFS Auth: ${IPFS_API_TOKEN ? "configured" : "not set"}`);

  // Test IPFS connectivity on startup
  console.log("🧪 Testing IPFS connectivity...");
  const testIPFSConnection = () => {
    return new Promise((resolve) => {
      const testReq = http
        .get(`${IPFS_API_URL}/api/v0/version`, (response) => {
          if (response.statusCode === 200 || response.statusCode === 405) {
            console.log("✅ IPFS node is responsive");
            resolve(true);
          } else {
            console.log(
              `⚠️ IPFS node responded with status ${response.statusCode}`
            );
            resolve(false);
          }
        })
        .on("error", (err) => {
          console.log(`❌ IPFS node unreachable: ${err.message}`);
          console.log(
            "💡 Make sure IPFS Desktop is running or IPFS daemon is started"
          );
          resolve(false);
        });

      testReq.setTimeout(3000, () => {
        testReq.destroy();
        console.log("⏰ IPFS connection test timed out");
        resolve(false);
      });

      testReq.end();
    });
  };

  // IPFS Gateway Proxy with fallback - for accessing files via IPFS hash
  app.use(
    "/ipfs",
    createProxyMiddleware({
      target: IPFS_GATEWAY_URL,
      changeOrigin: true,
      pathRewrite: {
        "^/ipfs": "/ipfs", // Changed to preserve /ipfs in the path
      },
      onProxyReq: (proxyReq, req, res) => {
        console.log(
          `📁 IPFS Gateway Request: ${req.method} ${req.url} -> ${IPFS_GATEWAY_URL}${proxyReq.path}`
        );
      },
      onProxyRes: (proxyRes, req, res) => {
        console.log(
          `📁 IPFS Gateway Response: ${proxyRes.statusCode} for ${req.url}`
        );

        // If local gateway fails with 404, try to add fallback headers
        if (proxyRes.statusCode === 404) {
          const hash = req.url.split("/ipfs/")[1];
          if (hash) {
            console.log(
              `⚠️ Local gateway 404 for hash: ${hash}, adding fallback headers`
            );
            proxyRes.headers[
              "X-IPFS-Fallback"
            ] = `https://ipfs.io/ipfs/${hash}`;
            // Add CORS headers
            proxyRes.headers["Access-Control-Allow-Origin"] = "*";
            proxyRes.headers["Access-Control-Allow-Methods"] =
              "GET, HEAD, OPTIONS";
          }
        }
      },
      onError: (err, req, res) => {
        console.error("❌ IPFS Gateway Proxy Error:", err.message);

        // Extract hash from URL for fallback
        const hash = req.url.split("/ipfs/")[1];

        res.status(502).json({
          success: false,
          error: "Local IPFS Gateway unavailable",
          details: err.message,
          fallback: hash
            ? {
                publicGateway: `https://ipfs.io/ipfs/${hash}`,
                cloudflareGateway: `https://cloudflare-ipfs.com/ipfs/${hash}`,
                dweb: `https://dweb.link/ipfs/${hash}`,
              }
            : undefined,
        });
      },
    })
  );

  app.use(
    "/ipns",
    createProxyMiddleware({
      target: IPFS_GATEWAY_URL,
      changeOrigin: true,
      pathRewrite: {
        "^/ipns": "/ipns",
      },
      onProxyReq: (proxyReq, req, res) => {
        console.log(
          `📁 IPNS Gateway Request: ${req.method} ${req.url} -> ${IPFS_GATEWAY_URL}${req.url}`
        );
      },
      onError: (err, req, res) => {
        console.error("❌ IPNS Gateway Proxy Error:", err.message);
        res.status(500).json({
          success: false,
          error: "IPFS Gateway unavailable",
          details: err.message,
        });
      },
    })
  );

  const tokenAuthMiddleware = (req, res, next) => {
    const expectedToken = process.env.ADMIN_PASSWORD;

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
    // file: "radata",
    // radisk: store,
    web: server,
    // localStorage: false,
    uuid: "shogun-relay",
    wire: true,
    axe: true,
    rfs: true,
    peer: ['http://localhost:8765/gun']
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
  // SECURED: This generic proxy requires the admin token for any access.
  app.use('/api/v0', tokenAuthMiddleware, createProxyMiddleware({
    target: IPFS_API_URL,
    changeOrigin: true,
    pathRewrite: {
      "^/api/v0": "/api/v0",
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(
        `🔧 IPFS API Request: ${req.method} ${req.url} -> ${IPFS_API_URL}${req.url}`
      );

      // Add authentication headers for IPFS API
      if (IPFS_API_TOKEN) {
        proxyReq.setHeader("Authorization", `Bearer ${IPFS_API_TOKEN}`);
      }

      // IPFS API requires POST method for most endpoints
      // Override GET requests to POST for IPFS API endpoints
      if (
        req.method === "GET" &&
        (req.url.includes("/version") ||
          req.url.includes("/id") ||
          req.url.includes("/peers"))
      ) {
        proxyReq.method = "POST";
        proxyReq.setHeader("Content-Length", "0");
      }

      // Add query parameter to get JSON response
      if (req.url.includes("/version")) {
        const originalPath = proxyReq.path;
        proxyReq.path =
          originalPath +
          (originalPath.includes("?") ? "&" : "?") +
          "format=json";
      }
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(
        `📤 IPFS API Response: ${proxyRes.statusCode} for ${req.method} ${req.url}`
      );

      // Handle non-JSON responses from IPFS
      if (
        proxyRes.headers["content-type"] &&
        !proxyRes.headers["content-type"].includes("application/json")
      ) {
        console.log(
          `📝 IPFS Response Content-Type: ${proxyRes.headers["content-type"]}`
        );
      }
    },
    onError: (err, req, res) => {
      console.error("❌ IPFS API Proxy Error:", err.message);
      res.status(500).json({
        success: false,
        error: "IPFS API unavailable",
        details: err.message,
      });
    },
  }));

  // Custom IPFS API endpoints with better error handling
  app.post("/ipfs-api/:endpoint(*)", async (req, res) => {
    try {
      const endpoint = req.params.endpoint;
      const requestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: `/api/v0/${endpoint}`,
        method: "POST",
        headers: {
          "Content-Length": "0",
        },
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        let data = "";
        ipfsRes.on("data", (chunk) => (data += chunk));
        ipfsRes.on("end", () => {
          console.log(`📡 IPFS API ${endpoint} raw response:`, data);

          try {
            // Try to parse as JSON
            const jsonData = JSON.parse(data);
            res.json({
              success: true,
              endpoint: endpoint,
              data: jsonData,
            });
          } catch (parseError) {
            // If not JSON, check if it's a structured response
            if (data.trim()) {
              // Try to clean the response
              const cleanData = data.replace(/^\uFEFF/, ""); // Remove BOM
              try {
                const jsonData = JSON.parse(cleanData);
                res.json({
                  success: true,
                  endpoint: endpoint,
                  data: jsonData,
                });
              } catch (cleanParseError) {
                res.json({
                  success: false,
                  endpoint: endpoint,
                  error: "Invalid JSON response",
                  rawResponse: data,
                  parseError: cleanParseError.message,
                });
              }
            } else {
              res.json({
                success: false,
                endpoint: endpoint,
                error: "Empty response",
                rawResponse: data,
              });
            }
          }
        });
      });

      ipfsReq.on("error", (err) => {
        console.error(`❌ IPFS API ${endpoint} error:`, err);
        res.status(500).json({
          success: false,
          endpoint: endpoint,
          error: err.message,
        });
      });

      ipfsReq.setTimeout(10000, () => {
        ipfsReq.destroy();
        if (!res.headersSent) {
          res.status(408).json({
            success: false,
            endpoint: endpoint,
            error: "Request timeout",
          });
        }
      });

      ipfsReq.end();
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // IPFS File Upload endpoint
  app.post("/ipfs-upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No file provided",
        });
      }

      const formData = new FormData();
      formData.append("file", req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype,
      });

      const requestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/add?wrap-with-directory=false",
        method: "POST",
        headers: {
          ...formData.getHeaders(),
        },
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        let data = "";
        ipfsRes.on("data", (chunk) => (data += chunk));
        ipfsRes.on("end", () => {
          console.log("📤 IPFS Upload raw response:", data);

          try {
            // IPFS add returns NDJSON (one JSON object per line)
            const lines = data.trim().split("\n");
            const results = lines.map((line) => JSON.parse(line));

            // Get the main file result (not directory)
            const fileResult =
              results.find((r) => r.Name === req.file.originalname) ||
              results[0];

            res.json({
              success: true,
              file: {
                name: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype,
                hash: fileResult?.Hash,
                ipfsUrl: `${req.protocol}://${req.get("host")}/ipfs-content/${
                  fileResult?.Hash
                }`,
                gatewayUrl: `${IPFS_GATEWAY_URL}/ipfs/${fileResult?.Hash}`,
                publicGateway: `https://ipfs.io/ipfs/${fileResult?.Hash}`,
              },
              ipfsResponse: results,
            });
          } catch (parseError) {
            console.error("Upload parse error:", parseError);
            res.json({
              success: false,
              error: "Failed to parse IPFS response",
              rawResponse: data,
              parseError: parseError.message,
            });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        console.error("❌ IPFS Upload error:", err);
        res.status(500).json({
          success: false,
          error: err.message,
        });
      });

      ipfsReq.setTimeout(30000, () => {
        ipfsReq.destroy();
        if (!res.headersSent) {
          res.status(408).json({
            success: false,
            error: "Upload timeout",
          });
        }
      });

      // Send the form data
      formData.pipe(ipfsReq);
    } catch (error) {
      console.error("Upload error:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Custom IPFS status endpoint
  app.get("/ipfs-status", async (req, res) => {
    try {
      // Create request options with authentication
      const requestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: "/api/v0/version",
        method: "POST", // IPFS API requires POST method
        headers: {
          "Content-Length": "0",
        },
      };

      // Add authentication if available
      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const testReq = http
        .request(requestOptions, (ipfsRes) => {
          let data = "";
          ipfsRes.on("data", (chunk) => (data += chunk));
          ipfsRes.on("end", () => {
            console.log("IPFS Raw Response:", data);

            try {
              // Try to parse as JSON first
              const versionInfo = JSON.parse(data);
              res.json({
                success: true,
                status: "connected",
                ipfs: {
                  version: versionInfo.Version,
                  commit: versionInfo.Commit,
                  repo: versionInfo.Repo,
                  system: versionInfo.System,
                  golang: versionInfo.Golang,
                },
                endpoints: {
                  api: IPFS_API_URL,
                  gateway: IPFS_GATEWAY_URL,
                },
              });
            } catch (parseError) {
              // If not JSON, check if it's Kubo text response
              if (data.includes("Kubo RPC")) {
                // Parse Kubo text response
                const lines = data.split("\n");
                let version = "unknown";

                for (const line of lines) {
                  if (line.includes("Kubo version:")) {
                    version = line.replace("Kubo version:", "").trim();
                    break;
                  }
                }

                res.json({
                  success: true,
                  status: "connected",
                  ipfs: {
                    version: version,
                    type: "Kubo",
                    rawResponse: data,
                  },
                  endpoints: {
                    api: IPFS_API_URL,
                    gateway: IPFS_GATEWAY_URL,
                  },
                });
              } else {
                res.json({
                  success: false,
                  status: "connected_but_invalid_response",
                  error: parseError.message,
                  rawResponse: data,
                  endpoints: {
                    api: IPFS_API_URL,
                    gateway: IPFS_GATEWAY_URL,
                  },
                });
              }
            }
          });
        })
        .on("error", (err) => {
          console.error("IPFS Connection Error:", err);
          res.json({
            success: false,
            status: "disconnected",
            error: err.message,
            endpoints: {
              api: IPFS_API_URL,
              gateway: IPFS_GATEWAY_URL,
            },
          });
        });

      testReq.setTimeout(5000, () => {
        testReq.destroy();
        if (!res.headersSent) {
          res.json({
            success: false,
            status: "timeout",
            error: "IPFS node did not respond within 5 seconds",
          });
        }
      });

      testReq.end();
    } catch (error) {
      res.status(500).json({
        success: false,
        status: "error",
        error: error.message,
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

  // API endpoint to provide relay configuration details
  app.get('/api/relay-info', (req, res) => {
    res.json({
      success: true,
      name: process.env.RELAY_NAME || 'Shogun Relay Control Panel'
    });
  });

  // All data endpoint - reads directly from the live in-memory graph.
  app.get("/api/alldata", tokenAuthMiddleware, (req, res) => {
    try {
      // Access the live, in-memory graph from the Gun instance
      let graphData = gun._.graph;

      // If the graph contains a `!` node, which typically holds the root,
      // use its contents as the main graph.
      if (graphData && graphData['!']) {
        console.log("Found '!' node in live graph, using it as the root.");
        graphData = graphData['!'];
      }

      // Clean the graph data for serialization (remove circular `_` metadata)
      const cleanGraph = {};
      for (const soul in graphData) {
        if (Object.prototype.hasOwnProperty.call(graphData, soul)) {
          const node = graphData[soul];
          const cleanNode = {};
          for (const key in node) {
            if (key !== '_') {
              cleanNode[key] = node[key];
            }
          }
          cleanGraph[soul] = cleanNode;
        }
      }

      res.json({
        success: true,
        data: cleanGraph,
        rawSize: JSON.stringify(cleanGraph).length,
        nodeCount: Object.keys(cleanGraph).length,
      });

    } catch (error) {
      console.error("Error reading live graph data:", error);
      res.status(500).json({
        success: false,
        error: "Failed to read data from live graph: " + error.message,
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

  app.get("/node/*", tokenAuthMiddleware, async (req, res) => {
    const path = req.params[0];
    if (!path || path.trim() === "") {
      return res
        .status(400)
        .json({ success: false, error: "Node path cannot be empty." });
    }
  
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({ success: false, error: "Request timed out." });
      }
    }, 5000); // 5-second timeout
  
    try {
      const node = getGunNodeFromPath(path);
      const data = await node; // Using promise-based .then()
      
      clearTimeout(timeout);
  
      if (!res.headersSent) {
        // Clean the GunDB metadata (`_`) before sending
        if (data && data._) {
          delete data._;
        }
        // Ensure undefined data is sent as null
        res.json({ success: true, path, data: data === undefined ? null : data });
      }
    } catch (error) {
      clearTimeout(timeout);
      if (!res.headersSent) {
        console.error("Error in GET /node/*:", error);
        res.status(500).json({ success: false, error: "Failed to retrieve node data.", details: error.message });
      }
    }
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
      await node.put(data); // Simplified promise-based put
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
      await node.put(null); // Simplified promise-based delete
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
  app.get("/upload", (req, res) => {
    res.sendFile(path.resolve(publicPath, "upload.html"));
  });
  app.get("/pin-manager", (req, res) => {
    res.sendFile(path.resolve(publicPath, "pin-manager.html"));
  });

  app.get("/s3-dashboard", (req, res) => {
    res.sendFile(path.resolve(publicPath, "s3-dashboard.html"));
  });

  app.get("/chat", (req, res) => {
    res.sendFile(path.resolve(publicPath, "chat.html"));
  });

  app.get("/notes", (req, res) => {
    res.sendFile(path.resolve(publicPath, "notes.html"));
  });

  // Add route to fetch and display IPFS content
  app.get("/ipfs-content/:cid", async (req, res) => {
    const { cid } = req.params;
    const { token } = req.query;

    if (!cid) {
      return res.status(400).json({
        success: false,
        error: "CID is required",
      });
    }

    try {
      // Create request to local gateway
      const requestOptions = {
        hostname: new URL(IPFS_GATEWAY_URL).hostname,
        port: new URL(IPFS_GATEWAY_URL).port,
        path: `/ipfs/${cid}`,
        method: "GET",
      };

      const ipfsReq = http.get(requestOptions, (ipfsRes) => {
        // If no token, just stream the response
        if (!token) {
          res.setHeader(
            "Content-Type",
            ipfsRes.headers["content-type"] || "application/octet-stream"
          );
          ipfsRes.pipe(res);
          return;
        }

        // If token is provided, buffer the response to decrypt it
        let body = "";
        ipfsRes.on("data", (chunk) => (body += chunk));
        ipfsRes.on("end", async () => {
          try {
            const decrypted = await SEA.decrypt(body, token);

            if (decrypted) {
              // It's a Base64 data URL, e.g., "data:image/png;base64,iVBORw0KGgo..."
              const parts = decrypted.match(/^data:(.+);base64,(.+)$/);
              if (parts) {
                const mimeType = parts[1];
                const fileContents = Buffer.from(parts[2], 'base64');
                res.setHeader('Content-Type', mimeType);
                res.send(fileContents);
              } else {
                // Not a data URL, just plain text
                res.setHeader('Content-Type', 'text/plain');
                res.send(decrypted);
              }
            } else {
              // Decryption failed, send raw content
              res.setHeader('Content-Type', ipfsRes.headers['content-type'] || 'application/octet-stream');
              res.send(body);
            }
          } catch (e) {
            console.error("Decryption error:", e);
            // Decryption failed, send raw content
            res.setHeader('Content-Type', ipfsRes.headers['content-type'] || 'application/octet-stream');
            res.send(body);
          }
        });

        ipfsRes.on("error", (err) => {
          console.error(`❌ Error streaming IPFS content: ${err.message}`);
          if (!res.headersSent) {
            res.status(500).json({
              success: false,
              error: "Failed to stream IPFS content",
              details: err.message,
            });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        console.error(`❌ Error fetching from IPFS gateway: ${err.message}`);
        if (!res.headersSent) {
          res.status(502).json({
            success: false,
            error: "Failed to fetch from IPFS gateway",
            details: err.message,
            fallback: {
              publicGateway: `https://ipfs.io/ipfs/${cid}`,
              cloudflareGateway: `https://cloudflare-ipfs.com/ipfs/${cid}`,
            },
          });
        }
      });

      // Set a timeout
      ipfsReq.setTimeout(30000, () => {
        ipfsReq.destroy();
        if (!res.headersSent) {
          res.status(504).json({
            success: false,
            error: "Gateway timeout",
            fallback: {
              publicGateway: `https://ipfs.io/ipfs/${cid}`,
              cloudflareGateway: `https://cloudflare-ipfs.com/ipfs/${cid}`,
            },
          });
        }
      });
    } catch (error) {
      console.error(`❌ Error handling IPFS content request: ${error.message}`);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        details: error.message,
      });
    }
  });

  app.get("/api/s3-stats", tokenAuthMiddleware, async (req, res) => {
    const enableS3 = process.env.ENABLE_S3 === "true";
    if (!enableS3) {
      return res.status(400).json({
        success: false,
        error: "S3 is not enabled in the relay configuration.",
      });
    }

    try {
      const s3 = new AWS.S3({
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
        endpoint: process.env.S3_ENDPOINT || "http://127.0.0.1:4569",
        s3ForcePathStyle: true,
        region: process.env.S3_REGION || "us-east-1",
        signatureVersion: 'v4',
      });

      const bucketsData = await s3.listBuckets().promise();
      const buckets = bucketsData.Buckets || [];
      
      let totalObjects = 0;
      let totalSize = 0;

      const bucketDetails = await Promise.all(
        buckets.map(async (bucket) => {
          let bucketSize = 0;
          let objectCount = 0;
          let isTruncated = false;
          let continuationToken;

          do {
            const listObjectsParams = {
              Bucket: bucket.Name,
              ContinuationToken: continuationToken,
            };
            const objectsData = await s3.listObjectsV2(listObjectsParams).promise();
            
            if (objectsData.Contents) {
              objectsData.Contents.forEach(obj => {
                bucketSize += obj.Size;
                objectCount++;
              });
            }

            isTruncated = objectsData.IsTruncated;
            continuationToken = objectsData.NextContinuationToken;

          } while (isTruncated);

          totalObjects += objectCount;
          totalSize += bucketSize;

          return {
            name: bucket.Name,
            creationDate: bucket.CreationDate,
            objectCount: objectCount,
            size: bucketSize,
          };
        })
      );

      res.json({
        success: true,
        stats: {
          totalBuckets: buckets.length,
          totalObjects,
          totalSize,
          buckets: bucketDetails,
        },
      });
    } catch (error) {
      console.error("Error getting S3 stats:", error);
      res.status(500).json({
        success: false,
        error: "Failed to retrieve S3 statistics.",
        details: error.message,
      });
    }
  });

  app.get("/api/s3-buckets/:bucketName/objects", tokenAuthMiddleware, async (req, res) => {
    const enableS3 = process.env.ENABLE_S3 === "true";
    if (!enableS3) {
      return res.status(400).json({ success: false, error: "S3 is not enabled." });
    }

    try {
        const s3 = new AWS.S3({
            accessKeyId: process.env.S3_ACCESS_KEY,
            secretAccessKey: process.env.S3_SECRET_KEY,
            endpoint: process.env.S3_ENDPOINT || "http://127.0.0.1:4569",
            s3ForcePathStyle: true,
            region: process.env.S3_REGION || "us-east-1",
            signatureVersion: 'v4',
        });

        const { bucketName } = req.params;
        const { continuationToken } = req.query;

        const listObjectsParams = {
            Bucket: bucketName,
            ContinuationToken: continuationToken,
        };

        const objectsData = await s3.listObjectsV2(listObjectsParams).promise();

        res.json({
            success: true,
            objects: objectsData.Contents || [],
            nextContinuationToken: objectsData.NextContinuationToken,
        });

    } catch (error) {
        console.error(`Error listing objects for bucket ${req.params.bucketName}:`, error);
        res.status(500).json({
            success: false,
            error: `Failed to retrieve objects for bucket ${req.params.bucketName}.`,
            details: error.message,
        });
    }
  });

  // --- Secure IPFS Management Endpoints ---
  const forwardToIpfsApi = (req, res, endpoint, method = 'POST') => {
    try {
      let path = `/api/v0/${endpoint}`;
      
      const cid = req.body.cid || req.query.cid || (req.params.cid || '');
      if (cid) {
        path += `?arg=${cid}`;
      } else if (req.query.type) {
        path += `?type=${req.query.type}`;
      }

      const requestOptions = {
        hostname: new URL(IPFS_API_URL).hostname,
        port: new URL(IPFS_API_URL).port,
        path: path,
        method: "POST",
        headers: {
          "Content-Length": "0",
          Accept: "application/json",
        },
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        let data = "";

        ipfsRes.on("data", (chunk) => {
          data += chunk;
        });

        ipfsRes.on("end", () => {
          try {
            // Clean the response data by removing any trailing newlines
            const cleanData = data.trim();
            // Try to parse the cleaned JSON
            const jsonData = JSON.parse(cleanData);

            res.json({
              success: true,
              data: jsonData,
            });
          } catch (parseError) {
            console.error("Error parsing IPFS API response:", parseError);
            res.status(500).json({
              success: false,
              error: "Invalid JSON response from IPFS API",
              details: parseError.message,
              rawResponse: data,
            });
          }
        });
      });

      ipfsReq.on("error", (error) => {
        console.error("Error in IPFS API request:", error);
        res.status(500).json({
          success: false,
          error: "IPFS API request failed",
          details: error.message,
        });
      });

      ipfsReq.end();
    } catch (error) {
      console.error("Error in forwardToIpfsApi:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
        details: error.message,
      });
    }
  };

  app.post('/pins/add', tokenAuthMiddleware, (req, res) => forwardToIpfsApi(req, res, 'pin/add'));
  app.post('/pins/rm', tokenAuthMiddleware, (req, res) => forwardToIpfsApi(req, res, 'pin/rm'));
  app.post('/pins/ls', tokenAuthMiddleware, (req, res) => forwardToIpfsApi(req, res, 'pin/ls', 'POST'));
  
  // Custom handler for repo/gc to correctly handle streaming responses
  app.post('/repo/gc', tokenAuthMiddleware, (req, res) => {
    try {
      const gcOptions = {
        hostname: new URL(IPFS_API_URL).hostname,
        port: new URL(IPFS_API_URL).port,
        path: '/api/v0/repo/gc',
        method: 'POST',
        headers: {
          ...(IPFS_API_TOKEN && { 'Authorization': `Bearer ${IPFS_API_TOKEN}` })
        }
      };

      const gcReq = http.request(gcOptions, (gcRes) => {
        let responseBody = '';
        gcRes.on('data', (chunk) => {
          responseBody += chunk; // Consume the stream
        });
        gcRes.on('end', () => {
          if (gcRes.statusCode === 200) {
            console.log('Garbage collection triggered successfully.');
            res.json({ success: true, message: 'Garbage collection completed.' });
          } else {
            console.error(`IPFS repo/gc failed with status ${gcRes.statusCode}:`, responseBody);
            res.status(gcRes.statusCode).json({ success: false, error: 'IPFS garbage collection failed.', details: responseBody });
          }
        });
      });

      gcReq.on('error', (error) => {
        console.error('Error calling /repo/gc:', error);
        res.status(500).json({ success: false, error: error.message });
      });

      gcReq.end();
    } catch (error) {
      console.error('Error setting up /repo/gc request:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/notes', tokenAuthMiddleware, (req, res) => {
    const notesNode = gun.get('admin').get('notes');
    notesNode.once(data => {
      res.json({ success: true, notes: data || '' });
    });
  });

  app.post('/api/notes', tokenAuthMiddleware, (req, res) => {
      const { notes } = req.body;
      if (typeof notes !== 'string') {
          return res.status(400).json({ success: false, error: 'Invalid notes format.' });
      }
      gun.get('admin').get('notes').put(notes, ack => {
          if (ack.err) {
              return res.status(500).json({ success: false, error: ack.err });
          }
          res.json({ success: true });
      });
  });

  app.delete('/api/notes', tokenAuthMiddleware, (req, res) => {
    gun.get('admin').get('notes').put(null, ack => {
        if (ack.err) {
            return res.status(500).json({ success: false, error: ack.err });
        }
        res.json({ success: true, message: 'Notes deleted.' });
    });
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
  console.log("\n=== IPFS PROXY ENDPOINTS ===");
  console.log(`📁 IPFS Gateway: ${link}/ipfs/`);
  console.log(`📁 IPNS Gateway: ${link}/ipns/`);
  console.log(`🔧 IPFS API: ${link}/api/v0/`);
  console.log(`📊 IPFS Status: ${link}/ipfs-status`);

  console.log("==============================");

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
