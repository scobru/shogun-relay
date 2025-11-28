import { saveUsername, getUsernameIndex } from "./database.js";
import Fuse from "fuse.js";

// Fuse.js configuration for fuzzy search
const fuseOptions = {
  keys: [
    { name: "username", weight: 0.7 },
    { name: "displayName", weight: 0.3 },
  ],
  threshold: 0.3,
  includeScore: true,
  minMatchCharLength: 2,
};

let fuseIndex = null;
let lastSyncTime = 0;
const SYNC_COOLDOWN = 10000; // 10 seconds between syncs

export function initSync(gun) {
  console.log("🔄 Starting GunDB sync service...");

  // Initial Fuse index build
  rebuildFuseIndex();

  try {
    // Listen for username mappings (usernames/username -> userPub)
    gun
      .get("usernames")
      .map()
      .on(async (userPub, username) => {
        if (userPub && username) {
          processUser(gun, username, userPub);
        }
      });

    // Listen for alias mappings (~@username -> userPub)
    gun
      .get("~@")
      .map()
      .on(async (aliasData, username) => {
        if (aliasData && username) {
          // Extract userPub from alias data
          const userPub = aliasData
            .replace("~@", "")
            .replace(username, "")
            .replace(/^~/, "");

          if (userPub && userPub.length > 10) {
            processUser(gun, username, userPub);
          }
        }
      });

    // Listen for display name updates
    gun
      .get("displayNames")
      .map()
      .on((displayData, username) => {
        if (displayData && displayData.userPub) {
          handleDisplayNameUpdate(username, displayData);
        }
      });

    // Start epub listener
    startEpubListener(gun);

    console.log("✅ GunDB sync service active");
  } catch (error) {
    console.error("❌ GunDB sync failed:", error);
  }
}

function rebuildFuseIndex() {
  const indexArray = Array.from(getUsernameIndex().values());
  fuseIndex = new Fuse(indexArray, fuseOptions);
}

export function searchUsers(query) {
  if (!fuseIndex) rebuildFuseIndex();
  if (!query) return [];
  return fuseIndex.search(query).map(result => result.item);
}

async function processUser(gun, username, userPub) {
  // Check if this user has recent activity (last 24 hours)
  try {
    const userData = await new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 2000);
      gun.get(userPub).once((data) => {
        clearTimeout(timeout);
        resolve(data || null);
      });
    });

    if (userData && userData.lastSeen) {
      const lastSeen = userData.lastSeen;
      const now = Date.now();
      const dayInMs = 24 * 60 * 60 * 1000;

      // Only sync users with activity in the last 24 hours
      if (now - lastSeen < dayInMs) {
        // Try to get the epub for this user
        let epub = null;
        try {
          epub = await new Promise((resolve) => {
            const timeout = setTimeout(() => resolve(null), 3000);
            gun
              .get(userPub)
              .get("epub")
              .once((data) => {
                clearTimeout(timeout);
                resolve(data || null);
              });
          });
        } catch (error) {
          // Ignore error
        }

        addUsernameToIndex({
          userId: userPub,
          username: username,
          displayName: username,
          userPub: userPub,
          epub: epub,
          lastSeen: Date.now(),
        });
      }
    }
  } catch (error) {
    // Ignore error
  }
}

function handleDisplayNameUpdate(username, displayData) {
  const usernameIndex = getUsernameIndex();
  
  // Find existing user by userPub
  let existingUser = null;
  for (const [key, userData] of usernameIndex.entries()) {
    if (userData.userPub === displayData.userPub) {
      existingUser = userData;
      // Remove old username from index if it changed
      if (key !== username.toLowerCase()) {
        usernameIndex.delete(key);
      }
      break;
    }
  }

  if (existingUser) {
    // Update with new username and display name
    addUsernameToIndex({
      userId: displayData.userPub,
      username: username,
      displayName: username,
      userPub: displayData.userPub,
      pub: displayData.userPub,
      epub: existingUser.epub,
      lastSeen: Date.now(),
    });
  } else {
    // User not found, add as new entry
    addUsernameToIndex({
      userId: displayData.userPub,
      username: username,
      displayName: username,
      userPub: displayData.userPub,
      pub: displayData.userPub,
      epub: null,
      lastSeen: Date.now(),
    });
  }
}

function startEpubListener(gun) {
  // Listen to all user nodes for epub changes
  gun
    .get("users")
    .map()
    .on(async (userData, userId) => {
      if (userData && userId) {
        const userPub = userData.pub || userId;

        // Listen for epub changes on this specific user
        gun
          .get(userPub)
          .get("epub")
          .on(async (epubData) => {
            if (
              epubData &&
              typeof epubData === "string" &&
              epubData.length > 10
            ) {
              // Find user in our index and update epub
              let foundUser = null;
              const usernameIndex = getUsernameIndex();
              
              for (const [key, userData] of usernameIndex.entries()) {
                if (userData.userPub === userPub) {
                  foundUser = userData;
                  break;
                }
              }

              if (foundUser) {
                addUsernameToIndex({
                  ...foundUser,
                  epub: epubData,
                  lastSeen: Date.now(),
                });
              }
            }
          });
      }
    });
}

function addUsernameToIndex(userData) {
  const now = Date.now();

  // Rate limiting: don't sync too frequently
  if (now - lastSyncTime < SYNC_COOLDOWN) {
    // Still save to DB but maybe skip heavy operations
  }
  lastSyncTime = now;

  saveUsername(userData);
  rebuildFuseIndex();
}
