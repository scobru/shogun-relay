import { loggers } from "../utils/logger";

const log = loggers.server;

/**
 * Middleware for Gun to prevent duplicate aliases (~@)
 * It intercepts incoming 'put' messages for aliases and checks if they already exist
 */
export function gunAliasGuard(gun: any) {
  // Use 'in' listener to intercept incoming data
  gun.on('in', async function(this: any, msg: any) {
    const to = this.to;
    
    // Check if message has a 'put' property
    if (msg.put) {
      const keys = Object.keys(msg.put);
      
      // Look for alias nodes (starting with ~@)
      const aliasSoul = keys.find(soul => soul.startsWith('~@'));
      
      if (aliasSoul) {
        const aliasData = msg.put[aliasSoul];
        // Alias data in Gun looks like: { "~pubKey": true }
        const newPubKeys = Object.keys(aliasData).filter(k => k !== '_' && k !== '#');
        
        if (newPubKeys.length > 0) {
          const newPubKey = newPubKeys[0];
          const alias = aliasSoul.slice(2);
          
          log.debug({ alias, newPubKey }, "Intercepted alias registration attempt");
          
          try {
            // Check existing data for this alias
            // We use .once() which is relatively fast if cached
            const existing = await new Promise((resolve) => {
              gun.get(aliasSoul).once((data: any) => {
                resolve(data);
              });
              // Safety timeout
              setTimeout(() => resolve(null), 1000);
            });
            
            if (existing) {
              const existingPubs = Object.keys(existing).filter(k => k !== '_' && k !== '#');
              
              if (existingPubs.length > 0 && !existingPubs.includes(newPubKey)) {
                log.warn(
                  { alias, existingPubs, newPubKey },
                  "Blocked duplicate alias creation attempt"
                );
                
                // Block the message by not calling to.next(msg)
                // We can also send back an error acknowledgement if requested
                if (msg['#']) {
                  gun.on('in', { '@': msg['#'], err: "Alias already taken" });
                }
                return;
              }
            }
          } catch (err: any) {
            log.error({ err: err.message, alias }, "Error checking alias uniqueness");
          }
        }
      }
    }
    
    // Pass the message to the next handler
    to.next(msg);
  });
  
  log.info("🛡️ Gun Alias Guard initialized");
}
