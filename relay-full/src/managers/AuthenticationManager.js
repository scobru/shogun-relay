// Configurazione globale
let config;
// Import express-basic-auth for optional HTTP Basic Auth layer
import basicAuth from "express-basic-auth";

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
 * Create HTTP Basic Auth middleware if credentials are configured
 * @returns {Function|null} Express middleware or null if not configured
 */
function createBasicAuthMiddleware() {
  const basicAuthUser = config?.BASIC_AUTH_USER || process.env.BASIC_AUTH_USER;
  const basicAuthPass =
    config?.BASIC_AUTH_PASSWORD || process.env.BASIC_AUTH_PASSWORD;

  if (!basicAuthUser || !basicAuthPass) {
    console.log(
      "[AuthenticationManager] Basic Auth not configured - skipping HTTP Basic Auth layer"
    );
    return null;
  }

  console.log("[AuthenticationManager] HTTP Basic Auth layer enabled");

  return basicAuth({
    users: { [basicAuthUser]: basicAuthPass },
    challenge: true,
    realm: "Shogun Relay API",
    unauthorizedResponse: (req) => {
      return {
        success: false,
        error: "HTTP Basic Authentication required",
        message: "Please provide valid Basic Auth credentials",
      };
    },
  });
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
   * Get HTTP Basic Auth middleware if configured
   * @returns {Function|null} Express middleware or null
   */
  getBasicAuthMiddleware: function () {
    return createBasicAuthMiddleware();
  },

  /**
   * Combined authentication middleware that supports both Basic Auth and Token Auth
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Function} next - Next middleware
   */
  authenticateRequest: async function (req, res, next) {
    if (!config.SECRET_TOKEN) return next();

    if (req.method === "OPTIONS") return next();

    // Check if Basic Auth is required and handle it first
    const basicAuthMiddleware = createBasicAuthMiddleware();
    if (basicAuthMiddleware) {
      return basicAuthMiddleware(req, res, (basicAuthErr) => {
        if (basicAuthErr) {
          return res.status(401).json({
            success: false,
            error: "HTTP Basic Authentication failed",
            message: "Invalid Basic Auth credentials",
          });
        }

        // Basic Auth passed, now check token auth
        return AuthenticationManager.checkTokenAuth(req, res, next);
      });
    }

    // No Basic Auth configured, go directly to token auth
    return AuthenticationManager.checkTokenAuth(req, res, next);
  },

  /**
   * Token-based authentication (existing logic)
   * @param {Object} req - Express request
   * @param {Object} res - Express response
   * @param {Function} next - Next middleware
   */
  checkTokenAuth: function (req, res, next) {
    const token = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.substring(7)
      : req.headers.authorization ||
        req.query.token ||
        req.body?.token ||
        req.headers.token;

    console.log("token", token);

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
        basicAuth: !!createBasicAuthMiddleware(), // Indicate if Basic Auth was also validated
      };
      return next();
    }

    // Se non è SECRET_TOKEN, rifiuta
    return res.status(403).json({
      success: false,
      error: "Invalid token.",
    });
  },
};

// Esporta AuthenticationManager e funzione di configurazione
export { AuthenticationManager, configure, formatKeyForBlockchain };
