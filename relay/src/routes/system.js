import express from "express";
import fs from "fs";

const router = express.Router();


// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req) => {
  return req.app.get("gunInstance");
};

// Health check endpoint
router.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Shogun Relay is running",
    timestamp: Date.now(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || "1.0.0",
  });
});

// Relay info endpoint
router.get("/relay-info", (req, res) => {
  res.json({
    success: true,
    relay: {
      name: "Shogun Relay",
      version: process.env.npm_package_version || "1.0.0",
      uptime: process.uptime(),
      timestamp: Date.now(),
    },
  });
});






// All data endpoint (requires authentication)
router.get("/alldata", (req, res) => {
  try {
    const gun = getGunInstance(req);

    // Get all data from Gun database
    gun.get("shogun").once((data) => {
      res.json({
        success: true,
        data: data,
        timestamp: Date.now(),
      });
    });
  } catch (error) {
    console.error("❌ All data error:", error);
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
      version: process.env.npm_package_version || "1.0.0",

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
  } catch (error) {
    console.error("❌ Stats error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Garbage collection trigger endpoint
router.post("/gc/trigger", (req, res) => {
  try {
    // Trigger garbage collection
    const addSystemLog = req.app.get("addSystemLog");
    const runGarbageCollector = req.app.get("runGarbageCollector");

    if (addSystemLog) {
      addSystemLog("info", "Manual garbage collection triggered");
    }

    if (runGarbageCollector) {
      runGarbageCollector();
    }

    res.json({
      success: true,
      message: "Garbage collection triggered",
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ GC trigger error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Stats update endpoint
router.post("/stats/update", (req, res) => {
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
  } catch (error) {
    console.error("❌ Stats update error:", error);
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
      version: process.env.npm_package_version || "1.0.0",

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
  } catch (error) {
    console.error("❌ Stats JSON error:", error);
    res.status(500).json({
      error: error.message,
    });
  }
});


// Gun node operations
router.get("/node/*", async (req, res) => {
  try {
    const path = req.params[0];
    const gun = getGunInstance(req);

    const getGunNodeFromPath = (pathString) => {
      const pathParts = pathString.split("/").filter(Boolean);
      let node = gun;

      for (const part of pathParts) {
        node = node.get(part);
      }

      return node;
    };

    const node = getGunNodeFromPath(path);

    node.once((data) => {
      res.json({
        success: true,
        path,
        data: data,
        timestamp: Date.now(),
      });
    });
  } catch (error) {
    console.error("❌ Gun node GET error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/node/*", async (req, res) => {
  try {
    const path = req.params[0];
    const { data } = req.body;
    const gun = getGunInstance(req);

    if (!path || path.trim() === "") {
      return res
        .status(400)
        .json({ success: false, error: "Node path cannot be empty." });
    }

    if (data === undefined) {
      return res.status(400).json({
        success: false,
        error: "Invalid data: undefined at test.",
        path: path,
        receivedBody: req.body,
      });
    }

    console.log(`📝 Creating node at path: "${path}" with data:`, data);

    const getGunNodeFromPath = (pathString) => {
      const pathParts = pathString.split("/").filter(Boolean);
      let node = gun;

      for (const part of pathParts) {
        node = node.get(part);
      }

      return node;
    };

    const node = getGunNodeFromPath(path);

    try {
      // Properly promisify the Gun put operation
      const putResult = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Put operation timed out after 10 seconds"));
        }, 10000);

        try {
          node.put(data, (ack) => {
            clearTimeout(timeout);
            if (ack.err) {
              console.error(`❌ Gun put error for path "${path}":`, ack.err);
              reject(new Error(ack.err));
            } else {
              console.log(`✅ Gun put success for path "${path}":`, ack);
              resolve(ack);
            }
          });
        } catch (syncError) {
          clearTimeout(timeout);
          console.error(
            `❌ Synchronous error in put for path "${path}":`,
            syncError
          );
          reject(syncError);
        }
      });
    } finally {
      // Reset flag
    }

    console.log(`✅ Node successfully created/updated at path: "${path}"`);
    return res.json({ success: true, path, data });
  } catch (error) {
    console.error(
      `❌ Error in POST /node/* for path "${req.params[0]}":`,
      error
    );
    return res.status(500).json({
      success: false,
      error: error.message,
      path: req.params[0],
    });
  }
});

router.delete("/node/*", async (req, res) => {
  try {
    const path = req.params[0];
    const gun = getGunInstance(req);

    if (!path || path.trim() === "") {
      return res
        .status(400)
        .json({ success: false, error: "Node path cannot be empty." });
    }

    console.log(`🗑️ Deleting node at path: "${path}"`);

    const getGunNodeFromPath = (pathString) => {
      const pathParts = pathString.split("/").filter(Boolean);
      let node = gun;

      for (const part of pathParts) {
        node = node.get(part);
      }

      return node;
    };

    const node = getGunNodeFromPath(path);

    try {
      // Properly promisify the Gun delete operation
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Delete operation timed out after 10 seconds"));
        }, 10000);

        try {
          node.put(null, (ack) => {
            clearTimeout(timeout);
            if (ack.err) {
              console.error(`❌ Gun delete error for path "${path}":`, ack.err);
              reject(new Error(ack.err));
            } else {
              console.log(`✅ Gun delete success for path "${path}":`, ack);
              resolve(ack);
            }
          });
        } catch (syncError) {
          clearTimeout(timeout);
          console.error(
            `❌ Synchronous error in delete for path "${path}":`,
            syncError
          );
          reject(syncError);
        }
      });
    } finally {
      // Reset flag
    }

    console.log(`✅ Node successfully deleted at path: "${path}"`);
    return res.json({
      success: true,
      path,
      message: "Node deleted successfully",
    });
  } catch (error) {
    console.error(
      `❌ Error in DELETE /node/* for path "${req.params[0]}":`,
      error
    );
    return res.status(500).json({
      success: false,
      error: error.message,
      path: req.params[0],
    });
  }
});

// Logs endpoint for real-time relay logs from file
router.get("/logs", (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const tail = parseInt(req.query.tail) || 100; // Number of lines to read from end

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

    // Parse log entries (simple parsing for now)
    const logEntries = lastLines.map((line, index) => {
      const timestamp = new Date().toISOString(); // Default timestamp
      return {
        id: `line_${lines.length - tail + index}`,
        timestamp,
        level: "info",
        message: line,
        lineNumber: lines.length - tail + index + 1,
      };
    });

    // Apply limit
    const limitedLogs = logEntries.slice(-limit);

    res.json({
      success: true,
      logs: limitedLogs,
      count: limitedLogs.length,
      totalLines: lines.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ Logs GET error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Clear logs endpoint (clears GunDB logs only)
router.delete("/logs", (req, res) => {
  try {
    const gun = getGunInstance(req);
    const logsNode = gun.get("shogun").get("logs");

    try {
      // Clear GunDB logs only (file logs are managed by the system)
      logsNode.put(null, (ack) => {
        if (ack.err) {
          console.error("❌ Error clearing GunDB logs:", ack.err);
          res.status(500).json({
            success: false,
            error: ack.err,
          });
        } else {
          console.log("✅ GunDB logs cleared successfully");
          res.json({
            success: true,
            message:
              "GunDB logs cleared successfully (file logs are managed by the system)",
            timestamp: Date.now(),
          });
        }
      });
    } finally {
      // Reset flag
    }
  } catch (error) {
    console.error("❌ Clear logs error:", error);
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
  } catch (error) {
    console.error("❌ Peers GET error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/peers/add", (req, res) => {
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
  } catch (error) {
    console.error("❌ Peers add error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
