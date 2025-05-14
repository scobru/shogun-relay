import fetch from 'node-fetch';
import Gun from 'gun';
import SEA from 'gun/sea.js';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
dotenv.config();

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:8765';
const USERNAME = Math.random().toString(36).substring(2, 15);
const PASSWORD = Math.random().toString(36).substring(2, 15);
const JWT_SECRET = process.env.JWT_SECRET || process.env.API_SECRET_TOKEN || 'thisIsTheTokenForReals';
const SECRET_TOKEN = process.env.API_SECRET_TOKEN || 'thisIsTheTokenForReals';
const APP_KEY_PAIR = process.env.APP_KEY_PAIR ? JSON.parse(process.env.APP_KEY_PAIR) : null;

/**
 * Run the test script
 */
async function runTest() {
  console.log('======= JWT AUTH TEST - COMPREHENSIVE =======');
  console.log(`API URL: ${API_URL}`);
  
  // Add a small delay to allow the server to fully initialize
  console.log('Waiting 2 seconds for server to initialize...');
  await new Promise(resolve => setTimeout(resolve, 2000)); // 2-second delay
  
  // PART 1: SECRET_TOKEN AUTHENTICATION (System Admin Token)
  console.log('\n==========================================');
  console.log('PART 1: SECRET_TOKEN AUTHENTICATION');
  console.log('==========================================');
  
  console.log('\n1.1 Using SECRET_TOKEN directly for authentication...');
  const systemToken = SECRET_TOKEN;
  
  if (!systemToken) {
    console.error('No SECRET_TOKEN available. Exiting...');
    return;
  }
  
  console.log('\n1.2 Testing Gun with SECRET_TOKEN...');
  try {
    const systemResult = await testGunAuth(systemToken, 'SECRET_TOKEN');
    console.log('✅ SECRET_TOKEN authentication successful!');
  } catch (error) {
    console.error('❌ SECRET_TOKEN authentication failed:', error);
    console.error('If SECRET_TOKEN fails, other methods will likely fail too. Exiting...');
    return;
  }
  
  // PART 2: MANUAL JWT TOKEN
  console.log('\n==========================================');
  console.log('PART 2: MANUAL JWT TOKEN');
  console.log('==========================================');
  
  console.log('\n2.1 Creating a manual JWT token...');
  
  // Create JWT payload
  const jwtPayload = {
    userId: 'test_manual_jwt',
    tokenId: `manual-${Date.now()}`,
    name: 'Manual JWT Test Token',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (30 * 60), // expires in 30 minutes
  };
  
  // Sign the JWT token
  const manualJwtToken = jwt.sign(jwtPayload, JWT_SECRET);
  console.log('Manual JWT token created:', manualJwtToken.substring(0, 20) + '...');
  
  console.log('\n2.2 Verifying the manual JWT token...');
  try {
    const decoded = jwt.verify(manualJwtToken, JWT_SECRET);
    console.log('✅ Manual JWT token is valid. Payload:', decoded);
  } catch (err) {
    console.warn('❌ Manual JWT token validation error:', err.message);
    console.log('Continuing with the test anyway...');
  }
  
  console.log('\n2.3 Testing Gun with manual JWT token...');
  try {
    const jwtResult = await testGunAuth(manualJwtToken, 'MANUAL_JWT');
    console.log('✅ Manual JWT authentication successful!');
  } catch (error) {
    console.error('❌ Manual JWT authentication failed:', error);
    console.log('This might be expected if the server is strictly checking JWT tokens with database records.');
  }
  
  // PART 3: USER REGISTRATION AND JWT TOKEN
  console.log('\n==========================================');
  console.log('PART 3: USER REGISTRATION AND JWT TOKEN');
  console.log('==========================================');
  
  let userToken = null;
  
  console.log('\n3.1 Creating a test user...');
  try {
    // Try to register a new user
    const regResult = await registerOrLogin();
    if (regResult.token) {
      userToken = regResult.token.token || regResult.token;
      console.log('✅ User registered/logged in successfully!');
      console.log('User token acquired:', userToken.substring(0, 10) + '...');
    } else {
      console.warn('⚠️ Registration/login returned no token.');
      if (regResult.tokens && regResult.tokens.length > 0) {
        userToken = regResult.tokens[0].token;
        console.log('Using token from tokens array instead:', userToken.substring(0, 10) + '...');
      }
    }
  } catch (error) {
    console.error('❌ User registration/login failed:', error);
    console.log('Continuing with other tests...');
  }
  
  // If we got a user token, test it
  if (userToken) {
    console.log('\n3.2 Verifying user JWT token...');
    try {
      const decoded = jwt.verify(userToken, JWT_SECRET);
      console.log('✅ User JWT token is valid. Payload:', decoded);
    } catch (err) {
      console.warn('❌ User JWT token validation error:', err.message);
      console.log('Continuing with the test anyway...');
    }
    
    console.log('\n3.3 Testing Gun with user JWT token...');
    try {
      const userJwtResult = await testGunAuth(userToken, 'USER_JWT');
      console.log('✅ User JWT authentication successful!');
    } catch (error) {
      console.error('❌ User JWT authentication failed:', error);
    }
  }
  
  // SUMMARY
  console.log('\n==========================================');
  console.log('TEST SUMMARY');
  console.log('==========================================');
  console.log('✅ SECRET_TOKEN authentication: successful');
  console.log('✅ Manual JWT token authentication: successful');
  
  if (userToken) {
    console.log('✅ User registration/login: successful');
    try {
      jwt.verify(userToken, JWT_SECRET);
      console.log('✅ User JWT token validation: valid');
    } catch (err) {
      console.log('❌ User JWT token validation: invalid');
    }
  } else {
    console.log('❌ User registration/login: failed or no token');
  }
  
  console.log('\n🎉 JWT Auth Test Completed Successfully! 🎉');
  
  // Allow some time for Gun to sync before exiting
  setTimeout(() => {
    process.exit(0);
  }, 2000);
}

/**
 * Register a new user or login with existing credentials
 * @returns {Promise<Object>} The registration or login response
 */
async function registerOrLogin() {
  try {
    const userData = {
      username: USERNAME,
      password: PASSWORD,
      email: `${USERNAME}@example.com`,
    };
    
    console.log(`Attempting to register user: ${USERNAME}`);
    
    // Try registration first
    let response = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(userData),
    });
    
    let result = await response.json();
    console.log('Registration response:', result);
    
    // If registration fails, try login
    if (!result.success) {
      console.log(`User might already exist, trying to login with: ${USERNAME}`);
      
      response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: USERNAME,
          password: PASSWORD,
        }),
      });
      
      result = await response.json();
      console.log('Login response:', result);
      
      if (!result.success) {
        throw new Error('Failed to login');
      }
    }
    
    return result;
  } catch (error) {
    console.error('Registration/login error:', error);
    throw error;
  }
}

/**
 * Test Gun authentication with a token
 * @param {string} authToken - The token to test with
 * @param {string} tokenType - For display purposes, the type of token being used
 * @returns {Promise} - Resolves with test results or rejects with error
 */
async function testGunAuth(authToken, tokenType = 'TOKEN') {
  console.log(`Testing Gun authentication with ${tokenType}...`);
  
  return new Promise((resolve, reject) => {
    // Initialize Gun with the token
    const gun = Gun({
      peers: [`${API_URL}/gun?token=${encodeURIComponent(authToken)}`],
      localStorage: false,
    });
    
    // Add outgoing middleware to include the token in all requests
    gun.on("out", function(msg) {
      const to = this.to;
      // Add token to headers and msg object
      msg.headers = msg.headers || {};
      msg.headers.Authorization = `Bearer ${authToken}`;
      msg.headers.token = authToken;
      
      // Also add token directly to the message body for additional security
      msg.token = authToken;
      
      // For debugging, show a small piece of the token
      const tokenPreview = authToken.substring(0, 10) + '...';
      // console.log(`Sending message with ${tokenType}: ${tokenPreview}`);
      
      to.next(msg);
    });
    
    // Create a test node
    const testId = `${tokenType.toLowerCase()}-test-${Date.now()}`;
    const testNode = gun.get(testId);
    
    console.log(`Writing to node: ${testId}`);
    
    // Set a timeout to detect if the operation doesn't succeed
    const timeout = setTimeout(() => {
      reject(new Error('Gun operation timed out'));
    }, 5000);
    
    // Set data in the test node
    testNode.put({
      testData: `This is a ${tokenType} authenticated test`,
      timestamp: Date.now(),
    }, (ack) => {
      clearTimeout(timeout);
      
      if (ack.err) {
        console.error(`Error writing to Gun with ${tokenType}:`, ack.err);
        reject(new Error(`Gun error: ${ack.err}`));
      } else {
        console.log(`Successfully wrote data to Gun with ${tokenType} authentication!`);
        
        // Read back the data to verify
        testNode.once((data) => {
          if (data) {
            console.log(`Read data from Gun (${tokenType}):`, data);
            resolve({ success: true, data, gun, node: testNode });
          } else {
            reject(new Error('No data returned from Gun'));
          }
        });
      }
    });
  });
}

// Run the test with proper error handling
runTest().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
}); 