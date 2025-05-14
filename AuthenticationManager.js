import jwt from 'jsonwebtoken';

// These will be injected when the module is imported
let SECRET_TOKEN, JWT_SECRET, authorizedKeys = new Map(), AUTH_KEY_EXPIRY, RELAY_CONFIG, relayVerifier, allowedOrigins;

/**
 * Set global configuration values needed by the AuthenticationManager
 * @param {Object} config - Configuration object with required values
 */
function configure(config) {
  // Simple validation
  if (!config) throw new Error('Configuration object is required');
  
  SECRET_TOKEN = config.SECRET_TOKEN;
  JWT_SECRET = config.JWT_SECRET;
  authorizedKeys = config.authorizedKeys || new Map();
  AUTH_KEY_EXPIRY = config.AUTH_KEY_EXPIRY;
  
  // Ensure RELAY_CONFIG has proper boolean values
  if (config.RELAY_CONFIG) {
    RELAY_CONFIG = config.RELAY_CONFIG;
    
    // Convert string boolean values to actual booleans if needed
    if (RELAY_CONFIG.relay && typeof RELAY_CONFIG.relay.onchainMembership === 'string') {
      RELAY_CONFIG.relay.onchainMembership = RELAY_CONFIG.relay.onchainMembership === 'true';
    }
    
    if (RELAY_CONFIG.didVerifier && typeof RELAY_CONFIG.didVerifier.enabled === 'string') {
      RELAY_CONFIG.didVerifier.enabled = RELAY_CONFIG.didVerifier.enabled === 'true';
    }
  }
  
  relayVerifier = config.relayVerifier;
  allowedOrigins = config.allowedOrigins;
}

/**
 * Check if a public key is pre-authorized in our temporary cache
 * @param {string} pubKey - The public key to check
 * @returns {boolean} - True if the key is pre-authorized
 */
function isKeyPreAuthorized(pubKey) {
  if (!pubKey) return false;
  
  if (!authorizedKeys || !(authorizedKeys instanceof Map)) {
    console.warn('[PRE-AUTH] authorizedKeys is not properly initialized');
    return false;
  }

  const authInfo = authorizedKeys.get(pubKey);
  if (!authInfo) return false;

  // Check if the authorization has expired
  if (Date.now() > authInfo.expiresAt) {
    authorizedKeys.delete(pubKey);
    return false;
  }

  return true;
}

/**
 * Temporarily authorize a public key
 * @param {string} pubKey - The public key to authorize
 * @param {number} expiryMs - Optional expiry time in ms, defaults to AUTH_KEY_EXPIRY
 * @returns {Object} Auth info including expiry time
 */
function authorizeKey(pubKey, expiryMs = AUTH_KEY_EXPIRY) {
  if (!pubKey) throw new Error("Public key required for authorization");
  
  if (!authorizedKeys || !(authorizedKeys instanceof Map)) {
    console.warn('[PRE-AUTH] authorizedKeys is not properly initialized, creating new Map');
    authorizedKeys = new Map();
  }

  const authInfo = {
    pubKey,
    authorizedAt: Date.now(),
    expiresAt: Date.now() + expiryMs,
  };

  authorizedKeys.set(pubKey, authInfo);
  console.log(
    `[PRE-AUTH] Key authorized: ${pubKey.substring(0, 10)}... (expires in ${
      expiryMs / 1000
    }s)`
  );

  return authInfo;
}

/**
 * Verify a JWT token
 * @param {string} token - The JWT token to verify
 * @returns {Object|false} Decoded token payload if valid, false otherwise
 */
function verifyJWT(token) {
  if (!token) return false;
  
  // Development/debug check
  if (!JWT_SECRET) {
    console.warn(`[JWT-VERIFY] JWT_SECRET is ${JWT_SECRET === "" ? "empty" : "undefined"}. JWT verification will fail.`);
    return false;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    return decoded;
  } catch (err) {
    console.warn(`[JWT-VERIFY] Error verifying token: ${err.message}`);
    return false;
  }
}

/**
 * Helper function to extract token from various request sources
 * @param {Object} req - Express request object
 * @returns {string|null} The extracted token or null
 */
function getTokenFromRequest(req) {
  // Check various places where token might be present
  const authHeader = req.headers.authorization;
  const queryToken = req.query.token;
  const bodyToken = req.body && req.body.token;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7); // Remove 'Bearer ' from token
  } else if (authHeader) {
    return authHeader; // Token might be directly in header
  }

  return queryToken || bodyToken;
}

/**
 * Central authentication module that coordinates all authentication mechanisms
 */
const AuthenticationManager = {
  /**
   * Validates a token from any authentication source
   * @param {string} token - The token to validate
   * @param {Object} options - Options for validation
   * @returns {Promise<Object|null>} - User info if authenticated, null otherwise
   */
  validateToken: async function (token, options = {}) {
    if (!token) {
      console.debug('[AUTH] Validation failed: No token provided');
      return null;
    }
    
    // Debug mode - allow all tokens if specified
    if (process.env.NODE_ENV === "development" && process.env.AUTH_ALLOW_ALL === "true") {
      console.log('[AUTH] Development mode with AUTH_ALLOW_ALL - bypassing validation');
      return {
        valid: true,
        isSystemToken: false,
        userId: "dev-user",
        permissions: ["user", "admin"],
        source: "development",
      };
    }

    // Check system admin token first (highest priority)
    if (token === SECRET_TOKEN) {
      console.debug('[AUTH] Token validated: System admin token');
      return {
        valid: true,
        isSystemToken: true,
        userId: "system",
        permissions: ["admin"],
        source: "system-token",
      };
    }

    // Check blockchain membership if enabled (second highest priority)
    if (
      RELAY_CONFIG && 
      RELAY_CONFIG.relay && 
      RELAY_CONFIG.relay.onchainMembership &&
      options.pubKey &&
      relayVerifier
    ) {
      try {
        const isAuthorized = await relayVerifier.isPublicKeyAuthorized(
          RELAY_CONFIG.relay.registryAddress,
          options.pubKey
        );

        if (isAuthorized) {
          console.debug('[AUTH] Token validated: Blockchain membership');
          return {
            valid: true,
            isSystemToken: false,
            userId: null,
            permissions: ["user"],
            source: "blockchain",
          };
        }
      } catch (error) {
        console.error("Blockchain verification error:", error);
      }
    }

    // Check JWT token (third priority)
    const jwtData = verifyJWT(token);
    if (jwtData) {
      console.debug(`[AUTH] Token validated: JWT for user ${jwtData.userId || "unknown"}`);
      return {
        valid: true,
        isSystemToken: false,
        userId: jwtData.userId,
        permissions: jwtData.permissions || ["user"],
        source: "jwt",
      };
    }

    // Check pre-authorized keys (lowest priority)
    if (isKeyPreAuthorized(token)) {
      console.debug('[AUTH] Token validated: Pre-authorized key');
      return {
        valid: true,
        isSystemToken: false,
        userId: null, // Pre-authorized keys may not have a user ID
        permissions: ["user"],
        source: "pre-authorized",
      };
    }

    // No valid authentication found
    console.debug(`[AUTH] Token validation failed for token: ${token.substring(0, 10)}...`);
    return null;
  },

  /**
   * HTTP middleware for route protection
   */
  authenticateRequest: async function (req, res, next) {
    // Bypass OPTIONS preflight
    if (req.method === "OPTIONS") return next();

    const token = getTokenFromRequest(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required. Token missing.",
      });
    }

    const auth = await this.validateToken(token);
    if (!auth) {
      return res.status(403).json({
        success: false,
        error: "Invalid token.",
      });
    }

    // Store authentication info for route handlers
    req.auth = auth;
    next();
  },

  /**
   * GunDB message validation
   */
  isValidGunMessage: async function (msg) {
    // Short-circuit per messaggi non-PUT
    if (!msg.put || Object.keys(msg.put).length === 0) {
      console.log("[RELAY-AUTH] Message is not a PUT - ALLOWED");
      return true;
    }

    // Check for system SECRET_TOKEN (always works)
    if (
      msg &&
      msg.headers &&
      msg.headers.token &&
      msg.headers.token === SECRET_TOKEN
    ) {
      console.log("[RELAY-AUTH] Message authorized by admin token");
      return true;
    }

    if (
      msg &&
      msg.headers &&
      msg.headers.Authorization &&
      msg.headers.Authorization === "Bearer " + SECRET_TOKEN
    ) {
      console.log("[RELAY-AUTH] Message authorized by admin token");
      return true;
    }

    // Extract the public key from the message for blockchain verification
    let pubKey = null;
    const putKeys = Object.keys(msg.put);
    for (const key of putKeys) {
      if (key.startsWith("~")) {
        const dotIndex = key.indexOf(".");
        pubKey = dotIndex > 0 ? key.substring(1, dotIndex) : key.substring(1);
        break;
      }
    }

    if (!pubKey) {
      if (msg.user && msg.user.pub) {
        pubKey = msg.user.pub;
      } else if (msg.from && msg.from.pub) {
        pubKey = msg.from.pub;
      } else if (msg.pub) {
        pubKey = msg.pub;
      }
    }

    // Check blockchain membership if enabled and we have a pubKey
    if (RELAY_CONFIG.relay.onchainMembership && relayVerifier && pubKey) {
      try {
        const isAuthorized = await relayVerifier.isPublicKeyAuthorized(
          RELAY_CONFIG.relay.registryAddress,
          pubKey
        );
        
        if (isAuthorized) {
          console.log("[RELAY-AUTH] Message authorized by blockchain membership");
          return true;
        }
      } catch (error) {
        console.error("Blockchain verification error:", error);
      }
    }

    // Check for JWT token in headers
    if (msg && msg.headers) {
      // Check for JWT in the token field
      if (msg.headers.token) {
        const tokenData = await this.validateToken(msg.headers.token);
        if (tokenData) {
          console.log(
            `[RELAY-AUTH] Message authorized by valid JWT for user ${
              tokenData.userId || tokenData.username
            }`
          );
          return true;
        }
      }

      // Check for JWT in the Authorization header
      if (
        msg.headers.Authorization &&
        msg.headers.Authorization.startsWith("Bearer ")
      ) {
        const token = msg.headers.Authorization.substring(7); // Remove 'Bearer ' prefix
        const tokenData = await this.validateToken(token);
        if (tokenData) {
          console.log(
            `[RELAY-AUTH] Message authorized by valid JWT in Authorization header for user ${
              tokenData.userId || tokenData.username
            }`
          );
          return true;
        }
      }
    }

    // Check if key is pre-authorized (lowest priority)
    if (pubKey && isKeyPreAuthorized(pubKey)) {
      console.log(
        `[RELAY-AUTH] Key ${pubKey.substring(
          0,
          10
        )}... is pre-authorized - ALLOWED`
      );
      return true;
    }

    console.log(
      "[RELAY-AUTH] Message authentication failed - No valid authentication method found"
    );
    return false;
  },

  /**
   * WebSocket connection authentication
   */
  authenticateWebsocket: async function (req, socket, head) {
      try {
        const url = req.url;
        const origin = req.headers.origin;

        // Log upgrade request
        console.log(
          `WebSocket upgrade requested for: ${url} from origin: ${
            origin || "unknown"
          }`
        );
        
        // DEVELOPMENT MODE - Allow all connections
        if (process.env.NODE_ENV === "development") {
          console.log("Development mode - allowing all WebSocket connections");
          return; // Let the request continue to Gun
        }

        // Validate origin if present
        if (origin) {
          // In development mode, allow all origins
          if (process.env.NODE_ENV === "development") {
            console.log("Development mode - origin accepted:", origin);
          } else if (!allowedOrigins.includes(origin)) {
            console.warn(
              `WebSocket upgrade rejected: origin not allowed ${origin}`
            );
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
          }
        }

        // PRODUCTION MODE CHECKS
        // In production, require valid authentication
        let isAuthenticated = false;

        // Check for authentication token in the URL
        if (url && (url.includes("?token=") || url.includes("&token="))) {
          try {
            // Safer URL parsing without assuming localhost
            const tokenParam = url.split(/[\?&]token=/)[1];
            if (tokenParam) {
              // Extract the token up to the next parameter or end
              const token = tokenParam.split('&')[0];
              
              console.log(
                "Token found in URL:",
                token ? token.substring(0, 3) + "..." : "missing"
              );

              if (token) {
                // Check for blockchain authentication first if pubKey is available
                let pubKey = null;
                if (token.includes('.') || token.startsWith('@')) {
                  // This might be a pubKey, try to extract it
                  pubKey = token.startsWith('@') ? token.substring(1) : token;
                  const dotIndex = pubKey.indexOf('.');
                  if (dotIndex > 0) {
                    pubKey = pubKey.substring(0, dotIndex);
                  }
                }

                // Try blockchain auth first if enabled and we have a pubKey
                if (pubKey && RELAY_CONFIG.relay.onchainMembership && relayVerifier) {
                  try {
                    const isAuthorized = await relayVerifier.isPublicKeyAuthorized(
                      RELAY_CONFIG.relay.registryAddress, 
                      pubKey
                    );
                    
                    if (isAuthorized) {
                      console.log("Valid blockchain authentication for WebSocket");
                      isAuthenticated = true;
                    }
                  } catch (blockchainError) {
                    console.error("Blockchain verification error:", blockchainError);
                  }
                }

                // If not authenticated by blockchain, try other methods
                if (!isAuthenticated) {
                  // Use our validateToken directly
                  const tokenData = await this.validateToken(token);
                  isAuthenticated = !!tokenData;

                  if (isAuthenticated) {
                    console.log("Valid token authentication for WebSocket");
                  } else {
                    console.warn("Invalid token provided in URL");
                  }
                }
              }
            }
          } catch (e) {
            console.error(
              "Error parsing URL or validating token:",
              e.message
            );
          }
        }

        // If not authenticated in production, reject the connection
        if (!isAuthenticated) {
          console.warn(
            `WebSocket upgrade rejected: authentication required in production`
          );
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }

        // Authentication passed, handle the connection
        console.log(`Handling authenticated WebSocket connection for GunDB`);
        return; // Let Gun handle the upgrade
      } catch (error) {
        console.error("Error in websocketMiddleware:", error);
        socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
        socket.destroy();
      }
  },
};

// Export AuthenticationManager and utility functions
export { 
  AuthenticationManager, 
  isKeyPreAuthorized, 
  authorizeKey,
  verifyJWT,
  configure 
};
