import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const router = express.Router();

// --- Ollama Configuration ---
const OLLAMA_API_URL = process.env.OLLAMA_API_URL || "http://127.0.0.1:11434";

// --- Nexasdk Configuration ---
const NEXASDK_API_URL = process.env.NEXASDK_API_URL || "http://127.0.0.1:3000";

// Middleware di autenticazione
const tokenAuthMiddleware = (req, res, next) => {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers["authorization"];
  const bearerToken = authHeader && authHeader.split(" ")[1];

  // Check custom token header (for Gun/Wormhole compatibility)
  const customToken = req.headers["token"];

  // Accept either format
  const token = bearerToken || customToken;

  if (token === process.env.ADMIN_PASSWORD) {
    next();
  } else {
    console.log("Auth failed - Bearer:", bearerToken, "Custom:", customToken);
    res.status(401).json({ success: false, error: "Unauthorized" });
  }
};

// Ollama API Proxy - requires admin authentication
router.use(
  "/ollama",
  tokenAuthMiddleware,
  createProxyMiddleware({
    target: OLLAMA_API_URL,
    changeOrigin: true,
    pathRewrite: {
      "^/ollama": "", // Remove /ollama prefix when forwarding
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(
        `🔧 Ollama API Request: ${req.method} ${req.url} -> ${OLLAMA_API_URL}${req.url.replace("/ollama", "")}`
      );
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(
        `✅ Ollama API Response: ${req.method} ${req.url} -> Status: ${proxyRes.statusCode}`
      );
    },
    onError: (err, req, res) => {
      console.error("❌ Ollama Proxy Error:", err);
      res.status(500).json({
        success: false,
        error: "Proxy error",
        message: err.message,
      });
    },
  })
);

// Nexasdk API Proxy - requires admin authentication
router.use(
  "/nexasdk",
  tokenAuthMiddleware,
  createProxyMiddleware({
    target: NEXASDK_API_URL,
    changeOrigin: true,
    pathRewrite: {
      "^/nexasdk": "", // Remove /nexasdk prefix when forwarding
    },
    onProxyReq: (proxyReq, req, res) => {
      console.log(
        `🔧 Nexasdk API Request: ${req.method} ${req.url} -> ${NEXASDK_API_URL}${req.url.replace("/nexasdk", "")}`
      );
    },
    onProxyRes: (proxyRes, req, res) => {
      console.log(
        `✅ Nexasdk API Response: ${req.method} ${req.url} -> Status: ${proxyRes.statusCode}`
      );
    },
    onError: (err, req, res) => {
      console.error("❌ Nexasdk Proxy Error:", err);
      res.status(500).json({
        success: false,
        error: "Proxy error",
        message: err.message,
      });
    },
  })
);

// Ollama status endpoint
router.get("/ollama-status", async (req, res) => {
  try {
    const http = await import("http");
    const https = await import("https");
    const url = new URL(OLLAMA_API_URL);
    const isHttps = url.protocol === "https:";
    const client = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: "/api/tags",
      method: "GET",
      timeout: 5000,
    };

    const request = client.request(options, (response) => {
      let data = "";
      response.on("data", (chunk) => (data += chunk));
      response.on("end", () => {
        try {
          const models = JSON.parse(data);
          res.json({
            success: true,
            status: "active",
            service: "ollama",
            config: {
              apiUrl: OLLAMA_API_URL,
            },
            models: models.models ? models.models.length : 0,
            timestamp: Date.now(),
          });
        } catch (parseError) {
          res.json({
            success: true,
            status: "active",
            service: "ollama",
            config: {
              apiUrl: OLLAMA_API_URL,
            },
            timestamp: Date.now(),
          });
        }
      });
    });

    request.on("error", (err) => {
      res.json({
        success: false,
        status: "inactive",
        service: "ollama",
        error: err.message,
        config: {
          apiUrl: OLLAMA_API_URL,
        },
        timestamp: Date.now(),
      });
    });

    request.on("timeout", () => {
      request.destroy();
      res.json({
        success: false,
        status: "timeout",
        service: "ollama",
        error: "Connection timeout",
        config: {
          apiUrl: OLLAMA_API_URL,
        },
        timestamp: Date.now(),
      });
    });

    request.end();
  } catch (error) {
    res.json({
      success: false,
      status: "error",
      service: "ollama",
      error: error.message,
      config: {
        apiUrl: OLLAMA_API_URL,
      },
      timestamp: Date.now(),
    });
  }
});

// Nexasdk status endpoint
router.get("/nexasdk-status", async (req, res) => {
  try {
    const http = await import("http");
    const https = await import("https");
    const url = new URL(NEXASDK_API_URL);
    const isHttps = url.protocol === "https:";
    const client = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: "/",
      method: "GET",
      timeout: 5000,
    };

    const request = client.request(options, (response) => {
      res.json({
        success: true,
        status: response.statusCode < 500 ? "active" : "error",
        service: "nexasdk",
        config: {
          apiUrl: NEXASDK_API_URL,
        },
        httpStatus: response.statusCode,
        timestamp: Date.now(),
      });
      response.on("data", () => {}); // Consume response
      response.on("end", () => {});
    });

    request.on("error", (err) => {
      res.json({
        success: false,
        status: "inactive",
        service: "nexasdk",
        error: err.message,
        config: {
          apiUrl: NEXASDK_API_URL,
        },
        timestamp: Date.now(),
      });
    });

    request.on("timeout", () => {
      request.destroy();
      res.json({
        success: false,
        status: "timeout",
        service: "nexasdk",
        error: "Connection timeout",
        config: {
          apiUrl: NEXASDK_API_URL,
        },
        timestamp: Date.now(),
      });
    });

    request.end();
  } catch (error) {
    res.json({
      success: false,
      status: "error",
      service: "nexasdk",
      error: error.message,
      config: {
        apiUrl: NEXASDK_API_URL,
      },
      timestamp: Date.now(),
    });
  }
});

export default router;

