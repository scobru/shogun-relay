import express from 'express';

const router = express.Router();

// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req) => {
  return req.app.get('gunInstance');
};

// Funzione helper per ottenere l'utilizzo MB off-chain
async function getOffChainMBUsage(userAddress) {
  const gun = getGunInstance(req);
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error("MB usage read timeout"));
    }, 10000);

    gun.get("shogun").get("mbUsage").get(userAddress).once((data) => {
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
router.get("/mb-usage/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;
    const gun = getGunInstance(req);

    console.log(`🔍 Debug MB usage for: ${userAddress}`);

    // Get MB usage data
    const mbUsageNode = gun.get("shogun").get("mbUsage").get(userAddress);

    const getDebugData = () => {
      return new Promise((resolve, reject) => {
        let timeoutId;
        let dataReceived = false;

        timeoutId = setTimeout(() => {
          if (!dataReceived) {
            console.log(`⏰ Debug MB timeout for ${userAddress}`);
            resolve({ rawData: null, detailedData: {}, error: "Timeout" });
          }
        }, 15000);

        mbUsageNode.once((data) => {
          dataReceived = true;
          clearTimeout(timeoutId);

          console.log(`🔍 Debug MB data:`, data);
          console.log(`🔍 Debug MB type:`, typeof data);

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
  } catch (error) {
    console.error(`💥 Debug MB error for ${req.params.userAddress}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// User MB usage endpoint
router.get("/user-mb-usage/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const gun = getGunInstance(req);

    console.log(`📊 MB usage request for: ${identifier}`);

    const mbUsageNode = gun.get("shogun").get("mbUsage").get(identifier);

    const getMBUsage = () => {
      return new Promise((resolve, reject) => {
        let timeoutId;
        let dataReceived = false;

        timeoutId = setTimeout(() => {
          if (!dataReceived) {
            console.log(`⏰ MB usage timeout for ${identifier}`);
            resolve(0);
          }
        }, 10000);

        mbUsageNode.once((data) => {
          dataReceived = true;
          clearTimeout(timeoutId);

          console.log(`📊 MB usage data for ${identifier}:`, data);

          if (!data) {
            console.log(`❌ No MB usage data for: ${identifier}`);
            resolve(0);
            return;
          }

          const mbUsed = data.mbUsed || 0;
          console.log(`✅ MB usage for ${identifier}: ${mbUsed} MB`);

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
  } catch (error) {
    console.error(`💥 MB usage error for ${identifier}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Debug user uploads endpoint
router.get("/user-uploads/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const gun = getGunInstance(req);

    console.log(`🔍 Debug: Caricando contenuto Gun per: ${identifier}`);

    const uploadsNode = gun.get("shogun").get("uploads").get(identifier);

    const getDebugData = () => {
      return new Promise((resolve, reject) => {
        let timeoutId;
        let dataReceived = false;

        timeoutId = setTimeout(() => {
          if (!dataReceived) {
            console.log(`⏰ Debug timeout per ${identifier}`);
            resolve({ rawData: null, detailedData: {}, error: "Timeout" });
          }
        }, 20000);

        uploadsNode.once((parentData) => {
          dataReceived = true;
          clearTimeout(timeoutId);

          console.log(`🔍 Debug parent data:`, parentData);
          console.log(`🔍 Debug parent type:`, typeof parentData);

          if (!parentData || typeof parentData !== "object") {
            resolve({
              rawData: parentData,
              detailedData: {},
              error: "No valid parent data",
            });
            return;
          }

          const allKeys = Object.keys(parentData);
          console.log(`🔍 Debug all keys:`, allKeys);

          const hashKeys = allKeys.filter((key) => key !== "_");
          console.log(`🔍 Debug hash keys:`, hashKeys);

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
  } catch (error) {
    console.error(`💥 Debug error per ${identifier}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reset MB usage endpoint
router.post("/user-mb-usage/:identifier/reset", async (req, res) => {
  try {
    const { identifier } = req.params;
    const gun = getGunInstance(req);

    console.log(`🔄 Reset MB usage for: ${identifier}`);

    // Reset MB usage to 0
    gun.get("shogun").get("mbUsage").get(identifier).put({
      mbUsed: 0,
      lastUpdated: Date.now(),
      userAddress: identifier,
      resetAt: Date.now(),
    }, (ack) => {
      if (ack && ack.err) {
        console.error("❌ Reset MB usage error:", ack.err);
        res.status(500).json({
          success: false,
          error: ack.err,
        });
      } else {
        console.log(`✅ MB usage reset for: ${identifier}`);
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
    });
  } catch (error) {
    console.error(`💥 Reset MB usage error for ${identifier}:`, error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Test Gun operations endpoint
router.get("/test-gun", async (req, res) => {
  try {
    const gun = getGunInstance(req);

    console.log("🧪 Testing Gun operations");

    const testData = {
      test: true,
      timestamp: Date.now(),
      message: "Gun test successful",
    };

    const testNode = gun.get("shogun").get("test");

    const writeTest = () => {
      return new Promise((resolve, reject) => {
        testNode.put(testData, (ack) => {
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

        testNode.once((data) => {
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
    console.log("✅ Write test passed");

    // Perform read test
    const readData = await readTest();
    console.log("✅ Read test passed");

    res.json({
      success: true,
      message: "Gun operations test successful",
      writeTest: "passed",
      readTest: "passed",
      readData,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ Gun test error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: "Gun operations test failed",
    });
  }
});

// Test Gun save endpoint
router.get("/test-gun-save/:identifier/:hash", async (req, res) => {
  try {
    const { identifier, hash } = req.params;
    const gun = getGunInstance(req);

    console.log(`🧪 Testing Gun save for: ${identifier}/${hash}`);

    const testData = {
      hash: hash,
      name: "test-file.txt",
      size: 1024,
      sizeMB: 1,
      uploadedAt: Date.now(),
      test: true,
    };

    const testNode = gun.get("shogun").get("uploads").get(identifier).get(hash);

    const writeTest = () => {
      return new Promise((resolve, reject) => {
        testNode.put(testData, (ack) => {
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

        testNode.once((data) => {
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
    console.log("✅ Write test passed");

    // Perform read test
    const readData = await readTest();
    console.log("✅ Read test passed");

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
  } catch (error) {
    console.error("❌ Gun save test error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: "Gun save test failed",
    });
  }
});

export default router; 