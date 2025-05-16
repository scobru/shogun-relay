import Gun from "gun"; // Gun itself is needed for Gun.on

class GunManager {
  constructor(ipfsManagerInstance) {
    this.ipfsManager = ipfsManagerInstance;
    this.middlewareConfigured = false;
  }

  /**
   * Set up middleware to integrate GunDB with IPFS.
   * This middleware intercepts 'in' messages to fetch data from IPFS if an ipfsHash is found.
   */
  setupGunIpfsMiddleware() {
    if (!this.ipfsManager || !this.ipfsManager.isEnabled()) {
      return;
    }

    // Avoid configuring middleware multiple times
    if (this.middlewareConfigured) {
      return;
    }

    const localIpfsManager = this.ipfsManager; // Capture for use in Gun.on closure

    Gun.on("in", async function (replyMsg) {
      // If IPFS is not enabled, pass the original message
      if (!localIpfsManager.isEnabled()) {
        this.to.next(replyMsg);
        return;
      }

      if (replyMsg.put && Object.keys(replyMsg.put).length > 0) {
        const entriesToFetch = [];

        // Find all nodes with IPFS hash references
        for (const soul in replyMsg.put) {
          const node = replyMsg.put[soul];
          let ipfsHash = null;

          if (node.ipfsHash) {
            ipfsHash = node.ipfsHash;
          } else if (node[":"] && typeof node[":"] === "object" && node[":"].ipfsHash) {
            ipfsHash = node[":"].ipfsHash;
          }

          if (ipfsHash) {
            entriesToFetch.push({ soul, hash: ipfsHash });
          }
        }

        if (entriesToFetch.length > 0) {
          try {
            await Promise.all(
              entriesToFetch.map(async ({ soul, hash }) => {
                try {
                  const ipfsData = await localIpfsManager.fetchJson(hash);
                  if (ipfsData) {
                    if (ipfsData.gunData && ipfsData.gunData[soul]) {
                      // Replace with full GunData from IPFS
                      replyMsg.put[soul] = ipfsData.gunData[soul];
                    } else if (replyMsg.put[soul][":"]) {
                      // Replace value with simple data from IPFS
                      replyMsg.put[soul][":"] = ipfsData;
                    } else {
                      // Embed data into node structure
                      replyMsg.put[soul] = { 
                        ...replyMsg.put[soul], 
                        ":": ipfsData, 
                        ipfsHash: undefined 
                      };
                    }
                  }
                } catch (error) {
                  // Continue with next entry despite errors
                }
              })
            );
          } catch (error) {
            // Continue with original message despite batch errors
          }
        }
      }
      
      // Pass the message to the next middleware
      this.to.next(replyMsg);
    });
    
    this.middlewareConfigured = true;
  }
  
  /**
   * Check if IPFS middleware is configured
   * @returns {boolean} Whether middleware is configured
   */
  isMiddlewareConfigured() {
    return this.middlewareConfigured;
  }
  
  /**
   * Reset the middleware configuration status
   * Useful for testing or reconfiguration
   */
  resetMiddlewareConfig() {
    this.middlewareConfigured = false;
  }
}

export default GunManager; 