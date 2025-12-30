
import { chatService } from './src/utils/chat-service';
import { loggers } from './src/utils/logger';

// Mock Gun
const mockGun = {
    get: (key: string) => {
        console.log(`Gun get: ${key}`);
        return mockGun;
    },
    map: () => mockGun,
    on: () => mockGun,
    once: () => mockGun,
    put: () => mockGun,
    opt: () => {},
    user: () => mockGun,
};

// Mock Relay User
import * as RelayUser from './src/utils/relay-user';
(RelayUser as any).getRelayUser = () => ({ is: { alias: 'test' }, get: () => mockGun });
(RelayUser as any).getRelayKeyPair = () => ({ pub: 'testpub', epriv: 'testepriv' });


async function run() {
    try {
        console.log("Initializing chat service...");
        chatService.initialize(mockGun as any);
        
        // Force active
        (chatService as any).active = true;
        (chatService as any).myPub = 'testpub';

        // The problematic ID
        const badPub = "ha0rWjUyBgp3HWDglWWO2h-1zlVaiewm6aEmS7T13iI.Lapk2VvJyJ9iZNVRn6iN-FgSWqYjQ6f1pBk7j3GdG6c:1";
        
        console.log(`Calling getHistory with ${badPub}`);
        await chatService.getHistory(badPub);
        console.log("Success!");
    } catch (e) {
        console.error("Caught error:", e);
    }
}

run();
