import { createNodeServer } from 'shogun-create';

const port = process.env.PORT || 8765;
const peers = process.env.PEERS ? process.env.PEERS.split(',') : ['http://localhost:8765/gun'];
const radiskPath = process.env.RADISK_PATH || 'radata';

const gun = createNodeServer(port, peers, { 
     useRadisk: true,
     radiskPath: radiskPath
});

console.log(`GUN server started on port ${port}`);

const namespace = `hal9000`

export { gun, namespace }