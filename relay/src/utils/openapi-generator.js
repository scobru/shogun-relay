/**
 * OpenAPI Specification Generator
 * Generates a complete OpenAPI 3.0 specification for Shogun Relay API
 */

export function generateOpenAPISpec(baseUrl = 'http://localhost:8765') {
  return {
    openapi: "3.0.0",
    info: {
      title: "Shogun Relay API",
      version: "1.0.0",
      description: "Complete API documentation for Shogun Relay. Test endpoints directly from the interactive documentation.",
      contact: {
        name: "Shogun Project",
        url: "https://github.com/scobru/shogun"
      },
      license: {
        name: "MIT"
      }
    },
    servers: [
      {
        url: baseUrl,
        description: "Current Server"
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Bearer token authentication using ADMIN_PASSWORD"
        },
        tokenHeader: {
          type: "apiKey",
          in: "header",
          name: "token",
          description: "Custom token header authentication"
        },
        sessionToken: {
          type: "apiKey",
          in: "header",
          name: "X-Session-Token",
          description: "Session token after initial authentication"
        }
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string", example: "Error message" },
            reason: { type: "string", example: "Detailed reason (optional)" }
          }
        },
        HealthResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            status: { type: "string", example: "healthy" },
            timestamp: { type: "string", format: "date-time" },
            uptime: {
              type: "object",
              properties: {
                seconds: { type: "number" },
                hours: { type: "number" },
                formatted: { type: "string" }
              }
            },
            connections: {
              type: "object",
              properties: {
                active: { type: "number" },
                total: { type: "number" }
              }
            },
            memory: {
              type: "object",
              properties: {
                heapUsedMB: { type: "number" },
                heapTotalMB: { type: "number" },
                percent: { type: "number" },
                rssMB: { type: "number" }
              }
            },
            relay: {
              type: "object",
              properties: {
                pub: { type: "string" },
                name: { type: "string" },
                host: { type: "string" },
                port: { type: "number" }
              }
            },
            services: {
              type: "object",
              properties: {
                gun: { type: "string" },
                holster: { type: "string" },
                ipfs: { type: "string" }
              }
            }
          }
        },
        NetworkStats: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            stats: {
              type: "object",
              properties: {
                totalRelays: { type: "number" },
                activeRelays: { type: "number" },
                totalConnections: { type: "number" },
                totalStorageBytes: { type: "number" },
                totalPins: { type: "number" },
                totalActiveDeals: { type: "number" },
                totalActiveSubscriptions: { type: "number" },
                totalDealStorageMB: { type: "number" },
                totalSubscriptionStorageMB: { type: "number" },
                totalStorageMB: { type: "number" },
                totalStorageGB: { type: "string" }
              }
            },
            timestamp: { type: "number" },
            debug: {
              type: "object",
              properties: {
                relaysFound: { type: "number" },
                relaysWithPulse: { type: "number" },
                sources: { type: "object" }
              }
            }
          }
        },
        ReputationLeaderboard: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            count: { type: "number" },
            leaderboard: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  host: { type: "string" },
                  score: { type: "number" },
                  tier: { type: "string" },
                  uptimePercent: { type: "number" },
                  proofsSuccessful: { type: "number" },
                  proofsTotal: { type: "number" },
                  avgResponseTimeMs: { type: "number" },
                  calculatedScore: {
                    type: "object",
                    properties: {
                      total: { type: "number" },
                      tier: { type: "string" },
                      breakdown: { type: "object" }
                    }
                  }
                }
              }
            },
            filters: { type: "object" }
          }
        },
        DealsStats: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            stats: {
              type: "object",
              properties: {
                totalDeals: { type: "number" },
                activeDeals: { type: "number" },
                pendingDeals: { type: "number" },
                expiredDeals: { type: "number" },
                totalSizeMB: { type: "number" },
                totalRevenueUSDC: { type: "number" },
                byTier: { type: "object" }
              }
            },
            timestamp: { type: "number" }
          }
        },
        RegistryParams: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            chainId: { type: "number" },
            registryAddress: { type: "string" },
            params: {
              type: "object",
              properties: {
                minStake: { type: "string" },
                minStakeRaw: { type: "string" },
                unstakingDelay: { type: "number" },
                unstakingDelayDays: { type: "number" }
              }
            }
          }
        },
        OnChainRelays: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            chainId: { type: "number" },
            relayCount: { type: "number" },
            relays: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  address: { type: "string" },
                  owner: { type: "string" },
                  endpoint: { type: "string" },
                  gunPubKey: { type: "string" },
                  stakedAmount: { type: "string" },
                  stakedAmountRaw: { type: "string" },
                  status: { type: "string" },
                  registeredAt: { type: "string" },
                  updatedAt: { type: "string" },
                  totalSlashed: { type: "string" },
                  griefingRatio: { type: "number" }
                }
              }
            },
            registryParams: { $ref: "#/components/schemas/RegistryParams" }
          }
        },
        IPFSUploadResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            cid: { type: "string" },
            size: { type: "number" },
            path: { type: "string" }
          }
        },
        IPFSPinList: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            pins: {
              type: "array",
              items: { type: "string" }
            }
          }
        },
        X402Tiers: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            tiers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  priceUSDC: { type: "number" },
                  storageMB: { type: "number" },
                  priceDisplay: { type: "string" }
                }
              }
            },
            relayStorage: {
              type: "object",
              properties: {
                unlimited: { type: "boolean" },
                usedGB: { type: "number" },
                maxStorageGB: { type: "number" },
                remainingGB: { type: "number" },
                percentUsed: { type: "number" }
              }
            }
          }
        },
        X402Subscription: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            userAddress: { type: "string" },
            subscription: {
              type: "object",
              properties: {
                active: { type: "boolean" },
                tier: { type: "string" },
                expiresAt: { type: "number" },
                storageUsedMB: { type: "number" },
                storageLimitMB: { type: "number" }
              }
            }
          }
        }
      }
    },
    security: [
      { bearerAuth: [] },
      { tokenHeader: [] },
      { sessionToken: [] }
    ],
    paths: {
      "/health": {
        get: {
          tags: ["Health & Status"],
          summary: "Health check",
          description: "Health check endpoint with detailed system status",
          operationId: "getHealth",
          responses: {
            "200": {
              description: "System health status",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/HealthResponse" }
                }
              }
            }
          }
        }
      },
      "/api/v1/system/stats": {
        get: {
          tags: ["System"],
          summary: "System statistics",
          description: "Get detailed system statistics",
          operationId: "getSystemStats",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          responses: {
            "200": {
              description: "System statistics",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/stats": {
        get: {
          tags: ["Network"],
          summary: "Network statistics",
          description: "Network-wide statistics aggregated from all known relays",
          operationId: "getNetworkStats",
          responses: {
            "200": {
              description: "Network statistics",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/NetworkStats" }
                }
              }
            },
            "500": {
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/reputation": {
        get: {
          tags: ["Network"],
          summary: "Reputation leaderboard",
          description: "Get reputation scores for all relays in the network",
          operationId: "getReputationLeaderboard",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 50, minimum: 1, maximum: 100 },
              description: "Maximum number of results"
            },
            {
              name: "minScore",
              in: "query",
              schema: { type: "number", minimum: 0, maximum: 100 },
              description: "Minimum reputation score"
            },
            {
              name: "tier",
              in: "query",
              schema: { 
                type: "string",
                enum: ["platinum", "gold", "silver", "bronze", "basic", "average", "good", "excellent"]
              },
              description: "Filter by tier"
            }
          ],
          responses: {
            "200": {
              description: "Reputation leaderboard",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReputationLeaderboard" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/reputation/{host}": {
        get: {
          tags: ["Network"],
          summary: "Get relay reputation",
          description: "Get reputation score for a specific relay",
          operationId: "getRelayReputation",
          parameters: [
            {
              name: "host",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Relay hostname"
            }
          ],
          responses: {
            "200": {
              description: "Relay reputation",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            },
            "404": {
              description: "Relay not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/relays": {
        get: {
          tags: ["Network"],
          summary: "List active relays",
          description: "Get list of active relays in the network",
          operationId: "getNetworkRelays",
          responses: {
            "200": {
              description: "List of relays",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      relays: {
                        type: "array",
                        items: { type: "object" }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/best-relays": {
        get: {
          tags: ["Network"],
          summary: "Get best relays",
          description: "Get list of best performing relays based on reputation",
          operationId: "getBestRelays",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 10 },
              description: "Maximum number of relays to return"
            }
          ],
          responses: {
            "200": {
              description: "List of best relays",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/deals/stats": {
        get: {
          tags: ["Storage Deals"],
          summary: "Deals statistics",
          description: "Get aggregate statistics for all deals (network-wide)",
          operationId: "getDealsStats",
          parameters: [
            {
              name: "timeout",
              in: "query",
              schema: { type: "integer", default: 5000 },
              description: "Timeout in milliseconds"
            }
          ],
          responses: {
            "200": {
              description: "Deals statistics",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DealsStats" }
                }
              }
            },
            "503": {
              description: "Service unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/deals/pricing": {
        get: {
          tags: ["Storage Deals"],
          summary: "Get deal pricing",
          description: "Get pricing information for storage deals",
          operationId: "getDealPricing",
          parameters: [
            {
              name: "sizeMB",
              in: "query",
              required: true,
              schema: { type: "number" },
              description: "Size in MB"
            },
            {
              name: "durationDays",
              in: "query",
              required: true,
              schema: { type: "number" },
              description: "Duration in days"
            },
            {
              name: "tier",
              in: "query",
              schema: { type: "string", default: "standard" },
              description: "Storage tier"
            }
          ],
          responses: {
            "200": {
              description: "Pricing information",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/deals/by-cid/{cid}": {
        get: {
          tags: ["Storage Deals"],
          summary: "Get deals by CID",
          description: "Get all deals for a specific CID",
          operationId: "getDealsByCid",
          parameters: [
            {
              name: "cid",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "IPFS CID"
            }
          ],
          responses: {
            "200": {
              description: "List of deals",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/deals/by-client/{address}": {
        get: {
          tags: ["Storage Deals"],
          summary: "Get deals by client",
          description: "Get all deals for a specific client address",
          operationId: "getDealsByClient",
          parameters: [
            {
              name: "address",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Client Ethereum address"
            }
          ],
          responses: {
            "200": {
              description: "List of deals",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/deals/{dealId}": {
        get: {
          tags: ["Storage Deals"],
          summary: "Get deal details",
          description: "Get details for a specific deal",
          operationId: "getDeal",
          parameters: [
            {
              name: "dealId",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Deal ID"
            }
          ],
          responses: {
            "200": {
              description: "Deal details",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            },
            "404": {
              description: "Deal not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/registry/params": {
        get: {
          tags: ["Registry"],
          summary: "Registry parameters",
          description: "Get on-chain registry parameters",
          operationId: "getRegistryParams",
          responses: {
            "200": {
              description: "Registry parameters",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/RegistryParams" }
                }
              }
            }
          }
        }
      },
      "/api/v1/registry/status": {
        get: {
          tags: ["Registry"],
          summary: "Registry status",
          description: "Get registry connection status",
          operationId: "getRegistryStatus",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          responses: {
            "200": {
              description: "Registry status",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/onchain/relays": {
        get: {
          tags: ["Registry"],
          summary: "On-chain relays",
          description: "Get list of relays registered on-chain",
          operationId: "getOnChainRelays",
          parameters: [
            {
              name: "chainId",
              in: "query",
              required: true,
              schema: { type: "integer" },
              description: "Chain ID (e.g., 84532 for Base Sepolia)"
            }
          ],
          responses: {
            "200": {
              description: "List of on-chain relays",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OnChainRelays" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/onchain/relay/{address}": {
        get: {
          tags: ["Registry"],
          summary: "Get on-chain relay",
          description: "Get details for a specific on-chain relay",
          operationId: "getOnChainRelay",
          parameters: [
            {
              name: "address",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Relay Ethereum address"
            },
            {
              name: "chainId",
              in: "query",
              required: true,
              schema: { type: "integer" },
              description: "Chain ID"
            }
          ],
          responses: {
            "200": {
              description: "Relay details",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/ipfs/upload": {
        post: {
          tags: ["IPFS"],
          summary: "Upload file to IPFS",
          description: "Upload a file to IPFS",
          operationId: "uploadToIPFS",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: {
                      type: "string",
                      format: "binary",
                      description: "File to upload"
                    }
                  },
                  required: ["file"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "File uploaded successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IPFSUploadResponse" }
                }
              }
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/ipfs/cat/{cid}": {
        get: {
          tags: ["IPFS"],
          summary: "Get IPFS content",
          description: "Retrieve file content from IPFS by CID",
          operationId: "getIPFSContent",
          parameters: [
            {
              name: "cid",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "IPFS CID"
            },
            {
              name: "json",
              in: "query",
              schema: { type: "boolean" },
              description: "Return as JSON if content is JSON"
            }
          ],
          responses: {
            "200": {
              description: "File content",
              content: {
                "application/octet-stream": {
                  schema: { type: "string", format: "binary" }
                },
                "application/json": {
                  schema: { type: "object" }
                }
              }
            },
            "404": {
              description: "CID not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/ipfs/cat/{cid}/json": {
        get: {
          tags: ["IPFS"],
          summary: "Get IPFS content as JSON",
          description: "Retrieve IPFS content and parse as JSON",
          operationId: "getIPFSContentAsJSON",
          parameters: [
            {
              name: "cid",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "IPFS CID"
            }
          ],
          responses: {
            "200": {
              description: "JSON content",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/ipfs/pin/add": {
        post: {
          tags: ["IPFS"],
          summary: "Pin CID to IPFS",
          description: "Pin a CID to IPFS",
          operationId: "pinIPFS",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    cid: {
                      type: "string",
                      description: "IPFS CID to pin"
                    }
                  },
                  required: ["cid"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "CID pinned successfully",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/ipfs/pin/ls": {
        get: {
          tags: ["IPFS"],
          summary: "List pinned CIDs",
          description: "List all pinned CIDs",
          operationId: "listPinnedIPFS",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          responses: {
            "200": {
              description: "List of pinned CIDs",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IPFSPinList" }
                }
              }
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/ipfs/pin/rm": {
        post: {
          tags: ["IPFS"],
          summary: "Unpin CID from IPFS",
          description: "Remove a pin from IPFS",
          operationId: "unpinIPFS",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    cid: {
                      type: "string",
                      description: "IPFS CID to unpin"
                    }
                  },
                  required: ["cid"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "CID unpinned successfully",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/ipfs/status": {
        get: {
          tags: ["IPFS"],
          summary: "IPFS status",
          description: "Get IPFS node status and connection info",
          operationId: "getIPFSStatus",
          responses: {
            "200": {
              description: "IPFS status",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/x402/tiers": {
        get: {
          tags: ["x402 Subscriptions"],
          summary: "List subscription tiers",
          description: "Get available subscription tiers and pricing",
          operationId: "getX402Tiers",
          responses: {
            "200": {
              description: "List of tiers",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/X402Tiers" }
                }
              }
            }
          }
        }
      },
      "/api/v1/x402/subscription/{userAddress}": {
        get: {
          tags: ["x402 Subscriptions"],
          summary: "Get user subscription",
          description: "Get subscription status for a user",
          operationId: "getX402Subscription",
          parameters: [
            {
              name: "userAddress",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "User Ethereum address"
            }
          ],
          responses: {
            "200": {
              description: "Subscription status",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/X402Subscription" }
                }
              }
            }
          }
        }
      },
      "/api/v1/x402/can-upload/{userAddress}": {
        get: {
          tags: ["x402 Subscriptions"],
          summary: "Check upload permission",
          description: "Check if user can upload based on subscription",
          operationId: "checkX402UploadPermission",
          parameters: [
            {
              name: "userAddress",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "User Ethereum address"
            }
          ],
          responses: {
            "200": {
              description: "Upload permission status",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      canUpload: { type: "boolean" },
                      reason: { type: "string" }
                    }
                  }
                }
              }
            }
          }
        }
      },
      "/api/v1/x402/relay-storage": {
        get: {
          tags: ["x402 Subscriptions"],
          summary: "Get relay storage info",
          description: "Get storage usage information for the relay",
          operationId: "getX402RelayStorage",
          responses: {
            "200": {
              description: "Storage information",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      }
    }
  };
}
