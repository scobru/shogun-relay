import { X402Merchant } from '../src/utils/x402-merchant.js';
import fs from 'fs';
import path from 'path';

console.log('✅ x402-merchant.js imported successfully');

const sdkPath = path.join(process.cwd(), 'src/utils/registry-client-sdk.js');
if (fs.existsSync(sdkPath)) {
  console.error('❌ registry-client-sdk.js still exists');
  process.exit(1);
} else {
  console.log('✅ registry-client-sdk.js is deleted');
}

console.log('✅ Verification passed');
