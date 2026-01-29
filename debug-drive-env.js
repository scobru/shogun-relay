var drive = require('./relay/dist/utils/drive');
// We need to use dist because we are running with node, unless we use ts-node
// But let's try to just read env vars first.

console.log("Drive Storage Type:", process.env.DRIVE_STORAGE_TYPE);
console.log("MinIO Config:", {
    endpoint: process.env.MINIO_ENDPOINT,
    bucket: process.env.MINIO_BUCKET,
    accessKey: process.env.MINIO_ACCESS_KEY ? "***" : "missing",
    secretKey: process.env.MINIO_SECRET_KEY ? "***" : "missing"
});
