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
        walletSignature: {
          type: "apiKey",
          in: "header",
          name: "X-Wallet-Signature",
          description: "EIP-191 signature of 'I Love Shogun' message for wallet authentication",
        },
        userAddress: {
          type: "apiKey",
          in: "header",
          name: "X-User-Address",
          description: "Ethereum wallet address for user authentication",
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
        // DealsStats, RegistryParams, OnChainRelays removed
        IPFSUploadResponse: {
          type: "object",
          properties: {
            success: { type: "boolean" },
            cid: { type: "string", description: "IPFS CID of uploaded file" },
            file: {
              type: "object",
              properties: {
                hash: { type: "string", description: "IPFS hash (same as cid)" },
                name: { type: "string", description: "Original filename" },
                size: { type: "number", description: "File size in bytes" },
                mimetype: { type: "string", description: "MIME type" },
              },
            },
            authType: {
              type: "string",
              enum: ["admin", "apiKey"],
              description: "Authentication type used",
            },
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
            authType: { type: "string", enum: ["admin", "apiKey"] },
          },
        },
        // IPFSPinList removed
        // X402Tiers, AnnasArchiveStatus, X402Subscription removed
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
      // Deals and Torrent paths removed
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
      // Registry paths removed
      "/api/v1/ipfs/upload": {
        post: {
          tags: ["IPFS"],
          summary: "Upload file to IPFS",
          description: `Upload a single file to IPFS. Supports two authentication methods:
1. **Admin Upload**: Use \`Authorization: Bearer <ADMIN_PASSWORD>\` (no signature required)
2. **API Key Upload**: Use \`X-API-Key\` header.

The wallet signature method is deprecated.`,
          operationId: "uploadToIPFS",
          security: [
            { bearerAuth: [] },
            { tokenHeader: [] },
            { userAddress: [], walletSignature: [] },
          ],
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
                    encrypted: {
                      type: "string",
                      description: "Set to 'true' if file is encrypted",
                      enum: ["true", "false"],
                    },
                    encryptionMethod: {
                      type: "string",
                      description: "Encryption method (e.g., 'SEA')",
                    },
                    encryptionToken: {
                      type: "string",
                      description: "Encryption token (signature) for encrypted files",
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
              description: "Unauthorized - Missing or invalid authentication",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/Error" },
                      {
                        type: "object",
                        properties: {
                          hint: {
                            type: "string",
                            example: "Sign 'I Love Shogun' with your wallet and provide X-Wallet-Signature header",
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
            "402": {
              description: "Storage limit exceeded",
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
              description: "Storage limit exceeded",
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
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      pins: {
                        type: "array",
                        items: { type: "string" },
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
      // x402 paths removed
      // Additional Deals paths removed
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
                    relayUrl: { type: "string", description: "Relay URL where file is stored" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "System hash saved successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                      hash: { type: "string" },
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
      "/api/v1/drive/list": {
        get: {
          tags: ["Admin Drive"],
          summary: "List directory contents (root)",
          description: "List files and folders in the root directory",
          operationId: "listDriveDirectoryRoot",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          responses: {
            "200": {
              description: "Directory listing",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      items: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            path: { type: "string" },
                            type: { type: "string", enum: ["file", "directory"] },
                            size: { type: "number" },
                            modified: { type: "number" },
                          },
                        },
                      },
                      path: { type: "string" },
                    },
                  },
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
      "/api/v1/drive/list/{path}": {
        get: {
          tags: ["Admin Drive"],
          summary: "List directory contents",
          description: "List files and folders in the specified directory path",
          operationId: "listDriveDirectory",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          parameters: [
            {
              name: "path",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Directory path",
            },
          ],
          responses: {
            "200": {
              description: "Directory listing",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      items: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            path: { type: "string" },
                            type: { type: "string", enum: ["file", "directory"] },
                            size: { type: "number" },
                            modified: { type: "number" },
                          },
                        },
                      },
                      path: { type: "string" },
                    },
                  },
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
      "/api/v1/drive/upload": {
        post: {
          tags: ["Admin Drive"],
          summary: "Upload file(s) to root",
          description: "Upload one or multiple files to the root directory. Use 'file' field for single file, 'files' field for multiple files.",
          operationId: "uploadDriveFilesRoot",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  properties: {
                    file: { type: "string", format: "binary", description: "Single file upload" },
                    files: {
                      type: "array",
                      items: { type: "string", format: "binary" },
                      description: "Multiple files upload",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Files uploaded successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                      files: {
                        type: "array",
                        items: { type: "string" },
                      },
                    },
                  },
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
              description: "Unauthorized - admin token required",
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
      "/api/v1/drive/download/{path}": {
        get: {
          tags: ["Admin Drive"],
          summary: "Download file",
          description: "Download a file from the drive",
          operationId: "downloadDriveFile",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          parameters: [
            {
              name: "path",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "File path",
            },
          ],
          responses: {
            "200": {
              description: "File content",
              content: {
                "application/octet-stream": {
                  schema: { type: "string", format: "binary" },
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
            "404": {
              description: "File not found",
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
      "/api/v1/drive/delete/{path}": {
        delete: {
          tags: ["Admin Drive"],
          summary: "Delete file or directory",
          description: "Delete a file or directory (recursive for directories)",
          operationId: "deleteDriveItem",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          parameters: [
            {
              name: "path",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Item path to delete",
            },
          ],
          responses: {
            "200": {
              description: "Item deleted successfully",
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
            "401": {
              description: "Unauthorized - admin token required",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "404": {
              description: "Item not found",
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
      "/api/v1/drive/mkdir": {
        post: {
          tags: ["Admin Drive"],
          summary: "Create directory in root",
          description: "Create a new directory in the root directory",
          operationId: "createDriveDirectoryRoot",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Directory name" },
                  },
                  required: ["name"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Directory created successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                      path: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request - directory name required",
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
            "409": {
              description: "Directory already exists",
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
      "/api/v1/drive/mkdir/{path}": {
        post: {
          tags: ["Admin Drive"],
          summary: "Create directory in path",
          description: "Create a new directory in the specified parent directory",
          operationId: "createDriveDirectory",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          parameters: [
            {
              name: "path",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Parent directory path",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Directory name" },
                  },
                  required: ["name"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Directory created successfully",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      message: { type: "string" },
                      path: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request - directory name required",
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
            "409": {
              description: "Directory already exists",
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
      "/api/v1/drive/rename": {
        post: {
          tags: ["Admin Drive"],
          summary: "Rename file or directory",
          description: "Rename a file or directory",
          operationId: "renameDriveItem",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    oldPath: { type: "string", description: "Current path of the item" },
                    newName: { type: "string", description: "New name for the item" },
                  },
                  required: ["oldPath", "newName"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Item renamed successfully",
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
              description: "Bad request - invalid parameters",
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
            "404": {
              description: "Item not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "409": {
              description: "Target name already exists",
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
      "/api/v1/drive/move": {
        post: {
          tags: ["Admin Drive"],
          summary: "Move file or directory",
          description: "Move a file or directory to a new location",
          operationId: "moveDriveItem",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    sourcePath: { type: "string", description: "Current path of the item" },
                    destPath: { type: "string", description: "Destination path" },
                  },
                  required: ["sourcePath", "destPath"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Item moved successfully",
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
              description: "Bad request - invalid parameters",
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
            "404": {
              description: "Source item not found",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "409": {
              description: "Destination already exists",
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
      "/api/v1/drive/stats": {
        get: {
          tags: ["Admin Drive"],
          summary: "Get storage statistics",
          description: "Get storage usage statistics for the drive",
          operationId: "getDriveStats",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          responses: {
            "200": {
              description: "Storage statistics",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      stats: {
                        type: "object",
                        properties: {
                          totalBytes: { type: "number" },
                          totalSizeMB: { type: "string" },
                          totalSizeGB: { type: "string" },
                          fileCount: { type: "number" },
                          dirCount: { type: "number" },
                        },
                      },
                    },
                  },
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
      "/api/v1/api-keys": {
        get: {
          tags: ["API Keys"],
          summary: "List API keys",
          description: "List all API keys. Requires admin authentication.",
          operationId: "listApiKeys",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          responses: {
            "200": {
              description: "API keys list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      keys: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            keyId: { type: "string" },
                            name: { type: "string" },
                            createdAt: { type: "number" },
                            lastUsedAt: { type: "number", nullable: true },
                            expiresAt: { type: "number", nullable: true },
                          },
                        },
                      },
                    },
                  },
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
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
        post: {
          tags: ["API Keys"],
          summary: "Create API key",
          description: "Generate a new API key for programmatic access to all relay services (Drive, IPFS, etc.). Requires admin authentication.",
          operationId: "createApiKey",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string", description: "Descriptive name for the API key" },
                    expiresInDays: {
                      type: "number",
                      description: "Number of days until expiration (optional)",
                    },
                  },
                  required: ["name"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "API key created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      keyId: { type: "string" },
                      token: {
                        type: "string",
                        description: "API key token (shown only once)",
                      },
                      name: { type: "string" },
                      createdAt: { type: "number" },
                      expiresAt: { type: "number", nullable: true },
                      message: { type: "string" },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request - invalid parameters",
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
      "/api/v1/api-keys/{keyId}": {
        delete: {
          tags: ["API Keys"],
          summary: "Revoke API key",
          description: "Revoke (delete) an API key. Requires admin authentication.",
          operationId: "revokeApiKey",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          parameters: [
            {
              name: "keyId",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "API key ID to revoke",
            },
          ],
          responses: {
            "200": {
              description: "API key revoked successfully",
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
            "401": {
              description: "Unauthorized - admin token required",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "404": {
              description: "API key not found",
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
      "/api/v1/drive/links": {
        get: {
          tags: ["Admin Drive"],
          summary: "List public links",
          description: "List all public sharing links. Requires admin or API key authentication.",
          operationId: "listDrivePublicLinks",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          responses: {
            "200": {
              description: "Public links list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      links: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            linkId: { type: "string" },
                            filePath: { type: "string" },
                            createdAt: { type: "number" },
                            expiresAt: { type: "number", nullable: true },
                            accessCount: { type: "number" },
                            lastAccessedAt: { type: "number", nullable: true },
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
              description: "Server error",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
          },
        },
        post: {
          tags: ["Admin Drive"],
          summary: "Create public link",
          description: "Create a public sharing link for a file. Requires admin or API key authentication.",
          operationId: "createDrivePublicLink",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    filePath: { type: "string", description: "Path to the file to share" },
                    expiresInDays: {
                      type: "number",
                      description: "Number of days until expiration (optional)",
                    },
                  },
                  required: ["filePath"],
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Public link created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      success: { type: "boolean" },
                      linkId: { type: "string" },
                      filePath: { type: "string" },
                      publicUrl: { type: "string" },
                      createdAt: { type: "number" },
                      expiresAt: { type: "number", nullable: true },
                    },
                  },
                },
              },
            },
            "400": {
              description: "Bad request - invalid parameters",
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
      "/api/v1/drive/links/{linkId}": {
        delete: {
          tags: ["Admin Drive"],
          summary: "Revoke public link",
          description: "Revoke (delete) a public link. Requires admin or API key authentication.",
          operationId: "revokeDrivePublicLink",
          security: [{ bearerAuth: [] }, { tokenHeader: [] }],
          parameters: [
            {
              name: "linkId",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Link ID to revoke",
            },
          ],
          responses: {
            "200": {
              description: "Link revoked successfully",
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
            "401": {
              description: "Unauthorized",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            "404": {
              description: "Link not found",
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
      "/api/v1/drive/public/{linkId}": {
        get: {
          tags: ["Admin Drive"],
          summary: "Access file via public link",
          description: "Access a file via public sharing link. NO AUTHENTICATION REQUIRED.",
          operationId: "accessDriveFileViaPublicLink",
          security: [],
          parameters: [
            {
              name: "linkId",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: "Public link ID",
            },
          ],
          responses: {
            "200": {
              description: "File content",
              content: {
                "application/octet-stream": {
                  schema: { type: "string", format: "binary" },
                },
              },
            },
            "404": {
              description: "Link not found or expired",
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

      "/api/v1/visualGraph": {
        get: {
          tags: ["Visual Graph"],
          summary: "Visual Graph Interface",
          description: "Get the visual graph HTML interface",
          operationId: "getVisualGraph",
          responses: {
            "200": {
              description: "Visual Graph HTML",
              content: {
                "text/html": {
                  schema: {
                    type: "string",
                  },
                },
              },
            },
            "404": {
              description: "Not found",
              content: {
                "text/plain": {
                  schema: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  };
}

