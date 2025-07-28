import express from 'express';
import { ethers } from 'ethers';
import { DEPLOYMENTS } from "shogun-contracts/deployments.js";

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

    // Ottieni i dettagli della sottoscrizione dal contratto
    const subscription = await relayContract.getSubscriptionDetails(userAddress);
    
    // Ottieni l'uso MB dal contratto - usa getUserSubscriptions per ottenere i dettagli completi
    const userSubscriptions = await relayContract.getUserSubscriptions(userAddress);

    // Calcola i dettagli aggiuntivi
    const now = Math.floor(Date.now() / 1000);
    const isActive = subscription.isActive && subscription.endTime > now;
    const timeRemaining = Math.max(0, subscription.endTime - now);
    const mbRemaining = Math.max(0, subscription.mbAllocated - userSubscriptions.mbUsed);

    console.log(`📋 subscription-status/${identifier}: Returning subscription status for chain: ${chainId}`);

    res.json({
      success: true,
      chainId: chainId,
      userAddress: userAddress,
      subscription: {
        isActive: subscription.isActive,
        startTime: subscription.startTime.toString(),
        endTime: subscription.endTime.toString(),
        plan: subscription.plan.toString(),
        mbAllocated: subscription.mbAllocated.toString(),
        mbUsed: userSubscriptions.mbUsed.toString(),
        mbRemaining: mbRemaining.toString(),
        timeRemaining: timeRemaining.toString(),
      },
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

    // Ottieni i dettagli della sottoscrizione dal contratto
    const subscription = await relayContract.getSubscription(userAddress);
    
    // Ottieni l'uso MB dal contratto
    const mbUsage = await relayContract.getMBUsage(userAddress);

    // Calcola i dettagli aggiuntivi
    const now = Math.floor(Date.now() / 1000);
    const isActive = subscription.isActive && subscription.endTime > now;
    const timeRemaining = Math.max(0, subscription.endTime - now);
    const mbRemaining = Math.max(0, subscription.mbAllocated - mbUsage);

    console.log(`📋 user-subscription-details/${userAddress}: Returning user subscription details for chain: ${chainId}`);

    res.json({
      success: true,
      chainId: chainId,
      userAddress: userAddress,
      subscription: {
        isActive: isActive,
        startTime: subscription.startTime.toString(),
        endTime: subscription.endTime.toString(),
        plan: subscription.plan.toString(),
        mbAllocated: subscription.mbAllocated.toString(),
        mbUsed: mbUsage.toString(),
        mbRemaining: mbRemaining.toString(),
        timeRemaining: timeRemaining.toString(),
      },
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

export default router; 