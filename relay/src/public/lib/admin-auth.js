/**
 * Shogun Relay Admin Authentication Library
 * 
 * This library provides centralized admin password management for all Shogun Relay applications.
 * It automatically loads stored passwords and provides utilities for authentication.
 */

const ShogunAdmin = (() => {
    const ADMIN_PASSWORD_KEY = 'shogun-relay-admin-password';
    const defaultOptions = {
        autoFill: false,
        showIndicator: false,
        adminFieldId: 'adminPassword',
        syncEnabled: true
    };
    let options = {};
    let passwordChangeCallbacks = [];

    function _cleanupDuplicateKeys() {
        // Rimuovi la chiave duplicata adminToken se esiste
        const adminToken = localStorage.getItem('adminToken');
        const currentPassword = localStorage.getItem(ADMIN_PASSWORD_KEY);
        
        if (adminToken && adminToken === currentPassword) {
            // Se adminToken è uguale alla password corrente, rimuovilo
            localStorage.removeItem('adminToken');
            console.log('🧹 Cleaned up duplicate adminToken key');
        }
    }

    function _broadcastUpdate() {
        // Broadcast to other tabs/windows
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                const channel = new BroadcastChannel('shogun-admin-auth');
                channel.postMessage({
                    type: 'password-updated',
                    hasPassword: hasPassword()
                });
            } catch (error) {
                console.warn('BroadcastChannel not supported:', error);
            }
        }
        
        // Call all registered callbacks
        passwordChangeCallbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                console.error('Error in password change callback:', error);
            }
        });
    }

    function _initField(fieldId, getter) {
        if (options.autoFill) {
            const field = document.getElementById(fieldId);
            if (field) {
                field.value = getter() || '';
            }
        }
    }

    // Public API
    return {
        init(config = {}) {
            options = { ...defaultOptions, ...config };
            
            // Cleanup duplicate keys on initialization
            _cleanupDuplicateKeys();
            
            // Listen for password updates from other tabs
            if (typeof BroadcastChannel !== 'undefined') {
                try {
                    const channel = new BroadcastChannel('shogun-admin-auth');
                    channel.onmessage = (event) => {
                        if (event.data.type === 'password-updated') {
                            _broadcastUpdate();
                        }
                    };
                } catch (error) {
                    console.warn('BroadcastChannel not supported:', error);
                }
            }
        },

        // Admin Password
        savePassword(password) {
            localStorage.setItem(ADMIN_PASSWORD_KEY, password);
            _broadcastUpdate();
        },
        getPassword() {
            return localStorage.getItem(ADMIN_PASSWORD_KEY) || '';
        },
        hasPassword() {
            return !!this.getPassword();
        },
        clearPassword() {
            localStorage.removeItem(ADMIN_PASSWORD_KEY);
            _broadcastUpdate();
        },
        getAuthHeaders() {
            const password = this.getPassword();
            if (!password) {
                return {};
            }
            return {
                'Authorization': 'Bearer ' + password
            };
        },
        
        onPasswordChange(callback) {
            if (typeof callback === 'function') {
                passwordChangeCallbacks.push(callback);
            }
        },

        // Cleanup duplicate keys manually
        cleanupDuplicateKeys() {
            _cleanupDuplicateKeys();
        }
    };
})();

// Auto-initialize with default settings when script loads
// Pages can call ShogunAdmin.init() again with custom options to override
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        ShogunAdmin.init();
    });
} else {
    ShogunAdmin.init();
}

// Legacy support for existing function names
window.getShogunAdminPassword = ShogunAdmin.getPassword;
window.hasShogunAdminPassword = ShogunAdmin.hasPassword; 