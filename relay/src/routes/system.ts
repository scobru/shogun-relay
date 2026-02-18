import express, { Request, Response, Router } from "express";
import fs from "fs";
import path from "path";
import { loggers } from "../utils/logger";
import { packageConfig } from "../config";
import { config } from "../config/env-config";
import { GUN_PATHS, getGunNode } from "../utils/gun-paths";
import { adminAuthMiddleware } from "../middleware/admin-auth";

const router: Router = express.Router();

// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req: Request): any => {
  return req.app.get("gunInstance");
};

// Health check endpoint
router.get("/health", (req, res) => {
  // Get relay public key from app context if available
  const relayPub = req.app.get("relayUserPub") || null;

  res.json({
    success: true,
    message: "Shogun Relay is running",
    relayName: config.relay.name,
    relay: {
      pub: relayPub,
    },
    relayPub: relayPub,
    timestamp: Date.now(),
    uptime: process.uptime(),
    version: packageConfig.version || "1.0.0",
  });
});

// Relay info endpoint
router.get("/relay-info", (req, res) => {
  res.json({
    success: true,
    relay: {
      name: config.relay.name,
      version: packageConfig.version || "1.0.0",
      uptime: process.uptime(),
      timestamp: Date.now(),
    },
  });
});

// All data endpoint (requires authentication)
router.get("/alldata", adminAuthMiddleware, (req, res) => {
  try {
    const gun = getGunInstance(req);

    // Get all data from Gun database
    getGunNode(gun, GUN_PATHS.SHOGUN).once((data: any) => {
      res.json({
        success: true,
        data: data,
        timestamp: Date.now(),
      });
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ All data error");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Stats endpoint
router.get("/stats", (req, res) => {
  try {
    const now = Date.now();
    const uptime = process.uptime() * 1000; // Convert to milliseconds
    const memoryUsage = process.memoryUsage();

    // Calculate rates (simplified - you might want to track these over time)
    const getRate = Math.random() * 10; // Placeholder
    const putRate = Math.random() * 5; // Placeholder

    const stats = {
      // Basic system info
      up: {
        time: uptime,
      },
      memory: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
      },
      cpu: process.cpuUsage(),
      timestamp: now,
      version: packageConfig.version || "1.0.0",

      // Gun-specific stats (placeholders - you might want to track these from Gun)
      peers: {
        count: Math.floor(Math.random() * 10) + 1, // Placeholder
        time: uptime,
      },
      node: {
        count: Math.floor(Math.random() * 100) + 10, // Placeholder
        memory: {
          heapUsed: memoryUsage.heapUsed,
          heapTotal: memoryUsage.heapTotal,
        },
      },

      // DAM (Data Access Manager) stats
      dam: {
        in: {
          rate: getRate,
          count: Math.floor(Math.random() * 1000) + 100,
        },
        out: {
          rate: putRate,
          count: Math.floor(Math.random() * 500) + 50,
        },
      },

      // Additional stats for charts
      over: 5000, // 5 seconds in milliseconds

      // Time series data (empty for now)
      all: {},
    };

    res.json({
      success: true,
      ...stats,
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Stats error");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Stats update endpoint
router.post("/stats/update", adminAuthMiddleware, (req, res) => {
  try {
    const { key, value } = req.body;
    const addTimeSeriesPoint = req.app.get("addTimeSeriesPoint");

    if (!key || value === undefined) {
      return res.status(400).json({
        success: false,
        error: "Key and value are required",
      });
    }

    if (addTimeSeriesPoint) {
      addTimeSeriesPoint(key, value);
    }

    res.json({
      success: true,
      message: "Stats updated",
      key,
      value,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Stats update error");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Stats JSON endpoint
router.get("/stats.json", (req, res) => {
  try {
    const now = Date.now();
    const uptime = process.uptime() * 1000; // Convert to milliseconds

    // Get memory usage
    const memoryUsage = process.memoryUsage();

    // Calculate rates (simplified - you might want to track these over time)
    const getRate = Math.random() * 10; // Placeholder
    const putRate = Math.random() * 5; // Placeholder

    const stats = {
      // Basic system info
      up: {
        time: uptime,
      },
      memory: {
        heapUsed: memoryUsage.heapUsed,
        heapTotal: memoryUsage.heapTotal,
        external: memoryUsage.external,
        rss: memoryUsage.rss,
      },
      cpu: process.cpuUsage(),
      timestamp: now,
      version: packageConfig.version || "1.0.0",

      // Gun-specific stats (placeholders - you might want to track these from Gun)
      peers: {
        count: Math.floor(Math.random() * 10) + 1, // Placeholder
        time: uptime,
      },
      node: {
        count: Math.floor(Math.random() * 100) + 10, // Placeholder
      },

      // DAM (Data Access Manager) stats
      dam: {
        in: {
          rate: getRate,
          count: Math.floor(Math.random() * 1000) + 100,
        },
        out: {
          rate: putRate,
          count: Math.floor(Math.random() * 500) + 50,
        },
      },

      // Additional stats for charts
      over: 5000, // 5 seconds in milliseconds

      // Time series data (empty for now)
      all: {},
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-cache");
    res.json(stats);
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Stats JSON error");
    res.status(500).json({
      error: error.message,
    });
  }
});

// Gun node operations
router.get("/node/*", adminAuthMiddleware, async (req, res) => {
  try {
    // @ts-ignore - req.params is an array for wildcard routes
    const path: string = req.params[0] as string;
    const gun = getGunInstance(req);

    const node = getGunNode(gun, path);

    // Promisify with timeout
    const data = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(undefined); // Resolve with undefined on timeout to avoid 500 error for empty nodes
      }, 5000); // 5 second timeout

      node.once((data: any) => {
        clearTimeout(timer);
        resolve(data);
      });
    });

    if (data === undefined) {
      // If data is undefined, it might be empty or timed out
      // We return an empty object or null to indicate "no data found" but success
      return res.json({
        success: true,
        path,
        data: null,
        message: "Node not found or timed out",
        timestamp: Date.now(),
      });
    }

    res.json({
      success: true,
      path,
      data: data,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    loggers.server.error({ err: error, path: req.params as any[0] }, "❌ Gun node GET error");
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post("/node/*", adminAuthMiddleware, async (req, res) => {
  try {
    // @ts-ignore - req.params is an array for wildcard routes
    const path: string = req.params[0] as string;
    const { data } = req.body;
    const gun = getGunInstance(req);

    if (!path || path.trim() === "") {
      return res.status(400).json({ success: false, error: "Node path cannot be empty." });
    }

    if (data === undefined) {
      return res.status(400).json({
        success: false,
        error: "Invalid data: undefined at test.",
        path: path,
        receivedBody: req.body,
      });
    }

    loggers.server.debug({ path, data }, `📝 Creating node`);

    const node = getGunNode(gun, path);

    try {
      // Properly promisify the Gun put operation
      const putResult = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Put operation timed out after 10 seconds"));
        }, 10000);

        try {
          node.put(data, (ack: any) => {
            clearTimeout(timeout);
            if (ack.err) {
              loggers.server.error({ err: ack.err, path }, `❌ Gun put error`);
              reject(new Error(ack.err));
            } else {
              loggers.server.debug({ path, ack }, `✅ Gun put success`);
              resolve(ack);
            }
          });
        } catch (syncError) {
          clearTimeout(timeout);
          loggers.server.error({ err: syncError, path }, `❌ Synchronous error in put`);
          reject(syncError);
        }
      });
    } finally {
      // Reset flag
    }

    loggers.server.info({ path }, `✅ Node successfully created/updated`);
    return res.json({ success: true, path, data });
  } catch (error: any) {
    loggers.server.error({ err: error, path: req.params as any[0] }, `❌ Error in POST /node/*`);
    return res.status(500).json({
      success: false,
      error: error.message,
      // @ts-ignore
      path: req.params[0],
    });
  }
});

router.delete("/node/*", adminAuthMiddleware, async (req, res) => {
  try {
    // @ts-ignore - req.params is an array for wildcard routes
    const path: string = req.params[0] as string;
    const gun = getGunInstance(req);

    if (!path || path.trim() === "") {
      return res.status(400).json({ success: false, error: "Node path cannot be empty." });
    }

    loggers.server.debug({ path }, `🗑️ Deleting node`);

    const node = getGunNode(gun, path);

    try {
      // Properly promisify the Gun delete operation
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Delete operation timed out after 10 seconds"));
        }, 10000);

        try {
          node.put(null, (ack: any) => {
            clearTimeout(timeout);
            if (ack.err) {
              loggers.server.error({ err: ack.err, path }, `❌ Gun delete error`);
              reject(new Error(ack.err));
            } else {
              loggers.server.debug({ path, ack }, `✅ Gun delete success`);
              resolve(ack);
            }
          });
        } catch (syncError) {
          clearTimeout(timeout);
          loggers.server.error({ err: syncError, path }, `❌ Synchronous error in delete`);
          reject(syncError);
        }
      });
    } finally {
      // Reset flag
    }

    loggers.server.info({ path }, `✅ Node successfully deleted`);
    return res.json({
      success: true,
      path,
      message: "Node deleted successfully",
    });
  } catch (error: any) {
    loggers.server.error({ err: error, path: req.params as any[0] }, `❌ Error in DELETE /node/*`);
    return res.status(500).json({
      success: false,
      error: error.message,
      // @ts-ignore
      path: req.params[0],
    });
  }
});

// Logs endpoint for real-time relay logs from file
router.get("/logs", adminAuthMiddleware, (req, res) => {
  try {
    const limit: number = parseInt(req.query.limit as string) || 100;
    const tail: number = parseInt(req.query.tail as string) || 100; // Number of lines to read from end

    // Read relay log file directly
    const logFilePath = "/var/log/supervisor/relay.log";

    // Check if file exists
    if (!fs.existsSync(logFilePath)) {
      return res.json({
        success: true,
        logs: [],
        count: 0,
        message: "Log file not found",
        timestamp: Date.now(),
      });
    }

    // Read the last N lines from the log file
    const logContent = fs.readFileSync(logFilePath, "utf8");
    const lines = logContent.split("\n").filter((line) => line.trim() !== "");

    // Get the last N lines
    const lastLines = lines.slice(-tail);

    // Parse log entries - extract JSON from log lines
    const logEntries = lastLines.map((line, index) => {
      let timestamp = new Date().toISOString();
      let level = "info";
      let logData: any = {};
      let rawMessage = line;

      try {
        // Try to parse JSON log format: timestamp JSON_OBJECT
        // Format: 2025-12-12T08:21:19.939018162Z {"level":"info","time":"...","pid":85,...}
        const jsonMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:\.]+Z)\s+(.+)$/);
        if (jsonMatch) {
          timestamp = jsonMatch[1];
          const jsonStr = jsonMatch[2];

          try {
            logData = JSON.parse(jsonStr);
            level = logData.level || "info";
            rawMessage = jsonStr;
          } catch (parseError) {
            // If JSON parsing fails, try to extract JSON from anywhere in the line
            const jsonStart = line.indexOf("{");
            if (jsonStart !== -1) {
              const jsonStr = line.substring(jsonStart);
              try {
                logData = JSON.parse(jsonStr);
                level = logData.level || "info";
                rawMessage = jsonStr;
                // Try to extract timestamp from beginning of line
                const tsMatch = line.substring(0, jsonStart).trim();
                if (tsMatch) {
                  timestamp = tsMatch;
                }
              } catch (e) {
                // Keep raw message if parsing fails
              }
            }
          }
        } else {
          // Try to find JSON object anywhere in the line
          const jsonStart = line.indexOf("{");
          if (jsonStart !== -1) {
            const jsonStr = line.substring(jsonStart);
            try {
              logData = JSON.parse(jsonStr);
              level = logData.level || "info";
              rawMessage = jsonStr;
              // Try to extract timestamp from beginning of line
              const tsMatch = line.substring(0, jsonStart).trim();
              if (tsMatch) {
                timestamp = tsMatch;
              }
            } catch (e) {
              // Keep raw message if parsing fails
            }
          }
        }
      } catch (error) {
        // If all parsing fails, use raw line
      }

      return {
        id: `line_${lines.length - tail + index}`,
        timestamp: timestamp,
        level: level,
        message: logData.message || logData.msg || rawMessage,
        raw: rawMessage,
        data: logData,
        lineNumber: lines.length - tail + index + 1,
      };
    });

    // Apply limit
    const limitedLogs = logEntries.slice(-limit);

    // Log for debugging
    loggers.server.debug(
      {
        totalLines: lines.length,
        tail: tail,
        parsedEntries: logEntries.length,
        limitedLogs: limitedLogs.length,
        fileExists: fs.existsSync(logFilePath),
      },
      "📋 Logs endpoint response"
    );

    res.json({
      success: true,
      logs: limitedLogs,
      count: limitedLogs.length,
      totalLines: lines.length,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Logs GET error");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Clear logs endpoint (clears GunDB logs only)
router.delete("/logs", adminAuthMiddleware, (req, res) => {
  try {
    const gun = getGunInstance(req);
    const logsNode = getGunNode(gun, GUN_PATHS.LOGS);

    try {
      // Clear GunDB logs only (file logs are managed by the system)
      logsNode.put(null, (ack: any) => {
        if (ack.err) {
          loggers.server.error({ err: ack.err }, "❌ Error clearing GunDB logs");
          res.status(500).json({
            success: false,
            error: ack.err,
          });
        } else {
          loggers.server.info("✅ GunDB logs cleared successfully");
          res.json({
            success: true,
            message: "GunDB logs cleared successfully (file logs are managed by the system)",
            timestamp: Date.now(),
          });
        }
      });
    } finally {
      // Reset flag
    }
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Clear logs error");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Peers endpoints
router.get("/peers", (req, res) => {
  try {
    const gun = getGunInstance(req);

    // Get peers information
    const peers = gun._.opt.peers || {};

    res.json({
      success: true,
      peers: Object.keys(peers),
      count: Object.keys(peers).length,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Peers GET error");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/peers/add", adminAuthMiddleware, (req, res) => {
  try {
    const { peer } = req.body;
    const gun = getGunInstance(req);

    if (!peer) {
      return res.status(400).json({
        success: false,
        error: "Peer URL is required",
      });
    }

    // Add peer to Gun
    gun.opt({ peers: [peer] });

    res.json({
      success: true,
      message: "Peer added successfully",
      peer,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Peers add error");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Services Logs endpoint
router.get("/services/:name/logs", adminAuthMiddleware, (req, res) => {
  try {
    const serviceName = req.params.name;
    const limit = parseInt(req.query.limit as string) || 100;
    const tail = parseInt(req.query.tail as string) || 100;

    // Map service names to log files
    // This assumes standard log locations or PM2 log naming convention
    let logFile = "";

    // Normalize service name
    const normalizedName = serviceName.toLowerCase().replace(/%20/g, " ").trim();

    if (normalizedName.includes("ipfs")) {
      // Check common IPFS log locations or PM2
      logFile = "/var/log/supervisor/ipfs.log"; // Supervisor default
      if (!fs.existsSync(logFile)) logFile = path.join(process.cwd(), "logs", "ipfs.log");
    } else if (normalizedName.includes("gun") || normalizedName.includes("relay")) {
      logFile = "/var/log/supervisor/relay.log";
      if (!fs.existsSync(logFile)) logFile = path.join(process.cwd(), "logs", "relay.log");
    } else {
      // Generic fallback
      logFile = `/var/log/supervisor/${normalizedName.replace(/\s+/g, "-")}.log`;
    }

    if (!fs.existsSync(logFile)) {
      // Try PM2 convention if Supervisor not found
      const pm2Log = path.join(
        process.env.HOME || "/root",
        ".pm2",
        "logs",
        `${normalizedName.replace(/\s+/g, "-")}-out.log`
      );
      if (fs.existsSync(pm2Log)) {
        logFile = pm2Log;
      } else {
        // Try Docker stdout logs - these are captured by Docker, not files
        // Return helpful message instead of 404
        return res.json({
          success: true,
          logs: [
            {
              id: "info_0",
              timestamp: new Date().toISOString(),
              message: `Logs for ${serviceName} are managed by Docker/container orchestrator.`,
              level: "info",
            },
            {
              id: "info_1",
              timestamp: new Date().toISOString(),
              message: `Use 'docker logs <container>' to view container logs.`,
              level: "info",
            },
            {
              id: "info_2",
              timestamp: new Date().toISOString(),
              message: `Checked paths: ${logFile}, ${pm2Log}`,
              level: "debug",
            },
          ],
          count: 3,
          service: serviceName,
          note: "Log files not found at expected paths. Logs may be managed by Docker.",
        });
      }
    }

    // Reuse log reading logic (simplified here)
    const logContent = fs.readFileSync(logFile, "utf8");
    const lines = logContent.split("\n").filter((line) => line.trim() !== "");
    const lastLines = lines.slice(-tail);

    // Simple parsing - just return lines for now to fix 404
    const formattedLogs = lastLines.map((line, i) => ({
      id: `l_${Date.now()}_${i}`,
      timestamp: new Date().toISOString(), // Placeholder, real parsing is complex
      message: line,
      level: "info",
    }));

    res.json({
      success: true,
      logs: formattedLogs,
      count: formattedLogs.length,
      service: serviceName,
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Service Logs error");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// RPC Execute endpoint
router.post("/rpc/execute", adminAuthMiddleware, async (req, res) => {
  try {
    const { endpoint, request } = req.body;

    if (!endpoint || !request) {
      return res.status(400).json({
        success: false,
        error: "Endpoint URL and request body are required",
      });
    }

    // Validate endpoint URL
    try {
      new URL(endpoint);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: "Invalid endpoint URL",
      });
    }

    // Validate request format
    if (!request.method || !request.jsonrpc) {
      return res.status(400).json({
        success: false,
        error: "Invalid RPC request format. Must include 'method' and 'jsonrpc'",
      });
    }

    // Execute RPC call
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(request),
    });

    const responseData = await response.json();

    res.json({
      success: true,
      response: responseData,
      status: response.status,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ RPC Execute error");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Contracts endpoint
router.get("/contracts", async (req, res) => {
  try {
    const { getConfigByChainId } = await import("shogun-contracts-sdk");

    const chainId = config.registry.chainId;
    const contractsConfig = getConfigByChainId(chainId);

    if (!contractsConfig) {
      return res.status(404).json({
        success: false,
        error: `No configuration found for chain ID ${chainId}`,
        chainId,
      });
    }

    res.json({
      success: true,
      chainId,
      contracts: contractsConfig,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Contracts GET error");
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
