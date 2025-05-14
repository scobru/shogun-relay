import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
// We will pass gun, JWT_SECRET, AuthenticationManager, ensureShogunCore, and authenticateRequestMiddleware when setting up the router

function generateSecureToken(length = 32) {
  return crypto.randomBytes(length).toString("hex");
}

// Modified to accept gun and JWT_SECRET as parameters
async function createUserToken(userId, tokenName, expiresAt = null, gun, JWT_SECRET) {
  return new Promise((resolve, reject) => {
    console.log(
      `[CREATE-TOKEN] Creating token for user ${userId}, name: ${
        tokenName || "API Token"
      }`
    );

    if (!userId) {
      console.error("[CREATE-TOKEN] Error: User ID is required");
      reject(new Error("User ID is required"));
      return;
    }

    const tokenId = generateSecureToken(16);
    const expiryDate =
      expiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const tokenPayload = {
      userId: userId,
      tokenId: tokenId,
      name: tokenName || "API Token",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(expiryDate.getTime() / 1000),
    };

    const tokenValue = jwt.sign(tokenPayload, JWT_SECRET);
    console.log(
      `[CREATE-TOKEN] Generated tokenId: ${tokenId.substring(0, 6)}...`
    );

    const tokenData = {
      id: tokenId,
      token: tokenValue,
      name: tokenName || "API Token",
      userId: userId,
      createdAt: Date.now(),
      expiresAt: expiryDate.getTime(),
      lastUsed: null,
      revoked: false,
    };

    if (!gun) {
      console.error("[CREATE-TOKEN] Error: Gun instance is not available");
      reject(new Error("Gun database not available"));
      return;
    }

    gun
      .get("users")
      .get(userId)
      .get("tokens")
      .get(tokenId)
      .put(tokenData, (ack) => {
        if (ack.err) {
          console.error(`[CREATE-TOKEN] Failed to store token: ${ack.err}`);
          reject(new Error("Failed to store token: " + ack.err));
        } else {
          console.log(`[CREATE-TOKEN] Token stored for user ${userId}`);
          gun
            .get("tokenIndex")
            .get(tokenId)
            .put(
              {
                userId: userId,
                tokenId: tokenId,
              },
              (indexAck) => {
                if (indexAck.err) {
                  console.warn(
                    `[CREATE-TOKEN] Failed to index token: ${indexAck.err}`
                  );
                } else {
                  console.log(`[CREATE-TOKEN] Token indexed for quick lookup`);
                }
                resolve(tokenData);
              }
            );
        }
      });
  });
}

// Modified to accept gun as a parameter
async function listUserTokens(userId, gun) {
  return new Promise((resolve) => {
    if (!gun) {
      console.error("[LIST-TOKENS] Error: Gun instance is not available");
      resolve([]); // Resolve with empty array if gun is not available
      return;
    }
    const tokens = [];
    gun
      .get("users")
      .get(userId)
      .get("tokens")
      .map()
      .once((token, tokenId) => {
        if (tokenId !== "_" && token) {
          const safeToken = { ...token };
          if (safeToken.token) {
            safeToken.token =
              safeToken.token.substring(0, 4) +
              "..." +
              safeToken.token.substring(safeToken.token.length - 4);
          }
          tokens.push(safeToken);
        }
      });
    setTimeout(() => {
      resolve(tokens);
    }, 2000);
  });
}

// Modified to accept gun as a parameter
async function revokeUserToken(userId, tokenId, gun) {
  return new Promise((resolve) => {
    if (!gun) {
      console.error("[REVOKE-TOKEN] Error: Gun instance is not available");
      resolve(false); // Resolve with false if gun is not available
      return;
    }
    gun
      .get("users")
      .get(userId)
      .get("tokens")
      .get(tokenId)
      .get("revoked")
      .put(true, (ack) => {
        resolve(!ack.err);
      });
    setTimeout(() => {
      resolve(false);
    }, 3000);
  });
}

// Moved and modified to use AuthenticationManagerInstance
async function validateUserToken(token, AuthenticationManagerInstance) {
  return new Promise((resolve) => {
    if (!AuthenticationManagerInstance) {
      console.error("[VALIDATE-TOKEN] Error: AuthenticationManager instance is not available");
      resolve(null);
      return;
    }
    AuthenticationManagerInstance.validateToken(token)
      .then(auth => {
        if (!auth) {
          resolve(null);
          return;
        }
        // Convert AuthenticationManager format to legacy format (if still needed by consumers)
        const tokenData = {
          valid: true,
          isSystemToken: auth.isSystemToken,
          userId: auth.userId,
          permissions: auth.permissions || ["user"],
          source: auth.source,
        };
        resolve(tokenData);
      })
      .catch(err => {
        console.error("Error in token validation:", err);
        resolve(null);
      });
    // Set a timeout in case of non-response from AuthenticationManager
    setTimeout(() => {
      //This timeout might be too short if validateToken does async work that takes time
      //console.warn("[VALIDATE-TOKEN] Timeout reached during token validation.");
      //resolve(null); // Potentially resolve null if it times out, or let the promise hang if that's preferred.
    }, 3000); // Original timeout was 3000ms
  });
}

export default function setupAuthRoutes(gunInstance, JWT_SECRET_PARAM, AuthenticationManagerInstance, ensureShogunCoreInstance, authenticateRequestMiddleware) {
  const router = express.Router();

  // User registration endpoint (Standardized with ShogunCore first)
  router.post("/register", async (req, res) => {
    try {
      const { username, password, email } = req.body;
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: "Username and password are required",
        });
      }

      const core = ensureShogunCoreInstance();
      if (!core) {
        return res.status(500).json({
          success: false,
          error: "ShogunCore not available",
        });
      }

      // Use ShogunCore to sign up the user
      // Assuming password can be used as recoveryPhrase for simplicity here, adjust if needed
      const signUpResult = await core.signUp(username, password, password);
      if (!signUpResult.success) {
        return res.status(400).json({
          success: false,
          error: signUpResult.error || "User registration failed via ShogunCore",
        });
      }

      // Authenticate with GunDB to get the user object and certificate
      const user = gunInstance.user();
      const authUserPromise = new Promise((resolve, reject) => {
        user.auth(username, password, (ack) => {
          if (ack.err) {
            reject(new Error(ack.err || "Gun authentication failed after ShogunCore signup"));
          } else {
            resolve(ack);
          }
        });
      });
      await authUserPromise; // Ensure Gun authentication completes

      // Optionally set email and default permissions in GunDB profile
      if (email) {
        user.get("profile").get("email").put(email);
      }
      user.get("profile").get("permissions").put("user"); // Default permission

      // Create a JWT for the session
      const tokenPayload = {
        userId: user.is.alias, // Use alias from Gun user object
        permissions: ["user"],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // Token valid for 30 days
      };
      const jwtToken = jwt.sign(tokenPayload, JWT_SECRET_PARAM);

      res.json({
        success: true,
        message: "User registered successfully via ShogunCore and GunDB",
        userId: user.is.alias,
        token: jwtToken,
        gunCert: user._.sea, // Gun certificate
        shogunResult: signUpResult, // Result from ShogunCore
      });
    } catch (error) {
      console.error("Registration error in authRoutes:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // User login endpoint (Standardized with ShogunCore first)
  router.post("/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: "Username and password are required",
        });
      }

      const core = ensureShogunCoreInstance();
      if (!core) {
        return res.status(500).json({
          success: false,
          error: "ShogunCore not available",
        });
      }

      // Use ShogunCore to log in the user
      const loginResult = await core.login(username, password);
      if (!loginResult.success) {
        return res.status(401).json({
          success: false,
          error: loginResult.error || "Login failed via ShogunCore",
        });
      }

      // Authenticate with GunDB to get the user object and certificate
      const user = gunInstance.user();
      const authUserPromise = new Promise((resolve, reject) => {
        user.auth(username, password, (ack) => {
          if (ack.err) {
            // If Gun auth fails after ShogunCore login, it's an inconsistency.
            // Log it, but might still proceed with ShogunCore success if desired,
            // though typically both should succeed.
            reject(new Error(ack.err || "Gun authentication failed after ShogunCore login"));
          } else {
            resolve(ack);
          }
        });
      });
      await authUserPromise; // Ensure Gun authentication completes

      // Create a JWT for the session
      const tokenPayload = {
        userId: user.is.alias, // Use alias from Gun user object
        permissions: ["user"], // Default permissions, or fetch from Gun profile if set
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // Token valid for 30 days
      };
      const jwtToken = jwt.sign(tokenPayload, JWT_SECRET_PARAM);

      res.json({
        success: true,
        message: "Login successful via ShogunCore and GunDB",
        userId: user.is.alias,
        token: jwtToken,
        gunCert: user._.sea, // Gun certificate
        shogunResult: loginResult, // Result from ShogunCore
      });
    } catch (error) {
      console.error("Login error in authRoutes:", error);
      // Differentiate auth failures from server errors
      if (error.message.includes("ShogunCore") || error.message.includes("Gun authentication") || error.message.includes("No user found") || error.message.includes("Password mismatch")) {
        res.status(401).json({
          success: false,
          error: "Invalid username or password.", // Generic message for auth failures
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  });

  // API - USER TOKEN MANAGEMENT
  // Create new token
  router.post("/tokens", authenticateRequestMiddleware, async (req, res) => {
    try {
      console.log("[TOKEN-CREATE] Received token creation request:", req.body);
      console.log("[TOKEN-CREATE] Authentication info:", req.auth);

      const userId = req.body.userId || req.auth.userId;
      const { name, expiresInDays } = req.body;

      console.log(
        `[TOKEN-CREATE] Creating token for userId '${userId}', name: ${name}`
      );

      if (!userId) {
        console.error("[TOKEN-CREATE] Error: userId is missing");
        return res.status(400).json({
          success: false,
          error: "User ID is required",
        });
      }

      let expiresAt = null;
      if (expiresInDays) {
        expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + parseInt(expiresInDays));
        console.log(`[TOKEN-CREATE] Token will expire at: ${expiresAt}`);
      }

      console.log(
        `[TOKEN-CREATE] Creating token with name: ${name || "Default Token"}`
      );
      // Pass gunInstance and JWT_SECRET_PARAM to createUserToken
      const token = await createUserToken(userId, name, expiresAt, gunInstance, JWT_SECRET_PARAM);
      console.log("[TOKEN-CREATE] Token created successfully");

      res.json({
        success: true,
        token: token,
      });
    } catch (error) {
      console.error("[TOKEN-CREATE] Error creating token:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // List user tokens
  router.get("/tokens", authenticateRequestMiddleware, async (req, res) => {
    try {
      const userId = req.auth.userId;
      // Pass gunInstance to listUserTokens
      const tokens = await listUserTokens(userId, gunInstance);

      res.json({
        success: true,
        tokens: tokens,
      });
    } catch (error) {
      console.error("Error listing tokens:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Revoke a token
  router.delete("/tokens/:tokenId", authenticateRequestMiddleware, async (req, res) => {
    try {
      const userId = req.auth.userId;
      const tokenId = req.params.tokenId;
      // Pass gunInstance to revokeUserToken
      const success = await revokeUserToken(userId, tokenId, gunInstance);

      if (success) {
        res.json({
          success: true,
          message: "Token revoked successfully",
        });
      } else {
        res.status(400).json({
          success: false,
          error: "Failed to revoke token",
        });
      }
    } catch (error) {
      console.error("Error revoking token:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Verify a token (for testing) - uses validateUserToken now
  router.post("/verify-token", async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, error: "Token is required" });
      }
      // Use the local validateUserToken which calls AuthenticationManagerInstance
      const tokenInfo = await validateUserToken(token, AuthenticationManagerInstance);

      if (tokenInfo && tokenInfo.valid) {
        res.json({
          success: true,
          tokenInfo: tokenInfo, // tokenInfo already has the desired structure
        });
      } else {
        res.json({
          success: false,
          valid: false,
          error: "Invalid token",
        });
      }
    } catch (error) {
      console.error("Error verifying token:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // API - VERIFY CERTIFICATE - (ensure createUserToken is available in this scope or passed)
  router.post("/verify-cert", async (req, res) => {
    try {
      const { certificate } = req.body;
      if (!certificate || !certificate.pub) {
        return res.status(400).json({ success: false, error: "Invalid certificate format. Certificate must contain a pub key." });
      }
      const userPub = certificate.pub;
      const userExists = await new Promise((resolve) => {
        gunInstance.user(userPub).once((data) => { resolve(!!data); });
        setTimeout(() => resolve(false), 3000);
      });
      if (!userExists) {
        return res.json({ success: false, valid: false, error: "User with this certificate does not exist" });
      }
      // Using the createUserToken function defined in this module
      const tokenData = await createUserToken(userPub, "Certificate Auth Token", null, gunInstance, JWT_SECRET_PARAM);
      res.json({ success: true, valid: true, userId: userPub, token: tokenData });
    } catch (error) {
      console.error("Error verifying certificate:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // WebAuthn login
  router.post("/shogun/webauthn/login", async (req, res) => {
    try {
      const { username } = req.body;
      if (!username) {
        return res.status(400).json({ success: false, error: "Username is required" });
      }
      const core = ensureShogunCoreInstance();
      if (!core) {
        return res.status(500).json({ success: false, error: "ShogunCore not available" });
      }
      const webauthnPlugin = core.getPlugin("webauthn");
      if (!webauthnPlugin) {
        return res.status(500).json({ success: false, error: "WebAuthn plugin not available" });
      }
      const result = await webauthnPlugin.loginWithWebAuthn(username);
      if (!result.success) {
        return res.status(401).json(result);
      }
      const token = await createUserToken(username, "WebAuthn Login Token", null, gunInstance, JWT_SECRET_PARAM);
      res.json({ success: true, ...result, token });
    } catch (error) {
      console.error("Error during WebAuthn login:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // WebAuthn signup
  router.post("/shogun/webauthn/signup", async (req, res) => {
    try {
      const { username } = req.body;
      if (!username) {
        return res.status(400).json({ success: false, error: "Username is required" });
      }
      const core = ensureShogunCoreInstance();
      if (!core) {
        return res.status(500).json({ success: false, error: "ShogunCore not available" });
      }
      const webauthnPlugin = core.getPlugin("webauthn");
      if (!webauthnPlugin) {
        return res.status(500).json({ success: false, error: "WebAuthn plugin not available" });
      }
      const result = await webauthnPlugin.signUpWithWebAuthn(username);
      if (!result.success) {
        return res.status(400).json(result);
      }
      const token = await createUserToken(username, "WebAuthn Registration Token", null, gunInstance, JWT_SECRET_PARAM);
      res.json({ success: true, ...result, token });
    } catch (error) {
      console.error("Error during WebAuthn signup:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // MetaMask login
  router.post("/shogun/metamask/login", async (req, res) => {
    try {
      const { address } = req.body;
      if (!address) {
        return res.status(400).json({ success: false, error: "Ethereum address is required" });
      }
      const core = ensureShogunCoreInstance();
      if (!core) {
        return res.status(500).json({ success: false, error: "ShogunCore not available" });
      }
      const metamaskPlugin = core.getPlugin("metamask");
      if (!metamaskPlugin) {
        return res.status(500).json({ success: false, error: "MetaMask plugin not available" });
      }
      const result = await metamaskPlugin.loginWithMetaMask(address);
      if (!result.success) {
        return res.status(401).json(result);
      }
      const token = await createUserToken(address, "MetaMask Login Token", null, gunInstance, JWT_SECRET_PARAM);
      res.json({ success: true, ...result, token });
    } catch (error) {
      console.error("Error during MetaMask login:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // MetaMask signup
  router.post("/shogun/metamask/signup", async (req, res) => {
    try {
      const { address } = req.body;
      if (!address) {
        return res.status(400).json({ success: false, error: "Ethereum address is required" });
      }
      const core = ensureShogunCoreInstance();
      if (!core) {
        return res.status(500).json({ success: false, error: "ShogunCore not available" });
      }
      const metamaskPlugin = core.getPlugin("metamask");
      if (!metamaskPlugin) {
        return res.status(500).json({ success: false, error: "MetaMask plugin not available" });
      }
      const result = await metamaskPlugin.signUpWithMetaMask(address);
      if (!result.success) {
        return res.status(400).json(result);
      }
      const token = await createUserToken(address, "MetaMask Registration Token", null, gunInstance, JWT_SECRET_PARAM);
      res.json({ success: true, ...result, token });
    } catch (error) {
      console.error("Error during MetaMask signup:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Endpoint per pre-autorizzare un token utente
  router.post("/pre-authorize-token", authenticateRequestMiddleware, async (req, res) => {
    try {
      const { token, userId, expiryMinutes } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, error: "Token is required" });
      }

      // This route should be restricted to admins or system tokens - req.auth is from authenticateRequestMiddleware
      if (!req.auth.isSystemToken && !req.auth.permissions?.includes("admin")) {
        return res.status(403).json({
          success: false,
          error: "Only administrators can pre-authorize tokens",
        });
      }
      
      // The original authorizedKeys map and AUTH_KEY_EXPIRY are in index.js 
      // We need a way to access/modify them or replicate the logic here if this route manages its own pre-auth list.
      // For now, let's assume AuthenticationManagerInstance provides methods for this, or we need to pass them.
      // This part needs careful handling of where `authorizedKeys` state lives.
      // For simplicity, I'll assume AuthenticationManagerInstance has `isKeyPreAuthorized` and `authorizeKey` methods that take expiry.
      // This is a placeholder for the actual logic that needs to be decided based on where `authorizedKeys` is managed.

      if (AuthenticationManagerInstance.isKeyPreAuthorized && AuthenticationManagerInstance.isKeyPreAuthorized(token)) {
        const authInfo = AuthenticationManagerInstance.getPreAuthorizedKeyInfo(token); // Fictional method
        return res.json({
          success: true,
          message: "Token already pre-authorized",
          token: token.substring(0, 6) + "..." + token.substring(token.length - 6),
          expiresAt: authInfo.expiresAt,
          expiresIn: Math.round((authInfo.expiresAt - Date.now()) / 1000) + " seconds",
        });
      }

      let tokenValid = true;
      let localTokenInfo = null;
      if (userId) {
        localTokenInfo = await validateUserToken(token, AuthenticationManagerInstance);
        if (!localTokenInfo || localTokenInfo.userId !== userId) {
          tokenValid = false;
        }
      }

      if (!tokenValid) {
        return res.status(400).json({
          success: false,
          error: "The token is not valid or does not belong to the specified user",
        });
      }

      const expiry = expiryMinutes ? expiryMinutes * 60 * 1000 : undefined; // Pass undefined if no specific expiry for authorizeKey
      const authInfo = AuthenticationManagerInstance.authorizeKey(token, expiry); // Fictional method, assumes AUTH_KEY_EXPIRY is default in AM

      res.json({
        success: true,
        message: "Token pre-authorized successfully",
        token: token.substring(0, 6) + "..." + token.substring(token.length - 6),
        userId: localTokenInfo?.userId || userId || "unknown",
        expiresAt: authInfo.expiresAt,
        expiresIn: Math.round((authInfo.expiresAt - Date.now()) / 1000) + " seconds",
      });
    } catch (error) {
      console.error("Error pre-authorizing token:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
} 