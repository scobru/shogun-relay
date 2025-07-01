/**
 * Gun Wrapper - Simplified interface for Gun operations
 */

// Gun CDN fallback if not already loaded
if (typeof Gun === 'undefined') {
    console.warn('Gun not loaded, attempting to load from CDN...');
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/gun/gun.js';
    document.head.appendChild(script);
}

function createGunWrapper(options = {}) {
    const { debug = false, peers = [] } = options;
    
    // Initialize Gun instance
    let gun;
    
    try {
        // Try to connect to the current relay
        const currentHost = window.location.origin;
        const gunPeers = [currentHost + '/gun', ...peers];
        
        gun = Gun({
            peers: gunPeers,
            localStorage: false,
            radisk: true
        });
        
        if (debug) {
            console.log('🔫 Gun initialized with peers:', gunPeers);
        }
    } catch (error) {
        console.error('❌ Gun initialization failed:', error);
        // Fallback to basic Gun instance
        gun = Gun();
    }
    
    return {
        /**
         * Get data from a path
         * @param {string} path - The path to get data from (e.g., "my/data/node")
         * @returns {Promise} Promise that resolves with the data
         */
        async get(path) {
            return new Promise((resolve, reject) => {
                try {
                    if (!path) {
                        reject(new Error('Path is required'));
                        return;
                    }
                    
                    const pathSegments = path.split('/').filter(Boolean);
                    let node = gun;
                    
                    // Navigate to the node
                    pathSegments.forEach(segment => {
                        node = node.get(segment);
                    });
                    
                    // Set timeout for the operation
                    const timeout = setTimeout(() => {
                        reject(new Error('Get operation timed out'));
                    }, 5000);
                    
                    // Get the data
                    node.once((data) => {
                        clearTimeout(timeout);
                        
                        // Clean Gun metadata
                        if (data && data._) {
                            const cleanData = { ...data };
                            delete cleanData._;
                            resolve(cleanData);
                        } else {
                            resolve(data);
                        }
                    });
                    
                    if (debug) {
                        console.log(`🔍 Getting data from path: ${path}`);
                    }
                } catch (error) {
                    reject(error);
                }
            });
        },
        
        /**
         * Put data to a path
         * @param {string} path - The path to put data to (e.g., "my/data/node")
         * @param {*} data - The data to store
         * @returns {Promise} Promise that resolves when data is stored
         */
        async put(path, data) {
            return new Promise((resolve, reject) => {
                try {
                    if (!path) {
                        reject(new Error('Path is required'));
                        return;
                    }
                    
                    const pathSegments = path.split('/').filter(Boolean);
                    let node = gun;
                    
                    // Navigate to the node
                    pathSegments.forEach(segment => {
                        node = node.get(segment);
                    });
                    
                    // Set timeout for the operation
                    const timeout = setTimeout(() => {
                        reject(new Error('Put operation timed out'));
                    }, 10000);
                    
                    // Store the data
                    node.put(data, (ack) => {
                        clearTimeout(timeout);
                        
                        if (ack.err) {
                            reject(new Error(ack.err));
                        } else {
                            resolve(ack);
                        }
                    });
                    
                    if (debug) {
                        console.log(`💾 Putting data to path: ${path}`, data);
                    }
                } catch (error) {
                    reject(error);
                }
            });
        },
        
        /**
         * Delete data at a path
         * @param {string} path - The path to delete
         * @returns {Promise} Promise that resolves when data is deleted
         */
        async delete(path) {
            return this.put(path, null);
        },
        
        /**
         * Get the raw Gun instance for advanced operations
         * @returns {Gun} The Gun instance
         */
        raw() {
            return gun;
        },
        
        /**
         * Subscribe to changes at a path
         * @param {string} path - The path to watch
         * @param {Function} callback - Callback function called when data changes
         * @returns {Function} Unsubscribe function
         */
        subscribe(path, callback) {
            try {
                const pathSegments = path.split('/').filter(Boolean);
                let node = gun;
                
                pathSegments.forEach(segment => {
                    node = node.get(segment);
                });
                
                const unsubscribe = node.on((data, key) => {
                    // Clean Gun metadata
                    if (data && data._) {
                        const cleanData = { ...data };
                        delete cleanData._;
                        callback(cleanData, key);
                    } else {
                        callback(data, key);
                    }
                });
                
                if (debug) {
                    console.log(`👁️ Subscribing to path: ${path}`);
                }
                
                return () => {
                    if (typeof unsubscribe === 'function') {
                        unsubscribe();
                    } else if (unsubscribe && typeof unsubscribe.off === 'function') {
                        unsubscribe.off();
                    }
                };
            } catch (error) {
                console.error('❌ Subscribe failed:', error);
                return () => {}; // Return empty unsubscribe function
            }
        }
    };
}

// Make it globally available
window.createGunWrapper = createGunWrapper;

// Also export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = createGunWrapper;
} 