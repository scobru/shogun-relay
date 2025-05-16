import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { AuthenticationManager } from "../managers/AuthenticationManager.js";
// We will pass gun, JWT_SECRET, AuthenticationManager, ensureShogunCore, and authenticateRequestMiddleware when setting up the router


export default function setupAuthRoutes(gunInstance, JWT_SECRET, AuthenticationManagerInstance, ensureShogunCoreInstance, authenticateRequestMiddleware) {
  const router = express.Router();

  // Registrazione utente (ShogunCore + GunDB)
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

      // Registrazione tramite ShogunCore
      const signUpResult = await core.signUp(username, password, password);
      if (!signUpResult.success) {
        return res.status(400).json({
          success: false,
          error: signUpResult.error || "User registration failed via ShogunCore",
        });
      }

      // Autenticazione con GunDB
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
      await authUserPromise;

      // Imposta email e permessi di default nel profilo GunDB
      if (email) {
        user.get("profile").get("email").put(email);
      }
      user.get("profile").get("permissions").put("user");

      // Crea JWT per la sessione
      const tokenPayload = {
        userId: user.is.alias,
        permissions: ["user"],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 giorni
      };
      const jwtToken = jwt.sign(tokenPayload, JWT_SECRET);

      res.json({
        success: true,
        message: "User registered successfully",
        userId: user.is.alias,
        token: jwtToken,
        gunCert: user._.sea,
        shogunResult: signUpResult,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Login utente (ShogunCore + GunDB)
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

      // Login tramite ShogunCore
      const loginResult = await core.login(username, password);
      if (!loginResult.success) {
        return res.status(401).json({
          success: false,
          error: loginResult.error || "Login failed via ShogunCore",
        });
      }

      // Autenticazione con GunDB
      const user = gunInstance.user();
      const authUserPromise = new Promise((resolve, reject) => {
        user.auth(username, password, (ack) => {
          if (ack.err) {
            reject(new Error(ack.err || "Gun authentication failed after ShogunCore login"));
          } else {
            resolve(ack);
          }
        });
      });
      await authUserPromise;

      // Crea JWT per la sessione
      const tokenPayload = {
        userId: user.is.alias,
        permissions: ["user"],
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60), // 30 giorni
      };
      const jwtToken = jwt.sign(tokenPayload, JWT_SECRET);

      res.json({
        success: true,
        message: "Login successful",
        userId: user.is.alias,
        token: jwtToken,
        gunCert: user._.sea,
        shogunResult: loginResult,
      });
    } catch (error) {
      // Differenzia errori di autenticazione da errori di server
      if (error.message.includes("ShogunCore") || 
          error.message.includes("Gun authentication") || 
          error.message.includes("No user found") || 
          error.message.includes("Password mismatch")) {
        res.status(401).json({
          success: false,
          error: "Invalid username or password.",
        });
      } else {
        res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    }
  });

  // Crea nuovo token
  router.post("/tokens", authenticateRequestMiddleware, async (req, res) => {
    try {
      const userId = req.body.userId || req.auth.userId;
      const { name, expiresInDays } = req.body;

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: "User ID is required",
        });
      }

      let expiresInMs = null;
      if (expiresInDays) {
        expiresInMs = parseInt(expiresInDays) * 24 * 60 * 60 * 1000;
      }

      // Usa AuthenticationManager per generare token
      const token = await AuthenticationManagerInstance.generateUserToken(
        userId, 
        name || "User Token", 
        expiresInMs, 
        true // checkBlockchain
      );

      // Salva il token nel database GunDB
      const saveResult = await AuthenticationManagerInstance.saveUserToken(
        gunInstance,
        userId,
        token,
        name || "User Token",
        expiresInMs ? Date.now() + expiresInMs : null
      );

      res.json({
        success: true,
        token: token,
        tokenInfo: {
          id: saveResult.tokenId,
          name: name || "User Token",
          createdAt: Date.now()
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Lista token utente
  router.get("/tokens", authenticateRequestMiddleware, async (req, res) => {
    try {
      const userId = req.auth.userId;
      // Usa AuthenticationManager per listare i token
      const tokens = await AuthenticationManagerInstance.listUserTokens(gunInstance, userId);

      res.json({
        success: true,
        tokens: tokens,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Revoca token
  router.delete("/tokens/:tokenId", authenticateRequestMiddleware, async (req, res) => {
    try {
      const userId = req.auth.userId;
      const tokenId = req.params.tokenId;
      // Usa AuthenticationManager per revocare il token
      const success = await AuthenticationManagerInstance.revokeUserToken(gunInstance, userId, tokenId);

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
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Verifica token
  router.post("/verify-token", async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, error: "Token is required" });
      }
      
      // Usa AuthenticationManager per validare il token
      const tokenInfo = await AuthenticationManagerInstance.validateToken(token);

      if (tokenInfo && tokenInfo.valid) {
        res.json({
          success: true,
          tokenInfo: tokenInfo,
        });
      } else {
        res.json({
          success: false,
          valid: false,
          error: "Invalid token",
        });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Verifica certificato
  router.post("/verify-cert", async (req, res) => {
    try {
      const { certificate } = req.body;
      if (!certificate || !certificate.pub) {
        return res.status(400).json({ 
          success: false, 
          error: "Invalid certificate format. Certificate must contain a pub key." 
        });
      }
      
      const userPub = certificate.pub;
      const userExists = await new Promise((resolve) => {
        gunInstance.user(userPub).once((data) => { resolve(!!data); });
        setTimeout(() => resolve(false), 3000);
      });
      
      if (!userExists) {
        return res.json({ 
          success: false, 
          valid: false, 
          error: "User with this certificate does not exist" 
        });
      }
      
      // Genera token per certificato
      const token = await AuthenticationManagerInstance.generateUserToken(
        userPub, 
        "Certificate Auth Token", 
        null, 
        true // checkBlockchain
      );
      
      res.json({ 
        success: true, 
        valid: true, 
        userId: userPub, 
        token: token 
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
} 