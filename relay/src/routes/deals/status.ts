import { Router, Request, Response } from "express";
import express from "express";
import http from "http";
import https from "https";
import crypto from "crypto";
import { ethers } from "ethers";
import * as StorageDeals from "../../utils/storage-deals";
import * as Reputation from "../../utils/relay-reputation";
import { createRegistryClient, createStorageDealRegistryClient } from "../../utils/registry-client";
import { loggers } from "../../utils/logger";
import { registryConfig, ipfsConfig, relayConfig, x402Config, authConfig } from "../../config";
import { getRelayUser, getRelayPub } from "../../utils/relay-user";
import { cacheDeal, getCachedDeal } from "./utils";
import { X402Merchant } from "../../utils/x402-merchant";

const router: Router = Router();

/**
 * GET /api/v1/deals/:dealId
 *
 * Get deal information.
 */
router.get("/:dealId", async (req: Request, res: Response) => {
  try {
    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res.status(503).json({ success: false, error: "Gun not available" });
    }

    const { dealId } = req.params;

    // Check cache first, then GunDB
    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }

    if (!deal) {
      return res.status(404).json({
        success: false,
        error: "Deal not found",
      });
    }

    // Check if expired
    const isExpired = StorageDeals.isDealExpired(deal);
    const needsRenewal = StorageDeals.needsRenewal(deal);

    res.json({
      success: true,
      deal,
      status: {
        isExpired,
        needsRenewal,
        daysRemaining: deal.expiresAt
          ? Math.max(0, Math.ceil((deal.expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
          : null,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/deals/:dealId/renew
 *
 * Renew an existing deal.
 */
router.post("/:dealId/renew", express.json(), async (req: Request, res: Response) => {
  try {
    const gun = req.app.get("gunInstance");
    const relayUser = getRelayUser();

    if (!gun || !relayUser) {
      return res.status(503).json({ success: false, error: "Relay not initialized" });
    }

    const { dealId } = req.params;
    const { additionalDays, payment } = req.body;

    if (!additionalDays) {
      return res.status(400).json({
        success: false,
        error: "additionalDays required",
      });
    }

    const deal = await StorageDeals.getDeal(gun, dealId);

    if (!deal) {
      return res.status(404).json({ success: false, error: "Deal not found" });
    }

    // Calculate renewal price
    const renewalPricing = StorageDeals.calculateRenewalPrice(deal, parseInt(additionalDays));

    // If no payment, return payment requirements
    if (!payment) {
      return res.status(402).json({
        success: true,
        renewalPricing,
        paymentRequired: {
          x402Version: 1,
          scheme: "exact",
          network: x402Config.defaultNetwork || "base-sepolia",
          maxAmountRequired: Math.ceil((renewalPricing as any).totalPriceUSDC * 1000000).toString(),
          resource: `deal-renewal-${dealId}`,
          description: `Renewal: ${additionalDays} additional days`,
          payTo: x402Config.payToAddress,
        },
      });
    }

    // Verify and settle payment (similar to activate)
    const payToAddress = x402Config.payToAddress;
    if (!payToAddress) {
      return res.status(500).json({ success: false, error: "X402_PAY_TO_ADDRESS not configured" });
    }
    const merchant = new X402Merchant({
      payToAddress,
      network: x402Config.defaultNetwork as any,
      settlementMode: x402Config.settlementMode as "facilitator" | "direct",
      facilitatorUrl: x402Config.facilitatorUrl as string,
      privateKey: x402Config.privateKey,
      facilitatorApiKey: x402Config.facilitatorApiKey,
    });

    const settlement = await merchant.settlePayment(payment);

    if (!settlement.success) {
      return res.status(402).json({
        success: false,
        error: `Payment failed: ${settlement.errorReason}`,
      });
    }

    // Renew deal
    const renewedDeal = StorageDeals.renewDeal(
      deal,
      parseInt(additionalDays),
      settlement.transaction
    );
    const seaKey = (relayUser as any)?._?.sea;
    if (seaKey) {
      await StorageDeals.saveDeal(gun, renewedDeal, seaKey);
    }

    res.json({
      success: true,
      deal: {
        id: renewedDeal.id,
        status: renewedDeal.status,
        expiresAt: renewedDeal.expiresAt,
        durationDays: renewedDeal.durationDays,
      },
      message: `Deal renewed for ${additionalDays} additional days`,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/deals/:dealId/verify
 *
 * Verify that a deal's file is actually stored on the relay.
 */
router.get("/:dealId/verify", async (req: Request, res: Response) => {
  try {
    let { dealId } = req.params;
    const gun = req.app.get("gunInstance");
    const IPFS_API_URL =
      req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
    const IPFS_API_TOKEN = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken;

    // Handle on-chain deal IDs (remove "onchain_" prefix if present)
    const originalDealId = dealId;
    if (dealId.startsWith("onchain_")) {
      dealId = dealId.replace(/^onchain_/, "");
    }

    // Get deal from cache or GunDB
    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }

    // If still not found, try to get from StorageDealRegistry (for any dealId, not just onchain_ prefixed)
    if (!deal) {
      try {
        const REGISTRY_CHAIN_ID = registryConfig.chainId;
        if (REGISTRY_CHAIN_ID) {
          const { createStorageDealRegistryClient } =
            await import("../../utils/registry-client.js");
          const { ethers } = await import("ethers");
          const storageDealRegistryClient = createStorageDealRegistryClient(
            parseInt(String(REGISTRY_CHAIN_ID))
          );

          loggers.server.info({ dealId }, `🔍 Searching for on-chain deal with ID: ${dealId}`);

          // Try multiple strategies to find the deal
          let onChainDeal = null;

          // Strategy 1: Try with dealId as-is (if it's already a bytes32)
          try {
            onChainDeal = await storageDealRegistryClient.getDeal(dealId);
          } catch (e: unknown) {
            onChainDeal = null;
          }

          // Strategy 2: If not found and dealId looks incomplete, try hashing it
          if (!onChainDeal && dealId.startsWith("0x") && dealId.length < 66) {
            try {
              // Try padding to bytes32
              const paddedId = dealId.padEnd(66, "0");
              onChainDeal = await storageDealRegistryClient.getDeal(paddedId);
              if (onChainDeal && onChainDeal.createdAt) {
                dealId = paddedId;
              }
            } catch (e: unknown) {}
          }

          // Strategy 3: If still not found, try hashing the dealId string
          if (!onChainDeal) {
            try {
              const hashedId = ethers.id(dealId);
              onChainDeal = await storageDealRegistryClient.getDeal(hashedId);
              if (onChainDeal && onChainDeal.createdAt) {
                dealId = hashedId;
              }
            } catch (e: unknown) {}
          }

          // Strategy 4: If we have a client address from query, try searching all their deals
          if (!onChainDeal && req.query.clientAddress) {
            try {
              const clientAddressRaw = req.query.clientAddress;
              const clientAddress = Array.isArray(clientAddressRaw)
                ? String(clientAddressRaw[0])
                : typeof clientAddressRaw === "string"
                  ? clientAddressRaw
                  : "";
              if (clientAddress) {
                const clientDeals = await storageDealRegistryClient.getClientDeals(clientAddress);
                for (const clientDeal of clientDeals) {
                  const clientDealIdStr = clientDeal.dealId || "";
                  if (
                    clientDealIdStr.includes(dealId.replace("0x", "")) ||
                    dealId.includes(clientDealIdStr.replace("0x", ""))
                  ) {
                    onChainDeal = clientDeal;
                    dealId = clientDeal.dealId;
                    break;
                  }
                }
              }
            } catch (e: unknown) {}
          }

          const hasCreatedAt =
            onChainDeal?.createdAt &&
            ((typeof onChainDeal.createdAt === "bigint" && onChainDeal.createdAt > 0n) ||
              (typeof onChainDeal.createdAt === "number" && onChainDeal.createdAt > 0) ||
              (typeof onChainDeal.createdAt === "string" &&
                onChainDeal.createdAt !== "1970-01-01T00:00:00.000Z" &&
                onChainDeal.createdAt.length > 0));

          if (onChainDeal && hasCreatedAt) {
            let expiresAtDate;
            if (typeof onChainDeal.expiresAt === "string") {
              expiresAtDate = new Date(onChainDeal.expiresAt);
            } else if (
              typeof onChainDeal.expiresAt === "number" ||
              typeof onChainDeal.expiresAt === "bigint"
            ) {
              expiresAtDate = new Date(Number(onChainDeal.expiresAt) * 1000);
            } else {
              expiresAtDate = new Date(onChainDeal.expiresAt);
            }

            const isActive =
              (onChainDeal as any).active &&
              !isNaN(expiresAtDate.getTime()) &&
              expiresAtDate > new Date();

            deal = {
              id: originalDealId,
              cid: onChainDeal.cid,
              status: isActive ? StorageDeals.DEAL_STATUS.ACTIVE : StorageDeals.DEAL_STATUS.EXPIRED,
              onChainDealId: dealId,
              active: isActive,
            } as any;
          }
        }
      } catch (e: unknown) {
        loggers.server.error({ dealId, err: e }, "Error fetching on-chain deal");
      }
    }

    // If still not found, try searching by CID if provided as query parameter
    if (!deal && req.query.cid) {
      try {
        const cidQuery = Array.isArray(req.query.cid) ? req.query.cid[0] : req.query.cid;
        if (!cidQuery || typeof cidQuery !== "string") {
          throw new Error("Invalid CID query parameter");
        }
        const dealsByCid = await StorageDeals.getDealsByCid(gun, cidQuery);
        if (dealsByCid && dealsByCid.length > 0) {
          deal = dealsByCid[0];
          loggers.server.info(
            { dealId, cid: req.query.cid },
            `✅ Found deal by CID: ${req.query.cid}`
          );
        }
      } catch (e: unknown) {}
    }

    if (!deal) {
      return res.status(404).json({ success: false, error: "Deal not found" });
    }

    const isActive =
      deal.status === StorageDeals.DEAL_STATUS.ACTIVE ||
      (deal.onChainDealId && (deal as any).active !== false);
    if (!isActive) {
      return res.status(400).json({
        success: false,
        error: `Deal is ${deal.status || "inactive"}, cannot verify`,
      });
    }

    const cid = deal.cid;

    // Helper function to make IPFS API HTTP requests
    const makeIpfsRequest = (path: string, method: string = "POST") => {
      return new Promise((resolve, reject) => {
        const url = new URL(IPFS_API_URL);
        const isHttps = url.protocol === "https:";
        const protocolModule = isHttps ? https : http;
        const options = {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 5001),
          path: `/api/v0${path}`,
          method,
          headers: { "Content-Length": "0" } as Record<string, string>,
        };

        if (IPFS_API_TOKEN) {
          options.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
        }

        const req = protocolModule.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                resolve({ raw: data });
              }
            } else {
              reject(new Error(`IPFS API returned ${res.statusCode}: ${data.substring(0, 200)}`));
            }
          });
        });

        req.on("error", reject);
        req.setTimeout(15000, () => {
          req.destroy();
          reject(new Error("IPFS request timeout"));
        });
        req.end();
      });
    };

    // 1. Verify CID exists in IPFS (try block/stat first)
    let ipfsStat = null;
    let ipfsExists = false;
    let blockSize = null;

    try {
      const blockStat = (await makeIpfsRequest(
        `/block/stat?arg=${encodeURIComponent(cid)}`
      )) as any;
      ipfsStat = blockStat;
      blockSize = blockStat?.Size || blockStat?.size;
      ipfsExists = true;
    } catch (error: unknown) {
      try {
        const dagStat = (await makeIpfsRequest(`/dag/stat?arg=${encodeURIComponent(cid)}`)) as any;
        ipfsStat = dagStat;
        blockSize = dagStat?.Size || dagStat?.size;
        ipfsExists = true;
      } catch (dagError: unknown) {
        ipfsExists = false;
      }
    }

    // 2. Check if pinned
    let isPinned = false;
    try {
      const pinResult = await makeIpfsRequest(`/pin/ls?arg=${encodeURIComponent(cid)}&type=all`);
      const pinResultObj = pinResult as any;
      if (pinResultObj && pinResultObj.Keys && Object.keys(pinResultObj.Keys).length > 0) {
        isPinned = true;
      } else if (
        pinResultObj &&
        (pinResultObj.Type === "recursive" || pinResultObj.Type === "direct")
      ) {
        isPinned = true;
      }
    } catch (error: unknown) {
      try {
        const allPins = (await makeIpfsRequest(`/pin/ls?type=all`)) as any;
        if (allPins && allPins.Keys) {
          isPinned = cid in allPins.Keys;
        }
      } catch (listError: unknown) {
        isPinned = false;
      }
    }

    // 3. Try to fetch a small sample of data
    let canRead = false;
    let readError = null;

    try {
      const url = new URL(IPFS_API_URL);
      const isHttps = url.protocol === "https:";
      const protocolModule = isHttps ? https : http;
      const catOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 5001),
        path: `/api/v0/cat?arg=${encodeURIComponent(cid)}&length=256`,
        method: "POST",
        headers: { "Content-Length": "0" } as Record<string, string>,
      };

      if (IPFS_API_TOKEN) {
        catOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const catData = await new Promise<Buffer>((resolve, reject) => {
        const req = protocolModule.request(catOptions, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              resolve(Buffer.concat(chunks));
            } else {
              reject(new Error(`cat returned ${res.statusCode || "unknown"}`));
            }
          });
        });
        req.on("error", reject);
        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error("cat timeout"));
        });
        req.end();
      });

      if (catData && Buffer.isBuffer(catData) && catData.length > 0) {
        canRead = true;
      }
    } catch (error: unknown) {
      readError = error instanceof Error ? error.message : String(error);
      canRead = false;
    }

    const isVerified = ipfsExists && isPinned && canRead;
    const verification = {
      dealId,
      cid,
      verified: isVerified,
      timestamp: Date.now(),
      checks: {
        existsInIPFS: ipfsExists,
        isPinned: isPinned,
        canRead: canRead,
        blockSize: blockSize,
      },
      issues: [] as string[],
    };

    if (!ipfsExists) (verification.issues as string[]).push("CID not found in IPFS");
    if (!isPinned) (verification.issues as string[]).push("CID is not pinned");
    if (!canRead)
      (verification.issues as string[]).push(
        `Cannot read content: ${readError || "unknown error"}`
      );

    // Record proof for reputation
    if (gun) {
      try {
        const host =
          (relayConfig as any).host ||
          (relayConfig as any).endpoint ||
          req.headers.host ||
          "localhost";
        let normalizedHost = host;
        if (host.includes("://")) {
          normalizedHost = new URL(host).hostname;
        }

        const relayUser = getRelayUser();
        const keyPair = (relayUser as any)?._?.sea || null;

        if (isVerified) {
          await Reputation.recordProofSuccess(gun, normalizedHost, 0, keyPair);
        } else {
          await Reputation.recordProofFailure(gun, normalizedHost, keyPair);
        }
      } catch (e: unknown) {
        loggers.server.warn({ err: e }, "Failed to record proof result");
      }
    }

    res.json({
      success: true,
      verification,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * GET /api/v1/deals/:dealId/verify-proof
 *
 * Challenge the relay to provide a storage proof for a deal.
 */
router.get("/:dealId/verify-proof", async (req: Request, res: Response) => {
  try {
    const { dealId } = req.params;
    const challenge = req.query.challenge || crypto.randomBytes(16).toString("hex");

    const gun = req.app.get("gunInstance");
    const IPFS_API_URL =
      req.app.get("IPFS_API_URL") || ipfsConfig.apiUrl || "http://127.0.0.1:5001";
    const IPFS_API_TOKEN = req.app.get("IPFS_API_TOKEN") || ipfsConfig.apiToken;

    if (!gun) {
      return res.status(503).json({ success: false, error: "Gun not available" });
    }

    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }

    if (!deal) {
      return res.status(404).json({ success: false, error: "Deal not found" });
    }

    const cid = deal.cid;

    const makeIpfsRequest = (path: string, method = "POST") => {
      return new Promise((resolve, reject) => {
        const url = new URL(IPFS_API_URL);
        const options = {
          hostname: url.hostname,
          port: url.port || 5001,
          path: `/api/v0${path}`,
          method,
          headers: { "Content-Length": "0" } as Record<string, string>,
        };

        if (IPFS_API_TOKEN) {
          options.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
        }

        const req = http.request(options, (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                resolve({ raw: data });
              }
            } else {
              reject(new Error(`IPFS API returned ${res.statusCode}`));
            }
          });
        });

        req.on("error", reject);
        req.setTimeout(15000, () => {
          req.destroy();
          reject(new Error("IPFS request timeout"));
        });
        req.end();
      });
    };

    // 1. Verify CID exists
    let blockStat: any;
    try {
      blockStat = (await makeIpfsRequest(`/block/stat?arg=${encodeURIComponent(cid)}`)) as any;
      if (blockStat?.Message || blockStat?.Type === "error") {
        return res.status(404).json({
          success: false,
          error: "CID not found on this relay for proof generation",
          cid,
          dealId,
        });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return res.status(404).json({
        success: false,
        error: "CID not found on this relay",
        details: errorMessage,
      });
    }

    // 2. Get content sample
    let contentSample = null;
    try {
      const url = new URL(IPFS_API_URL);
      const isHttps = url.protocol === "https:";
      const protocolModule = isHttps ? https : http;
      const catOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 5001),
        path: `/api/v0/cat?arg=${encodeURIComponent(cid)}&length=256`,
        method: "POST",
        headers: { "Content-Length": "0" } as Record<string, string>,
      };

      if (IPFS_API_TOKEN) {
        catOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const catData = await new Promise<Buffer>((resolve, reject) => {
        const req = protocolModule.request(catOptions, (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              resolve(Buffer.concat(chunks));
            } else {
              reject(new Error(`cat returned ${res.statusCode || "unknown"}`));
            }
          });
        });
        req.on("error", reject);
        req.setTimeout(10000, () => {
          req.destroy();
          reject(new Error("cat timeout"));
        });
        req.end();
      });

      if (catData && Buffer.isBuffer(catData) && catData.length > 0) {
        contentSample = catData.toString("base64");
      }
    } catch (error: unknown) {
      contentSample = "";
    }

    // 3. Check if pinned
    let isPinned = false;
    try {
      const pinLs = (await makeIpfsRequest(
        `/pin/ls?arg=${encodeURIComponent(cid)}&type=all`
      )) as any;
      isPinned = pinLs?.Keys && Object.keys(pinLs.Keys).length > 0;
    } catch (error: unknown) {
      isPinned = false;
    }

    // 4. Generate proof hash
    const timestamp = Date.now();
    const blockSize = blockStat.Size || blockStat.size;
    const proofData = `${cid}:${challenge}:${timestamp}:${blockSize}:${contentSample}`;
    const proofHash = crypto.createHash("sha256").update(proofData).digest("hex");
    const relayPub = req.app.get("relayUserPub");

    res.json({
      success: true,
      proof: {
        dealId,
        cid,
        challenge,
        timestamp,
        proofHash,
        relayPub: relayPub || null,
        block: { size: blockSize },
        contentSampleBase64: contentSample,
        isPinned,
        verification: {
          method: "sha256(cid:challenge:timestamp:size:contentSampleBase64)",
          validFor: 300000,
          expiresAt: timestamp + 300000,
        },
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/deals/:dealId/report
 *
 * Report an issue with a deal (missed proof or data loss) for slashing.
 */
router.post("/:dealId/report", express.json(), async (req: Request, res: Response) => {
  try {
    const gun = req.app.get("gunInstance");
    const { dealId } = req.params;
    const { clientAddress, reportType, reason, evidence = "" } = req.body;

    if (!gun) {
      return res.status(503).json({ success: false, error: "Gun not available" });
    }

    if (!clientAddress) {
      return res.status(400).json({ success: false, error: "clientAddress is required" });
    }

    if (!reportType || (reportType !== "missedProof" && reportType !== "dataLoss")) {
      return res.status(400).json({
        success: false,
        error: 'reportType must be "missedProof" or "dataLoss"',
      });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ success: false, error: "reason is required" });
    }

    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }

    if (!deal && registryConfig.chainId) {
      try {
        const chainId = parseInt(String(registryConfig.chainId));
        const storageDealRegistryClient = createStorageDealRegistryClient(chainId);
        const dealIdHash = ethers.id(dealId);
        const onChainDeal = await storageDealRegistryClient.getDeal(dealIdHash);

        if (onChainDeal) {
          deal = {
            id: dealId,
            clientAddress: onChainDeal.client,
            providerPub: onChainDeal.relay,
            cid: onChainDeal.cid,
            onChainDealId: onChainDeal.dealId,
          } as any;
          (deal as any).onChainRegistered = true;
        }
      } catch (error: unknown) {}
    }

    if (!deal) {
      return res.status(404).json({ success: false, error: "Deal not found" });
    }

    const normalizedClient = clientAddress.toLowerCase();
    const dealClient = deal.clientAddress?.toLowerCase() || (deal as any).client?.toLowerCase();

    if (!dealClient || dealClient !== normalizedClient) {
      return res.status(403).json({
        success: false,
        error: "You can only report issues for your own deals",
      });
    }

    let relayAddress = null;
    if (deal.onChainRelay) {
      relayAddress = deal.onChainRelay;
    } else if (deal.providerPub && deal.providerPub.startsWith("0x")) {
      relayAddress = deal.providerPub;
    } else if (registryConfig.chainId && deal.onChainDealId) {
      try {
        const chainId = parseInt(String(registryConfig.chainId));
        const storageDealRegistryClient = createStorageDealRegistryClient(chainId);
        const onChainDeal = await storageDealRegistryClient.getDeal(deal.onChainDealId);
        if (onChainDeal) {
          relayAddress = onChainDeal.relay;
        }
      } catch (error: unknown) {}
    }

    if (!relayAddress) {
      return res.status(400).json({
        success: false,
        error:
          "Could not determine relay address for this deal. Deal may not be registered on-chain.",
      });
    }

    let onChainDealId = deal.onChainDealId;
    if (!onChainDealId) {
      onChainDealId = ethers.id(dealId);
    }

    const chainId = parseInt(String(registryConfig.chainId)) || registryConfig.chainId;
    const storageDealRegistryClient = createStorageDealRegistryClient(chainId);
    const storageDealRegistryAddress = storageDealRegistryClient.registryAddress;

    const storageDealRegistryInterface = new ethers.Interface([
      "function grief(bytes32 dealId, uint256 slashAmount, string reason)",
    ]);

    const slashBps = reportType === "missedProof" ? 100 : 1000;
    const relayInfo = await createRegistryClient(chainId).getRelayInfo(relayAddress);
    const stakedAmount = BigInt(relayInfo.stakedAmountRaw);
    const slashAmount = (stakedAmount * BigInt(slashBps)) / 10000n;

    const evidenceText = evidence || reason;
    const callData = storageDealRegistryInterface.encodeFunctionData("grief", [
      onChainDealId,
      slashAmount,
      evidenceText,
    ]);

    const transaction = {
      to: storageDealRegistryAddress,
      data: callData,
      value: "0x0",
    };

    res.json({
      success: true,
      report: {
        dealId,
        onChainDealId,
        relayAddress,
        reportType,
        reason,
        evidence: evidenceText,
        transaction,
        chainId,
        storageDealRegistryAddress,
        functionName: "grief",
        griefingCost: null,
        slashAmount: slashAmount
          ? {
              amount: slashAmount.toString(),
              currency: "USDC",
              note: "Amount that will be slashed from relay stake",
            }
          : null,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/deals/:dealId/cancel
 *
 * Cancel/terminate your own deal.
 */
router.post("/:dealId/cancel", express.json(), async (req: Request, res: Response) => {
  try {
    const gun = req.app.get("gunInstance");
    const relayUser = getRelayUser();
    const { dealId } = req.params;
    const { clientAddress, reason = "User requested cancellation" } = req.body;

    if (!gun || !relayUser) {
      return res.status(503).json({ success: false, error: "Relay not initialized" });
    }

    if (!clientAddress) {
      return res.status(400).json({ success: false, error: "clientAddress is required" });
    }

    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }

    if (!deal) {
      return res.status(404).json({ success: false, error: "Deal not found" });
    }

    if (deal.clientAddress.toLowerCase() !== clientAddress.toLowerCase()) {
      return res.status(403).json({
        success: false,
        error: "You can only cancel your own deals",
      });
    }

    if (deal.status === StorageDeals.DEAL_STATUS.TERMINATED) {
      return res.status(400).json({
        success: false,
        error: "Deal is already terminated",
      });
    }

    const terminatedDeal = StorageDeals.terminateDeal(deal);
    (terminatedDeal as any).terminatedAt = Date.now();
    (terminatedDeal as any).terminationReason = reason;
    const seaKey = (relayUser as any)?._?.sea;
    if (seaKey) {
      await StorageDeals.saveDeal(gun, terminatedDeal, seaKey);
    }

    cacheDeal(terminatedDeal);
    res.json({
      success: true,
      deal: {
        id: terminatedDeal.id,
        status: terminatedDeal.status,
        terminatedAt: (terminatedDeal as any).terminatedAt,
      },
      message: "Deal cancelled successfully",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * POST /api/v1/deals/:dealId/terminate
 *
 * Terminate a deal early. Admin only.
 */
router.post("/:dealId/terminate", express.json(), async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1] || req.headers["token"];
    if (token !== authConfig.adminPassword) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const gun = req.app.get("gunInstance");
    const relayUser = getRelayUser();
    const { dealId } = req.params;
    const { reason = "Admin termination" } = req.body;

    if (!gun || !relayUser) {
      return res.status(503).json({ success: false, error: "Relay not initialized" });
    }

    let deal = getCachedDeal(dealId);
    if (!deal) {
      deal = await StorageDeals.getDeal(gun, dealId);
    }

    if (!deal) {
      return res.status(404).json({ success: false, error: "Deal not found" });
    }

    const terminatedDeal = StorageDeals.terminateDeal(deal);
    (terminatedDeal as any).terminationReason = reason;
    (terminatedDeal as any).terminatedAt = Date.now();
    const keyPair = (relayUser as any)?._?.sea;
    await StorageDeals.saveDeal(gun, terminatedDeal, keyPair);
    cacheDeal(terminatedDeal);

    res.json({
      success: true,
      deal: {
        id: terminatedDeal.id,
        status: terminatedDeal.status,
        terminatedAt: (terminatedDeal as any).terminatedAt,
      },
      message: "Deal terminated",
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;
