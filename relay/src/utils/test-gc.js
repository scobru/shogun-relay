// Simple test script for Shogun-GC
// Run with: node test-gc.js

import Gun from "gun";
import ShogunGC from "./shogun-gc.js";

console.log("🧪 Testing Shogun-GC...");

// Create a test Gun instance
const gun = Gun({
  file: "test-data",
  radisk: false, // Disable file storage for testing
  gc_enable: true,
  gc_delay: 5000, // 5 seconds for testing
  gc_threshold: 0.5, // Lower threshold for testing
  gc_info_enable: true,
  gc_max_nodes: 100,
  gc_namespace_protection: ['test-protected']
});

console.log("📊 Gun instance created");

// Initialize GC
try {
  const gcOptions = {
    gc_enable: true,
    gc_delay: 5000,
    gc_threshold: 0.5,
    gc_info_enable: true,
    gc_max_nodes: 100,
    gc_namespace_protection: ['test-protected']
  };
  
  ShogunGC.initialize(gun._.root, gcOptions);
  console.log("✅ Shogun-GC initialized");
} catch (error) {
  console.error("❌ Failed to initialize GC:", error);
  process.exit(1);
}

// Test data creation
console.log("📝 Creating test data...");

// Create some test nodes
for (let i = 0; i < 50; i++) {
  gun.get(`test/node-${i}`).put({
    id: i,
    data: `test data ${i}`,
    timestamp: Date.now(),
    random: Math.random()
  });
}

// Create some protected nodes
for (let i = 0; i < 10; i++) {
  gun.get(`test-protected/node-${i}`).put({
    id: i,
    protected: true,
    data: `protected data ${i}`
  });
}

console.log("📊 Test data created. GC should start working...");

// Test GC stats
setTimeout(() => {
  console.log("📊 GC Stats:", ShogunGC.stats());
}, 10000);

// Test manual GC trigger
setTimeout(() => {
  console.log("🔧 Triggering manual GC...");
  ShogunGC.trigger();
}, 15000);

// Exit after test
setTimeout(() => {
  console.log("✅ Test completed");
  process.exit(0);
}, 20000);
