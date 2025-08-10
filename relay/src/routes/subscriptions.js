import express from 'express';
import { ethers } from 'ethers';
import { DEPLOYMENTS } from "shogun-contracts/deployments.js";
import { getOffChainMBUsage } from './uploads.js';

const router = express.Router();

// Funzione per convertire chainId in nome della chain
function getChainName(chainId) {
  const chainMap = {
    "1": "mainnet",
    "11155111": "sepolia",
    "137": "polygon",
    "80001": "mumbai"
  };
  return chainMap[chainId] || chainId;
}

// Inizializza il provider e il contratto per una chain specifica
async function initializeContract(chainId = "11155111") {
  if (!process.env.ALCHEMY_API_KEY) {
    console.log("⚠️ ALCHEMY_API_KEY not configured");
    return { success: false, error: "ALCHEMY_API_KEY not configured" };
  }

  try {
    // Determina l'URL del provider in base alla chain
    let providerUrl;
    switch (chainId) {
      case "11155111": // Sepolia
        providerUrl = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
        break;
      case "1": // Ethereum Mainnet
        providerUrl = `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
        break;
      case "137": // Polygon
        providerUrl = `https://polygon-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
        break;
      default:
        return { success: false, error: `Unsupported chain ID: ${chainId}` };
    }

    // Converti chainId in nome della chain
    const chainName = getChainName(chainId);
    
    // Verifica che la chain abbia i deployments
    if (!DEPLOYMENTS[chainName]) {
      return { success: false, error: `No deployments found for chain ID: ${chainId} (${chainName})` };
    }

    const relayContractData = DEPLOYMENTS[chainName]["Relay#RelayPaymentRouter"];
    if (!relayContractData) {
      return { success: false, error: `Relay contract not found on chain: ${chainId} (${chainName})` };
    }

    const provider = new ethers.JsonRpcProvider(providerUrl);
    const relayContract = new ethers.Contract(
      relayContractData.address,
      relayContractData.abi,
      provider
    );

    return { success: true, provider, relayContract };
  } catch (error) {
    console.error("❌ Failed to initialize contract:", error);
    return { success: false, error: error.message };
  }
}

// Route per ottenere lo stato di una sottoscrizione
router.get("/subscription-status/:identifier", async (req, res) => {
  try {
    const { identifier } = req.params;
    const chainId = req.query.chainId || process.env.CHAIN_ID || "11155111";
    
    console.log(`📋 subscription-status/${identifier}: Requesting subscription status for chain: ${chainId}`);

    const contractInit = await initializeContract(chainId);
    if (!contractInit.success) {
      return res.status(500).json({
        success: false,
        error: contractInit.error,
      });
    }

    const { relayContract } = contractInit;

    // Decodifica l'identifier (può essere un address o un hash)
    let userAddress;
    try {
      // Se è un address valido, usalo direttamente
      if (ethers.isAddress(identifier)) {
        userAddress = identifier;
      } else {
        // Altrimenti, prova a decodificarlo come hash
        userAddress = ethers.getAddress(identifier);
      }
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: "Invalid identifier format",
      });
    }

    // Ottieni tutti i relay per trovare una sottoscrizione attiva
    const allRelays = await relayContract.getAllRelays();
    let activeSubscription = null;
    let foundRelay = null;

    // Cerca una sottoscrizione attiva su qualsiasi relay
    for (const relayAddress of allRelays) {
      try {
        const subscriptionDetails = await relayContract.getSubscriptionDetails(
          userAddress,
          relayAddress
        );

        const [startTime, endTime, amountPaid, mbAllocated, isActive] = subscriptionDetails;

        if (isActive && Number(mbAllocated) > 0) {
          const now = Math.floor(Date.now() / 1000);
          const timeRemaining = Math.max(0, Number(endTime) - now);
          
          activeSubscription = {
            isActive: true,
            startTime: startTime.toString(),
            endTime: endTime.toString(),
            amountPaid: amountPaid.toString(),
            mbAllocated: mbAllocated.toString(),
            timeRemaining: timeRemaining.toString(),
            relayAddress: relayAddress
          };
          
          foundRelay = relayAddress;
          break;
        }
      } catch (error) {
        // Continua con il prossimo relay se questo fallisce
        console.log(`⚠️ Error checking relay ${relayAddress}:`, error.message);
      }
    }

    if (!activeSubscription) {
      return res.json({
        success: true,
        chainId: chainId,
        userAddress: userAddress,
        subscription: {
          isActive: false,
          reason: "No active subscription found"
        },
        timestamp: Date.now(),
      });
    }

    console.log(`📋 subscription-status/${identifier}: Returning subscription status for chain: ${chainId}`);

    res.json({
      success: true,
      chainId: chainId,
      userAddress: userAddress,
      subscription: activeSubscription,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(`❌ subscription-status/${req.params.identifier}: Error:`, error);
    res.status(500).json({
      success: false,
      error: "Failed to get subscription status",
      details: error.message,
    });
  }
});

// Route per ottenere i dettagli della sottoscrizione di un utente
router.get("/user-subscription-details/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;
    const chainId = req.query.chainId || process.env.CHAIN_ID || "11155111";
    
    console.log(`📋 user-subscription-details/${userAddress}: Requesting user subscription details for chain: ${chainId}`);
    console.log(`📋 user-subscription-details/${userAddress}: Request headers:`, req.headers);
    console.log(`📋 user-subscription-details/${userAddress}: Request query:`, req.query);

    if (!ethers.isAddress(userAddress)) {
      return res.status(400).json({
        success: false,
        error: "Invalid user address",
      });
    }

    const contractInit = await initializeContract(chainId);
    if (!contractInit.success) {
      return res.status(500).json({
        success: false,
        error: contractInit.error,
      });
    }

    const { relayContract } = contractInit;

    // Ottieni tutti i relay per trovare una sottoscrizione attiva
    const allRelays = await relayContract.getAllRelays();
    let activeSubscription = null;
    let foundRelay = null;

    // Cerca una sottoscrizione attiva su qualsiasi relay
    for (const relayAddress of allRelays) {
      try {
        console.log(`📋 user-subscription-details/${userAddress}: Checking relay: ${relayAddress}`);
        const subscriptionDetails = await relayContract.getSubscriptionDetails(
          userAddress,
          relayAddress
        );

        const [startTime, endTime, amountPaid, mbAllocated, isActive] = subscriptionDetails;
        console.log(`📋 user-subscription-details/${userAddress}: Subscription details for relay ${relayAddress}:`, {
          startTime: startTime.toString(),
          endTime: endTime.toString(),
          amountPaid: amountPaid.toString(),
          mbAllocated: mbAllocated.toString(),
          isActive: isActive
        });

        if (isActive && Number(mbAllocated) > 0) {
          console.log(`📋 user-subscription-details/${userAddress}: Found active subscription on relay ${relayAddress}`);
          const now = Math.floor(Date.now() / 1000);
          const timeRemaining = Math.max(0, Number(endTime) - now);
          
          // Calcola i MB utilizzati in tempo reale
          let mbUsed = 0;
          let mbRemaining = Number(mbAllocated);
          let usagePercentage = 0;
          
          try {
            console.log(`📊 user-subscription-details: Calculating MB usage for ${userAddress}`);
            mbUsed = await getOffChainMBUsage(userAddress, req);
            console.log(`📊 user-subscription-details: getOffChainMBUsage returned: ${mbUsed}`);
            
            mbRemaining = Math.max(0, Number(mbAllocated) - mbUsed);
            usagePercentage = Number(mbAllocated) > 0 ? (mbUsed / Number(mbAllocated)) * 100 : 0;
            
            console.log(`📊 user-subscription-details: MB calculation for ${userAddress}:`);
            console.log(`📊 - MB Allocated: ${mbAllocated}`);
            console.log(`📊 - MB Used (off-chain): ${mbUsed}`);
            console.log(`📊 - MB Remaining: ${mbRemaining}`);
            console.log(`📊 - Usage: ${usagePercentage.toFixed(2)}%`);
          } catch (mbError) {
            console.warn(`⚠️ Error calculating MB usage for ${userAddress}:`, mbError.message);
            console.warn(`⚠️ MB Error stack:`, mbError.stack);
            mbUsed = 0;
            mbRemaining = Number(mbAllocated);
            usagePercentage = 0;
          }
          
          activeSubscription = {
            isActive: true,
            startTime: startTime.toString(),
            endTime: endTime.toString(),
            amountPaid: amountPaid.toString(),
            mbAllocated: mbAllocated.toString(),
            mbUsed: mbUsed,
            mbRemaining: mbRemaining,
            usagePercentage: Math.round(usagePercentage * 100) / 100,
            timeRemaining: timeRemaining.toString(),
            relayAddress: relayAddress,
            daysRemaining: Math.max(0, Math.ceil(timeRemaining / (24 * 60 * 60)))
          };
          
          foundRelay = relayAddress;
          break;
        }
      } catch (error) {
        // Continua con il prossimo relay se questo fallisce
        console.log(`⚠️ Error checking relay ${relayAddress}:`, error.message);
      }
    }

    if (!activeSubscription) {
      return res.json({
        success: true,
        chainId: chainId,
        userAddress: userAddress,
        subscription: {
          isActive: false,
          reason: "No active subscription found"
        },
        timestamp: Date.now(),
      });
    }

    console.log(`📋 user-subscription-details/${userAddress}: Returning user subscription details for chain: ${chainId}`);
    console.log(`📋 user-subscription-details/${userAddress}: Final response:`, {
      success: true,
      chainId: chainId,
      userAddress: userAddress,
      subscription: activeSubscription,
      timestamp: Date.now(),
    });

    res.json({
      success: true,
      chainId: chainId,
      userAddress: userAddress,
      subscription: activeSubscription,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(`❌ user-subscription-details/${req.params.userAddress}: Error:`, error);
    res.status(500).json({
      success: false,
      error: "Failed to get user subscription details",
      details: error.message,
    });
  }
});

// Route per ottenere la lista delle chain supportate per le sottoscrizioni
router.get("/supported-chains", async (req, res) => {
  try {
    console.log("📋 subscriptions/supported-chains: Requesting supported chains");

    const supportedChains = Object.keys(DEPLOYMENTS).filter(chainId => {
      return DEPLOYMENTS[chainId]["Relay#RelayPaymentRouter"];
    }).map(chainId => ({
      chainId: chainId,
      name: getChainName(chainId),
      relayContract: DEPLOYMENTS[chainId]["Relay#RelayPaymentRouter"].address,
      supported: true
    }));

    console.log("📋 subscriptions/supported-chains: Returning supported chains");

    res.json({
      success: true,
      chains: supportedChains,
      count: supportedChains.length,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("❌ subscriptions/supported-chains: Error:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get supported chains",
      details: error.message,
    });
  }
});

// Route di debug per testare getOffChainMBUsage direttamente
router.get("/debug-mb/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;
    
    console.log(`🐛 Debug MB endpoint called for: ${userAddress}`);
    
    if (!ethers.isAddress(userAddress)) {
      return res.status(400).json({
        success: false,
        error: "Invalid user address",
      });
    }

    // Test diretto di getOffChainMBUsage
    console.log(`🐛 Testing getOffChainMBUsage for: ${userAddress}`);
    const mbUsed = await getOffChainMBUsage(userAddress, req);
    console.log(`🐛 getOffChainMBUsage result: ${mbUsed}`);

    // Test diretto di GunDB
    const gun = req.app.get('gunInstance');
    if (!gun) {
      return res.json({
        success: false,
        error: "Gun instance not available",
        mbUsed: mbUsed
      });
    }

    console.log(`🐛 Gun instance available, testing direct access`);
    
    // Test accesso diretto a GunDB
    const uploadsNode = gun.get("shogun").get("uploads").get(userAddress);
    const directTest = await new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve({ error: "Timeout", data: null });
      }, 10000);

      uploadsNode.once((parentData) => {
        clearTimeout(timeoutId);
        resolve({
          error: null,
          data: parentData,
          dataType: typeof parentData,
          keys: parentData ? Object.keys(parentData) : null
        });
      });
    });

    console.log(`🐛 Direct GunDB test result:`, directTest);

    res.json({
      success: true,
      userAddress: userAddress,
      mbUsed: mbUsed,
      gunTest: directTest,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`❌ Debug MB error:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router; 