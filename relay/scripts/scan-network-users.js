import Gun from 'gun';
import 'gun/sea.js';
import { trackUser } from '../src/utils/relay-user';
// Mock logger for standalone script
global.loggers = {
    relayUser: {
        debug: console.log,
        info: console.log,
        warn: console.warn,
        error: console.error
    }
};

const relayUrl = process.env.RELAY_URL || 'http://localhost:8765/gun';
console.log(`Connecting to ${relayUrl}...`);

const gun = Gun({
    peers: [relayUrl],
    localStorage: false
});

async function main() {
    console.log('Scanning for existing users in GunDB...');

    // Scan the user graph via ~@ alias node
    gun.get('~@').map().once(async (data, alias) => {
        if (!alias || alias === '_' || alias === '#') return;

        // Data usually contains the pub key as key or value depending on structure
        // The structure of ~@ is usually: { alias: { '#': '~pub' } } or similar

        console.log(`Found alias candidate: ${alias}`);

        // We need to resolve the pub key for this alias
        gun.get(`~@${alias}`).once(async (userData) => {
            let pub = '';

            if (userData) {
                // Try to find pub key in user data
                if (userData.pub) pub = userData.pub;
                else {
                    // Check keys
                    const keys = Object.keys(userData);
                    for (const key of keys) {
                        if (key.startsWith('~') && key.length > 40) {
                            pub = key.substring(1);
                            break;
                        }
                    }
                }
            }

            if (pub) {
                console.log(`Matched alias '${alias}' to pub '${pub}'`);
                // Import trackUser dynamically or duplicate logic
                // Since we are in a script, we'll just replicate the essential PUT
                gun.get('shogun').get('users').get('observed').get(pub).put({
                    pub,
                    alias,
                    lastSeen: Date.now(),
                    registeredAt: Date.now() // Estimate
                }, (ack) => {
                    if (ack.err) console.error(`Failed to track ${alias}:`, ack.err);
                    else console.log(`Successfully tracked: ${alias} (${pub})`);
                });
            } else {
                // Try looking up by pub directly if available in outer mapping
                // Sometimes data IS the pub key reference object
                if (data && data['#'] && data['#'].startsWith('~')) {
                    pub = data['#'].substring(1);
                    console.log(`Found pub via reference: ${pub}`);

                    gun.get('shogun').get('users').get('observed').get(pub).put({
                        pub,
                        alias,
                        lastSeen: Date.now(),
                        registeredAt: Date.now()
                    }, (ack) => {
                        if (ack.err) console.error(`Failed to track ${alias}:`, ack.err);
                        else console.log(`Successfully tracked: ${alias} (${pub})`);
                    });
                }
            }
        });
    });

    // Also scan specific known pubs if provided

    // Keep alive for a bit
    setTimeout(() => {
        console.log('Scan complete.');
        process.exit(0);
    }, 10000);
}

main();
