import { Router, Request, Response } from "express";
import http from "http";
import { loggers } from "../../utils/logger";
import { X402Merchant } from "../../utils/x402-merchant";
import { IPFS_API_TOKEN } from "./utils";
import type { IpfsRequestOptions } from "./types";

const router: Router = Router();

/**
 * Get user uploads list (for x402 subscription users)
 */
router.get("/user-uploads/:userAddress", async (req, res) => {
  try {
    const { userAddress } = req.params;

    if (!userAddress) {
      return res.status(400).json({ success: false, error: "User address is required" });
    }

    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res
        .status(500)
        .json({ success: false, error: "Server error - Gun instance not available" });
    }

    const uploads = await X402Merchant.getUserUploads(gun, userAddress);
    const subscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);

    res.json({
      success: true,
      userAddress,
      uploads: uploads.map((upload) => ({
        hash: upload.hash,
        name: upload.name,
        size: upload.size,
        sizeMB: upload.sizeMB || (upload.size ? upload.size / (1024 * 1024) : 0),
        mimetype: upload.mimetype,
        uploadedAt: upload.uploadedAt,
      })),
      count: uploads.length,
      subscription: subscription.active
        ? {
            tier: subscription.tier,
            storageMB: subscription.storageMB,
            storageUsedMB: subscription.storageUsedMB,
            storageRemainingMB: subscription.storageRemainingMB,
          }
        : null,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ Get user uploads error");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * View/download user uploaded file (for x402 subscription users)
 */
router.get("/user-uploads/:userAddress/:hash/view", async (req, res) => {
  try {
    const { userAddress, hash } = req.params;

    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res
        .status(500)
        .json({ success: false, error: "Server error - Gun instance not available" });
    }

    const uploads = await X402Merchant.getUserUploads(gun, userAddress);
    const uploadRecord = uploads.find((u) => u.hash === hash);

    if (!uploadRecord) {
      return res.status(404).json({ success: false, error: "File not found for this user" });
    }

    const isEncrypted =
      uploadRecord.mimetype === "application/json" ||
      uploadRecord.mimetype === "text/plain" ||
      (uploadRecord.name &&
        (uploadRecord.name.endsWith(".encrypted") || uploadRecord.name.endsWith(".enc")));

    const mimetype = isEncrypted
      ? "application/json"
      : uploadRecord.mimetype || "application/octet-stream";
    const filename = uploadRecord.name || hash;

    const requestOptions: IpfsRequestOptions = {
      hostname: "127.0.0.1",
      port: 5001,
      path: `/api/v0/cat?arg=${encodeURIComponent(hash)}`,
      method: "POST",
      headers: { "Content-Length": "0" },
    };

    if (IPFS_API_TOKEN) {
      requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
    }

    const ipfsReq = http.request(requestOptions, (ipfsRes) => {
      const isDownload = req.query.download === "true" || req.query.dl === "true";

      if (isEncrypted) {
        res.setHeader("Content-Type", "application/json");
        res.setHeader(
          "Content-Disposition",
          isDownload ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`
        );
      } else {
        res.setHeader("Content-Type", mimetype);
        res.setHeader(
          "Content-Disposition",
          isDownload ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`
        );
      }
      res.setHeader("Cache-Control", "public, max-age=31536000");
      ipfsRes.pipe(res);

      ipfsRes.on("error", (err) => {
        loggers.server.error({ err, hash }, `❌ IPFS Content error`);
        if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
      });
    });

    ipfsReq.on("error", (err) => {
      loggers.server.error({ err, hash }, `❌ IPFS Content request error`);
      if (!res.headersSent) res.status(500).json({ success: false, error: err.message });
    });

    ipfsReq.setTimeout(30000, () => {
      ipfsReq.destroy();
      if (!res.headersSent)
        res.status(408).json({ success: false, error: "Content retrieval timeout" });
    });

    ipfsReq.end();
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ View user upload error");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * Download user uploaded file (alias for view with download=true)
 */
router.get("/user-uploads/:userAddress/:hash/download", async (req, res) => {
  const newUrl =
    req.url.replace("/download", "/view") +
    (req.url.includes("?") ? "&download=true" : "?download=true");
  return res.redirect(newUrl);
});

/**
 * Decrypt user uploaded file (for subscription files)
 * Redirects to /cat/:cid/decrypt after verification
 */
router.get("/user-uploads/:userAddress/:hash/decrypt", async (req: Request, res: Response) => {
  try {
    const { userAddress, hash } = req.params;
    const headerUserAddressRaw = req.headers["x-user-address"];
    const headerUserAddress = Array.isArray(headerUserAddressRaw)
      ? headerUserAddressRaw[0]
      : headerUserAddressRaw;

    loggers.server.debug({ hash, userAddress }, `🔓 User upload decrypt request`);

    if (
      !headerUserAddress ||
      typeof headerUserAddress !== "string" ||
      headerUserAddress.toLowerCase() !== userAddress.toLowerCase()
    ) {
      return res
        .status(401)
        .json({ success: false, error: "Unauthorized - User address mismatch" });
    }

    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res
        .status(500)
        .json({ success: false, error: "Server error - Gun instance not available" });
    }

    const uploads = await X402Merchant.getUserUploads(gun, userAddress);
    const uploadRecord = uploads.find((u) => u.hash === hash);

    if (!uploadRecord) {
      return res.status(404).json({ success: false, error: "File not found for this user" });
    }

    loggers.server.debug({ hash }, `✅ File ownership verified, redirecting to /cat/:cid/decrypt`);

    const queryParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (typeof value === "string") queryParams[key] = value;
      else if (Array.isArray(value) && value.length > 0) queryParams[key] = String(value[0]);
    }
    const queryString = new URLSearchParams(queryParams).toString();
    const redirectUrl = `/api/v1/ipfs/cat/${hash}/decrypt${queryString ? `?${queryString}` : ""}`;

    return res.redirect(redirectUrl);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ User upload decrypt error");
    if (!res.headersSent) res.status(500).json({ success: false, error: errorMessage });
  }
});

/**
 * Delete/unpin user file (for x402 subscription users)
 */
router.delete("/user-uploads/:userAddress/:hash", async (req, res) => {
  try {
    const { userAddress, hash } = req.params;
    const headerUserAddressRaw = req.headers["x-user-address"];
    const headerUserAddress = Array.isArray(headerUserAddressRaw)
      ? headerUserAddressRaw[0]
      : headerUserAddressRaw;

    if (
      !headerUserAddress ||
      typeof headerUserAddress !== "string" ||
      headerUserAddress.toLowerCase() !== userAddress.toLowerCase()
    ) {
      return res
        .status(401)
        .json({ success: false, error: "Unauthorized - User address mismatch" });
    }

    const gun = req.app.get("gunInstance");
    if (!gun) {
      return res
        .status(500)
        .json({ success: false, error: "Server error - Gun instance not available" });
    }

    const subscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);
    if (!subscription.active) {
      return res.status(403).json({ success: false, error: "No active subscription" });
    }

    const uploads = await X402Merchant.getUserUploads(gun, userAddress);
    const uploadRecord = uploads.find((u) => u.hash === hash);

    if (!uploadRecord) {
      return res.status(404).json({ success: false, error: "Upload not found" });
    }

    const fileSizeMB =
      uploadRecord.sizeMB || (uploadRecord.size ? uploadRecord.size / (1024 * 1024) : 0);

    loggers.server.info({ hash }, `📌 Unpinning from IPFS`);
    const unpinResult = await new Promise((resolve) => {
      const requestOptions: IpfsRequestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: `/api/v0/pin/rm?arg=${hash}`,
        method: "POST",
        headers: { "Content-Length": "0" },
      };

      if (IPFS_API_TOKEN) {
        requestOptions.headers["Authorization"] = `Bearer ${IPFS_API_TOKEN}`;
      }

      const ipfsReq = http.request(requestOptions, (ipfsRes) => {
        let data = "";
        ipfsRes.on("data", (chunk) => (data += chunk));
        ipfsRes.on("end", () => {
          try {
            resolve({ success: true, result: JSON.parse(data) });
          } catch {
            resolve({ success: true, warning: "Could not parse IPFS response", raw: data });
          }
        });
      });

      ipfsReq.on("error", (err) => {
        loggers.server.error({ err, hash }, `❌ IPFS unpin error`);
        resolve({ success: false, error: err.message });
      });

      ipfsReq.setTimeout(30000, () => resolve({ success: false, error: "Timeout" }));
      ipfsReq.end();
    });

    loggers.server.info({ hash }, `🗑️ Deleting upload record`);
    try {
      await X402Merchant.deleteUploadRecord(userAddress, hash);
    } catch (e) {
      loggers.server.warn({ err: e, hash }, `⚠️ Failed to delete upload record`);
    }

    try {
      const updateResult = await X402Merchant.updateStorageUsage(gun, userAddress, -fileSizeMB);
      loggers.server.info(
        {
          storageUsedMB: updateResult.storageUsedMB,
          storageRemainingMB: updateResult.storageRemainingMB,
        },
        `✅ Storage updated`
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("No active subscription"))
        loggers.server.warn({ err: e }, `⚠️ Failed to update storage`);
    }

    const updatedSubscription = await X402Merchant.getSubscriptionStatus(gun, userAddress);

    res.json({
      success: true,
      message: "File unpinned and removed successfully",
      hash,
      unpin: unpinResult,
      subscription: updatedSubscription.active
        ? {
            storageUsedMB: updatedSubscription.storageUsedMB,
            storageRemainingMB: updatedSubscription.storageRemainingMB,
          }
        : null,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    loggers.server.error({ err: error }, "❌ Delete user file error");
    res.status(500).json({ success: false, error: errorMessage });
  }
});

export default router;
