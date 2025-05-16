import express from "express";
import { generateUserToken, configure } from "../managers/AuthenticationManager.js";
import { ethers } from "ethers";

/**
 * Convert Gun SEA public key to hex format needed for the contract
 * @param pubKey Gun SEA format public key
 * @returns Hex string (without 0x prefix)
 */
function gunPubKeyToHex(pubKey) {
  try {
    // Remove the ~ prefix if present
    if (pubKey.startsWith("~")) {
      pubKey = pubKey.substring(1);
    }

    // Remove anything after a . if present (often used in GunDB for separating pub and epub)
    const dotIndex = pubKey.indexOf(".");
    if (dotIndex > 0) {
      pubKey = pubKey.substring(0, dotIndex);
    }

    // Convert from GunDB's URL-safe base64 to standard base64
    const base64Key = pubKey.replace(/-/g, "+").replace(/_/g, "/");

    // Add padding if needed
    const padded =
      base64Key.length % 4 === 0
        ? base64Key
        : base64Key.padEnd(
            base64Key.length + (4 - (base64Key.length % 4)),
            "="
          );

    // Convert to binary and then to hex
    const binaryData = Buffer.from(padded, "base64");
    const hexData = binaryData.toString("hex");

    return hexData;
  } catch (error) {
    return "";
  }
}

export default function setupRelayApiRoutes(RELAY_CONFIG_PARAM, getRelayVerifierInstance, authenticateRequestMiddleware, shogunCoreInstance, reinitializeRelayCallback, SECRET_TOKEN_PARAM, AuthenticationManagerInstance) {
  const router = express.Router();

  // Helper to access authorization methods
  const getMap = () => AuthenticationManagerInstance?.getAuthorizedKeysMap ? AuthenticationManagerInstance.getAuthorizedKeysMap() : new Map();
  const isKeyPreAuth = (key) => AuthenticationManagerInstance?.isKeyPreAuthorized ? AuthenticationManagerInstance.isKeyPreAuthorized(key) : false;
  const authKey = (key, expiry) => AuthenticationManagerInstance?.authorizeKey ? AuthenticationManagerInstance.authorizeKey(key, expiry) : { expiresAt: Date.now() + (5*60*1000) };
  const AUTH_KEY_EXPIRY_VALUE = AuthenticationManagerInstance?.AUTH_KEY_EXPIRY || (5*60*1000);

  /**
   * Safely execute operations that might fail
   * @param {Function} operation - The operation to execute
   * @param {string} errorMessage - Error message for failures
   * @returns {Promise<any>} Operation result
   */
  const _safeOperation = async (operation, errorMessage) => {
    try {
      return await operation();
    } catch (error) {
      throw new Error(`${errorMessage}: ${error.message}`);
    }
  };

  /**
   * Clean and standardize public key format
   * @param {string} pubKey - Raw public key
   * @returns {Object} Object with cleaned key formats
   */
  const _cleanPublicKey = (pubKey) => {
    let cleanedKey = pubKey;
    if (cleanedKey.startsWith("~") || cleanedKey.startsWith("@")) {
      cleanedKey = cleanedKey.substring(1);
    }
    
    const dotIndex = cleanedKey.indexOf(".");
    if (dotIndex > 0) {
      cleanedKey = cleanedKey.substring(0, dotIndex);
    }
    
    return {
      original: pubKey,
      cleaned: cleanedKey,
      hex: gunPubKeyToHex(cleanedKey)
    };
  };

  /**
   * Verify blockchain authorization for a public key across all relays
   * @param {string} pubKey - The public key to verify
   * @returns {Promise<Object>} Authorization result
   */
  const _verifyBlockchainAuth = async (pubKey) => {
    const keyData = _cleanPublicKey(pubKey);
    const relayVerifier = getRelayVerifierInstance();
    
    if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
      return { isAuthorized: false, authorizingRelay: null, reason: "blockchain_disabled" };
    }
    
    if (!keyData.hex) {
      return { isAuthorized: false, authorizingRelay: null, reason: "invalid_key_format" };
    }
    
    console.log(`Verifying public key authorization: ${keyData.cleaned}`);
    console.log(`Hex format: ${keyData.hex}`);

    try {
      // Use the relayVerifier directly, which now handles all contract types
      // The first parameter can be any value since the verification is done internally
      const registryAddress = RELAY_CONFIG_PARAM.relay.registryAddress || "check-all";
      const isAuthorized = await relayVerifier.isPublicKeyAuthorized(registryAddress, keyData.hex);
      
      if (isAuthorized) {
        console.log(`Public key ${keyData.cleaned} is authorized via blockchain verification`);
        return { 
          isAuthorized: true, 
          authorizingRelay: "detected", 
          reason: "success" 
        };
      }

      console.log(`Public key ${keyData.cleaned} is NOT authorized via blockchain verification`);
      return { 
        isAuthorized: false, 
        authorizingRelay: null, 
        reason: "not_authorized" 
      };
    } catch (error) {
      console.error(`Error during blockchain verification: ${error.message}`);
      return { 
        isAuthorized: false, 
        authorizingRelay: null, 
        reason: `verification_error: ${error.message}` 
      };
    }
  };

  /**
   * Authorize a key in all its formats
   * @param {string} pubKey - Public key to authorize
   * @param {number} expiryMs - Expiry time in milliseconds
   * @returns {Object} Authorization info
   */
  const _authorizeKeyAllFormats = (pubKey, expiryMs) => {
    const keyData = _cleanPublicKey(pubKey);
    const authInfo = authKey(pubKey, expiryMs);
    
    // Authorize all common variants
    if (pubKey !== keyData.cleaned) {
      authKey(keyData.cleaned, expiryMs);
    }
    
    if (!pubKey.startsWith("@")) {
      authKey("@" + pubKey, expiryMs);
    }
    
    if (pubKey.startsWith("@")) {
      authKey(pubKey.substring(1), expiryMs);
    }
    
    return authInfo;
  };

  /**
   * Create a standardized API response
   * @param {boolean} success - Whether the operation succeeded
   * @param {string} message - Response message
   * @param {Object} data - Additional data
   * @param {string} error - Error message if any
   * @returns {Object} Standardized response object
   */
  const _standardResponse = (success, message, data = {}, error = null) => {
    const response = {
      success,
      message
    };
    
    if (error) {
      response.error = error;
    }
    
    return { ...response, ...data };
  };

  // ============ RELAY VERIFIER API ============ 

  // API - Check relay status
  router.get("/status", authenticateRequestMiddleware, async (req, res) => {
    try {
      const relayVerifier = getRelayVerifierInstance();
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json(_standardResponse(
          false,
          "Relay services not available",
          {
            config: {
              enabled: RELAY_CONFIG_PARAM.relay.onchainMembership,
              registryAddress: RELAY_CONFIG_PARAM.relay.registryAddress || "Not configured",
            }
          },
          "Relay services not available"
        ));
      }
      
      const allRelays = await relayVerifier.getAllRelays();
      res.json(_standardResponse(
        true,
        "Relay status retrieved successfully",
        {
          config: {
            enabled: RELAY_CONFIG_PARAM.relay.onchainMembership,
            registryAddress: RELAY_CONFIG_PARAM.relay.registryAddress,
          },
          relaysCount: allRelays.length
        }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error getting relay status", {}, error.message));
    }
  });

  // API - Get all relays
  router.get("/all", authenticateRequestMiddleware, async (req, res) => {
    try {
      const relayVerifier = getRelayVerifierInstance();
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json(_standardResponse(false, "Relay services not available", {}, "Relay services not available"));
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
          // Continue to next relay
        }
      }
      
      res.json(_standardResponse(true, "Relays retrieved successfully", { relays }));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error getting all relays", {}, error.message));
    }
  });

  // API - Check if user is subscribed to a relay
  router.get("/check-subscription/:relayAddress/:userAddress", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { relayAddress, userAddress } = req.params;
      const relayVerifier = getRelayVerifierInstance();
      
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json(_standardResponse(false, "Relay services not available", {}, "Relay services not available"));
      }
      
      const isSubscribed = await relayVerifier.isUserSubscribedToRelay(relayAddress, userAddress);
      res.json(_standardResponse(
        true, 
        `User ${isSubscribed ? "is" : "is not"} subscribed to relay`,
        { relayAddress, userAddress, isSubscribed }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error checking subscription", {}, error.message));
    }
  });

  // API - Get user's active relays
  router.get("/user-active-relays/:userAddress", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { userAddress } = req.params;
      const relayVerifier = getRelayVerifierInstance();
      
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json(_standardResponse(false, "Relay services not available", {}, "Relay services not available"));
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
          // Continue to next relay
        }
      }
      
      res.json(_standardResponse(true, "User active relays retrieved", { userAddress, relays }));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error getting active relays", {}, error.message));
    }
  });

  // API - Check public key authorization against all relays
  router.post("/check-pubkey", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { publicKey } = req.body;
      if (!publicKey) {
        return res.status(400).json(_standardResponse(false, "Public key is required", {}, "Public key is required"));
      }
      
      const { isAuthorized, authorizingRelay } = await _verifyBlockchainAuth(publicKey);
      const authorizedRelays = isAuthorized ? [authorizingRelay] : [];
      
      res.json(_standardResponse(
        true, 
        isAuthorized ? "Public key is authorized" : "Public key is not authorized", 
        { publicKey, isAuthorized, authorizedRelays }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error checking public key authorization", {}, error.message));
    }
  });

  // API - Get user subscription info for a specific relay
  router.get("/subscription-info/:relayAddress/:userAddress", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { relayAddress, userAddress } = req.params;
      const relayVerifier = getRelayVerifierInstance();
      
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json(_standardResponse(false, "Relay services not available", {}, "Relay services not available"));
      }
      
      const subscriptionInfo = await relayVerifier.getUserSubscriptionInfo(relayAddress, userAddress);
      if (!subscriptionInfo) {
        return res.status(404).json(_standardResponse(false, "User subscription not found", {}, "User subscription not found"));
      }
      
      res.json(_standardResponse(
        true,
        "Subscription information retrieved",
        {
          relayAddress,
          userAddress,
          subscriptionInfo: {
            expires: subscriptionInfo.expires.toString(), // Ensure BigInt is converted
            pubKey: subscriptionInfo.pubKey,
            active: subscriptionInfo.active,
          }
        }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error getting subscription info", {}, error.message));
    }
  });

  // API - Subscribe to a relay
  router.post("/subscribe", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { relayAddress, months, publicKey } = req.body;
      const relayVerifier = getRelayVerifierInstance();
      
      if (!relayAddress || !months) {
        return res.status(400).json(_standardResponse(false, "Missing required parameters", {}, "Relay address and number of months are required"));
      }
      
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !relayVerifier) {
        return res.status(503).json(_standardResponse(false, "Relay services not available", {}, "Relay services not available"));
      }
      
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json(_standardResponse(false, "Insufficient permissions", {}, "Only administrators can subscribe users to relays"));
      }
      
      const price = await relayVerifier.getRelayPrice(relayAddress);
      if (!price) {
        return res.status(400).json(_standardResponse(false, "Failed to get relay subscription price", {}, "Failed to get relay subscription price"));
      }
      
      const tx = await relayVerifier.subscribeToRelay(relayAddress, months, publicKey || undefined);
      if (!tx) {
        return res.status(500).json(_standardResponse(false, "Failed to subscribe to relay", {}, "Failed to subscribe to relay"));
      }
      
      res.json(_standardResponse(
        true,
        "Subscription successful",
        {
          relayAddress,
          months,
          publicKey: publicKey || null,
          transactionHash: tx.hash
        }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error subscribing to relay", {}, error.message));
    }
  });

  // API - Update relay config
  router.post("/config", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { registryAddress, providerUrl, enabled } = req.body;
      
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json(_standardResponse(false, "Insufficient permissions", {}, "Only administrators can modify relay configuration"));
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
        await reinitializeRelayCallback(updatedRelayConfigFragment);
      }
      
      // Construct the response based on the parameters
      const currentConfigResponse = {
        enabled: updatedRelayConfigFragment.onchainMembership !== undefined ? updatedRelayConfigFragment.onchainMembership : RELAY_CONFIG_PARAM.relay.onchainMembership,
        registryAddress: updatedRelayConfigFragment.registryAddress || RELAY_CONFIG_PARAM.relay.registryAddress,
        providerUrl: updatedRelayConfigFragment.providerUrl || RELAY_CONFIG_PARAM.relay.providerUrl,
      };

      res.json(_standardResponse(
        true, 
        needsReinitialize ? "Relay configuration updated" : "No changes required",
        { config: currentConfigResponse }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error updating relay configuration", {}, error.message));
    }
  });

  // API - Pre-authorize a public key
  router.get("/pre-authorize/:pubKey", async (req, res) => {
    try {
      const { pubKey } = req.params;
      const forcedAuth = req.query.force === "true";

      if (!pubKey) {
        return res.status(400).json(_standardResponse(false, "Public key is required", {}, "Public key is required"));
      }

      // Check if key is already pre-authorized
      if (isKeyPreAuth(pubKey)) {
        const authInfo = getMap().get(pubKey);
        return res.json(_standardResponse(
          true,
          "Public key already authorized",
          {
            pubKey,
            expiresAt: authInfo.expiresAt,
            expiresIn: Math.round((authInfo.expiresAt - Date.now()) / 1000) + " seconds"
          }
        ));
      }

      // Handle forced authorization with admin token
      if (forcedAuth) {
        const token = req.headers.authorization;
        if (token && (token === SECRET_TOKEN_PARAM || token === `Bearer ${SECRET_TOKEN_PARAM}`)) {
          const authInfo = _authorizeKeyAllFormats(pubKey, AUTH_KEY_EXPIRY_VALUE);
          
          return res.json(_standardResponse(
            true, 
            "Public key force-authorized successfully", 
            {
              pubKey,
              forced: true,
              expiresAt: authInfo.expiresAt,
              expiresIn: Math.round((authInfo.expiresAt - Date.now()) / 1000) + " seconds"
            }
          ));
        } else {
          return res.status(401).json(_standardResponse(false, "Authentication required", {}, "API token required for forced authorization"));
        }
      }

      // Clean and standardize key format
      const keyData = _cleanPublicKey(pubKey);

      // Handle case when blockchain verification is disabled
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !getRelayVerifierInstance()) {
        const authInfo = _authorizeKeyAllFormats(pubKey, AUTH_KEY_EXPIRY_VALUE);
        
        return res.json(_standardResponse(
          true, 
          "Public key pre-authorized successfully (blockchain verification disabled)", 
          {
            pubKey,
            expiresAt: authInfo.expiresAt, 
            expiresIn: Math.round((authInfo.expiresAt - Date.now()) / 1000) + " seconds"
          }
        ));
      }

      // Verify blockchain authorization
      const { isAuthorized, authorizingRelay, reason } = await _verifyBlockchainAuth(pubKey);

      if (!isAuthorized) {
        return res.status(403).json(_standardResponse(
          false, 
          "Public key not authorized by any active relay", 
          { pubKey, reason }
        ));
      }

      // Pre-authorize key in all formats
      const authInfo = _authorizeKeyAllFormats(pubKey, AUTH_KEY_EXPIRY_VALUE);

      res.json(_standardResponse(
        true, 
        "Public key blockchain-verified and pre-authorized",
        {
          pubKey,
          authorizingRelay,
          expiresAt: authInfo.expiresAt,
          expiresIn: Math.round((authInfo.expiresAt - Date.now()) / 1000) + " seconds"
        }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error pre-authorizing key", {}, error.message));
    }
  });

  // API - Pre-authorize with token
  router.get("/pre-authorize-with-token/:pubKey", async (req, res) => {
    try {
      const { pubKey } = req.params;
      if (!pubKey) {
        return res.status(400).json(_standardResponse(false, "Public key is required", {}, "Public key is required"));
      }
      
      // Ensure JWT_SECRET is configured
      if (!SECRET_TOKEN_PARAM) {
        return res.status(500).json(_standardResponse(
          false, 
          "Server configuration error", 
          {},
          "JWT_SECRET not available"
        ));
      }
      
      // Clean and standardize the public key
      const keyData = _cleanPublicKey(pubKey);
      
      // Verify blockchain authentication
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership || !getRelayVerifierInstance()) {
        const authInfo = _authorizeKeyAllFormats(pubKey, AUTH_KEY_EXPIRY_VALUE);
        
        // Configure with SECRET_TOKEN
        configure({ JWT_SECRET: SECRET_TOKEN_PARAM });
        
        // Generate JWT even without blockchain verification
        const token = await generateUserToken(pubKey, "Pre-Authorized Access Token", null, false);
        
        return res.json(_standardResponse(
          true, 
          "Public key pre-authorized successfully (blockchain verification disabled)", 
          {
            pubKey,
            expiresAt: authInfo.expiresAt,
            token
          }
        ));
      }
      
      // Verify blockchain authorization
      const { isAuthorized, authorizingRelay, reason } = await _verifyBlockchainAuth(pubKey);
      
      if (!isAuthorized) {
        return res.status(403).json(_standardResponse(
          false, 
          "Public key not authorized by any active relay", 
          { pubKey, reason }
        ));
      }
      
      // Pre-authorize in all variants
      const authInfo = _authorizeKeyAllFormats(pubKey, AUTH_KEY_EXPIRY_VALUE);
      
      // Configure with SECRET_TOKEN
      configure({ JWT_SECRET: SECRET_TOKEN_PARAM });
      
      // Generate a JWT token
      const token = await generateUserToken(pubKey, "Blockchain Verified Token", null, true);
      
      res.json(_standardResponse(
        true, 
        "Public key blockchain-verified, pre-authorized, and token generated", 
        {
          pubKey, 
          authorizingRelay,
          expiresAt: authInfo.expiresAt, 
          token
        }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error pre-authorizing key with token", {}, error.message));
    }
  });

  // API - Test direct authorization by IndividualRelay - NO AUTH REQUIRED FOR TESTING
  router.get("/test-key-auth/:pubKey", async (req, res) => {
    try {
      const { pubKey } = req.params;
      if (!pubKey) {
        return res.status(400).json(_standardResponse(false, "Public key is required", {}, "Public key is required"));
      }
      
      // Import ethers
      const { ethers } = await import("ethers");
      
      // Clean the key
      const keyData = _cleanPublicKey(pubKey);
      console.log(`Test key auth - Cleaned key: ${JSON.stringify(keyData)}`);
      
      // Trova tutti i relay registrati per verificarli
      const relayVerifier = getRelayVerifierInstance();
      if (relayVerifier) {
        try {
          const allRelays = await relayVerifier.getAllRelays();
          console.log(`Trovati ${allRelays.length} relays registrati`);
          
          // Controlla che i Relay siano contratti validi
          const provider = new ethers.JsonRpcProvider(RELAY_CONFIG_PARAM.relay.providerUrl);
          for (const relayAddress of allRelays) {
            const code = await provider.getCode(relayAddress);
            const isContract = code !== "0x" && code.length > 2;
            console.log(`Relay ${relayAddress}: ${isContract ? "è un contratto valido" : "NON è un contratto valido"}`);
            
            if (isContract) {
              try {
                // Controlla se ha i metodi di un relay
                const relayAbi = [
                  "function isAuthorizedByPubKey(bytes calldata _pubKey) external view returns (bool)"
                ];
                const relayContract = new ethers.Contract(relayAddress, relayAbi, provider);
                
                const contractSize = code.length;
                console.log(`Dimensione codice contratto: ${contractSize} bytes`);
                
                // Di solito un wallet EOA (non un contratto) avrebbe codice vuoto
                if (contractSize < 100) {
                  console.log(`ATTENZIONE: Il contratto ha un codice molto piccolo, potrebbe non essere un vero contratto Relay!`);
                }
              } catch (err) {
                console.error(`Errore durante l'ispezione del contratto: ${err.message}`);
              }
            }
          }
        } catch (error) {
          console.error(`Errore nel recuperare i relay registrati: ${error.message}`);
        }
      }
      
      // Test direct IndividualRelay connection first
      if (RELAY_CONFIG_PARAM.relay.individualRelayAddress) {
        const individualRelayAddress = RELAY_CONFIG_PARAM.relay.individualRelayAddress;
        try {
          const provider = new ethers.JsonRpcProvider(RELAY_CONFIG_PARAM.relay.providerUrl);
          
          // Log contract details
          console.log(`Testing with IndividualRelay at: ${individualRelayAddress}`);
          console.log(`Using provider: ${RELAY_CONFIG_PARAM.relay.providerUrl}`);
          
          // Get contract code to check if the contract exists
          const contractCode = await provider.getCode(individualRelayAddress);
          console.log(`Contract code length: ${contractCode.length}`);
          if (contractCode === '0x') {
            console.log(`ERRORE: Nessun contratto trovato all'indirizzo ${individualRelayAddress}!`);
            return res.status(500).json({
              success: false,
              message: `Non esiste alcun contratto all'indirizzo ${individualRelayAddress}`,
              details: { address: individualRelayAddress }
            });
          }
          
          // Try to connect to the contract
          const individualRelayAbi = [
            "function isSubscribed(bytes memory pubKey) view returns (bool)",
            "function isPublicKeyAuthorized(bytes calldata pubKey) view returns (bool)",
            "function isAuthorizedByPubKey(bytes calldata _pubKey) external view returns (bool)",
            "function getCurrentPrice() view returns (uint256)",
            "function pricePerMonth() view returns (uint256)",
            // Aggiungiamo funzioni per identificare meglio il contratto
            "function getOwner() external view returns (address)",
            "function getRelayOperationalConfig() external view returns (string memory _url, uint256 _price, uint256 _daysInMonth, uint256 _stake)"
          ];
          
          const relayContract = new ethers.Contract(individualRelayAddress, individualRelayAbi, provider);
          
          // Proviamo a identificare il tipo di contratto
          let isIndividualRelay = false;
          try {
            // Verifica se il contratto ha il metodo getOwner
            const owner = await relayContract.getOwner();
            console.log(`Il contratto ha un proprietario: ${owner}`);
            isIndividualRelay = true;
          } catch (e) {
            console.log(`Il contratto non sembra essere un IndividualRelay: ${e.message}`);
          }
          
          // Se non è un IndividualRelay, verificare meglio cosa sia
          if (!isIndividualRelay) {
            return res.status(400).json({
              success: false,
              message: `Il contratto all'indirizzo ${individualRelayAddress} non sembra essere un IndividualRelay valido`,
              details: { address: individualRelayAddress }
            });
          }
          
          // Try to get price to validate contract connection
          let price = null;
          try {
            price = await relayContract.getCurrentPrice();
            console.log(`Contract price: ${ethers.formatEther(price)} ETH`);
          } catch (pe) {
            console.log(`Error getting price: ${pe.message}`);
            try {
              price = await relayContract.pricePerMonth();
              console.log(`Price per month: ${ethers.formatEther(price)} ETH`);
            } catch (pm) {
              console.log(`Error getting price per month: ${pm.message}`);
            }
          }
          
          // Format the key for contract
          const hexKey = keyData.hex.startsWith("0x") ? keyData.hex : `0x${keyData.hex}`;
          const keyBytes = ethers.getBytes(hexKey);
          console.log(`Checking key: ${hexKey}`);
          console.log(`Key bytes length: ${keyBytes.length}`);
          
          // Try all authorization methods
          let isAuthorized = false;
          let methodUsed = null;
          
          try {
            isAuthorized = await relayContract.isAuthorizedByPubKey(keyBytes);
            methodUsed = "isAuthorizedByPubKey";
            console.log(`isAuthorizedByPubKey result: ${isAuthorized}`);
          } catch (e1) {
            console.log(`Error with isAuthorizedByPubKey: ${e1.message}`);
            
            try {
              isAuthorized = await relayContract.isPublicKeyAuthorized(keyBytes);
              methodUsed = "isPublicKeyAuthorized";
              console.log(`isPublicKeyAuthorized result: ${isAuthorized}`);
            } catch (e2) {
              console.log(`Error with isPublicKeyAuthorized: ${e2.message}`);
              
              try {
                isAuthorized = await relayContract.isSubscribed(keyBytes);
                methodUsed = "isSubscribed";
                console.log(`isSubscribed result: ${isAuthorized}`);
              } catch (e3) {
                console.log(`Error with isSubscribed: ${e3.message}`);
              }
            }
          }
          
          // If successful, return the result
          if (isAuthorized) {
            return res.json({
              success: true,
              message: `Key is authorized by IndividualRelay using method ${methodUsed}`,
              details: {
                key: pubKey,
                cleanedKey: keyData,
                isAuthorized,
                method: methodUsed,
                contractAddress: individualRelayAddress
              }
            });
          }
        } catch (error) {
          console.error(`General error testing IndividualRelay: ${error.message}`);
        }
      }
      
      // If direct test failed, use the normal verification function
      const { isAuthorized, authorizingRelay, reason } = await _verifyBlockchainAuth(pubKey);
      
      // Return detailed result
      res.json({
        success: isAuthorized,
        message: isAuthorized 
          ? `Key is authorized by relay at ${authorizingRelay}` 
          : `Key is not authorized: ${reason}`,
        details: {
          key: pubKey,
          cleanedKey: keyData,
          isAuthorized,
          authorizingRelay,
          reason
        }
      });
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error testing key authorization", {}, error.message));
    }
  });

  // ============ DID VERIFIER API ============ 
  // API - Check DID verifier status
  router.get("/did/status", authenticateRequestMiddleware, async (req, res) => {
    try {
      const didVerifier = AuthenticationManagerInstance.getDidVerifier ? AuthenticationManagerInstance.getDidVerifier() : null;
      
      if (!RELAY_CONFIG_PARAM.didVerifier.enabled || !didVerifier) {
        return res.status(503).json(_standardResponse(
          false, 
          "DID verifier services not available",
          {
            config: { 
              enabled: RELAY_CONFIG_PARAM.didVerifier.enabled, 
              contractAddress: RELAY_CONFIG_PARAM.didVerifier.contractAddress || "Not configured" 
            }
          },
          "DID verifier services not available"
        ));
      }
      
      res.json(_standardResponse(
        true, 
        "DID verifier status retrieved successfully",
        { 
          config: { 
            enabled: RELAY_CONFIG_PARAM.didVerifier.enabled, 
            contractAddress: RELAY_CONFIG_PARAM.didVerifier.contractAddress 
          } 
        }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error getting DID verifier status", {}, error.message));
    }
  });

  // API - Verify DID and get controller
  router.get("/did/verify/:did", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { did } = req.params;
      const didVerifier = AuthenticationManagerInstance.getDidVerifier ? AuthenticationManagerInstance.getDidVerifier() : null;
      
      if (!RELAY_CONFIG_PARAM.didVerifier.enabled || !didVerifier) {
        return res.status(503).json(_standardResponse(false, "DID verifier services not available", {}, "DID verifier services not available"));
      }
      
      const controller = await didVerifier.verifyDID(did);
      res.json(_standardResponse(
        true, 
        controller ? "DID verified successfully" : "DID verification failed",
        { did, isValid: !!controller, controller }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error verifying DID", {}, error.message));
    }
  });

  // API - Check if DID is controlled by a specific controller
  router.post("/did/check-controller", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { did, controller } = req.body;
      const didVerifier = AuthenticationManagerInstance.getDidVerifier ? AuthenticationManagerInstance.getDidVerifier() : null;
      
      if (!did || !controller) {
        return res.status(400).json(_standardResponse(false, "Missing required parameters", {}, "DID and controller are required"));
      }
      
      if (!RELAY_CONFIG_PARAM.didVerifier.enabled || !didVerifier) {
        return res.status(503).json(_standardResponse(false, "DID verifier services not available", {}, "DID verifier services not available"));
      }
      
      const isControlledBy = await didVerifier.isDIDControlledBy(did, controller);
      res.json(_standardResponse(
        true, 
        isControlledBy ? "DID is controlled by the specified controller" : "DID is not controlled by the specified controller",
        { did, controller, isControlledBy }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error checking DID controller", {}, error.message));
    }
  });

  // API - Authenticate with DID and signature
  router.post("/did/authenticate", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { did, message, signature } = req.body;
      const didVerifier = AuthenticationManagerInstance.getDidVerifier ? AuthenticationManagerInstance.getDidVerifier() : null;
      
      if (!did || !message || !signature) {
        return res.status(400).json(_standardResponse(false, "Missing required parameters", {}, "DID, message, and signature are required"));
      }
      
      if (!RELAY_CONFIG_PARAM.didVerifier.enabled || !didVerifier) {
        return res.status(503).json(_standardResponse(false, "DID verifier services not available", {}, "DID verifier services not available"));
      }
      
      const isAuthenticated = await didVerifier.authenticateWithDID(did, message, signature);
      res.json(_standardResponse(
        true, 
        isAuthenticated ? "DID authentication successful" : "DID authentication failed",
        { did, isAuthenticated }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error authenticating with DID", {}, error.message));
    }
  });

  // API - Register a new DID
  router.post("/did/register", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { did, controller } = req.body;
      const didVerifier = AuthenticationManagerInstance.getDidVerifier ? AuthenticationManagerInstance.getDidVerifier() : null;
      
      if (!did || !controller) {
        return res.status(400).json(_standardResponse(false, "Missing required parameters", {}, "DID and controller are required"));
      }
      
      if (!RELAY_CONFIG_PARAM.didVerifier.enabled || !didVerifier) {
        return res.status(503).json(_standardResponse(false, "DID verifier services not available", {}, "DID verifier services not available"));
      }
      
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json(_standardResponse(false, "Insufficient permissions", {}, "Only administrators can register DIDs"));
      }
      
      const registrationSuccess = await didVerifier.registerDID(did, controller);
      res.json(_standardResponse(
        registrationSuccess, 
        registrationSuccess ? "DID registered successfully" : "Failed to register DID",
        { did, controller }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error registering DID", {}, error.message));
    }
  });

  // API - Update DID verifier config
  router.post("/did/config", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { contractAddress, providerUrl, enabled } = req.body;
      
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json(_standardResponse(false, "Insufficient permissions", {}, "Only administrators can modify DID verifier configuration"));
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
        await reinitializeRelayCallback({ didVerifier: updatedDidConfigFragment });
      }

      const currentDidConfigResponse = {
        enabled: updatedDidConfigFragment.enabled !== undefined ? updatedDidConfigFragment.enabled : RELAY_CONFIG_PARAM.didVerifier.enabled,
        contractAddress: updatedDidConfigFragment.contractAddress || RELAY_CONFIG_PARAM.didVerifier.contractAddress,
        providerUrl: updatedDidConfigFragment.providerUrl || RELAY_CONFIG_PARAM.didVerifier.providerUrl,
      };

      res.json(_standardResponse(
        true, 
        didNeedsReinitialize ? "DID verifier configuration updated" : "No changes required",
        { config: currentDidConfigResponse }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error updating DID verifier configuration", {}, error.message));
    }
  });

  // API - RELAY AUTHENTICATION CONFIG
  router.post("/auth/config", authenticateRequestMiddleware, async (req, res) => {
    try {
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json(_standardResponse(false, "Insufficient permissions", {}, "Only administrators can modify authentication configuration"));
      }

      const { onchainMembership } = req.body;
      const previousConfig = { onchainMembership: RELAY_CONFIG_PARAM.relay.onchainMembership };
      let needsReinitialize = false;
      const updatedRelayConfigFragment = {};

      if (onchainMembership !== undefined && RELAY_CONFIG_PARAM.relay.onchainMembership !== onchainMembership) {
        updatedRelayConfigFragment.onchainMembership = onchainMembership;
        needsReinitialize = true; 
      }

      if (needsReinitialize) {
        await reinitializeRelayCallback(updatedRelayConfigFragment);
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

      res.json(_standardResponse(
        true, 
        needsReinitialize ? "Authentication configuration updated" : "No changes to authentication configuration",
        {
          previousConfig,
          currentConfig: { onchainMembership: currentOnchainMembership },
          authenticationHierarchy: authHierarchy
        }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error updating authentication configuration", {}, error.message));
    }
  });

  return router;
} 