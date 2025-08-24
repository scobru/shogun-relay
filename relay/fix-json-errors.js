#!/usr/bin/env node

/**
 * Diagnostic script to identify and fix JSON parsing errors in Shogun Relay
 *
 * Usage:
 * 1. Set environment variables:
 *    - DISABLE_RADISK=true (to disable radisk temporarily)
 *    - CLEANUP_CORRUPTED_DATA=true (to clean up corrupted data)
 *
 * 2. Run the relay with these environment variables
 *
 * 3. If the errors persist, you can also try:
 *    - Delete the radata folder to start fresh
 *    - Check the data being sent to the relay
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("🔍 Shogun Relay JSON Error Diagnostic Tool");
console.log("==========================================");

// Check if radata folder exists
const radataPath = path.join(__dirname, "radata");
if (fs.existsSync(radataPath)) {
  console.log("📁 Found radata folder");

  // List files in radata
  const files = fs.readdirSync(radataPath);
  console.log(`📄 Found ${files.length} files in radata folder`);

  if (files.length > 0) {
    console.log("📋 Files in radata:");
    files.forEach((file) => {
      const filePath = path.join(radataPath, file);
      const stats = fs.statSync(filePath);
      console.log(`  - ${file} (${stats.size} bytes)`);
    });
  }
} else {
  console.log(
    "📁 No radata folder found (this is normal for new installations)"
  );
}

console.log("\n🔧 Recommended fixes:");
console.log(
  "1. Set DISABLE_RADISK=true in your environment to disable radisk temporarily"
);
console.log(
  "2. Set CLEANUP_CORRUPTED_DATA=true to clean up any corrupted data"
);
console.log("3. If problems persist, delete the radata folder to start fresh");
console.log(
  "4. Check the data being sent to the relay for non-serializable objects"
);

console.log("\n📝 Environment variables to set:");
console.log("export DISABLE_RADISK=true");
console.log("export CLEANUP_CORRUPTED_DATA=true");

console.log("\n🚀 To restart the relay with these settings:");
console.log("DISABLE_RADISK=true CLEANUP_CORRUPTED_DATA=true npm start");

console.log("\n✅ Diagnostic complete!");
