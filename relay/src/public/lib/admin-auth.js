/**
 * Shogun Relay Admin Authentication Library
 * 
 * This library provides centralized admin password management for all Shogun Relay applications.
 * It automatically loads stored passwords and provides utilities for authentication.
 */

(function() {
    'use strict';
    
    const ADMIN_PASSWORD_KEY = 'shogun-relay-admin-password';
    const BROADCAST_CHANNEL_NAME = 'shogun-relay-admin';
    
    // Global namespace for admin authentication
    window.ShogunAdmin = {
        
        /**
         * Get the stored admin password
         * @returns {string} The stored password or empty string
         */
        getPassword: function() {
            try {
                return localStorage.getItem(ADMIN_PASSWORD_KEY) || '';
            } catch (error) {
                console.error('[ShogunAdmin] Failed to get password:', error);
                return '';
            }
        },
        
        /**
         * Check if admin password is stored
         * @returns {boolean} True if password exists
         */
        hasPassword: function() {
            try {
                const password = localStorage.getItem(ADMIN_PASSWORD_KEY);
                return password && password.trim().length > 0;
            } catch (error) {
                console.error('[ShogunAdmin] Failed to check password:', error);
                return false;
            }
        },
        
        /**
         * Auto-fill password field if it exists on the page
         * @param {string} fieldId - The ID of the password field (default: 'adminToken', 'authToken', 'adminPassword')
         */
        autoFillPassword: function(fieldId = null) {
            const password = this.getPassword();
            if (!password) return false;
            
            // Default field IDs to try
            const fieldIds = fieldId ? [fieldId] : [
                'adminToken', 'authToken', 'adminPassword', 
                'adminTokenInput', 'authTokenInput', 'admin-token'
            ];
            
            for (const id of fieldIds) {
                const field = document.getElementById(id);
                if (field) {
                    field.value = password;
                    console.log(`[ShogunAdmin] Auto-filled password field: ${id}`);
                    
                    // Trigger change event for any listeners
                    const event = new Event('change', { bubbles: true });
                    field.dispatchEvent(event);
                    
                    return true;
                }
            }
            
            return false;
        },
        
        /**
         * Add visual indicator showing password status
         * @param {string} containerId - Container to add the indicator to
         */
        addPasswordIndicator: function(containerId = null) {
            // If indicator already exists, just update its content and return.
            const existingIndicator = document.getElementById('shogun-admin-indicator');
            if (existingIndicator) {
                const hasPassword = this.hasPassword();
                existingIndicator.innerHTML = hasPassword 
                    ? '<span class="indicator-success">🔑 Admin password loaded</span>' 
                    : '<span class="indicator-warning">⚠️ No admin password set</span>';
                
                if (!hasPassword && !existingIndicator.querySelector('.indicator-link')) {
                    const link = document.createElement('div');
                    link.innerHTML = '<span class="indicator-link">Set password in Control Panel</span>';
                    link.style.marginTop = '4px';
                    link.style.cursor = 'pointer';
                    link.onclick = () => window.open('/', '_blank');
                    existingIndicator.appendChild(link);
                }
                return;
            }

            const hasPassword = this.hasPassword();
            
            const indicator = document.createElement('div');
            indicator.id = 'shogun-admin-indicator';
            indicator.className = 'shogun-admin-indicator';
            indicator.innerHTML = hasPassword ? 
                '<span class="indicator-success">🔑 Admin password loaded</span>' : 
                '<span class="indicator-warning">⚠️ No admin password set</span>';
            
            // Add styles
            const style = document.createElement('style');
            style.textContent = `
                .shogun-admin-indicator {
                    padding: 8px 12px;
                    border-radius: 6px;
                    font-size: 0.85em;
                    margin: 8px 0;
                    text-align: center;
                    background-color: rgba(255,255,255,0.05);
                    border: 1px solid rgba(255,255,255,0.1);
                }
                .indicator-success {
                    color: #4ade80;
                }
                .indicator-warning {
                    color: #fbbf24;
                }
                .indicator-link {
                    color: #60a5fa;
                    text-decoration: underline;
                    cursor: pointer;
                }
            `;
            document.head.appendChild(style);
            
            // Try to find container
            let container = null;
            if (containerId) {
                container = document.getElementById(containerId);
            } else {
                // Try common container selectors
                container = document.querySelector('.container') || 
                           document.querySelector('.card') || 
                           document.querySelector('body > div') ||
                           document.body;
            }
            
            if (container && container.children.length > 0) {
                container.insertBefore(indicator, container.children[0]);
            } else if (container) {
                container.appendChild(indicator);
            }
            
            // Add link to main page if no password
            if (!hasPassword) {
                const link = document.createElement('div');
                link.innerHTML = '<span class="indicator-link">Set password in Control Panel</span>';
                link.style.marginTop = '4px';
                link.style.cursor = 'pointer';
                link.onclick = () => window.open('/', '_blank');
                indicator.appendChild(link);
            }
        },
        
        /**
         * Listen for password updates from other tabs
         */
        setupPasswordSync: function() {
            if ('BroadcastChannel' in window) {
                const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
                channel.onmessage = (event) => {
                    if (event.data.type === 'password-updated') {
                        console.log('[ShogunAdmin] Password updated in another tab, refreshing...');
                        
                        // Re-fill password fields
                        this.autoFillPassword();
                        
                        // Update indicator if it exists
                        const indicator = document.getElementById('shogun-admin-indicator');
                        if (indicator) {
                            const hasPassword = this.hasPassword();
                            indicator.innerHTML = hasPassword ? 
                                '<span class="indicator-success">🔑 Admin password loaded (updated)</span>' : 
                                '<span class="indicator-warning">⚠️ No admin password set</span>';
                        }
                        
                        // Dispatch custom event for pages to listen to
                        window.dispatchEvent(new CustomEvent('shogun-admin-password-updated', {
                            detail: { hasPassword: this.hasPassword() }
                        }));
                    }
                };
            }
        },
        
        /**
         * Get authorization header object
         * @returns {Object} Authorization header or empty object
         */
        getAuthHeader: function() {
            const password = this.getPassword();
            return password ? { 'Authorization': `Bearer ${password}` } : {};
        },
        
        /**
         * Initialize admin authentication for the current page
         * @param {Object} options - Configuration options
         */
        init: function(options = {}) {
            const {
                autoFill = true,
                showIndicator = true,
                fieldId = null,
                containerId = null,
                syncEnabled = true
            } = options;
            
            console.log('[ShogunAdmin] Initializing admin authentication...');
            
            // Setup password sync
            if (syncEnabled) {
                this.setupPasswordSync();
            }
            
            // Auto-fill password field
            if (autoFill) {
                // Try immediately
                this.autoFillPassword(fieldId);
                
                // Try again after DOM is fully loaded
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => {
                        setTimeout(() => this.autoFillPassword(fieldId), 100);
                    });
                } else {
                    setTimeout(() => this.autoFillPassword(fieldId), 100);
                }
            }
            
            // Show password indicator
            if (showIndicator) {
                if (document.readyState === 'loading') {
                    document.addEventListener('DOMContentLoaded', () => {
                        this.addPasswordIndicator(containerId);
                    });
                } else {
                    this.addPasswordIndicator(containerId);
                }
            }
            
            console.log('[ShogunAdmin] Admin authentication initialized');
        }
    };
    
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
    
})(); 