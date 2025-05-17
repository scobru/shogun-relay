// Test script to diagnose GunDB writing issues
import Gun from 'gun';
import 'gun/sea'; // Include SEA for authentication

// Create a Gun instance with the same options as your server
const gun = Gun({
  peers: ['http://localhost:8765/gun'],
  localStorage: false
});

// Test function to authenticate and write data
async function testGunWrite() {
  console.log('Starting GunDB write test...');
  
  // 1. Test unauthenticated write to public space
  console.log('\n--- TEST 1: Unauthenticated write to public space ---');
  const testData = {
    message: 'Test data',
    timestamp: Date.now(),
    random: Math.random().toString(36).substring(2)
  };
  
  console.log('Writing test data:', testData);
  
  // Try to write to public space first
  gun.get('test-public').put(testData, ack => {
    console.log('Public write result:', ack);
    if (ack.err) {
      console.error('Error writing to public space:', ack.err);
    } else {
      console.log('Successfully wrote to public space!');
      // Try to read it back
      gun.get('test-public').once(data => {
        console.log('Read back public data:', data);
      });
    }
  });
  
  // 2. Test with the keyPair you're using
  console.log('\n--- TEST 2: Authenticated write with keyPair ---');
  
  // Replace with your actual keyPair
  const keyPair = JSON.parse(process.env.APP_KEY_PAIR || '{"pub":"aENKzONpzeEH5k8uYTry-YUeHoRGvThJEpBRz_LhjvI.IxxUom-eOTNY4-W_4S2TqearcyQUcoWp5SHQzitzLVA"}');
  
  if (!keyPair || !keyPair.pub) {
    console.error('No keyPair available for test 2, skipping...');
  } else {
    console.log('Using keyPair with pub:', keyPair.pub);
    
    // Authenticate with the keypair
    const user = gun.user();
    
    user.auth(keyPair, ack => {
      if (ack.err) {
        console.error('Authentication error:', ack.err);
      } else {
        console.log('Authentication successful!');
        
        // Try to write user data
        const userData = {
          test: 'User authenticated data',
          timestamp: Date.now(),
          random: Math.random().toString(36).substring(2)
        };
        
        console.log('Writing user data:', userData);
        
        // Write to user space
        user.get('test-data').put(userData, userAck => {
          console.log('User write result:', userAck);
          if (userAck.err) {
            console.error('Error writing to user space:', userAck.err);
          } else {
            console.log('Successfully wrote to user space!');
            // Try to read it back
            user.get('test-data').once(data => {
              console.log('Read back user data:', data);
            });
          }
        });
        
        // Also write to a public node with attribution
        const pubData = {
          message: 'Authenticated public data',
          author: keyPair.pub,
          timestamp: Date.now()
        };
        
        console.log('Writing authenticated public data:', pubData);
        
        gun.get('test-auth-public').put(pubData, authPubAck => {
          console.log('Authenticated public write result:', authPubAck);
          if (authPubAck.err) {
            console.error('Error writing authenticated public data:', authPubAck.err);
          } else {
            console.log('Successfully wrote authenticated public data!');
            // Try to read it back
            gun.get('test-auth-public').once(data => {
              console.log('Read back authenticated public data:', data);
            });
          }
        });
      }
    });
  }
  
  // Keep the process alive for a bit to allow for network operations
  setTimeout(() => {
    console.log('\nTest complete! Check your radata folder for changes.');
    process.exit(0);
  }, 10000);
}

// Run the test
testGunWrite().catch(error => {
  console.error('Test failed with error:', error);
  process.exit(1);
}); 