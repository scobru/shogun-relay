// Restricted Gun server

import Gun from "gun";
import fs from "fs";
import path from "path";
import { createServer } from "http";

// Load configuration from config.json
let CONFIG = {};
try {
  const configPath = path.resolve("./config.json");
  const configData = fs.readFileSync(configPath, "utf8");
  CONFIG = JSON.parse(configData);
  console.log("Configuration loaded from config.json ✅");
} catch (error) {
  console.error("Error loading config.json:", error.message);
  console.log("Using default configuration");
  // Default configuration
  CONFIG = {
    PORT: 8000,
    AUTH_TOKEN: "automa25",
    PEERS: [
      "https://gun-manhattan.herokuapp.com/gun",
      "https://peer.wallie.io/gun",
    ],
  };
}

const port = CONFIG.PORT || 8000;
let authToken = CONFIG.AUTH_TOKEN || "automa25";

function hasValidToken(msg) {
  return (
    msg && msg.headers && msg.headers.token && msg.headers.token === authToken
  );
}

function isInternalMessage(msg) {
  // Messages from Gun's internal operations often have specific properties
  // Internal messages typically have faith=true, or come from storage/sync operations
  return (
    (msg._ && msg._.faith) || // Internal faith-based messages
    (msg._ && msg._.ram) || // RAM-based internal messages
    (msg._ && msg._.rad) || // Radial/sync messages
    !msg.headers || // No headers usually means internal
    (msg._ && !msg._.via) // Messages without 'via' are often internal
  );
}

// Add listener
Gun.on("opt", function (ctx) {
  if (ctx.once) {
    return;
  }

  // Check all incoming traffic
  ctx.on("in", function (msg) {
    const to = this.to;

    // Allow all operations that aren't PUTs
    if (!msg.put) {
      to.next(msg);
      return;
    }

    // For PUT operations, check if it's internal or has valid token
    if (isInternalMessage(msg)) {
      console.log("WRITING - Internal Gun message");
      to.next(msg);
      return;
    }

    if (hasValidToken(msg)) {
      console.log("WRITING - Valid token found");
      to.next(msg);
      return;
    }

    // Block external PUT operations without valid token
    console.log(
      "BLOCKED - External PUT without valid token:",
      JSON.stringify(msg.put).slice(0, 100) + "..."
    );
    // Don't forward unauthorized puts
  });
});

const server = createServer(Gun.serve("data.json"));

// Configure Gun options
let gunOptions = {
  web: server,
  peers: CONFIG.PEERS || [
    "https://gun-manhattan.herokuapp.com/gun",
    "https://peer.wallie.io/gun",
  ],
};

// Add S3 configuration if available in CONFIG
if (
  CONFIG.S3_ACCESS_KEY_ID &&
  CONFIG.S3_SECRET_ACCESS_KEY &&
  CONFIG.S3_BUCKET
) {
  console.log("S3 configuration found in config, adding to Gun options 🪣");

  gunOptions.s3 = {
    bucket: CONFIG.S3_BUCKET,
    region: CONFIG.S3_REGION || "us-east-1",
    accessKeyId: CONFIG.S3_ACCESS_KEY_ID,
    secretAccessKey: CONFIG.S3_SECRET_ACCESS_KEY,
    endpoint: CONFIG.S3_ENDPOINT || "http://0.0.0.0:4569",
    s3ForcePathStyle: true,
    address: CONFIG.S3_ADDRESS || "0.0.0.0",
    port: CONFIG.S3_PORT || 4569,
    key: CONFIG.S3_ACCESS_KEY_ID,
    secret: CONFIG.S3_SECRET_ACCESS_KEY,
  };

  console.log("S3 configuration added to Gun options:", {
    bucket: gunOptions.s3.bucket,
    endpoint: gunOptions.s3.endpoint,
    address: gunOptions.s3.address,
    port: gunOptions.s3.port,
  });
} else {
  console.log("S3 configuration not found in config, using default storage 💽");
}

const gun = Gun(gunOptions);

// Sync everything
gun.on("out", { get: { "#": { "*": "" } } });

server.listen(port);

console.log(`GUN server (restricted put) started on port ${port}`);
console.log("Use CTRL + C to stop it");
