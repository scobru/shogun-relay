import express from 'express';
import { DEPLOYMENTS } from "shogun-contracts/deployments.js";

const router = express.Router();

// Route per ottenere la configurazione completa dei contratti
router.get("/config", async (req, res) => {
  try {
    console.log("📋 contracts/config: Requesting contract configuration");

    const chainId = process.env.CHAIN_ID || "11155111"; // Sepolia di default

    if (!DEPLOYMENTS[chainId]) {
      return res.status(404).json({
        success: false,
        error: `No deployments found for chain ID: ${chainId}`,
      });
    }

    const chainDeployments = DEPLOYMENTS[chainId];

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
    };

    console.log(
      "📋 contracts/config: Returning contract configuration for chain:",
      chainId
    );

    res.json({
      success: true,
      chainId: chainId,
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

// Route per ottenere un contratto specifico
router.get("/:contractName", async (req, res) => {
  try {
    const { contractName } = req.params;
    console.log(`📋 contracts/${contractName}: Requesting contract details`);

    const chainId = process.env.CHAIN_ID || "11155111";

    if (!DEPLOYMENTS[chainId]) {
      return res.status(404).json({
        success: false,
        error: `No deployments found for chain ID: ${chainId}`,
      });
    }

    const chainDeployments = DEPLOYMENTS[chainId];

    // Mappa dei nomi dei contratti
    const contractMapping = {
      "relay-payment-router": "Relay#RelayPaymentRouter",
      "stealth-pool": "Stealth#StealthPool",
      "pair-recovery": "Recovery#PairRecovery",
      integrity: "Security#Integrity",
      "payment-forwarder": "Stealth#PayamentForwarder",
      "stealth-key-registry": "Stealth#StealthKeyRegistry",
      "bridge-dex": "Bridge#BridgeDex",
    };

    const fullContractName = contractMapping[contractName];
    if (!fullContractName || !chainDeployments[fullContractName]) {
      return res.status(404).json({
        success: false,
        error: `Contract not found: ${contractName}`,
      });
    }

    const contract = chainDeployments[fullContractName];

    console.log(`📋 contracts/${contractName}: Returning contract details`);

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

// Route per ottenere solo l'ABI di un contratto
router.get("/:contractName/abi", async (req, res) => {
  try {
    const { contractName } = req.params;
    console.log(`📋 contracts/${contractName}/abi: Requesting contract ABI`);

    const chainId = process.env.CHAIN_ID || "11155111";

    if (!DEPLOYMENTS[chainId]) {
      return res.status(404).json({
        success: false,
        error: `No deployments found for chain ID: ${chainId}`,
      });
    }

    const chainDeployments = DEPLOYMENTS[chainId];

    const contractMapping = {
      "relay-payment-router": "Relay#RelayPaymentRouter",
      "stealth-pool": "Stealth#StealthPool",
      "pair-recovery": "Recovery#PairRecovery",
      integrity: "Security#Integrity",
      "payment-forwarder": "Stealth#PayamentForwarder",
      "stealth-key-registry": "Stealth#StealthKeyRegistry",
      "bridge-dex": "Bridge#BridgeDex",
    };

    const fullContractName = contractMapping[contractName];
    if (!fullContractName || !chainDeployments[fullContractName]) {
      return res.status(404).json({
        success: false,
        error: `Contract not found: ${contractName}`,
      });
    }

    const contract = chainDeployments[fullContractName];

    console.log(`📋 contracts/${contractName}/abi: Returning contract ABI`);

    res.json({
      success: true,
      chainId: chainId,
      contractName: contractName,
      abi: contract.abi,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(
      `❌ contracts/${req.params.contractName}/abi: Error:`,
      error
    );
    res.status(500).json({
      success: false,
      error: "Failed to load contract ABI",
      details: error.message,
    });
  }
});

// Route per ottenere solo l'indirizzo di un contratto
router.get("/:contractName/address", async (req, res) => {
  try {
    const { contractName } = req.params;
    console.log(
      `📋 contracts/${contractName}/address: Requesting contract address`
    );

    const chainId = process.env.CHAIN_ID || "11155111";

    if (!DEPLOYMENTS[chainId]) {
      return res.status(404).json({
        success: false,
        error: `No deployments found for chain ID: ${chainId}`,
      });
    }

    const chainDeployments = DEPLOYMENTS[chainId];

    const contractMapping = {
      "relay-payment-router": "Relay#RelayPaymentRouter",
      "stealth-pool": "Stealth#StealthPool",
      "pair-recovery": "Recovery#PairRecovery",
      integrity: "Security#Integrity",
      "payment-forwarder": "Stealth#PayamentForwarder",
      "stealth-key-registry": "Stealth#StealthKeyRegistry",
      "bridge-dex": "Bridge#BridgeDex",
    };

    const fullContractName = contractMapping[contractName];
    if (!fullContractName || !chainDeployments[fullContractName]) {
      return res.status(404).json({
        success: false,
        error: `Contract not found: ${contractName}`,
      });
    }

    const contract = chainDeployments[fullContractName];

    console.log(
      `📋 contracts/${contractName}/address: Returning contract address`
    );

    res.json({
      success: true,
      chainId: chainId,
      contractName: contractName,
      address: contract.address,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(
      `❌ contracts/${req.params.contractName}/address: Error:`,
      error
    );
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
    console.log("📋 contracts: Requesting available contracts list");

    const chainId = process.env.CHAIN_ID || "11155111";

    if (!DEPLOYMENTS[chainId]) {
      return res.status(404).json({
        success: false,
        error: `No deployments found for chain ID: ${chainId}`,
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

    console.log("📋 contracts: Returning available contracts list");

    res.json({
      success: true,
      chainId: chainId,
      contracts: availableContracts,
      count: availableContracts.length,
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

export default router; 