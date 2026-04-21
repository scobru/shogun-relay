import { IGunChain } from "gun/types/gun";

/**
 * Utility to wait for data to appear in a Zen/Gun node.
 * This is useful for handling synchronization latency in decentralized networks.
 * 
 * @param node - The Gun chain node to watch
 * @param attempts - Number of retry attempts
 * @param delay - Delay between attempts in ms
 * @returns The data once found, or null if timed out
 */
export async function waitForZenData(
  node: IGunChain<any, any, any, any>,
  attempts: number = 15,
  delay: number = 1500
): Promise<any> {
  for (let i = 0; i < attempts; i++) {
    const data = await new Promise((resolve) => {
      // 3s safety timeout per check
      const timeout = setTimeout(() => resolve(null), 3000);
      
      node.once((val: any) => {
        clearTimeout(timeout);
        // We consider it found if it's not null/undefined
        // In the context of kfrags, it should be a string
        if (val !== null && val !== undefined) {
          resolve(val);
        } else {
          resolve(null);
        }
      });
    });

    if (data !== null && data !== undefined) {
      return data;
    }

    if (i < attempts - 1) {
      console.log(`[ZenUtils] Data not found yet, retrying sync... (${i + 1}/${attempts})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  return null;
}
