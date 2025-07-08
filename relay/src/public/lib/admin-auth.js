/**
 * Shogun Relay Admin Authentication Library
 * 
 * This library provides centralized admin password management for all Shogun Relay applications.
 * It automatically loads stored passwords and provides utilities for authentication.
 */

const ShogunAdmin = (() => {
    const ADMIN_PASSWORD_KEY = 'shogun-relay-admin-password';
    const S3_SECRET_KEY = 'shogun-relay-s3-secret';
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
                hasS3Secret: ShogunAdmin.hasS3Secret(),
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
                s3FieldId: opts.s3FieldId || 's3SecretKey',
                syncEnabled: opts.syncEnabled || true,
                ...opts
            };

            document.addEventListener('DOMContentLoaded', () => {
                 _initField(options.adminFieldId, this.getPassword);
                 _initField(options.s3FieldId, this.getS3Secret);
            });


            if (options.syncEnabled && 'BroadcastChannel' in window) {
                const channel = new BroadcastChannel('shogun-relay-admin');
                channel.onmessage = (event) => {
                    if (event.data && event.data.type === 'password-updated') {
                        console.log('Auth details updated in another tab, reloading...');
                         _initField(options.adminFieldId, this.getPassword);
                         _initField(options.s3FieldId, this.getS3Secret);
                         window.dispatchEvent(new CustomEvent('shogun-admin-password-updated', {
                            detail: {
                                hasPassword: this.hasPassword(),
                                hasS3Secret: this.hasS3Secret(),
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
            const pw = this.getPassword();
            return !!pw && pw.length > 0;
        },
        clearPassword() {
            localStorage.removeItem(ADMIN_PASSWORD_KEY);
            _broadcastUpdate();
        },

        // S3 Secret
        saveS3Secret(secret) {
            localStorage.setItem(S3_SECRET_KEY, secret);
            _broadcastUpdate();
        },
        getS3Secret() {
            return localStorage.getItem(S3_SECRET_KEY) || '';
        },
        hasS3Secret() {
            const secret = this.getS3Secret();
            return !!secret && secret.length > 0;
        },
        clearS3Secret() {
            localStorage.removeItem(S3_SECRET_KEY);
            _broadcastUpdate();
        },

        getAuthHeaders() {
            const headers = {};
            if(this.hasPassword()) {
                headers['Authorization'] = `Bearer ${this.getPassword()}`;
            }
            return headers;
        },

        getS3AuthHeaders() {
             const headers = {};
            if(this.hasS3Secret()) {
                headers['X-S3-Authorization'] = `Bearer ${this.getS3Secret()}`;
            }
             if(this.hasPassword()) {
                headers['Authorization'] = `Bearer ${this.getPassword()}`;
            }
            return headers;
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