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

//import "bullet-catcher";

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

import ShogunCoreModule from "shogun-core";
const { derive } = ShogunCoreModule;

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

  // Custom stats tracking
  let customStats = {
    getRequests: 0,
    putRequests: 0,
    startTime: Date.now()
  };

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
        msg.headers.token && msg.headers.token === "shogun2025";

      if (valid) {
        console.log(
          "PEER PUT ALLOWED (valid token):",
          Object.keys(msg.put)
        );
        return to.next(msg);
      } else {
        const error = "Unauthorized: Invalid or missing token.";
        console.log(
          "PEER PUT REJECTED (invalid token):",
          Object.keys(msg.put)
        );
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

  console.log("ADMIN_PASSWORD", process.env.ADMIN_PASSWORD);

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

  const gun = new Gun({
    super: false,
    file: "radata",
    radisk: store,
    web: server,
    localStorage: false,
    uuid: "shogun-relay",
  });

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
        path.resolve("radata", "!")
      ];
      
      let actualPath = null;
      for (const testPath of possiblePaths) {
        if (fs.existsSync(testPath)) {
          actualPath = testPath;
          break;
        }
      }
      
      if (!actualPath) {
        return res.json({ success: true, data: {}, message: "No data file found" });
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
        nodeCount: Object.keys(convertedData).length
      });
      
    } catch (error) {
      console.error("Error reading radata:", error);
      res.status(500).json({ 
        success: false, 
        error: "Failed to read data: " + error.message 
      });
    }
  });

  // Enhanced stats endpoint
  app.get("/api/stats", (req, res) => {
    try {
      const rawStats = gun._.stats;
      if (rawStats) {
        // Use our custom stats instead of Gun's internal ones
        const cleanStats = {
          peers: {
            count: activeWires,
          },
          node: {
            up: {
              time: Date.now() - customStats.startTime,
            },
            memory: process.memoryUsage(),
          },
          rad: {
            get: { count: customStats.getRequests },
            put: { count: customStats.putRequests },
          },
        };
        res.json({ success: true, stats: cleanStats });
      } else {
        res.status(404).json({ success: false, error: "Stats not available." });
      }
    } catch (error) {
      console.error("Error in /api/stats:", error);
      res
        .status(500)
        .json({ success: false, error: "Failed to retrieve stats." });
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
