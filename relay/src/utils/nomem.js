/**
 * No-Memory Storage Adapter for Gun
 * Provides ephemeral storage without disk persistence
 * Based on gun/lib/nomem
 */

export default function createNoMemAdapter() {
  return function NoMemAdapter(opt) {
    opt = opt || {};
    
    // RAD storage interface without actual storage
    return {
      get: function(key, cb) {
        // Always return undefined for ephemeral data
        cb(null, undefined);
      },
      
      put: function(file, data, cb) {
        // Acknowledge write without storing
        if (cb) cb(null, 1);
      },
      
      // List all keys (always empty for ephemeral)
      list: function(cb) {
        cb(null, {});
      }
    };
  };
}

