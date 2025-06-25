#!/usr/bin/env node

// Test script per verificare la connessione al fake S3
const AWS = require('aws-sdk');

// Configurazione per il fake S3
const s3Config = {
  accessKeyId: 'S3RVER',
  secretAccessKey: 'S3RVER',
  endpoint: 'http://localhost:4569',
  region: 'us-east-1',
  s3ForcePathStyle: true, // Importante per fake S3
  signatureVersion: 'v4'
};

const s3 = new AWS.S3(s3Config);
const bucketName = 'test-bucket';

async function testS3Connection() {
  try {
    console.log('🧪 Testing S3 connection...');
    console.log('📋 Configuration:', {
      endpoint: s3Config.endpoint,
      bucket: bucketName,
      accessKeyId: s3Config.accessKeyId,
      region: s3Config.region
    });

    // Test 1: List buckets
    console.log('\n📦 Test 1: Listing buckets...');
    const buckets = await s3.listBuckets().promise();
    console.log('✅ Buckets:', buckets.Buckets.map(b => b.Name));

    // Test 2: Put object
    console.log('\n📝 Test 2: Putting test object...');
    const putResult = await s3.putObject({
      Bucket: bucketName,
      Key: 'test-file.txt',
      Body: 'Hello from Shogun Relay S3 test!',
      ContentType: 'text/plain'
    }).promise();
    console.log('✅ Put object result:', putResult.ETag);

    // Test 3: Get object
    console.log('\n📖 Test 3: Getting test object...');
    const getResult = await s3.getObject({
      Bucket: bucketName,
      Key: 'test-file.txt'
    }).promise();
    console.log('✅ Object content:', getResult.Body.toString());

    // Test 4: List objects
    console.log('\n📋 Test 4: Listing objects in bucket...');
    const objects = await s3.listObjectsV2({
      Bucket: bucketName
    }).promise();
    console.log('✅ Objects:', objects.Contents.map(obj => ({
      key: obj.Key,
      size: obj.Size,
      lastModified: obj.LastModified
    })));

    console.log('\n🎉 All S3 tests passed! FakeS3 is working correctly.');

  } catch (error) {
    console.error('\n❌ S3 test failed:', error.message);
    console.error('🔍 Error details:', {
      code: error.code,
      statusCode: error.statusCode,
      endpoint: error.endpoint
    });

    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Suggestion: Make sure FakeS3 server is running on port 4569');
      console.log('   Run: cd shogun-relay/fakes3 && node index.js');
    }
    
    process.exit(1);
  }
}

// Verifica se fakes3 è in esecuzione
const net = require('net');
const client = new net.Socket();

client.setTimeout(3000);

client.connect(4569, 'localhost', () => {
  console.log('✅ FakeS3 server is running on port 4569');
  client.destroy();
  testS3Connection();
});

client.on('error', (err) => {
  console.error('❌ Cannot connect to FakeS3 server on port 4569');
  console.log('💡 Start FakeS3 first: cd shogun-relay/fakes3 && node index.js');
  process.exit(1);
});

client.on('timeout', () => {
  console.error('❌ Connection timeout to FakeS3 server');
  client.destroy();
  process.exit(1);
}); 