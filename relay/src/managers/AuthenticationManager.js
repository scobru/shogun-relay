// Configurazione globale
let config

import { authLogger } from "../utils/logger.js";
/**
 * Utility function to properly format a GunDB public key for blockchain verification
 * @param {string} pubKey - The GunDB public key
 * @returns {string} - Properly formatted key with 0x prefix for ethers.js
 */
function formatKeyForBlockchain(pubKey) {
  if (!pubKey) return null;

  try {
    // Clean the key by removing the ~ prefix if present and anything after the period
    let cleanKey = pubKey;

    // Remove ~ prefix if present
    if (cleanKey.startsWith("~")) {
      cleanKey = cleanKey.substring(1);
    }

    // Remove everything after the first period (if any)
    const dotIndex = cleanKey.indexOf(".");
    if (dotIndex > 0) {
      cleanKey = cleanKey.substring(0, dotIndex);
    }

    // Convert from GunDB's URL-safe base64 to standard base64 with padding
    const base64Key = cleanKey.replace(/-/g, "+").replace(/_/g, "/");
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

    // Always add 0x prefix for ethers.js v6
    const hexWithPrefix = hexData.startsWith("0x") ? hexData : `0x${hexData}`;

    return hexWithPrefix;
  } catch (error) {
    console.error("Error formatting key for blockchain:", error);
    return null;
  }
}

/**
 * Configura il modulo di autenticazione
 */
function configure(configData) {
  if (!configData) throw new Error("Configuration object is required");

  if (!config) {
    config = configData; // Prima inizializzazione completa
  } else {
    // Aggiorna solo le proprietà fornite
    Object.assign(config, configData);
  }
}

/**
 * Modulo centrale di autenticazione
 */
const AuthenticationManager = {

  /**
   * Validazione messaggi GunDB
   */
  isValidGunMessage: function (msg) {  
    console.log("isValidGunMessage", msg)
    
    // Special case: GET requests without PUT data should be allowed unconditionally
    if (msg.get && (!msg.put || Object.keys(msg.put || {}).length === 0)) {
      console.log("⚠️ GET message with no PUT data allowed");
      return true;
    }

    // return if config.SECRET_TOKEN is not set
    if (!config.SECRET_TOKEN) {
      authLogger.info(`[AuthenticationManager] isValidGunMessage: no SECRET_TOKEN ✅`);
      return true;
    }

    // Check for token in multiple places
    const headerToken = msg.headers?.token;
    const authHeaderToken = msg.headers?.Authorization?.replace('Bearer ', '');
    const directToken = msg.token;
    const internalToken = msg._?.token;
    const optHeadersToken = msg.opt?.headers?.token;
    const optAuthHeaderToken = msg.opt?.headers?.Authorization?.replace('Bearer ', '');
    
    // Try to get URL token if available
    let urlToken = undefined;
    if (msg.url) {
      try {
        const url = new URL(msg.url);
        urlToken = url.searchParams.get('token');
      } catch (e) {
        console.error("Error parsing URL:", e);
      }
    }
    
    // Check if any of the tokens match the expected token
    const validTokens = [
      headerToken, 
      authHeaderToken,
      directToken, 
      internalToken, 
      optHeadersToken, 
      optAuthHeaderToken,
      urlToken
    ].filter(token => token === config.SECRET_TOKEN);
    
    // If any valid token was found, authentication passes
    if (validTokens.length > 0) {
      authLogger.info(`[AuthenticationManager] Valid token found ✅`);
      return true;
    }
    
    // Log all the places we checked for tokens
    authLogger.info(`[AuthenticationManager] ❌ Not valid token in any location:
      headers.token: ${headerToken}
      headers.Authorization: ${authHeaderToken}
      direct token: ${directToken}
      internal token: ${internalToken}
      opt.headers.token: ${optHeadersToken}
      opt.headers.Authorization: ${optAuthHeaderToken}
      URL token: ${urlToken}
     `, { service: "shogun-relay" });
    
    console.log("🔑 Gun message validation failed:", {
      msgType: msg.get ? "GET" : msg.put ? "PUT" : "OTHER",
      headerToken,
      authHeaderToken,
      directToken,
      internalToken,
      optHeadersToken,
      optAuthHeaderToken,
      urlToken
    });
    
    return false;
  },

  /**
   * Middleware HTTP per protezione route
   * Versione semplificata che verifica solo il SECRET_TOKEN
   */
  authenticateRequest: async function (req, res, next) {
    if(!config.SECRET_TOKEN) return next();
    
    if (req.method === "OPTIONS") return next();

    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.substring(7)
      : req.headers.authorization || req.query.token || req.body?.token;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required. Token missing.",
      });
    }

    // Verifica solo il SECRET_TOKEN
    if (token === config.SECRET_TOKEN) {
      req.auth = {
        valid: true,
        isSystemToken: true,
        userId: "system",
        permissions: ["admin"],
        source: "system-token",
      };
      return next();
    }

    // Se non è SECRET_TOKEN, rifiuta
    return res.status(403).json({
      success: false,
      error: "Invalid token.",
    });
  },

  // Expose the formatKeyForBlockchain utility function
  formatKeyForBlockchain,
};

// Esporta AuthenticationManager e funzione di configurazione
export { AuthenticationManager, configure, formatKeyForBlockchain };
