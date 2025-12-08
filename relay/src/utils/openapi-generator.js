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
      },
      "/api/v1/x402/payment-requirements/{tier}": {
        get: {
          tags: ["x402 Subscriptions"],
          summary: "Get payment requirements for tier",
          description: "Get x402 payment requirements for a specific subscription tier",
          operationId: "getX402PaymentRequirements",
          parameters: [
            {
              name: "tier",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Subscription tier"
            }
          ],
          responses: {
            "200": {
              description: "Payment requirements",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/x402/subscribe": {
        post: {
          tags: ["x402 Subscriptions"],
          summary: "Purchase or renew subscription",
          description: "Purchase or renew a subscription with x402 payment",
          operationId: "subscribeX402",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    userAddress: { type: "string" },
                    tier: { type: "string" },
                    payment: { type: "object" }
                  },
                  required: ["userAddress", "tier"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Subscription activated",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            },
            "402": {
              description: "Payment required",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/x402/storage/{userAddress}": {
        get: {
          tags: ["x402 Subscriptions"],
          summary: "Get user storage usage",
          description: "Get real storage usage by verifying IPFS pins",
          operationId: "getX402Storage",
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
              description: "Storage usage information",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/x402/config": {
        get: {
          tags: ["x402 Subscriptions"],
          summary: "Get x402 configuration",
          description: "Get x402 configuration (public info only)",
          operationId: "getX402Config",
          responses: {
            "200": {
              description: "Configuration information",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/deals/create": {
        post: {
          tags: ["Storage Deals"],
          summary: "Create storage deal",
          description: "Create a new storage deal. Returns payment requirements.",
          operationId: "createDeal",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    cid: { type: "string" },
                    clientAddress: { type: "string" },
                    sizeMB: { type: "number" },
                    durationDays: { type: "number" },
                    tier: { type: "string" },
                    relayAddress: { type: "string" }
                  },
                  required: ["cid", "clientAddress", "sizeMB", "durationDays"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Deal created",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/deals/{dealId}/activate": {
        post: {
          tags: ["Storage Deals"],
          summary: "Activate deal",
          description: "Activate a deal after payment",
          operationId: "activateDeal",
          parameters: [
            {
              name: "dealId",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    paymentTxHash: { type: "string" },
                    clientStake: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Deal activated",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/deals/{dealId}/renew": {
        post: {
          tags: ["Storage Deals"],
          summary: "Renew deal",
          description: "Renew an existing deal",
          operationId: "renewDeal",
          parameters: [
            {
              name: "dealId",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    additionalDays: { type: "number" },
                    payment: { type: "object" }
                  },
                  required: ["additionalDays"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Deal renewed",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            },
            "402": {
              description: "Payment required",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/deals/{dealId}/terminate": {
        post: {
          tags: ["Storage Deals"],
          summary: "Terminate deal",
          description: "Terminate a storage deal",
          operationId: "terminateDeal",
          parameters: [
            {
              name: "dealId",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "Deal terminated",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/deals/{dealId}/verify": {
        get: {
          tags: ["Storage Deals"],
          summary: "Verify deal storage",
          description: "Verify that a deal's file is actually stored on the relay",
          operationId: "verifyDeal",
          parameters: [
            {
              name: "dealId",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "Verification result",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/deals/overhead": {
        get: {
          tags: ["Storage Deals"],
          summary: "Calculate erasure coding overhead",
          description: "Calculate erasure coding overhead for a file size",
          operationId: "getDealOverhead",
          parameters: [
            {
              name: "sizeMB",
              in: "query",
              schema: { type: "number" },
              description: "File size in MB"
            }
          ],
          responses: {
            "200": {
              description: "Overhead calculation",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/deals/leaderboard": {
        get: {
          tags: ["Storage Deals"],
          summary: "Deals leaderboard",
          description: "Get leaderboard of relays sorted by deal statistics",
          operationId: "getDealsLeaderboard",
          parameters: [
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 50 }
            },
            {
              name: "timeout",
              in: "query",
              schema: { type: "integer", default: 5000 }
            }
          ],
          responses: {
            "200": {
              description: "Leaderboard",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/relay/{host}": {
        get: {
          tags: ["Network"],
          summary: "Get relay details",
          description: "Get details for a specific relay",
          operationId: "getNetworkRelay",
          parameters: [
            {
              name: "host",
              in: "path",
              required: true,
              schema: { type: "string" }
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
      "/api/v1/network/proof/{cid}": {
        get: {
          tags: ["Network"],
          summary: "Generate storage proof",
          description: "Generate a storage proof for a CID",
          operationId: "getNetworkProof",
          parameters: [
            {
              name: "cid",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "challenge",
              in: "query",
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "Storage proof",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/verify-proof": {
        post: {
          tags: ["Network"],
          summary: "Verify storage proof",
          description: "Verify a storage proof from another relay",
          operationId: "verifyNetworkProof",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    proof: { type: "object" }
                  },
                  required: ["proof"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Verification result",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/pin-request": {
        get: {
          tags: ["Network"],
          summary: "Get pin request info",
          description: "Get information about pin requests endpoint",
          operationId: "getPinRequestInfo",
          responses: {
            "200": {
              description: "Pin request information",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        },
        post: {
          tags: ["Network"],
          summary: "Request pin",
          description: "Request other relays to pin a CID",
          operationId: "requestPin",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    cid: { type: "string" },
                    replicationFactor: { type: "integer", default: 3 },
                    priority: { type: "string", default: "normal" }
                  },
                  required: ["cid"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Pin request published",
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
      "/api/v1/network/pin-requests": {
        get: {
          tags: ["Network"],
          summary: "List pin requests",
          description: "List pending pin requests from the network",
          operationId: "listPinRequests",
          parameters: [
            {
              name: "maxAge",
              in: "query",
              schema: { type: "integer" },
              description: "Maximum age in milliseconds"
            }
          ],
          responses: {
            "200": {
              description: "List of pin requests",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/pin-response": {
        post: {
          tags: ["Network"],
          summary: "Respond to pin request",
          description: "Respond to a pin request (announce that you pinned it)",
          operationId: "respondToPinRequest",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    requestId: { type: "string" },
                    status: { type: "string", default: "completed" }
                  },
                  required: ["requestId"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Pin response published",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/reputation/record-proof": {
        post: {
          tags: ["Network"],
          summary: "Record proof event",
          description: "Record a storage proof event for tracking other relays",
          operationId: "recordProofEvent",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    host: { type: "string" },
                    success: { type: "boolean" },
                    responseTimeMs: { type: "number" }
                  },
                  required: ["host", "success"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Event recorded",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/verified/relays": {
        get: {
          tags: ["Network"],
          summary: "List verified relays",
          description: "List relay announcements from frozen (signed, immutable) space",
          operationId: "getVerifiedRelays",
          parameters: [
            {
              name: "verify",
              in: "query",
              schema: { type: "boolean", default: true }
            },
            {
              name: "maxAge",
              in: "query",
              schema: { type: "integer" }
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 50 }
            }
          ],
          responses: {
            "200": {
              description: "List of verified relays",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/verified/relay/{host}": {
        get: {
          tags: ["Network"],
          summary: "Get verified relay",
          description: "Get verified (frozen) announcement for a specific relay",
          operationId: "getVerifiedRelay",
          parameters: [
            {
              name: "host",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "Verified relay announcement",
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
      "/api/v1/network/verified/observation": {
        post: {
          tags: ["Network"],
          summary: "Create verified observation",
          description: "Create a signed observation about another relay",
          operationId: "createVerifiedObservation",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    observedHost: { type: "string" },
                    observation: { type: "object" }
                  },
                  required: ["observedHost", "observation"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Observation created",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/verified/observations/{host}": {
        get: {
          tags: ["Network"],
          summary: "Get verified observations",
          description: "Get all verified observations for a specific relay",
          operationId: "getVerifiedObservations",
          parameters: [
            {
              name: "host",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 50 }
            }
          ],
          responses: {
            "200": {
              description: "Observations and aggregated reputation",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/verified/entry/{namespace}/{hash}": {
        get: {
          tags: ["Network"],
          summary: "Read verified entry",
          description: "Read and verify any frozen entry by its content hash",
          operationId: "readVerifiedEntry",
          parameters: [
            {
              name: "namespace",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "hash",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "Verified entry",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            },
            "404": {
              description: "Entry not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" }
                }
              }
            }
          }
        }
      },
      "/api/v1/network/onchain/deals/relay/{address}": {
        get: {
          tags: ["Registry"],
          summary: "Get relay deals from registry",
          description: "Get all storage deals for a relay from on-chain registry",
          operationId: "getOnChainRelayDeals",
          parameters: [
            {
              name: "address",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "chainId",
              in: "query",
              schema: { type: "integer", default: 84532 }
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
      "/api/v1/registry/balance": {
        get: {
          tags: ["Registry"],
          summary: "Get wallet balances",
          description: "Get wallet balances (ETH for gas, USDC for staking)",
          operationId: "getRegistryBalance",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          responses: {
            "200": {
              description: "Wallet balances",
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
      "/api/v1/registry/register": {
        post: {
          tags: ["Registry"],
          summary: "Register relay on-chain",
          description: "Register this relay on-chain",
          operationId: "registerRelay",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    endpoint: { type: "string" },
                    gunPubKey: { type: "string" },
                    stakeAmount: { type: "string" },
                    griefingRatio: { type: "integer" }
                  },
                  required: ["endpoint", "gunPubKey", "stakeAmount"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Relay registered",
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
      "/api/v1/registry/update": {
        post: {
          tags: ["Registry"],
          summary: "Update relay",
          description: "Update relay endpoint and/or pubkey",
          operationId: "updateRelay",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    newEndpoint: { type: "string" },
                    newGunPubKey: { type: "string" }
                  }
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Relay updated",
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
      "/api/v1/registry/stake/increase": {
        post: {
          tags: ["Registry"],
          summary: "Increase stake",
          description: "Increase stake amount",
          operationId: "increaseStake",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    amount: { type: "string" }
                  },
                  required: ["amount"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Stake increased",
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
      "/api/v1/registry/stake/unstake": {
        post: {
          tags: ["Registry"],
          summary: "Request unstake",
          description: "Request to unstake (starts delay period)",
          operationId: "requestUnstake",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          responses: {
            "200": {
              description: "Unstake requested",
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
      "/api/v1/registry/stake/withdraw": {
        post: {
          tags: ["Registry"],
          summary: "Withdraw stake",
          description: "Withdraw stake after unstaking delay",
          operationId: "withdrawStake",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          responses: {
            "200": {
              description: "Stake withdrawn",
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
      "/api/v1/registry/deal/register": {
        post: {
          tags: ["Registry"],
          summary: "Register deal on-chain",
          description: "Register a storage deal on-chain",
          operationId: "registerDealOnChain",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    dealId: { type: "string" },
                    clientAddress: { type: "string" },
                    cid: { type: "string" },
                    sizeMB: { type: "number" },
                    priceUSDC: { type: "string" },
                    durationDays: { type: "number" },
                    clientStake: { type: "string" }
                  },
                  required: ["clientAddress", "cid", "sizeMB", "priceUSDC", "durationDays"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Deal registered",
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
      "/api/v1/registry/deals": {
        get: {
          tags: ["Registry"],
          summary: "Get relay deals",
          description: "Get all deals for this relay from StorageDealRegistry",
          operationId: "getRegistryDeals",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          responses: {
            "200": {
              description: "List of deals",
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
      "/api/v1/registry/config": {
        get: {
          tags: ["Registry"],
          summary: "Get registry configuration",
          description: "Get current registry configuration (addresses, chain info)",
          operationId: "getRegistryConfig",
          responses: {
            "200": {
              description: "Registry configuration",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/registry/deal/complete": {
        post: {
          tags: ["Registry"],
          summary: "Complete deal",
          description: "Mark a deal as completed",
          operationId: "completeDeal",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    dealId: { type: "string" }
                  },
                  required: ["dealId"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Deal completed",
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
      "/api/v1/registry/grief/missed-proof": {
        post: {
          tags: ["Registry"],
          summary: "Report missed proof",
          description: "Report a missed proof",
          operationId: "reportMissedProof",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    relayAddress: { type: "string" },
                    dealId: { type: "string" },
                    evidence: { type: "string" }
                  },
                  required: ["relayAddress", "dealId", "evidence"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Missed proof reported",
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
      "/api/v1/registry/grief/data-loss": {
        post: {
          tags: ["Registry"],
          summary: "Report data loss",
          description: "Report data loss",
          operationId: "reportDataLoss",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    relayAddress: { type: "string" },
                    dealId: { type: "string" },
                    evidence: { type: "string" }
                  },
                  required: ["relayAddress", "dealId", "evidence"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Data loss reported",
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
      "/api/v1/registry/deal/grief": {
        post: {
          tags: ["Registry"],
          summary: "Grief storage deal",
          description: "Grief a storage deal",
          operationId: "griefDeal",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    dealId: { type: "string" },
                    slashAmount: { type: "string" },
                    reason: { type: "string" }
                  },
                  required: ["dealId", "slashAmount", "reason"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Deal griefed",
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
      "/api/v1/deals/upload": {
        post: {
          tags: ["Storage Deals"],
          summary: "Upload file for deal",
          description: "Upload a file to IPFS for deal creation",
          operationId: "uploadDealFile",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: {
                      type: "string",
                      format: "binary"
                    },
                    walletAddress: { type: "string" }
                  },
                  required: ["file"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "File uploaded",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/deals/relay/active": {
        get: {
          tags: ["Storage Deals"],
          summary: "Get active deals for relay",
          description: "Get active deals for this relay (admin only)",
          operationId: "getRelayActiveDeals",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          responses: {
            "200": {
              description: "Active deals",
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
      "/api/v1/deals/{dealId}/verify-proof": {
        get: {
          tags: ["Storage Deals"],
          summary: "Verify deal proof",
          description: "Challenge the relay to provide a storage proof for a deal",
          operationId: "verifyDealProof",
          parameters: [
            {
              name: "dealId",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "challenge",
              in: "query",
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "Storage proof",
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
      "/api/v1/x402/can-upload-verified/{userAddress}": {
        get: {
          tags: ["x402 Subscriptions"],
          summary: "Check upload permission (verified)",
          description: "Check if user can upload with verified storage check",
          operationId: "checkX402UploadVerified",
          parameters: [
            {
              name: "userAddress",
              in: "path",
              required: true,
              schema: { type: "string" }
            },
            {
              name: "size",
              in: "query",
              schema: { type: "number" },
              description: "File size in MB"
            }
          ],
          responses: {
            "200": {
              description: "Upload permission status",
              content: {
                "application/json": {
                  schema: { type: "object" }
                }
              }
            }
          }
        }
      },
      "/api/v1/x402/storage/sync/{userAddress}": {
        post: {
          tags: ["x402 Subscriptions"],
          summary: "Sync storage usage",
          description: "Sync storage usage - verify IPFS and update GunDB (admin only)",
          operationId: "syncX402Storage",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          parameters: [
            {
              name: "userAddress",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          responses: {
            "200": {
              description: "Storage synced",
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
      "/api/v1/x402/update-usage/{userAddress}": {
        post: {
          tags: ["x402 Subscriptions"],
          summary: "Update storage usage",
          description: "Update storage usage after successful upload (admin only)",
          operationId: "updateX402Usage",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          parameters: [
            {
              name: "userAddress",
              in: "path",
              required: true,
              schema: { type: "string" }
            }
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    addMB: { type: "number" }
                  },
                  required: ["addMB"]
                }
              }
            }
          },
          responses: {
            "200": {
              description: "Usage updated",
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
      }
    }
  };
}
