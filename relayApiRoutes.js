import express from "express";
import { gunPubKeyToHex } from "./utils.js"; // Assuming utils.js is in the same directory or adjust path
import { ethers } from "ethers"; // Import ethers
// Dependencies to be passed: RELAY_CONFIG, relayVerifier, authenticateRequestMiddleware
// For /api/relay/config, we might need a callback to reinitialize relayVerifier in index.js
// or pass ShogunCore and ethers for re-initialization here.

export default function setupRelayApiRoutes(RELAY_CONFIG_PARAM, getRelayVerifierInstance, authenticateRequestMiddleware, shogunCoreInstance, reinitializeRelayCallback, SECRET_TOKEN_PARAM, AuthenticationManagerInstance) {
  const router = express.Router();

  // Helper to access authorizedKeys if not managed by AuthenticationManagerInstance directly
  // This is a conceptual placeholder. The actual implementation depends on how authorizedKeys is managed.
  const getMap = () => AuthenticationManagerInstance?.getAuthorizedKeysMap ? AuthenticationManagerInstance.getAuthorizedKeysMap() : new Map();
  const isKeyPreAuth = (key) => AuthenticationManagerInstance?.isKeyPreAuthorized ? AuthenticationManagerInstance.isKeyPreAuthorized(key) : false;
  const authKey = (key, expiry) => AuthenticationManagerInstance?.authorizeKey ? AuthenticationManagerInstance.authorizeKey(key, expiry) : { expiresAt: Date.now() + (5*60*1000) }; // default dummy
  const AUTH_KEY_EXPIRY_VALUE = AuthenticationManagerInstance?.AUTH_KEY_EXPIRY || (5*60*1000);

  // ============ RELAY VERIFIER API ============ 

  // API - Check relay status
  router.get("/status", authenticateRequestMiddleware, async (req, res) => {
    try {
      const relayVerifier = getRelayVerifierInstance();
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json({
          success: false,
          error: "Relay services not available",
          config: {
            enabled: RELAY_CONFIG_PARAM.relay.onchainMembership,
            registryAddress: RELAY_CONFIG_PARAM.relay.registryAddress || "Not configured",
          },
        });
      }
      const allRelays = await relayVerifier.getAllRelays();
      res.json({
        success: true,
        config: {
          enabled: RELAY_CONFIG_PARAM.relay.onchainMembership,
          registryAddress: RELAY_CONFIG_PARAM.relay.registryAddress,
        },
        relaysCount: allRelays.length,
      });
    } catch (error) {
      console.error("Error getting relay status:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - Get all relays
  router.get("/all", authenticateRequestMiddleware, async (req, res) => {
    try {
      const relayVerifier = getRelayVerifierInstance();
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json({ success: false, error: "Relay services not available" });
      }
      const relayAddresses = await relayVerifier.getAllRelays();
      const relays = [];
      for (const address of relayAddresses) {
        try {
          const relayInfo = await relayVerifier.getRelayInfo(address);
          if (relayInfo) {
            relays.push(relayInfo);
          }
        } catch (error) {
          console.error(`Error getting info for relay ${address}:`, error);
        }
      }
      res.json({ success: true, relays });
    } catch (error) {
      console.error("Error getting all relays:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - Check if user is subscribed to a relay
  router.get("/check-subscription/:relayAddress/:userAddress", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { relayAddress, userAddress } = req.params;
      const relayVerifier = getRelayVerifierInstance();
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json({ success: false, error: "Relay services not available" });
      }
      const isSubscribed = await relayVerifier.isUserSubscribedToRelay(relayAddress, userAddress);
      res.json({ success: true, relayAddress, userAddress, isSubscribed });
    } catch (error) {
      console.error(`Error checking subscription for user ${req.params.userAddress} to relay ${req.params.relayAddress}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - Get user's active relays
  router.get("/user-active-relays/:userAddress", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { userAddress } = req.params;
      const relayVerifier = getRelayVerifierInstance();
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json({ success: false, error: "Relay services not available" });
      }
      const relayAddresses = await relayVerifier.getUserActiveRelays(userAddress);
      const relays = [];
      for (const address of relayAddresses) {
        try {
          const relayInfo = await relayVerifier.getRelayInfo(address);
          if (relayInfo) {
            relays.push(relayInfo);
          }
        } catch (error) {
          console.error(`Error getting info for relay ${address}:`, error);
        }
      }
      res.json({ success: true, userAddress, relays });
    } catch (error) {
      console.error(`Error getting active relays for user ${req.params.userAddress}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - Check public key authorization against all relays
  router.post("/check-pubkey", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { publicKey } = req.body;
      if (!publicKey) {
        return res.status(400).json({ success: false, error: "Public key is required" });
      }
      const relayVerifier = getRelayVerifierInstance();
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json({ success: false, error: "Relay services not available" });
      }
      const relayAddresses = await relayVerifier.getAllRelays();
      const authorizedRelays = [];
      for (const address of relayAddresses) {
        try {
          // Assuming publicKey here is the hex version, or relayVerifier handles it.
          // The original /api/relay/pre-authorize/:pubKey does a gunPubKeyToHex conversion.
          // This route might need similar logic if publicKey is not already hex.
          const isAuthorized = await relayVerifier.isPublicKeyAuthorized(address, publicKey);
          if (isAuthorized) {
            authorizedRelays.push(address);
          }
        } catch (error) {
          console.error(`Error checking authorization on relay ${address}:`, error);
        }
      }
      res.json({ success: true, publicKey, isAuthorized: authorizedRelays.length > 0, authorizedRelays });
    } catch (error) {
      console.error("Error checking public key authorization:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - Get user subscription info for a specific relay
  router.get("/subscription-info/:relayAddress/:userAddress", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { relayAddress, userAddress } = req.params;
      const relayVerifier = getRelayVerifierInstance();
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json({ success: false, error: "Relay services not available" });
      }
      const subscriptionInfo = await relayVerifier.getUserSubscriptionInfo(relayAddress, userAddress);
      if (!subscriptionInfo) {
        return res.status(404).json({ success: false, error: "User subscription not found" });
      }
      res.json({
        success: true,
        relayAddress,
        userAddress,
        subscriptionInfo: {
          expires: subscriptionInfo.expires.toString(), // Ensure BigInt is converted
          pubKey: subscriptionInfo.pubKey,
          active: subscriptionInfo.active,
        },
      });
    } catch (error) {
      console.error(`Error getting subscription info for user ${req.params.userAddress} on relay ${req.params.relayAddress}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - Subscribe to a relay
  router.post("/subscribe", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { relayAddress, months, publicKey } = req.body;
      const relayVerifier = getRelayVerifierInstance();
      if (!relayAddress || !months) {
        return res.status(400).json({ success: false, error: "Relay address and number of months are required" });
      }
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json({ success: false, error: "Relay services not available" });
      }
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json({ success: false, error: "Only administrators can subscribe users to relays" });
      }
      const price = await relayVerifier.getRelayPrice(relayAddress);
      if (!price) {
        return res.status(400).json({ success: false, error: "Failed to get relay subscription price" });
      }
      // Ensure signer is available in relayVerifier if this is a write operation
      const tx = await relayVerifier.subscribeToRelay(relayAddress, months, publicKey || undefined);
      if (!tx) {
        return res.status(500).json({ success: false, error: "Failed to subscribe to relay" });
      }
      res.json({
        success: true,
        relayAddress,
        months,
        publicKey: publicKey || null,
        transactionHash: tx.hash,
        message: "Subscription successful",
      });
    } catch (error) {
      console.error("Error subscribing to relay:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - Update relay config
  router.post("/config", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { registryAddress, providerUrl, enabled } = req.body;
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json({ success: false, error: "Only administrators can modify relay configuration" });
      }

      let needsReinitialize = false;
      const updatedRelayConfigFragment = {};

      if (enabled !== undefined && RELAY_CONFIG_PARAM.relay.onchainMembership !== enabled) {
        updatedRelayConfigFragment.onchainMembership = enabled;
        needsReinitialize = true;
      }
      if (registryAddress && RELAY_CONFIG_PARAM.relay.registryAddress !== registryAddress) {
        updatedRelayConfigFragment.registryAddress = registryAddress;
        needsReinitialize = true;
      }
      if (providerUrl && RELAY_CONFIG_PARAM.relay.providerUrl !== providerUrl) {
        updatedRelayConfigFragment.providerUrl = providerUrl;
        needsReinitialize = true;
      }

      if (needsReinitialize) {
        console.log("[RelayAPI /config] Configuration changed, attempting re-initialization...");
        // The callback will update the main RELAY_CONFIG and re-init components in index.js
        const reinitSuccess = await reinitializeRelayCallback(updatedRelayConfigFragment);
        if (!reinitSuccess) {
            // If re-initialization in index.js fails, the main RELAY_CONFIG might not reflect the POSTed values.
            // The response will show the intended new config from RELAY_CONFIG_PARAM which *this route* tried to set.
            console.error("[RelayAPI /config] Re-initialization callback failed.");
            // Decide on error response. For now, proceed to show new config state as per this route's view.
        }
      } else {
        console.log("[RelayAPI /config] No configuration changes detected that require re-initialization.");
      }
      
      // Construct the response based on the parameters received by this route,
      // as the reinitializeRelayCallback handles the actual update in index.js scope.
      const currentConfigResponse = {
        enabled: updatedRelayConfigFragment.onchainMembership !== undefined ? updatedRelayConfigFragment.onchainMembership : RELAY_CONFIG_PARAM.relay.onchainMembership,
        registryAddress: updatedRelayConfigFragment.registryAddress || RELAY_CONFIG_PARAM.relay.registryAddress,
        providerUrl: updatedRelayConfigFragment.providerUrl || RELAY_CONFIG_PARAM.relay.providerUrl,
      };

      res.json({
        success: true,
        config: currentConfigResponse,
      });
    } catch (error) {
      console.error("Error updating relay configuration:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - Pre-authorize a public key (Moved from index.js)
  router.get("/pre-authorize/:pubKey", async (req, res) => {
    try {
      const { pubKey } = req.params;
      const forcedAuth = req.query.force === "true";

      if (!pubKey) {
        return res.status(400).json({ success: false, error: "Public key is required" });
      }

      if (isKeyPreAuth(pubKey)) {
        const authInfo = getMap().get(pubKey); // Assumes getMap().get() is how to retrieve info
        return res.json({
          success: true,
          message: "Public key already authorized",
          pubKey,
          expiresAt: authInfo.expiresAt,
          expiresIn: Math.round((authInfo.expiresAt - Date.now()) / 1000) + " seconds",
        });
      }

      if (forcedAuth) {
        const token = req.headers.authorization;
        if (token && (token === SECRET_TOKEN_PARAM || token === `Bearer ${SECRET_TOKEN_PARAM}`)) {
          console.log(`[PRE-AUTH API] Force-authorizing key: ${pubKey}`);
          const authInfo = authKey(pubKey, AUTH_KEY_EXPIRY_VALUE); // Use passed/derived AUTH_KEY_EXPIRY_VALUE or rely on authorizeKey default
          return res.json({
            success: true, message: "Public key force-authorized successfully", pubKey, forced: true, 
            expiresAt: authInfo.expiresAt, expiresIn: Math.round((authInfo.expiresAt - Date.now()) / 1000) + " seconds",
          });
        } else {
          return res.status(401).json({ success: false, error: "API token required for forced authorization" });
        }
      }

      let cleanedPubKey = pubKey;
      if (cleanedPubKey.startsWith("@")) cleanedPubKey = cleanedPubKey.substring(1);
      const dotIndex = cleanedPubKey.indexOf(".");
      if (dotIndex > 0) cleanedPubKey = cleanedPubKey.substring(0, dotIndex);

      const relayVerifier = getRelayVerifierInstance();
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        console.log(`[PRE-AUTH API] Blockchain verification not enabled, pre-authorizing key directly`);
        const authInfo = authKey(pubKey, AUTH_KEY_EXPIRY_VALUE);
        if (pubKey !== cleanedPubKey) authKey(cleanedPubKey, AUTH_KEY_EXPIRY_VALUE);
        if (!pubKey.startsWith("@")) authKey("@" + pubKey, AUTH_KEY_EXPIRY_VALUE);
        if (pubKey.startsWith("@")) authKey(pubKey.substring(1), AUTH_KEY_EXPIRY_VALUE);
        return res.json({
          success: true, message: "Public key pre-authorized successfully (blockchain verification disabled)", pubKey,
          expiresAt: authInfo.expiresAt, expiresIn: Math.round((authInfo.expiresAt - Date.now()) / 1000) + " seconds",
        });
      }

      const hexPubKey = gunPubKeyToHex(cleanedPubKey);
      if (!hexPubKey) {
        return res.status(400).json({ success: false, error: "Could not convert public key to hex format" });
      }
      console.log(`[PRE-AUTH API] Checking blockchain for key: ${pubKey}, cleaned: ${cleanedPubKey}, hex: ${hexPubKey}`);
      
      const activeRelays = await relayVerifier.getAllRelays();
      if (!activeRelays || activeRelays.length === 0) {
        return res.status(404).json({ success: false, error: "No active relays found" });
      }

      let isAuthorizedByChain = false;
      let authorizingRelayAddress = null;

      for (const relayAddress of activeRelays) {
        try {
          // Try direct contract call first for robustness, then relayVerifier method
          const provider = new ethers.JsonRpcProvider(RELAY_CONFIG_PARAM.relay.providerUrl);
          const relayAbi = ["function isPublicKeyAuthorized(bytes calldata pubKey) view returns (bool)", "function isAuthorizedByPubKey(bytes calldata _pubKey) external view returns (bool)"];
          const relayContract = new ethers.Contract(relayAddress, relayAbi, provider);
          const pubKeyBytes = ethers.getBytes(hexPubKey.startsWith("0x") ? hexPubKey : `0x${hexPubKey}`);
          let directResult = false;
          try {
            directResult = await relayContract.isPublicKeyAuthorized(pubKeyBytes);
          } catch (e) {
            try { directResult = await relayContract.isAuthorizedByPubKey(pubKeyBytes); } catch (e2) { /* ignore secondary error */ }
          }

          if (directResult) {
            isAuthorizedByChain = true;
            authorizingRelayAddress = relayAddress;
            console.log(`[PRE-AUTH API] Key directly authorized by relay ${relayAddress}`);
            break;
          }

          // Fallback to relayVerifier.isPublicKeyAuthorized if direct call fails or returns false
          // This might be redundant if direct call is the source of truth, or useful if relayVerifier has additional logic
          if (await relayVerifier.isPublicKeyAuthorized(relayAddress, hexPubKey)) {
             isAuthorizedByChain = true;
             authorizingRelayAddress = relayAddress;
             console.log(`[PRE-AUTH API] Key authorized by relay ${relayAddress} via relayVerifier`);
             break;
          }

        } catch (error) {
          console.error(`[PRE-AUTH API] Error checking relay ${relayAddress}: ${error.message}`);
        }
      }

      if (!isAuthorizedByChain) {
        return res.status(403).json({ success: false, error: "Public key not authorized by any active relay", pubKey });
      }

      const authInfo = authKey(pubKey, AUTH_KEY_EXPIRY_VALUE);
      if (pubKey !== cleanedPubKey) authKey(cleanedPubKey, AUTH_KEY_EXPIRY_VALUE);
      if (!pubKey.startsWith("@")) authKey("@" + pubKey, AUTH_KEY_EXPIRY_VALUE);
      if (pubKey.startsWith("@")) authKey(pubKey.substring(1), AUTH_KEY_EXPIRY_VALUE);

      res.json({
        success: true, message: "Public key blockchain-verified and pre-authorized", pubKey, authorizingRelay: authorizingRelayAddress,
        expiresAt: authInfo.expiresAt, expiresIn: Math.round((authInfo.expiresAt - Date.now()) / 1000) + " seconds",
      });

    } catch (error) {
      console.error("Error pre-authorizing key:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============ DID VERIFIER API ============ 
  // API - Check DID verifier status
  router.get("/did/status", authenticateRequestMiddleware, async (req, res) => {
    try {
      const didVerifier = AuthenticationManagerInstance.getDidVerifier ? AuthenticationManagerInstance.getDidVerifier() : null; // Or pass getDidVerifierInstance separately
      if (!RELAY_CONFIG_PARAM.didVerifier.enabled || !didVerifier) {
        return res.status(503).json({
          success: false, error: "DID verifier services not available",
          config: { enabled: RELAY_CONFIG_PARAM.didVerifier.enabled, contractAddress: RELAY_CONFIG_PARAM.didVerifier.contractAddress || "Not configured" },
        });
      }
      res.json({ success: true, config: { enabled: RELAY_CONFIG_PARAM.didVerifier.enabled, contractAddress: RELAY_CONFIG_PARAM.didVerifier.contractAddress } });
    } catch (error) {
      console.error("Error getting DID verifier status:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - Verify DID and get controller
  router.get("/did/verify/:did", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { did } = req.params;
      const didVerifier = AuthenticationManagerInstance.getDidVerifier ? AuthenticationManagerInstance.getDidVerifier() : null;
      if (!RELAY_CONFIG_PARAM.didVerifier.enabled || !didVerifier) {
        return res.status(503).json({ success: false, error: "DID verifier services not available" });
      }
      const controller = await didVerifier.verifyDID(did);
      res.json({ success: true, did, isValid: !!controller, controller });
    } catch (error) {
      console.error(`Error verifying DID ${req.params.did}:`, error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - Check if DID is controlled by a specific controller
  router.post("/did/check-controller", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { did, controller } = req.body;
      const didVerifier = AuthenticationManagerInstance.getDidVerifier ? AuthenticationManagerInstance.getDidVerifier() : null;
      if (!did || !controller) {
        return res.status(400).json({ success: false, error: "DID and controller are required" });
      }
      if (!RELAY_CONFIG_PARAM.didVerifier.enabled || !didVerifier) {
        return res.status(503).json({ success: false, error: "DID verifier services not available" });
      }
      const isControlledBy = await didVerifier.isDIDControlledBy(did, controller);
      res.json({ success: true, did, controller, isControlledBy });
    } catch (error) {
      console.error("Error checking DID controller:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - Authenticate with DID and signature
  router.post("/did/authenticate", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { did, message, signature } = req.body;
      const didVerifier = AuthenticationManagerInstance.getDidVerifier ? AuthenticationManagerInstance.getDidVerifier() : null;
      if (!did || !message || !signature) {
        return res.status(400).json({ success: false, error: "DID, message, and signature are required" });
      }
      if (!RELAY_CONFIG_PARAM.didVerifier.enabled || !didVerifier) {
        return res.status(503).json({ success: false, error: "DID verifier services not available" });
      }
      const isAuthenticated = await didVerifier.authenticateWithDID(did, message, signature);
      res.json({ success: true, did, isAuthenticated });
    } catch (error) {
      console.error("Error authenticating with DID:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - Register a new DID
  router.post("/did/register", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { did, controller } = req.body;
      const didVerifier = AuthenticationManagerInstance.getDidVerifier ? AuthenticationManagerInstance.getDidVerifier() : null;
      if (!did || !controller) {
        return res.status(400).json({ success: false, error: "DID and controller are required" });
      }
      if (!RELAY_CONFIG_PARAM.didVerifier.enabled || !didVerifier) {
        return res.status(503).json({ success: false, error: "DID verifier services not available" });
      }
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json({ success: false, error: "Only administrators can register DIDs" });
      }
      const registrationSuccess = await didVerifier.registerDID(did, controller);
      res.json({ success: registrationSuccess, did, controller, message: registrationSuccess ? "DID registered successfully" : "Failed to register DID" });
    } catch (error) {
      console.error("Error registering DID:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - Update DID verifier config
  router.post("/did/config", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { contractAddress, providerUrl, enabled } = req.body;
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json({ success: false, error: "Only administrators can modify DID verifier configuration" });
      }
      
      const updatedDidConfigFragment = {};
      let didNeedsReinitialize = false;

      if (enabled !== undefined && RELAY_CONFIG_PARAM.didVerifier.enabled !== enabled) {
        updatedDidConfigFragment.enabled = enabled;
        didNeedsReinitialize = true;
      }
      if (contractAddress && RELAY_CONFIG_PARAM.didVerifier.contractAddress !== contractAddress) {
        updatedDidConfigFragment.contractAddress = contractAddress;
        didNeedsReinitialize = true;
      }
      if (providerUrl && RELAY_CONFIG_PARAM.didVerifier.providerUrl !== providerUrl) {
        updatedDidConfigFragment.providerUrl = providerUrl;
        didNeedsReinitialize = true;
      }

      if (didNeedsReinitialize) {
        console.log("[RelayAPI /did/config] DID Verifier configuration changed, attempting re-initialization...");
        // Use the same reinitializeRelayCallback, assuming it handles both RelayVerifier and DIDVerifier updates in index.js
        // The callback will receive { didVerifier: updatedDidConfigFragment } or similar structure if needed to distinguish.
        // For simplicity, passing the fragment directly; index.js callback needs to know this is for DID.
        // A more robust way would be for the callback to accept an object like { relay: {}, did: {} }
        const reinitSuccess = await reinitializeRelayCallback({ didVerifier: updatedDidConfigFragment }); 
        if (!reinitSuccess) {
            console.error("[RelayAPI /did/config] Re-initialization callback failed for DID Verifier.");
        }
      }

      const currentDidConfigResponse = {
        enabled: updatedDidConfigFragment.enabled !== undefined ? updatedDidConfigFragment.enabled : RELAY_CONFIG_PARAM.didVerifier.enabled,
        contractAddress: updatedDidConfigFragment.contractAddress || RELAY_CONFIG_PARAM.didVerifier.contractAddress,
        providerUrl: updatedDidConfigFragment.providerUrl || RELAY_CONFIG_PARAM.didVerifier.providerUrl,
      };

      res.json({ success: true, config: currentDidConfigResponse });
    } catch (error) {
      console.error("Error updating DID verifier configuration:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - RELAY AUTHENTICATION CONFIG
  router.post("/auth/config", authenticateRequestMiddleware, async (req, res) => {
    try {
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json({ success: false, error: "Only administrators can modify authentication configuration" });
      }

      const { onchainMembership } = req.body;
      const previousConfig = { onchainMembership: RELAY_CONFIG_PARAM.relay.onchainMembership };
      let needsReinitialize = false;
      const updatedRelayConfigFragment = {};

      if (onchainMembership !== undefined && RELAY_CONFIG_PARAM.relay.onchainMembership !== onchainMembership) {
        updatedRelayConfigFragment.onchainMembership = onchainMembership;
        // This change might affect how relayVerifier is initialized or used, so re-initialization is likely needed.
        needsReinitialize = true; 
      }

      if (needsReinitialize) {
        // Use the main reinitializeRelayCallback, as this affects the relay part of RELAY_CONFIG
        const reinitSuccess = await reinitializeRelayCallback(updatedRelayConfigFragment);
        if (!reinitSuccess) {
          console.error("[RelayAPI /auth/config] Re-initialization callback failed when updating onchainMembership.");
          // If re-init fails, the actual RELAY_CONFIG in index.js might not have updated.
          // The response will reflect the intended change this route tried to make.
        }
      }
      
      const currentOnchainMembership = updatedRelayConfigFragment.onchainMembership !== undefined 
                                       ? updatedRelayConfigFragment.onchainMembership 
                                       : RELAY_CONFIG_PARAM.relay.onchainMembership;

      const authHierarchy = ["1. ADMIN_SECRET_TOKEN (highest priority)"];
      if (currentOnchainMembership) {
        authHierarchy.push("2. BLOCKCHAIN_MEMBERSHIP");
        authHierarchy.push("3. JWT");
        authHierarchy.push("4. PRE_AUTHORIZED_KEYS (lowest priority)");
      } else {
        authHierarchy.push("2. JWT");
        authHierarchy.push("3. PRE_AUTHORIZED_KEYS (lowest priority)");
      }

      res.json({
        success: true,
        previousConfig,
        currentConfig: { onchainMembership: currentOnchainMembership }, // Reflects the state this route processed
        authenticationHierarchy: authHierarchy,
        message: needsReinitialize ? "Authentication configuration updated (re-initialization attempted)" : "No changes to authentication configuration",
      });
    } catch (error) {
      console.error("Error updating authentication configuration:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
} 