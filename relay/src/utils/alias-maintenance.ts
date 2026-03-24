import { loggers } from "./logger";
import { GUN_PATHS, getGunNode } from "./gun-paths";

const log = loggers.server;

/**
 * Statistics for alias maintenance
 */
interface MaintenanceStats {
  totalAliases: number;
  duplicatesFound: number;
  orphansRemoved: number;
  errors: number;
}

/**
 * Maintenance utility to clean up orphan and duplicate aliases in GunDB
 */
export async function performAliasMaintenance(gun: any): Promise<MaintenanceStats> {
  const stats: MaintenanceStats = {
    totalAliases: 0,
    duplicatesFound: 0,
    orphansRemoved: 0,
    errors: 0,
  };

  log.info("🧹 Starting Alias Maintenance...");

  return new Promise((resolve) => {
    // 1. Get all aliases from Gun's internal alias index (~@)
    gun.get("~@").once(async (data: any) => {
      if (!data) {
        log.info("ℹ️ No aliases found in index");
        resolve(stats);
        return;
      }

      const aliasNames = Object.keys(data).filter((k) => k !== "_" && k !== "#");
      stats.totalAliases = aliasNames.length;

      log.info(`🔍 Found ${aliasNames.length} unique alias names`);

      for (const aliasName of aliasNames) {
        try {
          const aliasSoul = "~@" + aliasName;
          
          // 2. Check each alias for multiple associated public keys
          await new Promise<void>((nextAlias) => {
            gun.get(aliasSoul).once(async (pubs: any) => {
              if (!pubs) {
                nextAlias();
                return;
              }

              const pubKeys = Object.keys(pubs).filter((k) => k !== "_" && k !== "#");
              
              if (pubKeys.length > 1) {
                stats.duplicatesFound++;
                log.warn({ alias: aliasName, count: pubKeys.length }, "Found duplicate alias");

                // 3. Strategy: Keep the most "valid" one
                // For simplicity, we keep the one that actually exists in our USERS path
                // or the first one if none are in USERS.
                
                let bestPub: string | null = null;
                
                for (const pub of pubKeys) {
                  const existsInUsers = await new Promise((res) => {
                    getGunNode(gun, GUN_PATHS.USERS).get(pub).once((userData: any) => {
                      res(!!userData);
                    });
                    setTimeout(() => res(false), 500);
                  });
                  
                  if (existsInUsers) {
                    bestPub = pub;
                    break;
                  }
                }
                
                if (!bestPub) bestPub = pubKeys[0];

                // 4. Remove other references
                for (const pub of pubKeys) {
                  if (pub !== bestPub) {
                    log.info({ alias: aliasName, pub }, "Removing orphan alias reference");
                    gun.get(aliasSoul).get(pub).put(null);
                    stats.orphansRemoved++;
                  }
                }
              }
              nextAlias();
            });
          });
        } catch (err: any) {
          stats.errors++;
          log.error({ alias: aliasName, err: err.message }, "Error processing alias maintenance");
        }
      }

      log.info(stats, "✅ Alias Maintenance completed");
      resolve(stats);
    });

    // Safety timeout
    setTimeout(() => {
      log.warn("⚠️ Alias Maintenance timed out");
      resolve(stats);
    }, 60000);
  });
}
