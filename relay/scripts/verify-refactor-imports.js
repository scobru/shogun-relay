
import { ipfsRequest, ipfsUpload } from '../src/utils/ipfs-client.js';
import networkRouter from '../src/routes/network.js';
import dealsRouter from '../src/routes/deals.js';
import indexRoutes from '../src/routes/index.js';

console.log('✅ ipfs-client.js imported successfully');
console.log('✅ network.js imported successfully');
console.log('✅ deals.js imported successfully');
console.log('✅ index.js imported successfully');

if (typeof ipfsRequest !== 'function') {
  console.error('❌ ipfsRequest is not a function');
  process.exit(1);
}

if (typeof ipfsUpload !== 'function') {
  console.error('❌ ipfsUpload is not a function');
  process.exit(1);
}

console.log('🎉 All refactored modules loaded correctly.');
