import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs";

const sqlite = sqlite3.verbose();

// Configuration
const CONFIG = {
  MAX_USERNAME_RESULTS: 20,
};

// In-memory cache
let usernameIndex = new Map();
let protocolStatsCache = {
  totalMessages: 0,
  totalGroups: 0,
  totalTokenRooms: 0,
  totalPublicRooms: 0,
  totalConversations: 0,
  totalContacts: 0,
  lastUpdated: Date.now(),
};

let db = null;

// Initialize Database
export async function initDatabase(dataDir) {
  return new Promise((resolve, reject) => {
    const dbPath = path.join(dataDir, "relay_index.db");
    console.log(`📁 Initializing SQLite index at ${dbPath}`);

    db = new sqlite.Database(dbPath, (err) => {
      if (err) {
        console.error("❌ Failed to open SQLite database:", err);
        return reject(err);
      }
    });

    // Create tables if they don't exist
    db.serialize(() => {
      // Username table
      db.run(`
        CREATE TABLE IF NOT EXISTS usernames (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          display_name TEXT,
          user_pub TEXT NOT NULL,
          epub TEXT,
          last_seen INTEGER,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);

      // Protocol statistics table
      db.run(`
        CREATE TABLE IF NOT EXISTS protocol_stats (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          stat_type TEXT UNIQUE NOT NULL,
          stat_value INTEGER DEFAULT 0,
          last_updated INTEGER DEFAULT (strftime('%s', 'now')),
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
      `);

      // Indexes for performance
      db.run(`CREATE INDEX IF NOT EXISTS idx_username ON usernames(username)`);
      db.run(
        `CREATE INDEX IF NOT EXISTS idx_display_name ON usernames(display_name)`
      );
      db.run(`CREATE INDEX IF NOT EXISTS idx_user_pub ON usernames(user_pub)`);

      // Load data into memory
      loadUsernamesFromDB();
      loadProtocolStatsFromDB();
      console.log("✅ Database initialized");
      resolve(db);
    });
  });
}

// ============================================================================
// PROTOCOL STATISTICS FUNCTIONS
// ============================================================================

function loadProtocolStatsFromDB() {
  if (!db) return;
  db.all("SELECT stat_type, stat_value FROM protocol_stats", (err, rows) => {
    if (err) {
      console.error("❌ Failed to load protocol stats from DB:", err);
      return;
    }

    // Reset cache with default values
    protocolStatsCache = {
      totalMessages: 0,
      totalGroups: 0,
      totalTokenRooms: 0,
      totalPublicRooms: 0,
      totalConversations: 0,
      totalContacts: 0,
      lastUpdated: Date.now(),
    };

    // Load values from database
    rows.forEach((row) => {
      switch (row.stat_type) {
        case "totalMessages":
          protocolStatsCache.totalMessages = row.stat_value || 0;
          break;
        case "totalGroups":
          protocolStatsCache.totalGroups = row.stat_value || 0;
          break;
        case "totalTokenRooms":
          protocolStatsCache.totalTokenRooms = row.stat_value || 0;
          break;
        case "totalPublicRooms":
          protocolStatsCache.totalPublicRooms = row.stat_value || 0;
          break;
        case "totalConversations":
          protocolStatsCache.totalConversations = row.stat_value || 0;
          break;
      }
    });

    console.log(`📊 Loaded protocol stats from DB:`, protocolStatsCache);
  });
}

export function getProtocolStats() {
  return protocolStatsCache;
}

export function saveProtocolStat(statType, statValue) {
  if (!db) return;
  
  // Update cache
  if (protocolStatsCache.hasOwnProperty(statType)) {
    protocolStatsCache[statType] = statValue;
    protocolStatsCache.lastUpdated = Date.now();
  }

  db.run(
    `
    INSERT OR REPLACE INTO protocol_stats (stat_type, stat_value, last_updated)
    VALUES (?, ?, ?)
  `,
    [statType, statValue, Date.now()],
    (err) => {
      if (err) {
        console.error(`❌ Failed to save ${statType} to DB:`, err);
      }
    }
  );
}

// ============================================================================
// USERNAME INDEX FUNCTIONS
// ============================================================================

function loadUsernamesFromDB() {
  if (!db) return;
  db.all("SELECT * FROM usernames", (err, rows) => {
    if (err) {
      console.error("❌ Failed to load usernames from DB:", err);
      return;
    }

    usernameIndex.clear();
    rows.forEach((row) => {
      usernameIndex.set(row.username.toLowerCase(), {
        userId: row.user_pub,
        username: row.username,
        displayName: row.display_name || row.username,
        pub: row.user_pub,
        epub: row.epub,
        lastSeen: row.last_seen || Date.now(),
      });
    });

    console.log(`📚 Loaded ${usernameIndex.size} usernames from SQLite`);
  });
}

export function getUsernameIndex() {
  return usernameIndex;
}

export function saveUsername(usernameData) {
  if (!db) return;
  const { username, displayName, userPub, epub, lastSeen } = usernameData;

  // Update in-memory cache
  usernameIndex.set(username.toLowerCase(), usernameData);

  db.run(
    `
    INSERT OR REPLACE INTO usernames (username, display_name, user_pub, epub, last_seen)
    VALUES (?, ?, ?, ?, ?)
  `,
    [username, displayName, userPub, epub, lastSeen || Date.now()],
    (err) => {
      if (err) {
        console.error("❌ Failed to save username to DB:", err);
      }
    }
  );
}

export function getUser(username) {
  return usernameIndex.get(username.toLowerCase());
}

export function getUserByPub(userPub) {
  for (const user of usernameIndex.values()) {
    if (user.userPub === userPub) {
      return user;
    }
  }
  return null;
}
