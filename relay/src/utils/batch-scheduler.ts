import type { IGunInstance } from "gun";
import { loggers } from "./logger";
import { bridgeConfig } from "../config/env-config";
import { submitBatch } from "./batch-submitter";
import { getPendingWithdrawals } from "./bridge-state";

const log = loggers.bridge || console;

let schedulerInterval: NodeJS.Timeout | null = null;
let isProcessing = false;

export function startBatchScheduler(gun: IGunInstance) {
    if (!bridgeConfig.autoBatchEnabled) {
        log.info({}, "Batch scheduler disabled by configuration");
        return;
    }

    if (schedulerInterval) {
        log.warn({}, "Batch scheduler already running");
        return;
    }

    log.info(
        {
            intervalMs: bridgeConfig.autoBatchIntervalMs,
            minWithdrawals: bridgeConfig.autoBatchMinWithdrawals // Note: strictly we should check this before submitting
        },
        "Starting batch scheduler"
    );

    // Run immediately on startup (with a small delay to let GunDB initialize)
    setTimeout(() => {
        runBatchSubmission(gun);
    }, 5000);

    // Set interval
    schedulerInterval = setInterval(() => {
        runBatchSubmission(gun);
    }, bridgeConfig.autoBatchIntervalMs);
}

export function stopBatchScheduler() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
        log.info({}, "Batch scheduler stopped");
    }
}

async function runBatchSubmission(gun: IGunInstance) {
    if (isProcessing) {
        log.info({}, "Batch submission already in progress, skipping");
        return;
    }

    isProcessing = true;

    try {
        // Check if we have enough withdrawals to verify the threshold before trying to submit
        // This avoids unnecessary processing if we have e.g. 1 withdrawal but min is 10
        // But wait, submitBatch does this? No, submitBatch only checks > 0.
        // Optimization: Check count first.
        const pending = await getPendingWithdrawals(gun);
        const minWithdrawals = bridgeConfig.autoBatchMinWithdrawals;

        if (pending.length < minWithdrawals) {
            if (pending.length > 0) {
                log.info(
                    { pending: pending.length, min: minWithdrawals },
                    "Not enough pending withdrawals for auto-batch"
                );
            }
            return; // Skip submission
        }

        log.info({ pending: pending.length }, "Triggering auto-batch submission");

        const result = await submitBatch(gun);

        if (result.success) {
            log.info({ ...result }, "Scheduled batch submission completed successfully");
        } else if (result.error === "No pending withdrawals to batch") {
            // Should be caught by previous check, but just in case
            log.debug({}, "No pending withdrawals to batch");
        } else {
            log.error({ ...result }, "Scheduled batch submission failed");
        }
    } catch (err) {
        log.error({ err }, "Unexpected error in batch scheduler");
    } finally {
        isProcessing = false;
    }
}
