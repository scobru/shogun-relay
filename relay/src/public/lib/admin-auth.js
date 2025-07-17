/**
 * Shogun Relay Admin Authentication Library
 * 
 * This library provides centralized admin password management for all Shogun Relay applications.
 * It automatically loads stored passwords and provides utilities for authentication.
 */

const ShogunAdmin = (() => {
    const ADMIN_PASSWORD_KEY = 'shogun-relay-admin-password';
    let options = {};

    function _broadcastUpdate() {
        if ('BroadcastChannel' in window) {
            const channel = new BroadcastChannel('shogun-relay-admin');
            channel.postMessage({ type: 'password-updated' });
            channel.close();
        }
         // Dispatch a custom event for same-page updates
        window.dispatchEvent(new CustomEvent('shogun-admin-password-updated', {
            detail: {
                hasPassword: ShogunAdmin.hasPassword(),
                source: 'local'
            }
        }));
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
        init(opts = {}) {
            options = {
                autoFill: opts.autoFill || false,
                showIndicator: opts.showIndicator || false,
                adminFieldId: opts.adminFieldId || 'adminPassword',
                syncEnabled: opts.syncEnabled || true,
                ...opts
            };

            document.addEventListener('DOMContentLoaded', () => {
                 _initField(options.adminFieldId, this.getPassword);
            });


            if (options.syncEnabled && 'BroadcastChannel' in window) {
                const channel = new BroadcastChannel('shogun-relay-admin');
                channel.onmessage = (event) => {
                    if (event.data && event.data.type === 'password-updated') {
                        console.log('Auth details updated in another tab, reloading...');
                         _initField(options.adminFieldId, this.getPassword);
                         window.dispatchEvent(new CustomEvent('shogun-admin-password-updated', {
                            detail: {
                                hasPassword: this.hasPassword(),
                                source: 'broadcast'
                            }
                        }));
                    }
                };
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
            localStorage.removeItem('admin-password');
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