import express from 'express';
import http from 'http';
import FormData from 'form-data';
import multer from 'multer';

const router = express.Router();

// Configurazione IPFS
const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";
const IPFS_API_TOKEN = process.env.IPFS_API_TOKEN;
const IPFS_GATEWAY_URL = process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080";

// Configurazione multer per upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

// Funzione helper per ottenere il token JWT IPFS
function getIpfsJwtToken() {
  if (IPFS_API_TOKEN) {
    return IPFS_API_TOKEN;
  }
  return null;
}

// Funzione helper per ottenere l'header di autenticazione IPFS
function getIpfsAuthHeader() {
  const token = getIpfsJwtToken();
  if (token) {
    return `Bearer ${token}`;
  }
  return null;
}

// Custom IPFS API endpoints with better error handling
router.post("/api/:endpoint(*)", async (req, res) => {
  try {
    const endpoint = req.params.endpoint;
    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/${endpoint}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        console.log(`📡 IPFS API ${endpoint} raw response:`, data);

        try {
          // Try to parse as JSON
          const jsonData = JSON.parse(data);
          res.json({
            success: true,
            endpoint: endpoint,
            data: jsonData,
          });
        } catch (parseError) {
          // If not JSON, check if it's a structured response
          if (data.trim()) {
            // Try to clean the response
            const cleanData = data.replace(/^\uFEFF/, ""); // Remove BOM
            try {
              const jsonData = JSON.parse(cleanData);
              res.json({
                success: true,
                endpoint: endpoint,
                data: jsonData,
              });
            } catch (cleanParseError) {
              res.json({
                success: false,
                endpoint: endpoint,
                error: "Invalid JSON response",
                rawResponse: data,
                parseError: cleanParseError.message,
              });
            }
          } else {
            res.json({
              success: false,
              endpoint: endpoint,
              error: "Empty response",
              rawResponse: data,
            });
          }
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error(`❌ IPFS API ${endpoint} error:`, err);
      res.status(500).json({
        success: false,
        endpoint: endpoint,
        error: err.message,
      });
    });

    ipfsReq.setTimeout(10000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          endpoint: endpoint,
          error: "Request timeout",
        });
      }
    });

    ipfsReq.end();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// IPFS File Upload endpoint
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file provided",
      });
    }

    const formData = new FormData();
    formData.append("file", req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/add?wrap-with-directory=false",
      method: "POST",
      headers: {
        ...formData.getHeaders(),
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const authHeader = getIpfsAuthHeader();
    if (authHeader) {
      requestOptions.headers["Authorization"] = authHeader;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        console.log("📤 IPFS Upload raw response:", data);

        try {
          const lines = data.trim().split("\n");
          const results = lines.map((line) => JSON.parse(line));
          const fileResult =
            results.find((r) => r.Name === req.file.originalname) ||
            results[0];

          res.json({
            success: true,
            file: {
              name: req.file.originalname,
              size: req.file.size,
              mimetype: req.file.mimetype,
              hash: fileResult?.Hash,
              ipfsUrl: `${req.protocol}://${req.get("host")}/ipfs-content/${
                fileResult?.Hash
              }`,
              gatewayUrl: `${IPFS_GATEWAY_URL}/ipfs/${fileResult?.Hash}`,
              publicGateway: `https://ipfs.io/ipfs/${fileResult?.Hash}`,
            },
            ipfsResponse: results,
          });
        } catch (parseError) {
          console.error("Upload parse error:", parseError);
          res.status(500).json({
            success: false,
            error: "Failed to parse IPFS response",
            rawResponse: data,
            parseError: parseError.message,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error("❌ IPFS Upload error:", err);
      res.status(500).json({ success: false, error: err.message });
    });

    ipfsReq.setTimeout(30000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({ success: false, error: "Upload timeout" });
      }
    });

    formData.pipe(ipfsReq);
  } catch (error) {
    console.error("Upload error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Custom IPFS status endpoint
router.get("/status", async (req, res) => {
  try {
    // Create request options with authentication
    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/version",
      method: "POST", // IPFS API requires POST method
      headers: {
        "Content-Length": "0",
      },
    };

    // Add authentication if available
    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const testReq = http
      .request(requestOptions, (ipfsRes) => {
        let data = "";
        ipfsRes.on("data", (chunk) => (data += chunk));
        ipfsRes.on("end", () => {
          console.log("IPFS Raw Response:", data);

          try {
            // Try to parse as JSON first
            const versionInfo = JSON.parse(data);
            res.json({
              success: true,
              status: "connected",
              ipfs: {
                version: versionInfo.Version,
                commit: versionInfo.Commit,
                repo: versionInfo.Repo,
                system: versionInfo.System,
                golang: versionInfo.Golang,
              },
              endpoints: {
                api: IPFS_API_URL,
                gateway: IPFS_GATEWAY_URL,
              },
            });
          } catch (parseError) {
            // If not JSON, check if it's Kubo text response
            if (data.includes("Kubo RPC")) {
              // Parse Kubo text response
              const lines = data.split("\n");
              let version = "unknown";

              for (const line of lines) {
                if (line.includes("Kubo version:")) {
                  version = line.replace("Kubo version:", "").trim();
                  break;
                }
              }

              res.json({
                success: true,
                status: "connected",
                ipfs: {
                  version: version,
                  type: "Kubo RPC",
                },
                endpoints: {
                  api: IPFS_API_URL,
                  gateway: IPFS_GATEWAY_URL,
                },
              });
            } else {
              res.json({
                success: false,
                status: "unknown",
                error: "Unable to parse IPFS response",
                rawResponse: data,
              });
            }
          }
        });
      })
      .on("error", (err) => {
        console.error("❌ IPFS Status error:", err);
        res.json({
          success: false,
          status: "disconnected",
          error: err.message,
          endpoints: {
            api: IPFS_API_URL,
            gateway: IPFS_GATEWAY_URL,
          },
        });
      });

    testReq.setTimeout(5000, () => {
      testReq.destroy();
      if (!res.headersSent) {
        res.json({
          success: false,
          status: "timeout",
          error: "IPFS connection timeout",
          endpoints: {
            api: IPFS_API_URL,
            gateway: IPFS_GATEWAY_URL,
          },
        });
      }
    });

    testReq.end();
  } catch (error) {
    console.error("❌ IPFS Status error:", error);
    res.status(500).json({
      success: false,
      status: "error",
      error: error.message,
    });
  }
});

// IPFS Content endpoint
router.get("/content/:cid", async (req, res) => {
  try {
    const { cid } = req.params;
    console.log(`📄 IPFS Content request for CID: ${cid}`);

    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${cid}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      // Set appropriate headers
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${cid}"`);
      res.setHeader("Cache-Control", "public, max-age=31536000"); // 1 year cache

      // Pipe the response directly
      ipfsRes.pipe(res);

      ipfsRes.on("error", (err) => {
        console.error(`❌ IPFS Content error for ${cid}:`, err);
        if (!res.headersSent) {
          res.status(500).json({
            success: false,
            error: err.message,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error(`❌ IPFS Content request error for ${cid}:`, err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: err.message,
        });
      }
    });

    ipfsReq.setTimeout(30000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: "Content retrieval timeout",
        });
      }
    });

    ipfsReq.end();
  } catch (error) {
    console.error(`❌ IPFS Content error for ${req.params.cid}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// IPFS Content JSON endpoint
router.get("/content-json/:cid", async (req, res) => {
  try {
    const { cid } = req.params;
    console.log(`📄 IPFS Content JSON request for CID: ${cid}`);

    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${cid}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        try {
          // Try to parse as JSON
          const jsonData = JSON.parse(data);
          res.json({
            success: true,
            cid: cid,
            data: jsonData,
          });
        } catch (parseError) {
          // If not JSON, return as text
          res.json({
            success: true,
            cid: cid,
            data: data,
            type: "text",
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error(`❌ IPFS Content JSON error for ${cid}:`, err);
      res.status(500).json({
        success: false,
        error: err.message,
      });
    });

    ipfsReq.setTimeout(30000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: "Content retrieval timeout",
        });
      }
    });

    ipfsReq.end();
  } catch (error) {
    console.error(`❌ IPFS Content JSON error for ${req.params.cid}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// IPFS Pins endpoints
router.post("/pins/add", async (req, res) => {
  try {
    const { cid } = req.body;
    if (!cid) {
      return res.status(400).json({
        success: false,
        error: "CID is required",
      });
    }

    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/pin/add?arg=${cid}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        try {
          const result = JSON.parse(data);
          res.json({
            success: true,
            message: "CID pinned successfully",
            result: result,
          });
        } catch (parseError) {
          res.status(500).json({
            success: false,
            error: "Failed to parse IPFS response",
            rawResponse: data,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error("❌ IPFS Pin add error:", err);
      res.status(500).json({
        success: false,
        error: err.message,
      });
    });

    ipfsReq.end();
  } catch (error) {
    console.error("❌ IPFS Pin add error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/pins/rm", async (req, res) => {
  try {
    const { cid } = req.body;
    if (!cid) {
      return res.status(400).json({
        success: false,
        error: "CID is required",
      });
    }

    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/pin/rm?arg=${cid}`,
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        try {
          const result = JSON.parse(data);
          res.json({
            success: true,
            message: "CID unpinned successfully",
            result: result,
          });
        } catch (parseError) {
          res.status(500).json({
            success: false,
            error: "Failed to parse IPFS response",
            rawResponse: data,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error("❌ IPFS Pin rm error:", err);
      res.status(500).json({
        success: false,
        error: err.message,
      });
    });

    ipfsReq.end();
  } catch (error) {
    console.error("❌ IPFS Pin rm error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

router.post("/pins/ls", async (req, res) => {
  try {
    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/pin/ls",
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        try {
          const result = JSON.parse(data);
          res.json({
            success: true,
            pins: result.Keys || {},
            count: Object.keys(result.Keys || {}).length,
          });
        } catch (parseError) {
          res.status(500).json({
            success: false,
            error: "Failed to parse IPFS response",
            rawResponse: data,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error("❌ IPFS Pin ls error:", err);
      res.status(500).json({
        success: false,
        error: err.message,
      });
    });

    ipfsReq.end();
  } catch (error) {
    console.error("❌ IPFS Pin ls error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// IPFS Repo GC endpoint
router.post("/repo/gc", async (req, res) => {
  try {
    const requestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: "/api/v0/repo/gc",
      method: "POST",
      headers: {
        "Content-Length": "0",
      },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      let data = "";
      ipfsRes.on("data", (chunk) => (data += chunk));
      ipfsRes.on("end", () => {
        try {
          const lines = data.trim().split("\n");
          const results = lines.map((line) => {
            try {
              return JSON.parse(line);
            } catch {
              return line;
            }
          });

          res.json({
            success: true,
            message: "Garbage collection completed",
            results: results,
          });
        } catch (parseError) {
          res.status(500).json({
            success: false,
            error: "Failed to parse IPFS response",
            rawResponse: data,
          });
        }
      });
    });

    ipfsReq.on("error", (err) => {
      console.error("❌ IPFS Repo GC error:", err);
      res.status(500).json({
        success: false,
        error: err.message,
      });
    });

    ipfsReq.setTimeout(60000, () => {
      ipfsReq.destroy();
      if (!res.headersSent) {
        res.status(408).json({
          success: false,
          error: "Garbage collection timeout",
        });
      }
    });

    ipfsReq.end();
  } catch (error) {
    console.error("❌ IPFS Repo GC error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router; 