import Gun from "gun";
import "gun/sea";
import { initRelayUser, cleanDuplicateAliases, rebuildAliasIndex } from "../src/utils/relay-user";
import { relayKeysConfig, serverConfig } from "../src/config/env-config";
import dotenv from "dotenv";

dotenv.config();

// Force console logging for this script
import { loggers } from "../src/utils/logger";
loggers.relayUser = {
    debug: (...args: any[]) => console.log('[DEBUG]', ...args),
    info: (...args: any[]) => console.log('[INFO]', ...args),
    warn: (...args: any[]) => console.warn('[WARN]', ...args),
    error: (...args: any[]) => console.error('[ERROR]', ...args),
} as any;

async function main() {
    console.log("Starting cleanup script...");

    // Use port from config or default
    const port = serverConfig.port || 8765;
    const relayUrl = `http://localhost:${port}/gun`;
    console.log(`Connecting to ${relayUrl}`);

    const gun = Gun({
        peers: [relayUrl],
        localStorage: false,
        radisk: false // Don't create local radata for this script if possible
    });

    /* Keypair loading logic adapted from index.ts */
    if (!relayKeysConfig.seaKeypair && !relayKeysConfig.seaKeypairPath) {
        // Try to find it in default locations
        const fs = await import("fs");
        const path = await import("path");
        const defaultPaths = [
            path.join(process.cwd(), "relay-keypair.json"),
            path.join(process.cwd(), "keys", "relay-keypair.json"),
        ];

        for (const p of defaultPaths) {
            if (fs.existsSync(p)) {
                console.log(`Found keypair at ${p}`);
                relayKeysConfig.seaKeypairPath = p;
                break;
            }
        }

        if (!relayKeysConfig.seaKeypairPath) {
            console.warn("Could not find relay-keypair.json in default locations.");
        }
    }

    /* Load keypair */
    let keyPair: any = null;
    if (relayKeysConfig.seaKeypair) {
        try {
            keyPair = JSON.parse(relayKeysConfig.seaKeypair);
        } catch (e) { console.error("Invalid RELAY_SEA_KEYPAIR env"); }
    } else if (relayKeysConfig.seaKeypairPath) {
        const fs = await import("fs");
        if (fs.existsSync(relayKeysConfig.seaKeypairPath)) {
            keyPair = JSON.parse(fs.readFileSync(relayKeysConfig.seaKeypairPath, 'utf8'));
        }
    }

    if (!keyPair) {
        throw new Error("No relay keypair found in config or default paths. Cannot authenticate as relay.");
    }

    try {
        console.log("Authenticating with pub:", keyPair.pub);
        await initRelayUser(gun, keyPair);
        console.log("Relay user authenticated.");

        console.log("Running duplicate alias cleanup...");
        const result = await cleanDuplicateAliases();
        console.log("Cleanup complete:", result);

        console.log("Rebuilding/Verifying alias index...");
        await rebuildAliasIndex();
        console.log("Index rebuilt.");

        // Delay exit to allow Gun to sync
        console.log("Waiting for sync...");
        setTimeout(() => {
            console.log("Done.");
            process.exit(0);
        }, 5000);

    } catch (error) {
        console.error("Error running cleanup:", error);
        process.exit(1);
    }
}

main();
