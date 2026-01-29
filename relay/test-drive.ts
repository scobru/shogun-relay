
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const relayRoot = __dirname;
// We need to load env before importing config
dotenv.config({ path: path.join(relayRoot, ".env") });

async function main() {
    console.log("--- Drive Debug Script ---");
    console.log("CWD:", process.cwd());

    // FORCE MINIO CONFIGURATION FOR TESTING
    // We want to simulate valid config (so app starts) but invalid connection (runtime error)
    process.env.DRIVE_STORAGE_TYPE = "minio";
    process.env.MINIO_ENDPOINT = "https://cloud.scobrudot.dev"; // Real endpoint
    process.env.MINIO_ACCESS_KEY = "dummy_access"; // Invalid key
    process.env.MINIO_SECRET_KEY = "dummy_secret"; // Invalid key
    process.env.MINIO_BUCKET = "shogun-drive";

    // Re-import config to pick up env vars (this is hacky but might work if config isn't frozen)
    // Actually config is likely already loaded. We might need to mock getStorageAdapter or create a fresh instance.
    // The createStorageAdapter function reads from driveConfig.
    // driveConfig reads from process.env at load time.
    // So we might need to rely on the fact that we set env vars BEFORE re-running or manual instantiation.
    // But since config is already imported, we can't change it easily.

    // Instead, let's manually instantiate MinIO adapter if we can export it, 
    // OR we relies on the tool to just run this script. 
    // Wait, env-config.ts reads process.env AT IMPORT.
    // So setting process.env HERE is too late if we already imported `driveConfig`.
    // We need to set env vars BEFORE importing `./src/config/env-config`.

    // So we will restart the logic in a new block or just rely on the fact that I'm editing the file.
}

// Wrapping in IIFE to handle imports after env set
(async () => {
    // Set ENV vars mock
    process.env.DRIVE_STORAGE_TYPE = "minio";
    process.env.MINIO_ENDPOINT = "https://cloud.scobrudot.dev";
    process.env.MINIO_ACCESS_KEY = "dummy_access";
    process.env.MINIO_SECRET_KEY = "dummy_secret";
    process.env.MINIO_BUCKET = "shogun-drive";

    // Dynamic import to load config AFTER env vars are set
    const { driveConfig } = await import("./src/config/env-config");
    const { createStorageAdapter } = await import("./src/utils/storage-adapter");

    console.log("Drive Config (Loaded):", {
        storageType: driveConfig.storageType,
        minio: {
            endpoint: driveConfig.minio.endpoint,
            hasAccessKey: !!driveConfig.minio.accessKey,
        }
    });

    try {
        console.log("Initializing Storage Adapter...");
        // force new instance
        const adapter = createStorageAdapter();
        console.log(`Adapter created: ${adapter.getStorageType()}`);

        console.log("Testing listDirectory('')...");
        const items = await adapter.listDirectory("");
        console.log("Success! Items found:", items.length);

    } catch (error: any) {
        console.error("❌ ERROR DETECTED (Expected if MinIO fails):");
        console.error(error.message);
        // We want to see if this matches the behaviour of crashing
    }
})();
