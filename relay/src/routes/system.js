import express from 'express';

const router = express.Router();

// Middleware per ottenere l'istanza Gun dal relay
const getGunInstance = (req) => {
  return req.app.get('gunInstance');
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

// Contract config endpoint
router.get("/contract-config", (req, res) => {
  res.json({
    success: true,
    config: {
      chainId: process.env.CHAIN_ID || "11155111",
      provider: process.env.ALCHEMY_API_KEY ? "Alchemy" : "Not configured",
      contracts: {
        relayPaymentRouter: process.env.RELAY_CONTRACT_ADDRESS || "Not configured",
      },
    },
  });
});

// Contract status endpoint
router.get("/contract-status", async (req, res) => {
  try {
    const { ethers } = await import("ethers");
    const { DEPLOYMENTS } = await import("shogun-contracts/deployments.js");

    const chainId = process.env.CHAIN_ID || "11155111";
    const web3ProviderUrl = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;

    if (!process.env.ALCHEMY_API_KEY) {
      return res.json({
        success: false,
        status: "not_configured",
        error: "ALCHEMY_API_KEY not configured",
      });
    }

    const provider = new ethers.JsonRpcProvider(web3ProviderUrl);
    const network = await provider.getNetwork();

    const chainDeployments = DEPLOYMENTS[chainId];
    const relayContract = chainDeployments?.["Relay#RelayPaymentRouter"];

    if (!relayContract) {
      return res.json({
        success: false,
        status: "contract_not_found",
        error: "Relay contract not found in deployments",
      });
    }

    const contract = new ethers.Contract(
      relayContract.address,
      relayContract.abi,
      provider
    );

    // Test basic contract interaction
    try {
      await contract.getFunction("owner")();
      
      res.json({
        success: true,
        status: "connected",
        network: {
          name: network.name,
          chainId: network.chainId.toString(),
        },
        contract: {
          address: relayContract.address,
          name: "RelayPaymentRouter",
          status: "accessible",
        },
      });
    } catch (contractError) {
      res.json({
        success: false,
        status: "contract_error",
        error: contractError.message,
        network: {
          name: network.name,
          chainId: network.chainId.toString(),
        },
        contract: {
          address: relayContract.address,
          name: "RelayPaymentRouter",
          status: "error",
        },
      });
    }
  } catch (error) {
    console.error("❌ Contract status error:", error);
    res.status(500).json({
      success: false,
      status: "error",
      error: error.message,
    });
  }
});

// User subscription endpoint
router.get("/user-subscription/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;
    const { ethers } = await import("ethers");
    const { DEPLOYMENTS } = await import("shogun-contracts/deployments.js");

    if (!process.env.ALCHEMY_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "ALCHEMY_API_KEY not configured",
      });
    }

    const web3ProviderUrl = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
    const provider = new ethers.JsonRpcProvider(web3ProviderUrl);
    const chainId = process.env.CHAIN_ID || "11155111";
    const chainDeployments = DEPLOYMENTS[chainId];

    if (!chainDeployments) {
      return res.status(500).json({
        success: false,
        error: "No deployments found for chain ID",
      });
    }

    const relayContract = chainDeployments["Relay#RelayPaymentRouter"];
    if (!relayContract) {
      return res.status(500).json({
        success: false,
        error: "Relay contract not found",
      });
    }

    const contract = new ethers.Contract(
      relayContract.address,
      relayContract.abi,
      provider
    );

    // Get user subscription data
    const subscription = await contract.getUserSubscription(userAddress);
    const subscriptionStatus = await contract.getSubscriptionStatus(userAddress);

    res.json({
      success: true,
      userAddress,
      subscription: {
        isActive: subscription.isActive,
        startTime: subscription.startTime.toString(),
        endTime: subscription.endTime.toString(),
        plan: subscription.plan.toString(),
        status: subscriptionStatus,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ User subscription error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Subscription status endpoint
router.get("/subscription-status/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const { ethers } = await import("ethers");
    const { DEPLOYMENTS } = await import("shogun-contracts/deployments.js");

    if (!process.env.ALCHEMY_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "ALCHEMY_API_KEY not configured",
      });
    }

    const web3ProviderUrl = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
    const provider = new ethers.JsonRpcProvider(web3ProviderUrl);
    const chainId = process.env.CHAIN_ID || "11155111";
    const chainDeployments = DEPLOYMENTS[chainId];

    if (!chainDeployments) {
      return res.status(500).json({
        success: false,
        error: "No deployments found for chain ID",
      });
    }

    const relayContract = chainDeployments["Relay#RelayPaymentRouter"];
    if (!relayContract) {
      return res.status(500).json({
        success: false,
        error: "Relay contract not found",
      });
    }

    const contract = new ethers.Contract(
      relayContract.address,
      relayContract.abi,
      provider
    );

    // Get subscription status
    const status = await contract.getSubscriptionStatus(identifier);

    res.json({
      success: true,
      identifier,
      status: status,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ Subscription status error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// User subscription details endpoint
router.get("/user-subscription-details/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;
    const { ethers } = await import("ethers");
    const { DEPLOYMENTS } = await import("shogun-contracts/deployments.js");

    if (!process.env.ALCHEMY_API_KEY) {
      return res.status(500).json({
        success: false,
        error: "ALCHEMY_API_KEY not configured",
      });
    }

    const web3ProviderUrl = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
    const provider = new ethers.JsonRpcProvider(web3ProviderUrl);
    const chainId = process.env.CHAIN_ID || "11155111";
    const chainDeployments = DEPLOYMENTS[chainId];

    if (!chainDeployments) {
      return res.status(500).json({
        success: false,
        error: "No deployments found for chain ID",
      });
    }

    const relayContract = chainDeployments["Relay#RelayPaymentRouter"];
    if (!relayContract) {
      return res.status(500).json({
        success: false,
        error: "Relay contract not found",
      });
    }

    const contract = new ethers.Contract(
      relayContract.address,
      relayContract.abi,
      provider
    );

    // Get detailed subscription information
    const subscription = await contract.getUserSubscription(userAddress);
    const status = await contract.getSubscriptionStatus(userAddress);
    const balance = await provider.getBalance(userAddress);

    res.json({
      success: true,
      userAddress,
      subscription: {
        isActive: subscription.isActive,
        startTime: subscription.startTime.toString(),
        endTime: subscription.endTime.toString(),
        plan: subscription.plan.toString(),
        status: status,
      },
      balance: {
        wei: balance.toString(),
        eth: ethers.formatEther(balance),
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ User subscription details error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
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
    const stats = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      timestamp: Date.now(),
    };

    res.json({
      success: true,
      stats: stats,
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
    const addSystemLog = req.app.get('addSystemLog');
    const runGarbageCollector = req.app.get('runGarbageCollector');

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
    const addTimeSeriesPoint = req.app.get('addTimeSeriesPoint');

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
    const stats = {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      timestamp: Date.now(),
      version: process.env.npm_package_version || "1.0.0",
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

// Derive endpoint
router.post("/derive", async (req, res) => {
  try {
    const { data } = req.body;
    
    if (!data) {
      return res.status(400).json({
        success: false,
        error: "Data is required",
      });
    }

    const ShogunCoreModule = await import("shogun-core");
    const { derive } = ShogunCoreModule;

    const result = derive(data);

    res.json({
      success: true,
      result: result,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ Derive error:", error);
    res.status(500).json({
      success: false,
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
    
    const getGunNodeFromPath = (pathString) => {
      const pathParts = pathString.split("/").filter(Boolean);
      let node = gun;
      
      for (const part of pathParts) {
        node = node.get(part);
      }
      
      return node;
    };

    const node = getGunNodeFromPath(path);
    
    node.put(data, (ack) => {
      if (ack && ack.err) {
        res.status(500).json({
          success: false,
          error: ack.err,
        });
      } else {
        res.json({
          success: true,
          path,
          message: "Data saved successfully",
          timestamp: Date.now(),
        });
      }
    });
  } catch (error) {
    console.error("❌ Gun node POST error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.delete("/node/*", async (req, res) => {
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
    
    node.put(null, (ack) => {
      if (ack && ack.err) {
        res.status(500).json({
          success: false,
          error: ack.err,
        });
      } else {
        res.json({
          success: true,
          path,
          message: "Data deleted successfully",
          timestamp: Date.now(),
        });
      }
    });
  } catch (error) {
    console.error("❌ Gun node DELETE error:", error);
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