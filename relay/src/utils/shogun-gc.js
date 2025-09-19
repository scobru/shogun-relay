// Shogun Relay Garbage Collector (Shogun-GC)
// Based on LES.js but optimized for Shogun relay server
// Provides intelligent memory management for GunDB data

/**
 * Shogun Garbage Collector Configuration
 * 
 * Gun Parameters:
 * - gc_enable: Enable/disable GC (default: true)
 * - gc_delay: Time between GC runs in ms (default: 30000)
 * - gc_threshold: Memory usage threshold to trigger GC (default: 0.8)
 * - gc_info_enable: Enable GC info logging (default: true)
 * - gc_info_interval: Time between info logs in ms (default: 60000)
 * - gc_namespace_protection: Protected namespaces that should not be garbage collected
 * - gc_importance_func: Custom function to calculate node importance
 * - gc_max_nodes: Maximum number of nodes to track (default: 10000)
 */

// Default configuration
const DEFAULT_CONFIG = {
    gc_enable: true,
    gc_delay: 30000, // 30 seconds
    gc_threshold: 0.8, // 80% memory usage
    gc_info_enable: true,
    gc_info_interval: 60000, // 1 minute
    gc_namespace_protection: ['shogun', 'relays', 'pulse', 'logs'], // Protected namespaces
    gc_max_nodes: 10000,
    gc_cleanup_interval: 300000 // 5 minutes for cleanup tasks
};

// Debug mode
const DEBUG = false;

// Node tracking
const trackedNodes = new Map(); // soul -> { timestamp, accessCount, namespace }
const accessPatterns = new Map(); // soul -> { lastAccess, frequency }
const namespaceStats = new Map(); // namespace -> { count, lastCleanup }

// GC Statistics
const gcStats = {
    totalRuns: 0,
    totalFreed: 0,
    totalMemoryFreed: 0,
    lastRun: 0,
    avgRunTime: 0
};

// Global variables
let gcConfig = { ...DEFAULT_CONFIG };
let gunInstance = null;
let lastInfoTime = 0;

/**
 * Enhanced importance calculation for Shogun relay
 */
function calculateNodeImportance(nodeInfo, currentTime, memoryRatio) {
    const timeSinceAccess = (currentTime - nodeInfo.timestamp) * 0.001; // seconds
    const accessWeight = Math.log(nodeInfo.accessCount + 1);
    const namespaceWeight = gcConfig.gc_namespace_protection.includes(nodeInfo.namespace) ? 1000 : 1;
    
    // Calculate importance (higher = more important, less likely to be collected)
    const importance = (timeSinceAccess * 0.1) * (memoryRatio * memoryRatio) / (accessWeight * namespaceWeight);
    
    return importance;
}

/**
 * Get namespace from soul
 */
function getNamespaceFromSoul(soul) {
    if (!soul || typeof soul !== 'string') return 'unknown';
    
    // Try to extract namespace from soul pattern
    const parts = soul.split('/');
    if (parts.length > 1) {
        return parts[1]; // Usually the second part is the namespace
    }
    
    return 'root';
}

/**
 * Track node access
 */
function trackNodeAccess(soul, namespace) {
    if (!soul) return;
    
    const currentTime = Date.now();
    
    // Update tracked nodes
    if (trackedNodes.has(soul)) {
        const nodeInfo = trackedNodes.get(soul);
        nodeInfo.accessCount++;
        nodeInfo.lastAccess = currentTime;
    } else {
        trackedNodes.set(soul, {
            timestamp: currentTime,
            accessCount: 1,
            namespace: namespace,
            lastAccess: currentTime,
            created: currentTime
        });
    }
    
    // Update namespace stats
    if (namespaceStats.has(namespace)) {
        const nsStats = namespaceStats.get(namespace);
        nsStats.count++;
        nsStats.lastAccess = currentTime;
    } else {
        namespaceStats.set(namespace, {
            count: 1,
            lastAccess: currentTime,
            lastCleanup: 0
        });
    }
    
    // Clean up old tracking data if we exceed max nodes
    if (trackedNodes.size > gcConfig.gc_max_nodes) {
        cleanupOldTrackingData();
    }
}

/**
 * Clean up old tracking data
 */
function cleanupOldTrackingData() {
    const currentTime = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    let removed = 0;
    
    for (const [soul, nodeInfo] of trackedNodes.entries()) {
        if (currentTime - nodeInfo.lastAccess > maxAge) {
            trackedNodes.delete(soul);
            removed++;
        }
    }
    
    if (DEBUG && removed > 0) {
        console.log(`🧹 Shogun-GC: Cleaned up ${removed} old tracking entries`);
    }
}

/**
 * Main garbage collection function
 */
function performGarbageCollection(memoryRatio) {
    if (!gcConfig.gc_enable) return;
    
    const startTime = Date.now();
    let freed = 0;
    let memoryFreed = 0;
    const currentTime = Date.now();
    
    // Sort nodes by importance (least important first)
    const nodesToCheck = Array.from(trackedNodes.entries())
        .filter(([soul, nodeInfo]) => {
            // Skip protected namespaces
            return !gcConfig.gc_namespace_protection.includes(nodeInfo.namespace);
        })
        .sort((a, b) => {
            const importanceA = calculateNodeImportance(a[1], currentTime, memoryRatio);
            const importanceB = calculateNodeImportance(b[1], currentTime, memoryRatio);
            return importanceA - importanceB;
        });
    
    // Collect nodes based on memory pressure
    const targetFreed = memoryRatio > gcConfig.gc_threshold ? Math.floor(nodesToCheck.length * 0.1) : 0;
    
    for (let i = 0; i < nodesToCheck.length && freed < targetFreed; i++) {
        const [soul, nodeInfo] = nodesToCheck[i];
        const importance = calculateNodeImportance(nodeInfo, currentTime, memoryRatio);
        
        if (importance < 100) { // Threshold for collection
            try {
                // Remove from GunDB
                if (gunInstance && typeof gunInstance.get === 'function') {
                    gunInstance.get(soul).off();
                    memoryFreed += estimateNodeMemoryUsage(nodeInfo);
                    freed++;
                    
                    if (DEBUG) {
                        console.log(`🗑️ Shogun-GC: Collected node ${soul} (importance: ${importance.toFixed(2)})`);
                    }
                }
                
                // Remove from tracking
                trackedNodes.delete(soul);
                
            } catch (error) {
                console.error(`❌ Shogun-GC: Error collecting node ${soul}:`, error);
            }
        }
    }
    
    // Update statistics
    gcStats.totalRuns++;
    gcStats.totalFreed += freed;
    gcStats.totalMemoryFreed += memoryFreed;
    gcStats.lastRun = startTime;
    gcStats.avgRunTime = (gcStats.avgRunTime * (gcStats.totalRuns - 1) + (Date.now() - startTime)) / gcStats.totalRuns;
    
    // Log results
    if (freed > 0 || (gcConfig.gc_info_enable && startTime - lastInfoTime >= gcConfig.gc_info_interval)) {
        const runTime = Date.now() - startTime;
        console.log(`🧹 Shogun-GC: Freed ${freed} nodes (${(memoryFreed / 1024).toFixed(2)}KB) in ${runTime}ms | Memory ratio: ${(memoryRatio * 100).toFixed(1)}% | Tracked: ${trackedNodes.size}`);
        lastInfoTime = startTime;
    }
}

/**
 * Estimate memory usage of a node
 */
function estimateNodeMemoryUsage(nodeInfo) {
    // Rough estimation based on access patterns and age
    const baseSize = 1024; // 1KB base
    const accessMultiplier = Math.log(nodeInfo.accessCount + 1);
    const ageMultiplier = Math.log((Date.now() - nodeInfo.created) / 1000 + 1);
    
    return baseSize * accessMultiplier * ageMultiplier;
}

/**
 * Get GC statistics
 */
function getGCStats() {
    return {
        ...gcStats,
        trackedNodes: trackedNodes.size,
        namespaceStats: Object.fromEntries(namespaceStats),
        config: gcConfig,
        memoryUsage: process.memoryUsage ? process.memoryUsage() : null
    };
}

/**
 * Manual GC trigger
 */
function triggerManualGC() {
    if (!gcConfig.gc_enable) {
        console.log("❌ Shogun-GC: Garbage collection is disabled");
        return;
    }
    
    const memoryUsage = process.memoryUsage ? process.memoryUsage().rss / 1024 / 1024 : 0;
    const maxMemory = parseFloat(process.env.WEB_MEMORY || 512) * 0.8;
    const memoryRatio = maxMemory > 0 ? memoryUsage / maxMemory : 0;
    
    console.log("🔧 Shogun-GC: Manual garbage collection triggered");
    performGarbageCollection(memoryRatio);
}

/**
 * Initialize the garbage collector
 */
function initializeGC(root, config) {
    gcConfig = { ...DEFAULT_CONFIG, ...config };
    gunInstance = root.gun;
    lastInfoTime = 0;
    
    if (!gcConfig.gc_enable) {
        console.log("📊 Shogun-GC: Garbage collection disabled");
        return;
    }
    
    console.log("🧹 Shogun-GC: Initializing Shogun Garbage Collector");
    console.log(`📊 Shogun-GC Config: delay=${gcConfig.gc_delay}ms, threshold=${gcConfig.gc_threshold}, protected=${gcConfig.gc_namespace_protection.join(',')}`);
    
    // Set up periodic GC
    setInterval(() => {
        const memoryUsage = process.memoryUsage ? process.memoryUsage().rss / 1024 / 1024 : 0;
        const maxMemory = parseFloat(process.env.WEB_MEMORY || 512) * 0.8;
        const memoryRatio = maxMemory > 0 ? memoryUsage / maxMemory : 0;
        
        performGarbageCollection(memoryRatio);
    }, gcConfig.gc_delay);
    
    // Set up cleanup tasks
    setInterval(() => {
        cleanupOldTrackingData();
    }, gcConfig.gc_cleanup_interval);
    
    // Track node access on PUT operations
    root.on("put", function(msg) {
        const souls = Object.keys(msg.put || {});
        
        souls.forEach(soul => {
            const namespace = getNamespaceFromSoul(soul);
            trackNodeAccess(soul, namespace);
        });
    });
    
    // Track node access on GET operations
    root.on("get", function(msg) {
        if (msg.get && msg.get["#"]) {
            const soul = msg.get["#"];
            const namespace = getNamespaceFromSoul(soul);
            trackNodeAccess(soul, namespace);
        }
    });
    
    console.log("✅ Shogun-GC: Garbage collector initialized successfully");
}

// Export functions for external use
const ShogunGC = {
    initialize: initializeGC,
    trigger: triggerManualGC,
    stats: getGCStats,
    config: function(newConfig) {
        if (newConfig) {
            gcConfig = { ...gcConfig, ...newConfig };
            console.log("🔧 Shogun-GC: Configuration updated");
        }
        return gcConfig;
    }
};

// Make available globally
if (typeof window !== "undefined") {
    window.ShogunGC = ShogunGC;
} else if (typeof global !== "undefined") {
    global.ShogunGC = ShogunGC;
}

// Export for ES modules
export default ShogunGC;