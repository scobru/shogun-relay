/**
 * OpenAPI Specification Generator
 * Generates a complete OpenAPI 3.0 specification for Shogun Relay API
 */

// OpenAPI types - using obj for the complex nested structure
interface OpenAPISpec {
  openapi: string;
  info: Record<string, any>;
  servers: Array<Record<string, any>>;
  components: Record<string, any>;
  security: Array<Record<string, any>>;
  paths: Record<string, any>;
}

export function generateOpenAPISpec(baseUrl: string = "http://localhost:8765"): OpenAPISpec {
  return {
    openapi: "3.0.0",
    info: {
      title: "Shogun Relay API",
      version: "1.0.0",
      description:
        "Complete API documentation for Shogun Relay. Test endpoints directly from the interactive documentation.",
      contact: {
        name: "Shogun Project",
        url: "https://github.com/scobru/shogun",
      },
      license: {
        name: "MIT",
      },
    },
    servers: [
      {
        url: baseUrl,
        description: "Current Server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Bearer token authentication using ADMIN_PASSWORD",
        },
        tokenHeader: {
          type: "apiKey",
          in: "header",
          name: "token",
          description: "Custom token header authentication",
        },
        sessionToken: {
          type: "apiKey",
          in: "header",
          name: "X-Session-Token",
          description: "Session token after initial authentication",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            success: { type: "boolean", example: false },
            error: { type: "string", example: "Error message" },
            reason: { type: "string", example: "Detailed reason (optional)" },
          },
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
                formatted: { type: "string" },
              },
            },
            connections: {
              type: "object",
              properties: {
                active: { type: "number" },
                total: { type: "number" },
              },
            },
            memory: {
              type: "object",
              properties: {
                heapUsedMB: { type: "number" },
                heapTotalMB: { type: "number" },
                percent: { type: "number" },
                rssMB: { type: "number" },
              },
            },
            relay: {
              type: "object",
              properties: {
                pub: { type: "string" },
                name: { type: "string" },
                host: { type: "string" },
                port: { type: "number" },
              },
            },
            services: {
              type: "object",
              properties: {
                gun: { type: "string" },
                holster: { type: "string" },
                ipfs: { type: "string" },
              },
            },
          },
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
                totalStorageGB: { type: "string" },
              },
            },
            timestamp: { type: "number" },
            debug: {
              type: "object",
              properties: {
                relaysFound: { type: "number" },
                relaysWithPulse: { type: "number" },
                sources: { type: "object" },
              },
            },
          },
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
                      breakdown: { type: "object" },
                    },
                  },
                },
              },
            },
            filters: { type: "object" },
          },
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
                byTier: { type: "object" },
              },
            },
            timestamp: { type: "number" },
          },
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
                unstakingDelayDays: { type: "number" },
              },
            },
          },
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
                  griefingRatio: { type: "number" },
                },
              },
            },
            registryParams: { $ref: "#/components/schemas/RegistryParams" },
          },
        },
        IPFSUploadResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            cid: { type: "string" },
            size: { type: "number" },
            path: { type: "string" },
          },
        },
        IPFSDirectoryUploadResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            cid: { type: "string", description: "Directory CID" },
            directoryCid: { type: "string", description: "Directory CID (same as cid)" },
            fileCount: { type: "number", description: "Number of files uploaded" },
            totalSize: { type: "number", description: "Total size in bytes" },
            totalSizeMB: { type: "number", description: "Total size in MB" },
            files: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  path: { type: "string", description: "Relative path within directory" },
                  size: { type: "number" },
                  mimetype: { type: "string" },
                },
              },
            },
            authType: { type: "string", enum: ["admin", "user"] },
            mbUsage: {
              type: "object",
              properties: {
                actualSizeMB: { type: "number" },
                sizeMB: { type: "number" },
                verified: { type: "boolean" },
              },
            },
            subscription: {
              type: "object",
              properties: {
                storageUsedMB: { type: "number" },
                storageRemainingMB: { type: "number" },
              },
            },
          },
        },
        IPFSPinList: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            pins: {
              type: "array",
              items: { type: "string" },
            },
          },
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
                  priceDisplay: { type: "string" },
                },
              },
            },
            relayStorage: {
              type: "object",
              properties: {
                unlimited: { type: "boolean" },
                usedGB: { type: "number" },
                maxStorageGB: { type: "number" },
                remainingGB: { type: "number" },
                percentUsed: { type: "number" },
              },
            },
          },
        },
        AnnasArchiveStatus: {
          type: "object",
          properties: {
            enabled: { type: "boolean" },
            activeTorrents: { type: "number" },
            downloadSpeed: { type: "number" },
            uploadSpeed: { type: "number" },
            ratio: { type: "number" },
            torrents: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  infoHash: { type: "string" },
                  name: { type: "string" },
                  progress: { type: "number" },
                  downloadSpeed: { type: "number" },
                  uploadSpeed: { type: "number" },
                  peers: { type: "number" },
                },
              },
            },
          },
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
                storageLimitMB: { type: "number" },
              },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }, { tokenHeader: [] }, { sessionToken: [] }],
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
                  schema: { $ref: "#/components/schemas/HealthResponse" },
                },
              },
            },
          },
        },
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
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/system/contracts": {
        get: {
          tags: ["System"],
          summary: "Get contract addresses",
          description: "Get the addresses of all protocol contracts for the current chain",
          operationId: "getContracts",
          responses: {
            "200": {
              description: "Contract addresses",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      chainId: { type: "number" },
                      contracts: {
                        type: "object",
                        additionalProperties: { type: "string" },
                      },
                      timestamp: { type: "number" },
                    },
                  },
                },
              },
            },
            "500": {
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                  schema: { $ref: "#/components/schemas/NetworkStats" },
                },
              },
            },
            "500": {
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
              description: "Maximum number of results",
            },
            {
              name: "minScore",
              in: "query",
              schema: { type: "number", minimum: 0, maximum: 100 },
              description: "Minimum reputation score",
            },
            {
              name: "tier",
              in: "query",
              schema: {
                type: "string",
                enum: [
                  "platinum",
                  "gold",
                  "silver",
                  "bronze",
                  "basic",
                  "average",
                  "good",
                  "excellent",
                ],
              },
              description: "Filter by tier",
            },
          ],
          responses: {
            "200": {
              description: "Reputation leaderboard",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReputationLeaderboard" },
                },
              },
            },
          },
        },
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
              description: "Relay hostname",
            },
          ],
          responses: {
            "200": {
              description: "Relay reputation",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "404": {
              description: "Relay not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                        items: { type: "object" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
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
              description: "Maximum number of relays to return",
            },
          ],
          responses: {
            "200": {
              description: "List of best relays",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              description: "Timeout in milliseconds",
            },
          ],
          responses: {
            "200": {
              description: "Deals statistics",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/DealsStats" },
                },
              },
            },
            "503": {
              description: "Service unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/torrent/status": {
        get: {
          tags: ["Anna's Archive"],
          summary: "Get integration status",
          description: "Get current status, active torrents and speeds",
          operationId: "getAnnasArchiveStatus",
          responses: {
            "200": {
              description: "Status information",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      data: { $ref: "#/components/schemas/AnnasArchiveStatus" },
                    },
                  },
                },
              },
            },
            "500": {
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/torrent/add": {
        post: {
          tags: ["Anna's Archive"],
          summary: "Add manual torrent",
          description: "Add a magnet link or torrent file manually",
          operationId: "addAnnasArchiveTorrent",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    magnet: { type: "string", description: "Magnet link or URL" },
                  },
                  required: ["magnet"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Success response",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "500": {
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
              description: "Size in MB",
            },
            {
              name: "durationDays",
              in: "query",
              required: true,
              schema: { type: "number" },
              description: "Duration in days",
            },
            {
              name: "tier",
              in: "query",
              schema: { type: "string", default: "standard" },
              description: "Storage tier",
            },
          ],
          responses: {
            "200": {
              description: "Pricing information",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              description: "IPFS CID",
            },
          ],
          responses: {
            "200": {
              description: "List of deals",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              description: "Client Ethereum address",
            },
          ],
          responses: {
            "200": {
              description: "List of deals",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              description: "Deal ID",
            },
          ],
          responses: {
            "200": {
              description: "Deal details",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "404": {
              description: "Deal not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/balance-info/{user}": {
        get: {
          tags: ["Bridge"],
          summary: "Get balance with verification data",
          description:
            "Get user L2 balance with Merkle proof for independent verification against on-chain batch roots. Enables trustless balance verification without relying on the relay.",
          operationId: "getBalanceInfo",
          parameters: [
            {
              name: "user",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "User's Ethereum address",
            },
          ],
          responses: {
            "200": {
              description: "Balance info with verification data",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      user: { type: "string" },
                      balance: { type: "string" },
                      balanceEth: { type: "string" },
                      verification: {
                        type: "object",
                        nullable: true,
                        properties: {
                          lastBatchId: { type: "string" },
                          lastBatchRoot: { type: "string" },
                          lastBatchTxHash: { type: "string", nullable: true },
                          lastBatchTimestamp: { type: "number" },
                          lastWithdrawal: {
                            type: "object",
                            properties: {
                              amount: { type: "string" },
                              nonce: { type: "string" },
                              timestamp: { type: "number" },
                            },
                          },
                          merkleProof: {
                            type: "array",
                            items: { type: "string" },
                          },
                          verifiedOnChain: { type: "boolean" },
                        },
                      },
                      stats: {
                        type: "object",
                        properties: {
                          processedDepositsCount: { type: "number" },
                          hasVerificationData: { type: "boolean" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Invalid address",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/batch-history/{user}": {
        get: {
          tags: ["Bridge"],
          summary: "Get batch history for user",
          description:
            "Get all batches containing user withdrawals plus processed deposits. Enables users to track their complete on-chain activity.",
          operationId: "getBatchHistory",
          parameters: [
            {
              name: "user",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "User's Ethereum address",
            },
          ],
          responses: {
            "200": {
              description: "User batch history",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      user: { type: "string" },
                      batches: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            batchId: { type: "string" },
                            root: { type: "string" },
                            txHash: { type: "string", nullable: true },
                            timestamp: { type: "number" },
                            finalized: { type: "boolean" },
                            withdrawals: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  amount: { type: "string" },
                                  nonce: { type: "string" },
                                  timestamp: { type: "number" },
                                },
                              },
                            },
                          },
                        },
                      },
                      deposits: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            txHash: { type: "string" },
                            amount: { type: "string" },
                            amountEth: { type: "string" },
                            blockNumber: { type: "number" },
                            timestamp: { type: "number" },
                          },
                        },
                      },
                      summary: {
                        type: "object",
                        properties: {
                          totalBatches: { type: "number" },
                          totalDeposits: { type: "number" },
                          totalWithdrawals: { type: "number" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Invalid address",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                  schema: { $ref: "#/components/schemas/RegistryParams" },
                },
              },
            },
          },
        },
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
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
              description: "Chain ID (e.g., 84532 for Base Sepolia)",
            },
          ],
          responses: {
            "200": {
              description: "List of on-chain relays",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/OnChainRelays" },
                },
              },
            },
          },
        },
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
              description: "Relay Ethereum address",
            },
            {
              name: "chainId",
              in: "query",
              required: true,
              schema: { type: "integer" },
              description: "Chain ID",
            },
          ],
          responses: {
            "200": {
              description: "Relay details",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
      },
      "/api/v1/ipfs/upload": {
        post: {
          tags: ["IPFS"],
          summary: "Upload file to IPFS",
          description: "Upload a single file to IPFS",
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
                      description: "File to upload",
                    },
                  },
                  required: ["file"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "File uploaded successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IPFSUploadResponse" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "402": {
              description: "Payment required (x402 subscription)",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/ipfs/upload-directory": {
        post: {
          tags: ["IPFS"],
          summary: "Upload directory to IPFS",
          description:
            "Upload multiple files as a directory to IPFS. Maintains directory structure using relative paths. Files are uploaded with wrap-with-directory=true to preserve structure.",
          operationId: "uploadDirectoryToIPFS",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    files: {
                      type: "array",
                      items: {
                        type: "string",
                        format: "binary",
                      },
                      description:
                        "Multiple files with relative paths (e.g., index.html, css/style.css, js/app.js)",
                    },
                  },
                  required: ["files"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Directory uploaded successfully",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/IPFSDirectoryUploadResponse" },
                },
              },
            },
            "400": {
              description: "Bad request - no files provided",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "402": {
              description: "Payment required (x402 subscription) or storage limit exceeded",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "500": {
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
              description: "IPFS CID",
            },
            {
              name: "json",
              in: "query",
              schema: { type: "boolean" },
              description: "Return as JSON if content is JSON",
            },
          ],
          responses: {
            "200": {
              description: "File content",
              content: {
                "application/octet-stream": {
                  schema: { type: "string", format: "binary" },
                },
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "404": {
              description: "CID not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
              description: "IPFS CID",
            },
          ],
          responses: {
            "200": {
              description: "JSON content",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
                      description: "IPFS CID to pin",
                    },
                  },
                  required: ["cid"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "CID pinned successfully",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                  schema: { $ref: "#/components/schemas/IPFSPinList" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                      description: "IPFS CID to unpin",
                    },
                  },
                  required: ["cid"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "CID unpinned successfully",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
                  schema: { $ref: "#/components/schemas/X402Tiers" },
                },
              },
            },
          },
        },
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
              description: "User Ethereum address",
            },
          ],
          responses: {
            "200": {
              description: "Subscription status",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/X402Subscription" },
                },
              },
            },
          },
        },
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
              description: "User Ethereum address",
            },
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
                      reason: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
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
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              description: "Subscription tier",
            },
          ],
          responses: {
            "200": {
              description: "Payment requirements",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
                    payment: { type: "object" },
                  },
                  required: ["userAddress", "tier"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Subscription activated",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "402": {
              description: "Payment required",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
              description: "User Ethereum address",
            },
          ],
          responses: {
            "200": {
              description: "Storage usage information",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
                    relayAddress: { type: "string" },
                  },
                  required: ["cid", "clientAddress", "sizeMB", "durationDays"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Deal created",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    paymentTxHash: { type: "string" },
                    clientStake: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Deal activated",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    additionalDays: { type: "number" },
                    payment: { type: "object" },
                  },
                  required: ["additionalDays"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Deal renewed",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "402": {
              description: "Payment required",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Deal terminated",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Verification result",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              description: "File size in MB",
            },
          ],
          responses: {
            "200": {
              description: "Overhead calculation",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              schema: { type: "integer", default: 50 },
            },
            {
              name: "timeout",
              in: "query",
              schema: { type: "integer", default: 5000 },
            },
          ],
          responses: {
            "200": {
              description: "Leaderboard",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Relay details",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
            {
              name: "challenge",
              in: "query",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Storage proof",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
                    proof: { type: "object" },
                  },
                  required: ["proof"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Verification result",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
                  schema: { type: "object" },
                },
              },
            },
          },
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
                    priority: { type: "string", default: "normal" },
                  },
                  required: ["cid"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Pin request published",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
              description: "Maximum age in milliseconds",
            },
          ],
          responses: {
            "200": {
              description: "List of pin requests",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
                    status: { type: "string", default: "completed" },
                  },
                  required: ["requestId"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Pin response published",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
                    responseTimeMs: { type: "number" },
                  },
                  required: ["host", "success"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Event recorded",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              schema: { type: "boolean", default: true },
            },
            {
              name: "maxAge",
              in: "query",
              schema: { type: "integer" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 50 },
            },
          ],
          responses: {
            "200": {
              description: "List of verified relays",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Verified relay announcement",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "404": {
              description: "Relay not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                    observation: { type: "object" },
                  },
                  required: ["observedHost", "observation"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Observation created",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              schema: { type: "integer", default: 50 },
            },
          ],
          responses: {
            "200": {
              description: "Observations and aggregated reputation",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
            {
              name: "hash",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Verified entry",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "404": {
              description: "Entry not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
            {
              name: "chainId",
              in: "query",
              schema: { type: "integer", default: 84532 },
            },
          ],
          responses: {
            "200": {
              description: "List of deals",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                    griefingRatio: { type: "integer" },
                  },
                  required: ["endpoint", "gunPubKey", "stakeAmount"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Relay registered",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                    newGunPubKey: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Relay updated",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                    amount: { type: "string" },
                  },
                  required: ["amount"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Stake increased",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                    clientStake: { type: "string" },
                  },
                  required: ["clientAddress", "cid", "sizeMB", "priceUSDC", "durationDays"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Deal registered",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
                    dealId: { type: "string" },
                  },
                  required: ["dealId"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Deal completed",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                    evidence: { type: "string" },
                  },
                  required: ["relayAddress", "dealId", "evidence"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Missed proof reported",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                    evidence: { type: "string" },
                  },
                  required: ["relayAddress", "dealId", "evidence"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Data loss reported",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                    reason: { type: "string" },
                  },
                  required: ["dealId", "slashAmount", "reason"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Deal griefed",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
                      format: "binary",
                    },
                    walletAddress: { type: "string" },
                  },
                  required: ["file"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "File uploaded",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
            {
              name: "challenge",
              in: "query",
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Storage proof",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "404": {
              description: "Deal not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
            {
              name: "size",
              in: "query",
              schema: { type: "number" },
              description: "File size in MB",
            },
          ],
          responses: {
            "200": {
              description: "Upload permission status",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Storage synced",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
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
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    addMB: { type: "number" },
                  },
                  required: ["addMB"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Usage updated",
              content: {
                "application/json": {
                  schema: { type: "object" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/deposit": {
        post: {
          tags: ["Bridge"],
          summary: "Get deposit instructions",
          description: "Get instructions for depositing ETH to the bridge contract",
          operationId: "getDepositInstructions",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    amount: { type: "string", description: "Amount in wei" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Deposit instructions",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                      contractAddress: { type: "string" },
                      amount: { type: "string" },
                      instructions: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/transfer": {
        post: {
          tags: ["Bridge"],
          summary: "Transfer balance (L2 -> L2)",
          description: "Transfer balance from one user to another on L2",
          operationId: "transferBalance",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    from: { type: "string", description: "Sender Ethereum address" },
                    to: { type: "string", description: "Receiver Ethereum address" },
                    amount: { type: "string", description: "Amount in wei" },
                    message: { type: "string", description: "Message that was signed" },
                    seaSignature: { type: "string", description: "SEA signature" },
                    ethSignature: { type: "string", description: "Ethereum signature" },
                    gunPubKey: { type: "string", description: "GunDB public key" },
                  },
                  required: [
                    "from",
                    "to",
                    "amount",
                    "message",
                    "seaSignature",
                    "ethSignature",
                    "gunPubKey",
                  ],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Transfer successful",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      transfer: { type: "object" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "401": {
              description: "Unauthorized - invalid signatures",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/withdraw": {
        post: {
          tags: ["Bridge"],
          summary: "Request withdrawal",
          description: "Request withdrawal from L2 to L1",
          operationId: "requestWithdrawal",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    user: { type: "string", description: "User Ethereum address" },
                    amount: { type: "string", description: "Amount in wei" },
                    nonce: {
                      type: "string",
                      description: "Withdrawal nonce (optional, auto-generated if omitted)",
                    },
                    message: {
                      type: "string",
                      description: "Message that was signed (must include nonce if provided)",
                    },
                    seaSignature: { type: "string", description: "SEA signature" },
                    ethSignature: { type: "string", description: "Ethereum signature" },
                    gunPubKey: { type: "string", description: "GunDB public key" },
                  },
                  required: [
                    "user",
                    "amount",
                    "message",
                    "seaSignature",
                    "ethSignature",
                    "gunPubKey",
                  ],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Withdrawal requested",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      withdrawal: {
                        type: "object",
                        properties: {
                          user: { type: "string" },
                          amount: { type: "string" },
                          nonce: { type: "string" },
                          timestamp: { type: "number" },
                        },
                      },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "401": {
              description: "Unauthorized - invalid signatures",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/submit-batch": {
        post: {
          tags: ["Bridge"],
          summary: "Submit batch",
          description: "Submit a batch with Merkle root (sequencer only)",
          operationId: "submitBatch",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Batch submitted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      batch: {
                        type: "object",
                        properties: {
                          batchId: { type: "string" },
                          root: { type: "string" },
                          txHash: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "403": {
              description: "Forbidden - not authorized to submit batches",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/balance/{user}": {
        get: {
          tags: ["Bridge"],
          summary: "Get user balance",
          description: "Get user's L2 balance",
          operationId: "getUserBalance",
          parameters: [
            {
              name: "user",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "User Ethereum address",
            },
          ],
          responses: {
            "200": {
              description: "User balance",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      user: { type: "string" },
                      balance: { type: "string" },
                      balanceEth: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/pending-withdrawals": {
        get: {
          tags: ["Bridge"],
          summary: "Get pending withdrawals",
          description: "Get all pending withdrawals waiting for batch submission",
          operationId: "getPendingWithdrawals",
          responses: {
            "200": {
              description: "Pending withdrawals",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      withdrawals: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            user: { type: "string" },
                            amount: { type: "string" },
                            nonce: { type: "string" },
                            timestamp: { type: "number" },
                          },
                        },
                      },
                      count: { type: "number" },
                    },
                  },
                },
              },
            },
            "503": {
              description: "Service unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/nonce/{user}": {
        get: {
          tags: ["Bridge"],
          summary: "Get next nonce",
          description:
            "Get the next nonce for a user (for withdrawal requests). This allows clients to include the nonce in their signed message.",
          operationId: "getNextNonce",
          parameters: [
            {
              name: "user",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "User Ethereum address",
            },
          ],
          responses: {
            "200": {
              description: "Nonce information",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      lastNonce: { type: "string" },
                      nextNonce: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Invalid user address",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "500": {
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/proof/{user}/{amount}/{nonce}": {
        get: {
          tags: ["Bridge"],
          summary: "Get withdrawal proof",
          description:
            "Generate Merkle proof for a withdrawal. The withdrawal must be included in a batch.",
          operationId: "getWithdrawalProof",
          parameters: [
            {
              name: "user",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "User Ethereum address",
            },
            {
              name: "amount",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Withdrawal amount in wei",
            },
            {
              name: "nonce",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Withdrawal nonce",
            },
          ],
          responses: {
            "200": {
              description: "Merkle proof",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      proof: {
                        type: "array",
                        items: { type: "string" },
                        description: "Merkle proof array",
                      },
                      batchId: { type: "string" },
                      root: { type: "string" },
                      withdrawal: {
                        type: "object",
                        properties: {
                          user: { type: "string" },
                          amount: { type: "string" },
                          nonce: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "202": {
              description: "Withdrawal pending - not yet in a batch",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      status: { type: "string", example: "pending" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
            "404": {
              description: "Proof not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "410": {
              description: "Withdrawal already processed on-chain",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      status: { type: "string", example: "already_processed" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/state": {
        get: {
          tags: ["Bridge"],
          summary: "Get bridge state",
          description: "Get current bridge state (root, batchId, sequencer, contract balance)",
          operationId: "getBridgeState",
          responses: {
            "200": {
              description: "Bridge state",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      state: {
                        type: "object",
                        properties: {
                          currentStateRoot: { type: "string" },
                          currentBatchId: { type: "string" },
                          sequencer: { type: "string" },
                          contractBalance: { type: "string" },
                          contractBalanceEth: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "500": {
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/sync-deposits": {
        post: {
          tags: ["Bridge"],
          summary: "Sync deposits",
          description: "Retroactively sync missed deposits from a block range (admin only)",
          operationId: "syncDeposits",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    fromBlock: { type: "number", description: "Block to start from (default: 0)" },
                    toBlock: {
                      type: ["number", "string"],
                      description: 'Block to end at (default: "latest")',
                    },
                    user: {
                      type: "string",
                      description: "Optional - only sync deposits for this user",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Sync completed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      results: {
                        type: "object",
                        properties: {
                          total: { type: "number" },
                          processed: { type: "number" },
                          skipped: { type: "number" },
                          failed: { type: "number" },
                          errors: {
                            type: "array",
                            items: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "503": {
              description: "Service unavailable",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/reconcile-balance": {
        post: {
          tags: ["Bridge"],
          summary: "Reconcile balance",
          description:
            "Recalculate and fix user balance if it doesn't match deposits/withdrawals/transfers",
          operationId: "reconcileBalance",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    user: { type: "string", description: "User Ethereum address" },
                  },
                  required: ["user"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Balance reconciled",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      user: { type: "string" },
                      currentBalance: { type: "string" },
                      calculatedBalance: { type: "string" },
                      corrected: { type: "boolean" },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "500": {
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/process-deposit": {
        post: {
          tags: ["Bridge"],
          summary: "Process specific deposit",
          description: "Force process a specific deposit by transaction hash (admin only)",
          operationId: "processDeposit",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    txHash: { type: "string", description: "Transaction hash of the deposit" },
                  },
                  required: ["txHash"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Deposit processed",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                      deposit: {
                        type: "object",
                        properties: {
                          user: { type: "string" },
                          amountEth: { type: "string" },
                          blockNumber: { type: "number" },
                        },
                      },
                      balance: {
                        type: "object",
                        properties: {
                          eth: { type: "string" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "404": {
              description: "Transaction not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/transactions/{user}": {
        get: {
          tags: ["Bridge"],
          summary: "Get user transaction history",
          description:
            "Get all transactions (deposits, withdrawals, transfers) for a user. Returns a unified list of all transaction types sorted by timestamp.",
          operationId: "getUserTransactions",
          parameters: [
            {
              name: "user",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "User Ethereum address",
            },
          ],
          responses: {
            "200": {
              description: "Transaction history",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      user: { type: "string" },
                      transactions: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            type: {
                              type: "string",
                              enum: ["deposit", "withdrawal", "transfer"],
                              description: "Transaction type",
                            },
                            txHash: {
                              type: "string",
                              description: "Transaction hash",
                            },
                            from: {
                              type: "string",
                              description: "Sender address (for withdrawals and transfers)",
                            },
                            to: {
                              type: "string",
                              description: "Receiver address (for deposits and transfers)",
                            },
                            amount: {
                              type: "string",
                              description: "Amount in wei",
                            },
                            amountEth: {
                              type: "string",
                              description: "Amount in ETH",
                            },
                            timestamp: {
                              type: "number",
                              description: "Transaction timestamp (milliseconds)",
                            },
                            blockNumber: {
                              type: "number",
                              description: "Block number (for on-chain transactions)",
                            },
                            nonce: {
                              type: "string",
                              description: "Withdrawal nonce (for withdrawals)",
                            },
                            batchId: {
                              type: "string",
                              description: "Batch ID (for batched withdrawals)",
                            },
                            status: {
                              type: "string",
                              enum: ["pending", "completed", "batched"],
                              description: "Transaction status",
                            },
                          },
                        },
                      },
                      count: {
                        type: "number",
                        description: "Total number of transactions",
                      },
                      summary: {
                        type: "object",
                        properties: {
                          deposits: { type: "number" },
                          withdrawals: { type: "number" },
                          transfers: { type: "number" },
                        },
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request - invalid user address",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "503": {
              description: "Service unavailable - GunDB not initialized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "500": {
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/bridge/transaction/{txHash}": {
        get: {
          tags: ["Bridge"],
          summary: "Get transaction details",
          description:
            "Get detailed information about a specific transaction by hash. Searches across deposits, withdrawals, and transfers.",
          operationId: "getTransactionDetails",
          parameters: [
            {
              name: "txHash",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Transaction hash",
            },
          ],
          responses: {
            "200": {
              description: "Transaction details",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      transaction: {
                        type: "object",
                        properties: {
                          type: {
                            type: "string",
                            enum: ["deposit", "withdrawal", "transfer"],
                            description: "Transaction type",
                          },
                          txHash: {
                            type: "string",
                            description: "Transaction hash",
                          },
                          from: {
                            type: "string",
                            description: "Sender address",
                          },
                          to: {
                            type: "string",
                            description: "Receiver address",
                          },
                          amount: {
                            type: "string",
                            description: "Amount in wei",
                          },
                          amountEth: {
                            type: "string",
                            description: "Amount in ETH",
                          },
                          timestamp: {
                            type: "number",
                            description: "Transaction timestamp",
                          },
                          blockNumber: {
                            type: "number",
                            description: "Block number",
                          },
                          nonce: {
                            type: "string",
                            description: "Withdrawal nonce",
                          },
                          status: {
                            type: "string",
                            enum: ["pending", "completed", "batched"],
                            description: "Transaction status",
                          },
                        },
                      },
                      source: {
                        type: "string",
                        enum: ["deposit", "withdrawal", "transfer"],
                        description: "Source where the transaction was found",
                      },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request - invalid transaction hash",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "404": {
              description: "Transaction not found",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean", example: false },
                      error: { type: "string", example: "Transaction not found" },
                    },
                  },
                },
              },
            },
            "503": {
              description: "Service unavailable - GunDB not initialized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "500": {
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/user-uploads/system-hashes-map": {
        get: {
          tags: ["User Uploads"],
          summary: "Get system hashes map",
          description:
            "Get the complete system hashes map with metadata for all files. Returns all file metadata stored in the GunDB systemhash node.",
          operationId: "getSystemHashesMap",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          responses: {
            "200": {
              description: "System hashes map with metadata",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      systemHashes: {
                        type: "object",
                        description: "Map of CID to metadata objects",
                        additionalProperties: {
                          type: "object",
                          properties: {
                            hash: { type: "string" },
                            userAddress: { type: "string" },
                            timestamp: { type: "number" },
                            uploadedAt: { type: "number" },
                            fileName: { type: "string" },
                            displayName: { type: "string" },
                            originalName: { type: "string" },
                            fileSize: { type: "number" },
                            contentType: { type: "string" },
                            isEncrypted: { type: "boolean" },
                            isDirectory: { type: "boolean" },
                            fileCount: { type: "number" },
                            files: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  name: { type: "string" },
                                  path: { type: "string" },
                                  size: { type: "number" },
                                  mimetype: { type: "string" },
                                  originalName: { type: "string" },
                                  isEncrypted: { type: "boolean" },
                                },
                              },
                            },
                            relayUrl: { type: "string" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "500": {
              description: "Server error - GunDB not available",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/user-uploads/save-system-hash": {
        post: {
          tags: ["User Uploads"],
          summary: "Save file metadata to system hash map",
          description:
            "Save file or directory metadata to the GunDB systemhash node. Used by drive applications to track file metadata.",
          operationId: "saveSystemHash",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["hash", "userAddress"],
                  properties: {
                    hash: { type: "string", description: "IPFS CID" },
                    userAddress: { type: "string", description: "User identifier" },
                    timestamp: { type: "number", description: "Upload timestamp" },
                    fileName: { type: "string", description: "File name" },
                    displayName: { type: "string", description: "Display name" },
                    originalName: { type: "string", description: "Original file name" },
                    fileSize: { type: "number", description: "File size in bytes" },
                    contentType: { type: "string", description: "MIME type" },
                    isEncrypted: { type: "boolean", description: "Whether file is encrypted" },
                    isDirectory: { type: "boolean", description: "Whether this is a directory" },
                    fileCount: { type: "number", description: "Number of files in directory" },
                    files: {
                      type: "array",
                      description: "File list for directories",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          path: { type: "string" },
                          size: { type: "number" },
                          mimetype: { type: "string" },
                          originalName: { type: "string" },
                          isEncrypted: { type: "boolean" },
                        },
                      },
                    },
                    relayUrl: { type: "string", description: "URL to retrieve file" },
                    uploadedAt: { type: "number", description: "Upload timestamp" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Metadata saved successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                      hash: { type: "string" },
                      userAddress: { type: "string" },
                      timestamp: { type: "number" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request - missing required fields",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "401": {
              description: "Unauthorized - admin token required",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "500": {
              description: "Server error - GunDB not available",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
      "/api/v1/user-uploads/remove-system-hash/{cid}": {
        delete: {
          tags: ["User Uploads"],
          summary: "Remove file metadata from system hash map",
          description:
            "Remove file metadata from the GunDB systemhash node. Used when deleting files from drive applications.",
          operationId: "removeSystemHash",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          parameters: [
            {
              name: "cid",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "IPFS CID to remove",
            },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    userAddress: {
                      type: "string",
                      description: "User identifier (defaults to 'drive-user')",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Metadata removed successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                      hash: { type: "string" },
                      userAddress: { type: "string" },
                      timestamp: { type: "number" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request - CID required",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "500": {
              description: "Server error - GunDB not available",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
      },
    },
  };
}

