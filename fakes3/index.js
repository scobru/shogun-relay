const S3rver = require("s3rver");
const { fromEvent } = require("rxjs");
const { filter } = require("rxjs/operators");
const fs = require("fs");
const path = require("path");
const corsConfig = require.resolve("s3rver/example/cors.xml");
const websiteConfig = require.resolve("s3rver/example/website.xml");

const dotenv = require("dotenv")

dotenv.config()

// Configuration matching the relay server exactly
let accessKeyId = process.env.S3_ACCESS_KEY || "S3RVER2025";
let secretAccessKey = process.env.S3_SECRET_KEY || "S3RVER2025";
let bucketName = process.env.S3_BUCKET || "shogun-bucket";
let port = process.env.S3_PORT || 4569;
let address = process.env.ADDRESS || "localhost";
let directory = "./buckets";


if(!accessKeyId || !secretAccessKey || !bucketName || !port || !address) {
  console.error("❌ Missing required environment variables");
  process.exit(1);
}

// Ensure buckets directory exists
if (!fs.existsSync(directory)) {
  fs.mkdirSync(directory, { recursive: true });
  console.log(`Created directory: ${directory}`);
}

// Ensure bucket directory exists
const bucketDir = path.join(directory, bucketName);
if (!fs.existsSync(bucketDir)) {
  fs.mkdirSync(bucketDir, { recursive: true });
  console.log(`Created bucket directory: ${bucketDir}`);
}

const instance = new S3rver({
  serviceEndpoint: "test-bucket.127.0.0.1",
  port: port,
  address: address,
  silent: false,
  directory: directory,
  accessKeyId: accessKeyId,
  secretAccessKey: secretAccessKey,
  allowMismatchedSignatures: true,
  vhostBuckets: true, // Disable virtual hosted style buckets for compatibility
  configureBuckets: [
    {
      name: bucketName,
      region: "us-east-1",
      configs: [fs.readFileSync(corsConfig), fs.readFileSync(websiteConfig)],
      accessKeyId: accessKeyId,
      secretAccessKey: secretAccessKey,
    },
      
  ],
}).run((err, { address, port } = {}) => {
  if (err) {
    console.error("❌ FakeS3 Server failed to start:", err);
    process.exit(1);
  } else {
    console.log("✅ FakeS3 Server started successfully");
    console.log(`📍 Address: ${address}`);
    console.log(`🔌 Port: ${port}`);
    console.log(`📁 Directory: ${directory}`);
    console.log(`🔐 Access Key ID: ${accessKeyId}`);
    console.log(`🔑 Secret Access Key: ${secretAccessKey}`);
    console.log(`🪣 Bucket Name: ${bucketName}`);
    console.log(`🌐 Service Endpoint: http://${address}:${port}`);
    console.log("📝 Gun.js relay server can now connect to this fake S3");
  }
});

const s3Events = fromEvent(instance, "event");
s3Events.subscribe((event) => console.log(event));
s3Events
  .pipe(filter((event) => event.Records[0].eventName == "ObjectCreated:Copy"))
  .subscribe((event) => console.log(event));
