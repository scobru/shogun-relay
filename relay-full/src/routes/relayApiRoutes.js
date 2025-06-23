import express from "express";
import { formatKeyForBlockchain } from "../managers/AuthenticationManager.js";
import { ethers } from "ethers";


export default function setupRelayApiRoutes(RELAY_CONFIG_PARAM, authenticateRequestMiddleware, shogunCoreInstance, reinitializeRelayCallback, SECRET_TOKEN_PARAM, AuthenticationManagerInstance) {
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
      // Check if onchain membership is enabled
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership) {
        return res.status(503).json(_standardResponse(
          false,
          "Relay services not available - onchain membership disabled",
          {
            config: {
              enabled: false,
              registryAddress: RELAY_CONFIG_PARAM.relay.registryAddress || "Not configured",
            }
          },
          "Onchain membership is disabled"
        ));
      }

      // Basic relay status - service is running
      res.json(_standardResponse(
        true,
        "Relay status retrieved successfully",
        {
          status: "active",
          timestamp: Date.now()
        }
      ));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error getting relay status", {}, error.message));
    }
  });

  // API - Get all relays
  router.get("/all", authenticateRequestMiddleware, async (req, res) => {
    try {
      if (!RELAY_CONFIG_PARAM.relay.onchainMembership) {
        return res.status(503).json(_standardResponse(false, "Relay services not available - onchain membership disabled", {}, "Onchain membership is disabled"));
      }
      
      // Return basic relay information without RelayVerifier
      const relays = [{
        address: RELAY_CONFIG_PARAM.relay.individualRelayAddress || "Not configured",
        registryAddress: RELAY_CONFIG_PARAM.relay.registryAddress || "Not configured",
        entryPointAddress: RELAY_CONFIG_PARAM.relay.entryPointAddress || "Not configured",
        status: "configured"
      }];
      
      res.json(_standardResponse(true, "Relays retrieved successfully", { relays }));
    } catch (error) {
      res.status(500).json(_standardResponse(false, "Error getting all relays", {}, error.message));
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

  return router;
} 