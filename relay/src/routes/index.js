import express from 'express';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';

// Importa i moduli delle routes
import contractsRouter from './contracts.js';
import uploadsRouter from './uploads.js';
import ipfsRouter from './ipfs.js';
import systemRouter from './system.js';
import notesRouter from './notes.js';
import debugRouter from './debug.js';
import authRouter from './auth.js';
import usersRouter from './users.js';
import subscriptionsRouter from './subscriptions.js';
import servicesRouter from './services.js';

// Rate limiting generale
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minuti
  max: 1000, // massimo 1000 richieste per IP
  message: { 
    success: false, 
    message: 'Troppe richieste. Riprova tra 15 minuti.', 
    data: null 
  }
});

export default (app) => {
  // Configurazione generale delle route
  const baseRoute = '/api/v1';
  
  // Applica rate limiting generale
  app.use(generalLimiter);
  
  // Route di autenticazione
  app.use(`${baseRoute}/auth`, authRouter);
  
  // Route per la gestione utenti
  app.use(`${baseRoute}/users`, usersRouter);
  
  // Route per i contratti smart contract
  app.use(`${baseRoute}/contracts`, contractsRouter);
  
  // Route per gli upload degli utenti
  app.use(`${baseRoute}/user-uploads`, uploadsRouter);
  
  // Route per IPFS
  app.use(`${baseRoute}/ipfs`, ipfsRouter);
  
  // Route di sistema e debug
  app.use(`${baseRoute}/system`, systemRouter);
  
  // Route per le note
  app.use(`${baseRoute}/notes`, notesRouter);
  
  // Route di debug
  app.use(`${baseRoute}/debug`, debugRouter);
  
  // Route per le sottoscrizioni
  app.use(`${baseRoute}/subscriptions`, subscriptionsRouter);
  
  // Route per i servizi
  app.use(`${baseRoute}/services`, servicesRouter);
  
  // Route legacy per compatibilità (solo quelle essenziali)
  app.use('/api/contracts', contractsRouter);
  app.use('/api/user-uploads', uploadsRouter);
  app.use('/api/ipfs', ipfsRouter);
  app.use('/api/system', systemRouter);
  app.use('/api/notes', notesRouter);
  app.use('/api/debug', debugRouter);
  app.use('/api/subscriptions', subscriptionsRouter);
  app.use('/api/services', servicesRouter);
  
  // --- ROUTE LEGACY ESSENZIALI DAL FILE ORIGINALE ---

  // IPFS API proxy legacy
  app.use(
    "/api/v0",
    (req, res, next) => {
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const token = bearerToken || customToken;

      if (token === process.env.ADMIN_PASSWORD) {
        next();
      } else {
        res.status(401).json({ success: false, error: "Unauthorized" });
      }
    },
    createProxyMiddleware({
      target: process.env.IPFS_API_URL || "http://127.0.0.1:5001",
      changeOrigin: true,
      pathRewrite: { "^/api/v0": "/api/v0" },
      onProxyReq: (proxyReq, req, res) => {
        console.log(`🔗 IPFS Proxy: ${req.method} ${req.path}`);
      },
      onProxyRes: (proxyRes, req, res) => {
        console.log(`✅ IPFS Proxy: ${proxyRes.statusCode} for ${req.path}`);
      },
      onError: (err, req, res) => {
        console.error(`❌ IPFS Proxy Error:`, err.message);
        res.status(500).json({ success: false, error: "IPFS proxy error" });
      },
    })
  );

  // IPFS custom API legacy
  app.post("/ipfs-api/:endpoint(*)", async (req, res) => {
    try {
      const { endpoint } = req.params;
      const ipfsUrl = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
      const url = `${ipfsUrl}/api/v0/${endpoint}`;

      console.log(`🔗 IPFS Custom API: POST ${url}`);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      });

      const data = await response.json();
      res.json(data);
    } catch (error) {
      console.error("❌ IPFS Custom API Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // IPFS upload legacy
  app.post("/ipfs-upload", async (req, res) => {
    try {
      const authHeader = req.headers["authorization"];
      const bearerToken = authHeader && authHeader.split(" ")[1];
      const customToken = req.headers["token"];
      const token = bearerToken || customToken;

      if (token !== process.env.ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, error: "Unauthorized" });
      }

      console.log("📤 IPFS Upload: Processing file upload");

      // Implementazione mock per ora
      res.json({
        success: true,
        hash: "QmMockHash123456789",
        size: 1024,
        message: "File uploaded successfully (mock)",
      });
    } catch (error) {
      console.error("❌ IPFS Upload Error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // IPFS status legacy
  app.get("/ipfs-status", async (req, res) => {
    try {
      console.log("📊 IPFS Status: Checking IPFS node status");

      const ipfsUrl = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
      const response = await fetch(`${ipfsUrl}/api/v0/version`);

      if (response.ok) {
        const data = await response.json();
        res.json({
          success: true,
          status: "connected",
          version: data.Version,
          apiUrl: ipfsUrl,
        });
      } else {
        res.json({
          success: false,
          status: "disconnected",
          error: "IPFS node not responding",
        });
      }
    } catch (error) {
      console.error("❌ IPFS Status Error:", error);
      res.json({
        success: false,
        status: "error",
        error: error.message,
      });
    }
  });

  // Health check legacy
  app.get("/health", (req, res) => {
    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Relay info legacy
  app.get("/api/relay-info", (req, res) => {
    res.json({
      success: true,
      relay: {
        name: process.env.RELAY_NAME || "shogun-relay",
        version: process.env.npm_package_version || "1.0.0",
        host: process.env.RELAY_HOST || "localhost",
        port: process.env.RELAY_PORT || 8765,
        uptime: process.uptime(),
      },
      timestamp: Date.now(),
    });
  });

  // Contract config legacy
  app.get("/api/contract-config", (req, res) => {
    try {
      const { DEPLOYMENTS } = require("shogun-contracts/deployments.js");
      const chainId = process.env.CHAIN_ID || "11155111";

      if (!DEPLOYMENTS[chainId]) {
        return res.status(404).json({
          success: false,
          error: `No deployments found for chain ID: ${chainId}`,
        });
      }

      const chainDeployments = DEPLOYMENTS[chainId];
      const contracts = {
        relayPaymentRouter:
          chainDeployments["Relay#RelayPaymentRouter"] || null,
        stealthPool: chainDeployments["Stealth#StealthPool"] || null,
        pairRecovery: chainDeployments["Recovery#PairRecovery"] || null,
        integrity: chainDeployments["Security#Integrity"] || null,
        paymentForwarder: chainDeployments["Stealth#PayamentForwarder"] || null,
        stealthKeyRegistry:
          chainDeployments["Stealth#StealthKeyRegistry"] || null,
        bridgeDex: chainDeployments["Bridge#BridgeDex"] || null,
      };

      res.json({
        success: true,
        chainId: chainId,
        contracts: contracts,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("❌ Contract Config Error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to load contract configuration",
        details: error.message,
      });
    }
  });

  // Contract status legacy
  app.get("/api/contract-status", async (req, res) => {
    try {
      const { ethers } = await import("ethers");
      const { DEPLOYMENTS } = await import("shogun-contracts/deployments.js");

      const chainId = process.env.CHAIN_ID || "11155111";
      const web3ProviderUrl = `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;

      if (!process.env.ALCHEMY_API_KEY) {
        return res.json({
          success: false,
          status: "not_configured",
          error: "ALCHEMY_API_KEY not configured",
        });
      }

      const provider = new ethers.JsonRpcProvider(web3ProviderUrl);
      const network = await provider.getNetwork();

      const chainDeployments = DEPLOYMENTS[chainId];
      const relayContract = chainDeployments?.["Relay#RelayPaymentRouter"];

      if (!relayContract) {
        return res.json({
          success: false,
          status: "contract_not_found",
          error: "Relay contract not found in deployments",
        });
      }

      const contract = new ethers.Contract(
        relayContract.address,
        relayContract.abi,
        provider
      );

      // Test basic contract interaction
      try {
        await contract.getFunction("owner")();
        
        res.json({
          success: true,
          status: "connected",
          network: {
            name: network.name,
            chainId: network.chainId.toString(),
          },
          contract: {
            address: relayContract.address,
            name: "RelayPaymentRouter",
            status: "accessible",
          },
        });
      } catch (contractError) {
        res.json({
          success: false,
          status: "contract_error",
          error: contractError.message,
          network: {
            name: network.name,
            chainId: network.chainId.toString(),
          },
          contract: {
            address: relayContract.address,
            name: "RelayPaymentRouter",
            status: "error",
          },
        });
      }
    } catch (error) {
      res.json({
        success: false,
        status: "error",
        error: error.message,
      });
    }
  });

  // --- FINE ROUTE LEGACY ---
  
  // Route di health check
  app.get(`${baseRoute}/health`, (req, res) => {
    res.json({
      success: true,
      message: 'Shogun Relay API is running',
      data: {
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime()
      }
    });
  });
  
  // Route di default per API non trovate
  app.use(`${baseRoute}/*`, (req, res) => {
    res.status(404).json({
      success: false,
      message: 'API endpoint non trovato',
      data: {
        path: req.path,
        method: req.method,
        availableEndpoints: [
          `${baseRoute}/auth/register`,
          `${baseRoute}/auth/login`,
          `${baseRoute}/auth/forgot`,
          `${baseRoute}/auth/reset`,
          `${baseRoute}/auth/change-password`,
          `${baseRoute}/users/profile`,
          `${baseRoute}/users/:pubkey`,
          `${baseRoute}/contracts`,
          `${baseRoute}/contracts/config`,
          `${baseRoute}/contracts/:contractName`,
          `${baseRoute}/user-uploads/:identifier`,
          `${baseRoute}/ipfs/upload`,
          `${baseRoute}/ipfs/status`,
          `${baseRoute}/ipfs/content/:cid`,
          `${baseRoute}/system/health`,
          `${baseRoute}/system/stats`,
          `${baseRoute}/notes`,
          `${baseRoute}/debug/mb-usage/:userAddress`,
          `${baseRoute}/subscriptions/subscription-status/:identifier`,
          `${baseRoute}/subscriptions/user-subscription-details/:userAddress`,
          `${baseRoute}/services/s3-stats`,
          `${baseRoute}/services/:service/restart`,
          `${baseRoute}/health`
        ]
      }
    });
  });
}; 