import Gun from "gun";

/**
 * Set up middleware to integrate GunDB with IPFS
 * This middleware simplifies IPFS data retrieval when GunDB references IPFS content
 * 
 * @param {Object} ipfsManager - The IPFS manager instance
 * @returns {void}
 */
export function setupGunIpfsMiddleware(ipfsManager) {
  if (!ipfsManager || !ipfsManager.isEnabled()) {
    // IPFS middleware not configured (disabled)
    return;
  }

  // Configuring Gun-IPFS middleware

  // Simplified version: we don't intercept PUTs anymore
  // IPFS uploads will be handled client-side

  // We only intercept 'in' responses to retrieve IPFS data
  Gun.on("in", async function (replyMsg) {
    // If IPFS is not enabled, pass the original message
    if (!ipfsManager.isEnabled()) {
      this.to.next(replyMsg);
      return;
    }

    // Gun-IPFS middleware configured successfully

    // Check if the response message contains data
    if (replyMsg.put && Object.keys(replyMsg.put).length > 0) {
      console.log("[IPFS-MIDDLEWARE] Found data in replyMsg.put");
      const entriesToFetch = [];

      // Look for IPFS references in the data
      for (const soul in replyMsg.put) {
        const node = replyMsg.put[soul];

        // Look for ipfsHash directly in the node or in the ':' property of the node
        let ipfsHash = null;

        if (node.ipfsHash) {
          // Case 1: ipfsHash is directly in the node
          ipfsHash = node.ipfsHash;
        } else if (
          node[":"] &&
          typeof node[":"] === "object" &&
          node[":"].ipfsHash
        ) {
          // Case 2: ipfsHash is in the ':' property of the node
          ipfsHash = node[":"].ipfsHash;
        }

        if (ipfsHash) {
          // Add to list of hashes to retrieve
          entriesToFetch.push({
            soul: soul,
            hash: ipfsHash,
          });
        }
      }

      // If we found IPFS references, retrieve them
      if (entriesToFetch.length > 0) {
        console.log(
          `IPFS-MIDDLEWARE: Retrieving ${entriesToFetch.length} IPFS references`
        );

        try {
          // Retrieve data from IPFS for each hash
          await Promise.all(
            entriesToFetch.map(async ({ soul, hash }) => {
              try {
                console.log(
                  `IPFS-MIDDLEWARE: Retrieving data from IPFS for hash: ${hash}`
                );
                const ipfsData = await ipfsManager.fetchJson(hash);

                if (ipfsData) {
                  // If they are complete GunDB data (format created by previous middleware)
                  if (ipfsData.gunData && ipfsData.gunData[soul]) {
                    // Replace with data retrieved from IPFS
                    replyMsg.put[soul] = ipfsData.gunData[soul];
                    console.log(
                      `IPFS-MIDDLEWARE: Replaced data for ${soul} with data from IPFS`
                    );
                  }
                  // If they are simple data (uploaded directly by the client)
                  else {
                    // Replace the value field (preserving GunDB metadata)
                    if (replyMsg.put[soul][":"]) {
                      replyMsg.put[soul][":"] = ipfsData;
                      console.log(
                        `IPFS-MIDDLEWARE: Replaced value for ${soul} with data from IPFS`
                      );
                    }
                  }
                } else {
                  console.warn(
                    `IPFS-MIDDLEWARE: No valid data from IPFS for hash ${hash}`
                  );
                }
              } catch (error) {
                console.error(
                  `IPFS-MIDDLEWARE: Error retrieving hash ${hash}:`,
                  error
                );
              }
            })
          );
        } catch (error) {
          console.error(
            "IPFS-MIDDLEWARE: Error during IPFS data retrieval:",
            error
          );
        }
      }
    }

    // Pass the message to Gun (original or with IPFS data)
    this.to.next(replyMsg);
  });

  console.log("Gun-IPFS middleware configured successfully (simplified mode)");
} 