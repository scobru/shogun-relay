// Simple Gun unauthenticated server
import Gun from "gun";
// MUST be required after Gun to work
import "bullet-catcher";

import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

import "gun/sea.js";
import "gun/lib/then.js";
import "gun/lib/radisk.js";
import "gun/lib/store.js";
import "gun/lib/wire.js";
import "gun/lib/stats.js";
import "gun/lib/server.js";
import "gun/lib/yson.js";
import "gun/lib/rindexed.js";
import "gun/lib/webrtc.js";

import { ShogunCore } from "shogun-core";

// ES Module equivalent for __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8765;
const publicPath = path.resolve(__dirname, "public");
const indexPath = path.resolve(publicPath, "index.html");

// --- Middleware ---
app.use(cors()); // Allow all cross-origin requests
app.use(express.json());

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

// --- Start Server ---
const server = app.listen(PORT, (error) => {
  if (error) {
    return console.log("Error during app startup", error);
  }
  console.log("listening on " + PORT + "...");
});

function hasValidToken(msg) {
  // console.log('Validating message:', JSON.stringify(msg, null, 2));
  
  // Allow GET requests and handshake messages without token
  if (msg.get || msg.dam === "hi" || !msg.put) {
    console.log('Token validation result: true (GET/handshake allowed)');
    return true;
  }
  
  // For PUT operations, REQUIRE headers with valid token
  if (msg.put) {
    if (!msg.headers || !msg.headers.token) {
      console.log('Token validation result: false (PUT without headers/token rejected)');
      return false;
    }
    
    const isValid = msg.headers.token === process.env.ADMIN_PASSWORD;
    console.log('Token validation result:', isValid, 'for token:', msg.headers.token);
    return isValid;
  }
  
  console.log('Token validation result: true (default allow)');
  return true;
}

const gun = Gun({
  web: server,
  peers: ["http://localhost:8765/gun"],
  radisk: true,
  file: "radata",
  localStorage: false,
  uuid: "shogun-relay",
  isValid: hasValidToken,
});

gun.on("out", { get: { "#": { "*": "" } } });

// --- Shogun Core Initialization ---
const shogun = new ShogunCore({
  gunInstance: gun,
  scope: "shogun-relay",
  logging: {
    level: "debug",
    logToConsole: true,
    logTimestamps: true,
  },
});

// --- API Routes ---
app.get("/api/stats", (req, res) => {
  try {
    console.log(gun);
    const rawStats = gun._.stats;
    if (rawStats) {
      // Manually create a clean object to avoid circular references in JSON.stringify
      const cleanStats = {
        DUMP: rawStats.DUMP,
        GET: rawStats.GET,
        PUT: rawStats.PUT,
        dam: rawStats.dam,
        peers: rawStats.peers,
        node: rawStats,
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
    const derivedKeys = await shogun.gundb.derive(password, extra, options);
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
  let node = shogun.gundb.gun;
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

// Fallback to index.html
app.get("/*", (req, res) => {
  res.sendFile(indexPath);
});
