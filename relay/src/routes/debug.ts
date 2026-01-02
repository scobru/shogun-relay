import express, { Request, Response, Router } from "express";
import { loggers } from "../utils/logger";
import { GUN_PATHS } from "../utils/gun-paths";

const router: Router = express.Router();

// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req: Request): any => {
  return req.app.get("gunInstance");
};

// Funzione helper per ottenere l'utilizzo MB off-chain
async function getOffChainMBUsage(userAddress: string, req: Request): Promise<number> {
  const gun = getGunInstance(req);
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("MB usage read timeout"));
    }, 10000);

    gun
      .get(GUN_PATHS.MB_USAGE)
      .get(userAddress)
      .once((data: any) => {
        clearTimeout(timeoutId);
        if (!data) {
          resolve(0);
        } else {
          resolve(data.mbUsed || 0);
        }
      });
  });
}

// Debug MB usage endpoint
router.get("/mb-usage/:userAddress", async (req: Request, res: Response) => {
  try {
    const { userAddress } = req.params;
    const gun = getGunInstance(req);

    loggers.server.debug({ userAddress }, `🔍 Debug MB usage`);

    // Get MB usage data
    const mbUsageNode = gun.get(GUN_PATHS.MB_USAGE).get(userAddress);

    const getDebugData = (): Promise<any> => {
      return new Promise((resolve, reject) => {
        let timeoutId: NodeJS.Timeout;
        let dataReceived = false;

        timeoutId = setTimeout(() => {
          if (!dataReceived) {
            loggers.server.warn({ userAddress }, `⏰ Debug MB timeout`);
            resolve({ rawData: null, detailedData: {}, error: "Timeout" });
          }
        }, 15000);

        mbUsageNode.once((data: any) => {
          dataReceived = true;
          clearTimeout(timeoutId);

          loggers.server.debug({ userAddress, data, dataType: typeof data }, `🔍 Debug MB data`);

          if (!data || typeof data !== "object") {
            resolve({
              rawData: data,
              detailedData: {
                mbUsed: 0,
                lastUpdated: null,
                userAddress: userAddress,
              },
              error: "No valid MB usage data",
            });
            return;
          }

          const detailedData = {
            mbUsed: data.mbUsed || 0,
            lastUpdated: data.lastUpdated || null,
            userAddress: data.userAddress || userAddress,
            hasData: true,
          };

          resolve({
            rawData: data,
            detailedData: detailedData,
            error: null,
          });
        });
      });
    };

    const debugData = await getDebugData();

    res.json({
      success: true,
      userAddress,
      debug: debugData,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    loggers.server.error({ err: error, userAddress: req.params.userAddress }, `💥 Debug MB error`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// User MB usage endpoint
router.get("/user-mb-usage/:identifier", async (req: Request, res: Response) => {
  try {
    const { identifier } = req.params;
    const gun = getGunInstance(req);

    loggers.server.debug({ identifier }, `📊 MB usage request`);

    const mbUsageNode = gun.get(GUN_PATHS.MB_USAGE).get(identifier);

    const getMBUsage = (): Promise<number> => {
      return new Promise((resolve, reject) => {
        let timeoutId: NodeJS.Timeout;
        let dataReceived = false;

        timeoutId = setTimeout(() => {
          if (!dataReceived) {
            loggers.server.warn({ identifier }, `⏰ MB usage timeout`);
            resolve(0);
          }
        }, 10000);

        mbUsageNode.once((data: any) => {
          dataReceived = true;
          clearTimeout(timeoutId);

          loggers.server.debug({ identifier, data }, `📊 MB usage data`);

          if (!data) {
            loggers.server.warn({ identifier }, `❌ No MB usage data`);
            resolve(0);
            return;
          }

          const mbUsed = data.mbUsed || 0;
          loggers.server.debug({ identifier, mbUsed }, `✅ MB usage`);

          resolve(mbUsed);
        });
      });
    };

    const mbUsed = await getMBUsage();

    res.json({
      success: true,
      identifier,
      mbUsage: {
        mbUsed: mbUsed,
        limit: 100, // Default limit
        remaining: Math.max(0, 100 - mbUsed),
        percentage: Math.min(100, (mbUsed / 100) * 100),
      },
      timestamp: Date.now(),
    });
  } catch (error: any) {
    const { identifier } = req.params;
    loggers.server.error({ err: error, identifier }, `💥 MB usage error`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug user uploads endpoint
router.get("/user-uploads/:identifier", async (req: Request, res: Response) => {
  try {
    const { identifier } = req.params;
    const gun = getGunInstance(req);

    loggers.server.debug({ identifier }, `🔍 Debug: Caricando contenuto Gun`);

    const uploadsNode = gun.get(GUN_PATHS.UPLOADS).get(identifier);

    const getDebugData = (): Promise<any> => {
      return new Promise((resolve, reject) => {
        let timeoutId: NodeJS.Timeout;
        let dataReceived = false;

        timeoutId = setTimeout(() => {
          if (!dataReceived) {
            loggers.server.warn({ identifier }, `⏰ Debug timeout`);
            resolve({ rawData: null, detailedData: {}, error: "Timeout" });
          }
        }, 20000);

        uploadsNode.once((parentData: any) => {
          dataReceived = true;
          clearTimeout(timeoutId);

          loggers.server.debug(
            { identifier, parentData, parentDataType: typeof parentData },
            `🔍 Debug parent data`
          );

          if (!parentData || typeof parentData !== "object") {
            resolve({
              rawData: parentData,
              detailedData: {},
              error: "No valid parent data",
            });
            return;
          }

          const allKeys = Object.keys(parentData);
          loggers.server.debug({ identifier, allKeys }, `🔍 Debug all keys`);

          const hashKeys = allKeys.filter((key) => key !== "_");
          loggers.server.debug({ identifier, hashKeys }, `🔍 Debug hash keys`);

          const detailedData = {
            totalKeys: allKeys.length,
            hashKeys: hashKeys.length,
            gunMetadata: allKeys.includes("_"),
            hashes: hashKeys,
          };

          resolve({
            rawData: parentData,
            detailedData: detailedData,
            error: null,
          });
        });
      });
    };

    const debugData = await getDebugData();

    res.json({
      success: true,
      identifier,
      debug: debugData,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    const { identifier } = req.params;
    loggers.server.error({ err: error, identifier }, `💥 Debug error`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reset MB usage endpoint
router.post("/user-mb-usage/:identifier/reset", async (req: Request, res: Response) => {
  try {
    const { identifier } = req.params;
    const gun = getGunInstance(req);

    loggers.server.info({ identifier }, `🔄 Reset MB usage`);

    // Reset MB usage to 0
    gun
      .get(GUN_PATHS.MB_USAGE)
      .get(identifier)
      .put(
        {
          mbUsed: 0,
          lastUpdated: Date.now(),
          userAddress: identifier,
          resetAt: Date.now(),
        },
        (ack: any) => {
          if (ack && ack.err) {
            loggers.server.error({ err: ack.err, identifier }, "❌ Reset MB usage error");
            res.status(500).json({
              success: false,
              error: ack.err,
            });
          } else {
            loggers.server.info({ identifier }, `✅ MB usage reset`);
            res.json({
              success: true,
              message: "MB usage reset successfully",
              identifier,
              mbUsage: {
                mbUsed: 0,
                limit: 100,
                remaining: 100,
                percentage: 0,
              },
              timestamp: Date.now(),
            });
          }
        }
      );
  } catch (error: any) {
    const { identifier } = req.params;
    loggers.server.error({ err: error, identifier }, `💥 Reset MB usage error`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test Gun operations endpoint
router.get("/test-gun", async (req: Request, res: Response) => {
  try {
    const gun = getGunInstance(req);

    loggers.server.debug("🧪 Testing Gun operations");

    const testData = {
      test: true,
      timestamp: Date.now(),
      message: "Gun test successful",
    };

    const testNode = gun.get(GUN_PATHS.TEST);

    const writeTest = () => {
      return new Promise((resolve, reject) => {
        testNode.put(testData, (ack: any) => {
          if (ack && ack.err) {
            reject(new Error(ack.err));
          } else {
            resolve("Write successful");
          }
        });
      });
    };

    const readTest = () => {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Read timeout"));
        }, 10000);

        testNode.once((data: any) => {
          clearTimeout(timeoutId);
          if (data && data.test) {
            resolve(data);
          } else {
            reject(new Error("Invalid test data"));
          }
        });
      });
    };

    // Perform write test
    await writeTest();
    loggers.server.debug("✅ Write test passed");

    // Perform read test
    const readData = await readTest();
    loggers.server.debug("✅ Read test passed");

    res.json({
      success: true,
      message: "Gun operations test successful",
      writeTest: "passed",
      readTest: "passed",
      readData,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Gun test error");
    res.status(500).json({
      success: false,
      error: error.message,
      message: "Gun operations test failed",
    });
  }
});

// Test Gun save endpoint
router.get("/test-gun-save/:identifier/:hash", async (req: Request, res: Response) => {
  try {
    const { identifier, hash } = req.params;
    const gun = getGunInstance(req);

    loggers.server.debug({ identifier, hash }, `🧪 Testing Gun save`);

    const testData = {
      hash: hash,
      name: "test-file.txt",
      size: 1024,
      sizeMB: 1,
      uploadedAt: Date.now(),
      test: true,
    };

    const testNode = gun.get(GUN_PATHS.UPLOADS).get(identifier).get(hash);

    const writeTest = () => {
      return new Promise((resolve, reject) => {
        testNode.put(testData, (ack: any) => {
          if (ack && ack.err) {
            reject(new Error(ack.err));
          } else {
            resolve("Write successful");
          }
        });
      });
    };

    const readTest = () => {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Read timeout"));
        }, 10000);

        testNode.once((data: any) => {
          clearTimeout(timeoutId);
          if (data && data.hash === hash) {
            resolve(data);
          } else {
            reject(new Error("Invalid test data"));
          }
        });
      });
    };

    // Perform write test
    await writeTest();
    loggers.server.debug("✅ Write test passed");

    // Perform read test
    const readData = await readTest();
    loggers.server.debug("✅ Read test passed");

    res.json({
      success: true,
      message: "Gun save test successful",
      identifier,
      hash,
      writeTest: "passed",
      readTest: "passed",
      readData,
      timestamp: Date.now(),
    });
  } catch (error: any) {
    loggers.server.error({ err: error }, "❌ Gun save test error");
    res.status(500).json({
      success: false,
      error: error.message,
      message: "Gun save test failed",
    });
  }
});

export default router;
