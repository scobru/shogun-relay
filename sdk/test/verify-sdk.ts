import { DelaySDK } from '../src/index';

async function main() {
  console.log('🚀 Starting SDK Verification...');

  // Initialize SDK
  const sdk = new DelaySDK({
    baseURL: 'https://delay.scobrudot.dev',
    token: 'shogun2025', // Default dev token
  });

  try {
    // 1. System Health
    console.log('\n1. Testing System Health...');
    const health = await sdk.system.getHealth();
    console.log('✅ Health:', health);

    // 2. Network Stats
    console.log('\n2. Testing Network Stats...');
    const stats = await sdk.network.getStats();
    console.log('✅ Network Stats:', stats);

    // 3. IPFS Status
    console.log('\n3. Testing IPFS Status...');
    const ipfsStatus = await sdk.ipfs.getStatus();
    console.log('✅ IPFS Status:', ipfsStatus);

    // 4. Registry Config
    console.log('\n4. Testing Registry Config...');
    const registryConfig = await sdk.registry.getStatus();
    console.log('✅ Registry Config:', registryConfig);

    console.log('\n✨ Verification Complete!');
  } catch (error: any) {
    console.error('❌ Verification Failed:', error.message);
    if (error.code) {
      console.error('Error Code:', error.code);
    }
    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('No response received from server');
    }
    console.error('Full Error:', error);
  }
}

main();
