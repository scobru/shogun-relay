import express from "express";
import { formatKeyForBlockchain } from "../managers/AuthenticationManager.js";
import { ethers } from "ethers";


export default function setupRelayApiRoutes(RELAY_CONFIG_PARAM, getRelayVerifierInstance, authenticateRequestMiddleware, shogunCoreInstance, reinitializeRelayCallback, SECRET_TOKEN_PARAM, AuthenticationManagerInstance) {
  const router = express.Router();

  /**
   * Clean and standardize a public key
   * @param {string} pubKey - Public key to clean
   * @returns {Object} Cleaned key data
   */
  const _cleanPublicKey = (pubKey) => {
    if (!pubKey) {
      return { original: "", cleaned: "", hex: "" };
    }
    
    // Remove @ prefix if present
    let cleaned = pubKey.startsWith('@') ? pubKey.substring(1) : pubKey;
    
    // Get the key part (before any period if present)
    const dotIndex = cleaned.indexOf('.');
    cleaned = dotIndex > 0 ? cleaned.substring(0, dotIndex) : cleaned;
    
    // Format the key for blockchain interaction
    const blockchainFormatted = formatKeyForBlockchain(pubKey);
    
    // Get the hex part without 0x prefix for legacy compatibility
    const hex = blockchainFormatted ? blockchainFormatted.substring(2) : "";
    
    return {
      original: pubKey,
      cleaned,
      hex
    };
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

  // API - Update relay config
  router.post("/update-relay-config", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { registryAddress, providerUrl, enabled } = req.body;
      
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json({
          success: false,
          error: "Insufficient permissions",
          message: "Only administrators can modify relay configuration"
        });
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

      return res.json({
        success: true, 
        message: needsReinitialize ? "Relay configuration updated" : "No changes required",
        config: currentConfigResponse
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error updating relay configuration"
      });
    }
  });

  // Legacy support for backward compatibility
  router.post("/config", authenticateRequestMiddleware, async (req, res) => {
    // Redirect to the new endpoint
    try {
      const { registryAddress, providerUrl, enabled } = req.body;
      
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json({
          success: false,
          error: "Insufficient permissions",
          message: "Only administrators can modify relay configuration"
        });
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

      return res.json({
        success: true, 
        message: needsReinitialize ? "Relay configuration updated (legacy endpoint)" : "No changes required",
        config: currentConfigResponse
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error updating relay configuration"
      });
    }
  });

  // API - RELAY AUTHENTICATION CONFIG
  router.post("/auth/update-config", authenticateRequestMiddleware, async (req, res) => {
    try {
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json({
          success: false,
          error: "Insufficient permissions",
          message: "Only administrators can modify authentication configuration"
        });
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
        authHierarchy.push("3. PRE_AUTHORIZED_KEYS (lowest priority)");
      } else {
        authHierarchy.push("2. PRE_AUTHORIZED_KEYS (lowest priority)");
      }

      return res.json({
        success: true, 
        message: needsReinitialize ? "Authentication configuration updated" : "No changes to authentication configuration",
        previousConfig,
        currentConfig: { onchainMembership: currentOnchainMembership },
        authenticationHierarchy: authHierarchy
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error updating authentication configuration"
      });
    }
  });

  // Legacy support for backward compatibility
  router.post("/auth/config", authenticateRequestMiddleware, async (req, res) => {
    try {
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json({
          success: false,
          error: "Insufficient permissions",
          message: "Only administrators can modify authentication configuration"
        });
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
        authHierarchy.push("3. PRE_AUTHORIZED_KEYS (lowest priority)");
      } else {
        authHierarchy.push("2. PRE_AUTHORIZED_KEYS (lowest priority)");
      }

      return res.json({
        success: true, 
        message: needsReinitialize ? "Authentication configuration updated (legacy endpoint)" : "No changes to authentication configuration",
        previousConfig,
        currentConfig: { onchainMembership: currentOnchainMembership },
        authenticationHierarchy: authHierarchy
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error.message,
        message: "Error updating authentication configuration"
      });
    }
  });


  return router;
} 