import { Request } from "express";
import crypto from "crypto";
import FormData from "form-data";
import { loggers } from "../../utils/logger";
import { ipfsRequest, ipfsUpload } from "../../utils/ipfs-client";
import * as ErasureCoding from "../../utils/erasure-coding";
import * as StorageDeals from "../../utils/storage-deals";
import type { Deal } from "../../utils/storage-deals";
import { getRelayUser } from "../../utils/relay-user";
import { replicationConfig } from "../../config";
import { GUN_PATHS } from "../../utils/gun-paths";

/**
 * Apply tier-specific features (erasure coding and replication)
 * Called automatically when premium/enterprise deals are activated
 */
export async function applyTierFeatures(deal: Deal, req: Request) {
  if (!req || !req.app) {
    loggers.server.warn("⚠️ Request context not available, skipping tier features");
    return;
  }

  const gun = req.app.get("gunInstance");
  if (!gun) {
    loggers.server.warn("⚠️ Gun not available, skipping tier features");
    return;
  }

  const cid = deal.cid;
  const replicationFactor = deal.replicationFactor || 1;
  const shouldApplyErasure = deal.erasureCoding || false;

  loggers.server.info(
    { dealId: deal.id, erasureCoding: shouldApplyErasure, replicationFactor },
    `🔧 Applying tier features for deal ${deal.id}:`
  );
  loggers.server.debug(`   - Erasure Coding: ${shouldApplyErasure ? "Yes" : "No"}`);
  loggers.server.debug(`   - Replication Factor: ${replicationFactor}x`);

  // Apply erasure coding if enabled
  if (shouldApplyErasure) {
    try {
      loggers.server.info({ cid }, `📦 Applying erasure coding to CID: ${cid}`);

      // Helper function to download from IPFS
      const downloadFromIPFS = async (cidToDownload: string): Promise<Buffer> => {
        const result = await ipfsRequest(`/cat?arg=${encodeURIComponent(cidToDownload)}`, {
          responseType: "arraybuffer",
        });
        return Buffer.isBuffer(result) ? result : Buffer.from(result as ArrayBuffer);
      };

      // Helper function to upload buffer to IPFS
      const uploadToIPFS = async (buffer: Buffer, filename = "chunk"): Promise<string> => {
        const form = new FormData();
        form.append("file", buffer, {
          filename: filename,
          contentType: "application/octet-stream",
        });

        // Use unified ipfsUpload
        const result = await ipfsUpload("/api/v0/add?pin=true", form);
        return result.Hash;
      };

      // Step 1: Download file from IPFS
      loggers.server.debug({ cid }, `📥 Downloading file from IPFS: ${cid}`);
      const fileData = await downloadFromIPFS(cid);
      loggers.server.debug(
        { cid, sizeMB: (fileData.length / 1024 / 1024).toFixed(2) },
        `✅ Downloaded ${(fileData.length / 1024 / 1024).toFixed(2)} MB`
      );

      // Step 2: Apply erasure coding
      const erasureConfig = {
        chunkSize: 256 * 1024, // 256KB chunks
        dataChunks: 10, // 10 data chunks
        parityChunks: 4, // 4 parity chunks (40% redundancy)
        minChunksForRecovery: 10, // Need 10 chunks to recover
      };

      loggers.server.debug({ cid }, `🔧 Encoding data with erasure coding...`);
      const encoded = ErasureCoding.encodeData(fileData as any, erasureConfig);

      loggers.server.info(
        {
          cid,
          dataChunks: encoded.dataChunkCount,
          parityChunks: encoded.parityChunkCount,
        },
        `✅ Encoded into ${encoded.dataChunkCount} data chunks + ${encoded.parityChunkCount} parity chunks`
      );

      // Step 3: Upload all chunks to IPFS
      loggers.server.debug({ cid }, `📤 Uploading chunks to IPFS...`);
      const chunkCids = [];

      // Upload data chunks
      for (let i = 0; i < encoded.dataChunks.length; i++) {
        const chunkCid = await uploadToIPFS(encoded.dataChunks[i], `data-chunk-${i}`);
        const chunkInfo = encoded.chunks[i]; // chunkInfos array has metadata
        chunkCids.push({
          type: "data",
          index: i,
          cid: chunkCid,
          hash: chunkInfo.hash,
          size: chunkInfo.size,
        });
        loggers.server.debug(
          { cid, chunkCid, index: i + 1, total: encoded.dataChunkCount },
          `  ✅ Data chunk ${i + 1}/${encoded.dataChunkCount}: ${chunkCid}`
        );
      }

      // Upload parity chunks
      for (let i = 0; i < encoded.parityChunks.length; i++) {
        const parityIndex = encoded.dataChunkCount + i;
        const parityCid = await uploadToIPFS(encoded.parityChunks[i], `parity-chunk-${i}`);
        const chunkInfo = encoded.chunks[parityIndex]; // chunkInfos includes both data and parity
        chunkCids.push({
          type: "parity",
          index: i,
          cid: parityCid,
          hash: chunkInfo.hash,
          size: chunkInfo.size,
        });
        loggers.server.debug(
          { cid, parityCid, index: i + 1, total: encoded.parityChunkCount },
          `  ✅ Parity chunk ${i + 1}/${encoded.parityChunkCount}: ${parityCid}`
        );
      }

      // Step 4: Store erasure metadata in deal
      const erasureMetadata = {
        originalCid: cid,
        originalSize: fileData.length,
        chunkSize: erasureConfig.chunkSize,
        dataChunks: encoded.dataChunkCount,
        parityChunks: encoded.parityChunkCount,
        minChunksForRecovery: erasureConfig.minChunksForRecovery,
        redundancyPercent: encoded.redundancyPercent,
        chunks: chunkCids,
        encodedAt: Date.now(),
      };

      deal.erasureMetadata = erasureMetadata;

      // Save updated deal with erasure metadata
      const relayUser = getRelayUser();
      if (relayUser && (relayUser as any)?._?.sea) {
        await StorageDeals.saveDeal(gun, deal, (relayUser as any)._?.sea);
        loggers.server.info(
          { dealId: deal.id },
          `✅ Erasure coding metadata saved to deal ${deal.id}`
        );
      }

      loggers.server.info(
        {
          dealId: deal.id,
          cid,
          totalChunks: chunkCids.length,
          dataChunks: encoded.dataChunkCount,
          parityChunks: encoded.parityChunkCount,
          redundancyPercent: encoded.redundancyPercent,
        },
        `✅ Erasure coding completed successfully for deal ${deal.id}`
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      loggers.server.error({ err: error, dealId: deal.id, cid }, `❌ Erasure coding failed`);
      (deal as any).erasureCodingError = {
        message: errorMessage,
        timestamp: Date.now(),
      };
    }
  }

  // Apply replication if replicationFactor > 1
  if (replicationFactor > 1) {
    try {
      loggers.server.info(
        { cid, replicationFactor },
        `🔄 Requesting ${replicationFactor}x replication for CID: ${cid}`
      );

      // Use network pin-request to request replication
      const autoReplication = replicationConfig.autoReplication !== false;
      if (autoReplication) {
        // Publish pin request to network via GunDB
        const relayPub = req.app.get("relayUserPub");
        const requestId = crypto.randomBytes(8).toString("hex");

        const pinRequest = {
          id: requestId,
          cid,
          requester: relayPub,
          replicationFactor,
          priority: deal.tier === "enterprise" ? "high" : "normal",
          timestamp: Date.now(),
          status: "pending",
          dealId: deal.id,
        };

        gun.get(GUN_PATHS.PIN_REQUESTS).get(requestId).put(pinRequest);
        loggers.server.info(
          { cid, replicationFactor, requestId },
          `✅ Replication request published: ${cid} (${replicationFactor}x)`
        );

        // Update deal with replication request info
        (deal as any).replicationRequestId = requestId;
        (deal as any).replicationRequestedAt = Date.now();

        // Save updated deal
        const relayUser = getRelayUser();
        if (relayUser && (relayUser as any)._ && (relayUser as any)._?.sea) {
          await StorageDeals.saveDeal(gun, deal, (relayUser as any)._?.sea);
        }
      } else {
        loggers.server.info({ cid }, `⚠️ Auto-replication disabled - replication not requested`);
      }
    } catch (error: unknown) {
      loggers.server.error({ err: error, cid }, `❌ Replication request failed`);
    }
  }
}
