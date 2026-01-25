
import Gun from 'gun';
import 'gun/sea.js';
import 'gun/lib/webrtc.js';

const relayUrl = process.env.RELAY_URL || 'http://localhost:8765/gun';

console.log(`Connecting to ${relayUrl}...`);

const gun = Gun({
    peers: [relayUrl],
    // radisk: false,
    localStorage: false
});

const user = gun.user();

async function main() {
    const alias = `testuser_${Date.now()}`;
    const pass = 'password123';

    console.log(`Creating user: ${alias}`);

    user.create(alias, pass, (ack) => {
        if (ack.err) {
            console.error('Registration failed:', ack.err);
            process.exit(1);
        }

        console.log(`Registered! Pub: ${ack.pub}`);

        console.log('Authenticating...');
        user.auth(alias, pass, (authAck) => {
            if (authAck.err) {
                console.error('Login failed:', authAck.err);
                process.exit(1);
            }

            console.log('Logged in successfully!');
            console.log(`User Pub: ${user.is.pub}`);

            // Wait to allow relay to process
            console.log('Waiting 5 seconds for relay to track...');
            setTimeout(() => {
                console.log('Done. Check relay logs/dashboard.');
                process.exit(0);
            }, 5000);
        });
    });
}

main();
