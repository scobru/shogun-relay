import express from 'express';

const router = express.Router();

// Test import di shogun-contracts
let DEPLOYMENTS = {};
try {
  const contractsModule = await import("shogun-contracts/deployments.js");
  DEPLOYMENTS = contractsModule.DEPLOYMENTS;
  console.log("✅ shogun-contracts importato correttamente");
  console.log("📋 Chain IDs disponibili:", Object.keys(DEPLOYMENTS));
} catch (error) {
  console.error("❌ Errore import shogun-contracts:", error);
  // Fallback con dati mock per test
  DEPLOYMENTS = {
    "11155111": {
      "Relay#RelayPaymentRouter": {
        address: "0x1234567890123456789012345678901234567890",
        abi: []
      }
    }
  };
}

// Route per ottenere la configurazione completa dei contratti
router.get("/config", async (req, res) => {
  try {
    console.log("📋 contracts/config: Requesting contract configuration");

    // Supporta chain ID come query parameter o usa quello di default
    let chainId = req.query.chainId || process.env.CHAIN_ID || "11155111";
    
    // Mappa chain ID numerici ai nomi delle chain
    const chainIdMapping = {
      "11155111": "sepolia",
      "sepolia": "sepolia"
    };
    
    // Converti chain ID numerico in nome della chain se necessario
    const chainKey = chainIdMapping[chainId] || chainId;

    if (!DEPLOYMENTS[chainKey]) {
      return res.status(404).json({
        success: false,
        error: `No deployments found for chain ID: ${chainId}`,
        availableChains: Object.keys(DEPLOYMENTS),
        chainKey: chainKey,
        originalChainId: chainId
      });
    }

    const chainDeployments = DEPLOYMENTS[chainKey];

    // Estrai solo i contratti che ci interessano
    const contracts = {
      relayPaymentRouter:
        chainDeployments["Relay#RelayPaymentRouter"] || null,
      stealthPool: chainDeployments["Stealth#StealthPool"] || null,
      pairRecovery: chainDeployments["Recovery#PairRecovery"] || null,
      integrity: chainDeployments["Security#Integrity"] || null,
      paymentForwarder: chainDeployments["Stealth#PayamentForwarder"] || null,
      stealthKeyRegistry:
        chainDeployments["Stealth#StealthKeyRegistry"] || null,
      bridgeDex: chainDeployments["Bridge#BridgeDex"] || null,
      chain: chainDeployments["Database#Chain"] || null,
      ipcmFactory: chainDeployments["IPFS#IPCMFactory"] || null,
    };

    console.log(
      "📋 contracts/config: Returning contract configuration for chain:",
      chainId,
      "(key:",
      chainKey,
      ")"
    );

    res.json({
      success: true,
      chainId: chainId,
      chainKey: chainKey,
      contracts: contracts,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ contracts/config: Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to load contract configuration",
      details: error.message,
    });
  }
});

// Route specifica per IPCM
router.get("/ipcm", async (req, res) => {
  try {
    console.log("📋 contracts/ipcm: Requesting IPCM contract configuration");

    let chainId = req.query.chainId || process.env.CHAIN_ID || "11155111";
    
    const chainIdMapping = {
      "11155111": "sepolia",
      "sepolia": "sepolia"
    };
    
    const chainKey = chainIdMapping[chainId] || chainId;

    if (!DEPLOYMENTS[chainKey]) {
      return res.status(404).json({
        success: false,
        error: `No deployments found for chain ID: ${chainId}`,
        availableChains: Object.keys(DEPLOYMENTS),
        chainKey: chainKey,
        originalChainId: chainId
      });
    }

    const chainDeployments = DEPLOYMENTS[chainKey];

    // Estrai solo i contratti IPCM
    const factory = chainDeployments["IPFS#IPCMFactory"] || null;
    const ipcm = chainDeployments["IPFS#IPCM"] || null;

    if (!factory) {
      return res.status(404).json({
        success: false,
        error: "IPCMFactory contract not found in deployments",
        chainId: chainId,
        chainKey: chainKey
      });
    }

    console.log("📋 contracts/ipcm: Returning IPCM configuration for chain:", chainId);

    res.json({
      success: true,
      chainId: chainId,
      chainKey: chainKey,
      data: {
        factory: factory,
        ipcm: ipcm
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ contracts/ipcm: Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to load IPCM configuration",
      details: error.message,
    });
  }
});

// Route per ottenere tutti i contratti disponibili
router.get("/all", async (req, res) => {
  try {
    console.log("📋 contracts/all: Requesting all contracts configuration");

    let chainId = req.query.chainId || process.env.CHAIN_ID || "11155111";
    
    const chainIdMapping = {
      "11155111": "sepolia",
      "sepolia": "sepolia"
    };
    
    const chainKey = chainIdMapping[chainId] || chainId;

    if (!DEPLOYMENTS[chainKey]) {
      return res.status(404).json({
        success: false,
        error: `No deployments found for chain ID: ${chainId}`,
        availableChains: Object.keys(DEPLOYMENTS),
        chainKey: chainKey,
        originalChainId: chainId
      });
    }

    const chainDeployments = DEPLOYMENTS[chainKey];

    console.log("📋 contracts/all: Returning all contracts for chain:", chainId);

    res.json({
      success: true,
      chainId: chainId,
      chainKey: chainKey,
      data: chainDeployments,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ contracts/all: Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to load all contracts",
      details: error.message,
    });
  }
});

// Route per ottenere un contratto specifico
router.get("/:contractName", async (req, res) => {
  try {
    const { contractName } = req.params;
    let chainId = req.query.chainId || process.env.CHAIN_ID || "11155111";
    
    // Mappa chain ID numerici ai nomi delle chain
    const chainIdMapping = {
      "11155111": "sepolia",
      "sepolia": "sepolia"
    };
    
    // Converti chain ID numerico in nome della chain se necessario
    const chainKey = chainIdMapping[chainId] || chainId;
    
    console.log(`📋 contracts/${contractName}: Requesting contract details for chain: ${chainId} (key: ${chainKey})`);

    if (!DEPLOYMENTS[chainKey]) {
      return res.status(404).json({
        success: false,
        error: `No deployments found for chain ID: ${chainId}`,
        availableChains: Object.keys(DEPLOYMENTS),
        chainKey: chainKey,
        originalChainId: chainId
      });
    }

    const chainDeployments = DEPLOYMENTS[chainKey];

    // Mappa dei nomi dei contratti
    const contractMapping = {
      "relay-payment-router": "Relay#RelayPaymentRouter",
      "stealth-pool": "Stealth#StealthPool",
      "pair-recovery": "Recovery#PairRecovery",
      integrity: "Security#Integrity",
      "payment-forwarder": "Stealth#PayamentForwarder",
      "stealth-key-registry": "Stealth#StealthKeyRegistry",
      "bridge-dex": "Bridge#BridgeDex",
      "chain": "Database#Chain",
      "ipcm-factory": "IPFS#IPCMFactory",
    };

    const fullContractName = contractMapping[contractName];
    if (!fullContractName || !chainDeployments[fullContractName]) {
      return res.status(404).json({
        success: false,
        error: `Contract not found: ${contractName} on chain: ${chainId}`,
        availableContracts: Object.keys(contractMapping),
        availableChains: Object.keys(DEPLOYMENTS),
      });
    }

    const contract = chainDeployments[fullContractName];

    console.log(`📋 contracts/${contractName}: Returning contract details for chain: ${chainId}`);

    res.json({
      success: true,
      chainId: chainId,
      contractName: contractName,
      contract: contract,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(`❌ contracts/${req.params.contractName}: Error:`, error);
    res.status(500).json({
      success: false,
      error: "Failed to load contract details",
      details: error.message,
    });
  }
});

// Route per ottenere l'ABI di un contratto specifico
router.get("/:contractName/abi", async (req, res) => {
  try {
    const { contractName } = req.params;
    let chainId = req.query.chainId || process.env.CHAIN_ID || "11155111";
    
    // Mappa chain ID numerici ai nomi delle chain
    const chainIdMapping = {
      "11155111": "sepolia",
      "sepolia": "sepolia"
    };
    
    // Converti chain ID numerico in nome della chain se necessario
    const chainKey = chainIdMapping[chainId] || chainId;
    
    console.log(`📋 contracts/${contractName}/abi: Requesting contract ABI for chain: ${chainId} (key: ${chainKey})`);

    if (!DEPLOYMENTS[chainKey]) {
      return res.status(404).json({
        success: false,
        error: `No deployments found for chain ID: ${chainId}`,
        availableChains: Object.keys(DEPLOYMENTS),
        chainKey: chainKey,
        originalChainId: chainId
      });
    }

    const chainDeployments = DEPLOYMENTS[chainKey];

    // Mappa dei nomi dei contratti
    const contractMapping = {
      "relay-payment-router": "Relay#RelayPaymentRouter",
      "stealth-pool": "Stealth#StealthPool",
      "pair-recovery": "Recovery#PairRecovery",
      integrity: "Security#Integrity",
      "payment-forwarder": "Stealth#PayamentForwarder",
      "stealth-key-registry": "Stealth#StealthKeyRegistry",
      "bridge-dex": "Bridge#BridgeDex",
      "chain": "Database#Chain",
      "ipcm-factory": "IPFS#IPCMFactory",
    };

    const fullContractName = contractMapping[contractName];
    if (!fullContractName || !chainDeployments[fullContractName]) {
      return res.status(404).json({
        success: false,
        error: `Contract not found: ${contractName} on chain: ${chainId}`,
        availableContracts: Object.keys(contractMapping),
        availableChains: Object.keys(DEPLOYMENTS),
      });
    }

    const contract = chainDeployments[fullContractName];

    console.log(`📋 contracts/${contractName}/abi: Returning contract ABI for chain: ${chainId}`);

    res.json({
      success: true,
      chainId: chainId,
      contractName: contractName,
      abi: contract.abi,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(`❌ contracts/${req.params.contractName}/abi: Error:`, error);
    res.status(500).json({
      success: false,
      error: "Failed to load contract ABI",
      details: error.message,
    });
  }
});

// Route per ottenere l'indirizzo di un contratto specifico
router.get("/:contractName/address", async (req, res) => {
  try {
    const { contractName } = req.params;
    let chainId = req.query.chainId || process.env.CHAIN_ID || "11155111";
    
    // Mappa chain ID numerici ai nomi delle chain
    const chainIdMapping = {
      "11155111": "sepolia",
      "sepolia": "sepolia"
    };
    
    // Converti chain ID numerico in nome della chain se necessario
    const chainKey = chainIdMapping[chainId] || chainId;
    
    console.log(`📋 contracts/${contractName}/address: Requesting contract address for chain: ${chainId} (key: ${chainKey})`);

    if (!DEPLOYMENTS[chainKey]) {
      return res.status(404).json({
        success: false,
        error: `No deployments found for chain ID: ${chainId}`,
        availableChains: Object.keys(DEPLOYMENTS),
        chainKey: chainKey,
        originalChainId: chainId
      });
    }

    const chainDeployments = DEPLOYMENTS[chainKey];

    // Mappa dei nomi dei contratti
    const contractMapping = {
      "relay-payment-router": "Relay#RelayPaymentRouter",
      "stealth-pool": "Stealth#StealthPool",
      "pair-recovery": "Recovery#PairRecovery",
      integrity: "Security#Integrity",
      "payment-forwarder": "Stealth#PayamentForwarder",
      "stealth-key-registry": "Stealth#StealthKeyRegistry",
      "bridge-dex": "Bridge#BridgeDex",
      "chain": "Database#Chain",
      "ipcm-factory": "IPFS#IPCMFactory",
    };

    const fullContractName = contractMapping[contractName];
    if (!fullContractName || !chainDeployments[fullContractName]) {
      return res.status(404).json({
        success: false,
        error: `Contract not found: ${contractName} on chain: ${chainId}`,
        availableContracts: Object.keys(contractMapping),
        availableChains: Object.keys(DEPLOYMENTS),
      });
    }

    const contract = chainDeployments[fullContractName];

    console.log(`📋 contracts/${contractName}/address: Returning contract address for chain: ${chainId}`);

    res.json({
      success: true,
      chainId: chainId,
      contractName: contractName,
      address: contract.address,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(`❌ contracts/${req.params.contractName}/address: Error:`, error);
    res.status(500).json({
      success: false,
      error: "Failed to load contract address",
      details: error.message,
    });
  }
});

// Route per ottenere la lista di tutti i contratti disponibili
router.get("/", async (req, res) => {
  try {
    const chainId = req.query.chainId || process.env.CHAIN_ID || "11155111";
    
    console.log(`📋 contracts: Requesting available contracts list for chain: ${chainId}`);

    if (!DEPLOYMENTS[chainId]) {
      return res.status(404).json({
        success: false,
        error: `No deployments found for chain ID: ${chainId}`,
        availableChains: Object.keys(DEPLOYMENTS),
      });
    }

    const chainDeployments = DEPLOYMENTS[chainId];

    // Estrai solo i nomi dei contratti disponibili
    const availableContracts = Object.keys(chainDeployments).map(
      (contractName) => {
        const shortName = contractName.split("#")[1] || contractName;
        return {
          fullName: contractName,
          shortName: shortName,
          address: chainDeployments[contractName].address,
        };
      }
    );

    console.log(`📋 contracts: Returning available contracts list for chain: ${chainId}`);

    res.json({
      success: true,
      chainId: chainId,
      contracts: availableContracts,
      count: availableContracts.length,
      availableChains: Object.keys(DEPLOYMENTS),
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ contracts: Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to load contracts list",
      details: error.message,
    });
  }
});

// Route per ottenere la lista di tutte le chain disponibili
router.get("/chains", async (req, res) => {
  try {
    console.log("📋 contracts/chains: Requesting available chains list");

    const availableChains = Object.keys(DEPLOYMENTS).map(chainId => ({
      chainId: chainId,
      contractCount: Object.keys(DEPLOYMENTS[chainId]).length,
      contracts: Object.keys(DEPLOYMENTS[chainId])
    }));

    console.log("📋 contracts/chains: Returning available chains list");

    res.json({
      success: true,
      chains: availableChains,
      count: availableChains.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ contracts/chains: Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to load chains list",
      details: error.message,
    });
  }
});

export default router; 