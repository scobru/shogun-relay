// Simple Gun unauthenticated server

import { createNodeServer } from 'shogun-create';

const server = createNodeServer(8765, ['http://localhost:8765/gun'],{ 
     useRadisk: true,
     radiskPath: 'radata'
});

console.log(server);

console.log('GUN server started on port 8765');


