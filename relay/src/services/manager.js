import { initDatabase } from "./indexing/database.js";
import { initSync } from "./indexing/sync.js";
import { initSocket } from "./realtime/socket.js";
import { initRoutes } from "./api/routes.js";
import path from "path";

export async function initServices(app, server, gun) {
  console.log("🚀 Initializing Generic Services...");

  try {
    // 1. Initialize Database
    const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
    await initDatabase(dataDir);

    // 2. Initialize Sync Service (GunDB -> SQLite)
    initSync(gun);

    // 3. Initialize Socket.IO (Realtime)
    initSocket(server);

    // 4. Initialize HTTP API Routes
    initRoutes(app);

    console.log("✅ Generic Services initialized successfully");
  } catch (error) {
    console.error("❌ Failed to initialize Generic Services:", error);
  }
}
