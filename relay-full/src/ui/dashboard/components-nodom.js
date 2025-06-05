import { h, setEffect, setSignal } from './nodom.js';
import {
    getActiveTab,
    setActiveTab,
    getServerStatus,
    getFileStats,
    formatFileSize,
    getIsLoading,
    setIsLoading,
    showToast,
    getAuthToken,
    loadFiles,
    getToasts,
    setToasts,
    getTheme,
    toggleTheme,
    getIpfsConnectionStatus,
    getIpfsStatus,
    handleLogout,
    setFiles,
    deleteFile,
    checkIpfsPinStatus,
    pinFileToIpfs,
    unpinFileFromIpfs,
    deleteIpfsFile,
    loadAllFiles
} from './app-nodom.js';

/**
 * Header Component
 */
export function Header() {
    return h('header', { class: 'navbar bg-primary text-primary-content shadow-lg' }, 
        h('div', { class: 'navbar-start' },
            h('h1', { class: 'text-xl font-bold' }, '🛡️ Shogun Relay Dashboard')
        )
    );
}

/**
 * Navbar Component
 */
export function Navbar() {
    return h('div', { class: 'navbar bg-base-200 shadow-md' },
        h('div', { class: 'navbar-start' },
            h('div', { class: 'flex gap-2' },
                h('button', { class: 'btn btn-ghost btn-sm' }, 'Dashboard'),
                h('button', { 
                    id: 'debug-command-btn', 
                    class: 'btn btn-ghost btn-sm text-error'
                }, '🐛 Debug')
            )
        ),
        h('div', { class: 'navbar-center hidden lg:flex' },
            h('div', { class: 'flex gap-2' },
                h('button', { 
                    class: 'btn btn-ghost btn-sm',
                    onclick: () => showManageLinksModal(),
                    title: 'Manage all shared links'
                }, '🔗 Shared Links')
            )
        ),
        h('div', { class: 'navbar-end gap-2' },
            h('button', { 
                id: 'theme-toggle-btn', 
                class: 'btn btn-circle btn-ghost',
                onclick: toggleTheme,
                title: 'Toggle theme'
            }, () => getTheme() === 'dark' ? '☀️' : '🌙'),
            h('button', { 
                id: 'logout-btn', 
                class: 'btn btn-error btn-sm',
                onclick: handleLogout
            }, '🚪 Logout')
        )
    );
}

/**
 * Toast Container Component - Enhanced with DaisyUI
 */
export function ToastContainer() {
    const toastContainer = h('div', { 
        id: 'toast-container', 
        class: 'toast toast-top toast-end z-50'
    });
    
    setEffect(() => {
        const toasts = getToasts();
        toastContainer.innerHTML = '';
        
        // Se ci sono più di 3 toast, aggiungi un pulsante per cancellare tutto
        if (toasts.length > 3) {
            const clearAllButton = h('div', { 
                class: 'alert alert-warning shadow-lg mb-2' 
            },
                h('div', { class: 'flex items-center justify-between w-full' },
                    h('span', { class: 'text-sm' }, `${toasts.length} notifications`),
                    h('button', { 
                        class: 'btn btn-error btn-xs',
                        onclick: () => {
                            try {
                                // Clear localStorage
                                localStorage.removeItem('app-toasts');
                                // Clear state
                                setToasts([]);
                                // Show confirmation message with short duration
                                setTimeout(() => {
                                    showToast('🧹 All notifications cleared', 'success', 2000);
                                }, 100);
                                console.log('[ToastContainer] All notifications cleared via Clear All button');
                            } catch (error) {
                                console.error('[ToastContainer] Error clearing notifications:', error);
                                showToast('❌ Error clearing notifications', 'error', 2000);
                            }
                        }
                    }, '🗑️ Clear All')
                )
            );
            toastContainer.appendChild(clearAllButton);
        }
        
        toasts.forEach((toast, index) => {
            const alertClass = {
                'success': 'alert-success',
                'error': 'alert-error', 
                'warning': 'alert-warning',
                'info': 'alert-info'
            }[toast.type] || 'alert-info';
            
            const toastEl = h('div', { 
                class: `alert ${alertClass} shadow-lg mb-2`,
                style: `animation: slideInRight 0.3s ease-out ${index * 0.1}s both;`
            },
                h('div', { class: 'flex items-center justify-between w-full' },
                    h('span', { class: 'flex-1 text-sm' }, toast.message),
                    h('button', { 
                        class: 'btn btn-circle btn-ghost btn-xs ml-2',
                        onclick: (e) => {
                            e.stopPropagation();
                            // Animazione di uscita
                            toastEl.style.animation = 'slideOutRight 0.3s ease-out forwards';
                            setTimeout(() => {
                                setToasts(prev => prev.filter(t => t.id !== toast.id));
                            }, 300);
                        }
                    }, '✕')
                )
            );
            
            toastContainer.appendChild(toastEl);
        });
    });
    
    return toastContainer;
}

/**
 * Loading Overlay Component
 */
export function LoadingOverlay() {
    const overlay = h('div', { 
        id: 'loading-overlay', 
        class: 'fixed inset-0 bg-black bg-opacity-50 z-50 hidden items-center justify-center'
    },
        h('div', { class: 'bg-base-100 rounded-lg p-8 shadow-xl flex items-center gap-4' },
            h('span', { class: 'loading loading-spinner loading-lg text-primary' }),
            h('span', { class: 'text-lg font-medium' }, 'Loading...')
        )
    );
    
    setEffect(() => {
        const isLoading = getIsLoading();
        overlay.className = isLoading 
            ? 'fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center' 
            : 'fixed inset-0 bg-black bg-opacity-50 z-50 hidden items-center justify-center';
    });
    
    return overlay;
}

/**
 * Dashboard Header Component
 */
export function DashboardHeader() {
    return h('div', { class: 'flex justify-between items-center mb-6' },
        h('h2', { class: 'text-2xl font-bold text-base-content' }, 'System Overview'),
        h('div', { class: 'flex gap-2' },
            h('button', { 
                id: 'debug-ipfs-endpoints',
                class: 'btn btn-info btn-sm',
                onclick: () => {
                    debugIpfsEndpoints();
                }
            }, '🔍 Debug IPFS'),
            h('button', { 
                id: 'clear-notifications',
                class: 'btn btn-warning btn-sm',
                onclick: () => {
                    localStorage.removeItem('app-toasts');
                    setToasts([]);
                    showToast('🧹 All notifications cleared', 'success', 2000);
                }
            }, '🗑️ Clear Notifications'),
            h('button', { 
                id: 'refresh-all',
                class: 'btn btn-primary btn-sm'
            }, '🔄 Refresh Data')
        )
    );
}

/**
 * Overview Statistics Component - simplified without network stats
 */
export function OverviewStats() {
    const overview = h('div', { class: 'card bg-base-200 shadow-lg mb-6' },
        h('div', { class: 'card-body' },
            h('h3', { class: 'card-title text-lg mb-4' }, '📊 System Overview'),
            h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                h('div', { class: 'space-y-2' },
                    h('div', { class: 'flex justify-between' },
                        h('span', { class: 'text-sm' }, 'Server Status:'),
                        h('strong', { class: 'text-sm', id: 'server-status-detail' }, () => getServerStatus().status)
                    ),
                    h('div', { class: 'flex justify-between' },
                        h('span', { class: 'text-sm' }, 'Files Stored:'),
                        h('strong', { class: 'text-sm', id: 'file-count-detail' }, () => getFileStats().count)
                    )
                ),
                h('div', { class: 'space-y-2' },
                    h('div', { class: 'flex justify-between' },
                        h('span', { class: 'text-sm' }, 'Total Size:'),
                        h('strong', { class: 'text-sm', id: 'total-size-detail' }, () => formatFileSize(getFileStats().totalSize))
                    ),
                    h('div', { class: 'flex justify-between' },
                        h('span', { class: 'text-sm' }, 'System Theme:'),
                        h('strong', { class: 'text-sm' }, () => getTheme())
                    )
                )
            )
        )
    );
    
    return overview;
}

/**
 * Server Info Card Component
 */
export function ServerInfoCard() {
    return h('div', { class: 'card bg-base-200 shadow-xl mb-6' },
        h('div', { class: 'card-body' },
            h('div', { class: 'flex justify-between items-center' },
                h('h3', { class: 'card-title' }, '📡 Server Information'),
                h('button', { 
                    id: 'debug-command-btn', 
                    class: 'btn btn-outline btn-sm'
                }, '🔍 Debug')
            ),
            h('div', { class: 'space-y-2' },
                h('p', { class: 'text-sm' },
                    'Gun server active on ',
                    h('code', { class: 'bg-base-300 px-2 py-1 rounded' }, 
                        h('span', { id: 'origin' }, window.location.origin)
                    )
                ),
                h('p', { class: 'text-sm' },
                    'WebSocket on ',
                    h('code', { class: 'bg-base-300 px-2 py-1 rounded' }, 
                        h('span', { id: 'ws' }, window.location.origin.replace(/^http/, 'ws') + '/gun')
                    )
                )
            ),
            h('div', { 
                id: 'log-container', 
                class: 'mockup-code mt-4 hidden max-h-64 overflow-y-auto'
            })
        )
    );
}

/**
 * Enhanced Tabs Component with DaisyUI styling
 */
export function EnhancedTabs() {
    const tabsContainer = h('div', { 
        class: 'tabs tabs-boxed bg-base-200 p-1 mb-4',
        role: 'tablist' 
    });
    
    let previousBadgeStates = new Map();
    
    const getTabConfig = () => [
        { 
            id: 'files', 
            label: 'Files', 
            icon: '📁',
            getBadge: () => {
                const fileStats = getFileStats();
                return fileStats.count > 0 ? { text: fileStats.count.toString(), type: 'info' } : null;
            },
            ariaLabel: 'View and manage uploaded files'
        },
        { 
            id: 'upload', 
            label: 'Upload', 
            icon: '⬆️',
            getBadge: () => {
                const isLoading = getIsLoading();
                return isLoading ? { text: '...', type: 'warning' } : null;
            },
            ariaLabel: 'Upload new files to the system'
        },
        { 
            id: 'settings', 
            label: 'Settings', 
            icon: '⚙️',
            getBadge: () => {
                const ipfsConnectionStatus = getIpfsConnectionStatus();
                if (ipfsConnectionStatus.status === 'error') {
                    return { text: '!', type: 'error' };
                }
                return null;
            },
            ariaLabel: 'Configure system settings and IPFS'
        }
    ];
    
    setEffect(() => {
        tabsContainer.innerHTML = '';
        const activeTab = getActiveTab();
        const tabs = getTabConfig();
        
        tabs.forEach((tab, index) => {
            const isActive = tab.id === activeTab;
            const badge = tab.getBadge();
            
            const currentBadgeState = badge ? `${badge.text}-${badge.type}` : 'none';
            const previousBadgeState = previousBadgeStates.get(tab.id);
            const badgeChanged = previousBadgeState && previousBadgeState !== currentBadgeState;
            
            previousBadgeStates.set(tab.id, currentBadgeState);
            
            // Create tab element with DaisyUI classes
            const tabEl = document.createElement('button');
            tabEl.className = isActive ? 'tab tab-active flex items-center gap-2' : 'tab flex items-center gap-2';
            tabEl.setAttribute('data-tab', tab.id);
            tabEl.setAttribute('role', 'tab');
            tabEl.setAttribute('aria-selected', isActive.toString());
            tabEl.setAttribute('aria-controls', `${tab.id}-panel`);
            tabEl.setAttribute('aria-label', tab.ariaLabel);
            tabEl.setAttribute('tabindex', isActive ? '0' : '-1');
            tabEl.id = `tab-${tab.id}`;
            
            // Tab content
            const tabContent = h('div', { class: 'flex items-center gap-2' },
                h('span', { class: 'text-lg' }, tab.icon),
                h('span', {}, tab.label)
            );
            
            tabEl.appendChild(tabContent);
            
            // Add badge if present
            if (badge) {
                const badgeClass = {
                    'success': 'badge-success',
                    'error': 'badge-error',
                    'warning': 'badge-warning', 
                    'info': 'badge-info'
                }[badge.type] || 'badge-info';
                
                const badgeEl = h('span', { 
                    class: `badge ${badgeClass} badge-sm ml-1`
                }, badge.text);
                
                if (badgeChanged) {
                    badgeEl.style.animation = 'pulse 0.6s ease-out';
                    
                    if (badge.type === 'error') {
                        setTimeout(() => {
                            showToast(`${tab.label}: Error detected`, 'error', 3000);
                        }, 100);
                    }
                }
                
                tabEl.appendChild(badgeEl);
            }
            
            // Click handler
            tabEl.addEventListener('click', () => {
                setActiveTab(tab.id);
                tabEl.focus();
                
                // Emit tab changed event
                const event = new CustomEvent('tabChanged', { 
                    detail: { tab: tab.id, previousTab: activeTab } 
                });
                document.dispatchEvent(event);
            });
            
            // Keyboard navigation (keeping existing logic)
            tabEl.addEventListener('keydown', (e) => {
                let targetIndex = index;
                
                switch (e.key) {
                    case 'ArrowRight':
                    case 'ArrowDown':
                        e.preventDefault();
                        targetIndex = (index + 1) % tabs.length;
                        break;
                    case 'ArrowLeft':
                    case 'ArrowUp':
                        e.preventDefault();
                        targetIndex = index === 0 ? tabs.length - 1 : index - 1;
                        break;
                    case 'Home':
                        e.preventDefault();
                        targetIndex = 0;
                        break;
                    case 'End':
                        e.preventDefault();
                        targetIndex = tabs.length - 1;
                        break;
                    case 'Enter':
                    case ' ':
                        e.preventDefault();
                        setActiveTab(tab.id);
                        
                        // Emit tab changed event
                        const enterEvent = new CustomEvent('tabChanged', { 
                            detail: { tab: tab.id, previousTab: activeTab } 
                        });
                        document.dispatchEvent(enterEvent);
                        return;
                    default:
                        return;
                }
                
                const targetTab = tabs[targetIndex];
                setActiveTab(targetTab.id);
                
                // Emit tab changed event for arrow navigation
                const arrowEvent = new CustomEvent('tabChanged', { 
                    detail: { tab: targetTab.id, previousTab: activeTab } 
                });
                document.dispatchEvent(arrowEvent);
                
                setTimeout(() => {
                    const targetEl = document.getElementById(`tab-${targetTab.id}`);
                    if (targetEl) {
                        targetEl.focus();
                    }
                }, 50);
            });
            
            tabsContainer.appendChild(tabEl);
        });
    });
    
    return tabsContainer;
}

// Legacy compatibility
export function Tabs() {
    console.warn('Tabs() is deprecated. Use EnhancedTabs() instead.');
    return EnhancedTabs();
}

export { EnhancedTabs as ModernTabs };

/**
 * File Item Component with optional checkbox support
 */
export function FileItem(file, options = {}) {
    if (!file || typeof file !== 'object') {
        console.error('Invalid file object:', file);
        return h('div', { class: 'alert alert-error' }, 'Invalid file data');
    }
    
    const {
        showCheckbox = false,
        checked = false,
        onSelectionChange = null
    } = options;
    
    const safeFile = {
        id: file.id || `file-${Date.now()}`,
        name: file.name || file.originalName || 'Unnamed file',
        originalName: file.originalName || file.name || 'Unnamed file',
        mimetype: file.mimetype || file.mimeType || 'application/octet-stream',
        size: parseInt(file.size || 0, 10),
        fileUrl: file.fileUrl || file.url || '#',
        ipfsHash: file.ipfsHash || null,
        ipfsUrl: file.ipfsUrl || (file.ipfsHash ? `https://ipfs.io/ipfs/${file.ipfsHash}` : null),
        timestamp: parseInt(file.timestamp || file.uploadedAt || Date.now(), 10),
        storageType: file.storageType || (file.ipfsHash ? 'ipfs-independent' : 'local-only'),
    };
    
    const uploadDate = new Date(safeFile.timestamp).toLocaleString();
    
    // Create file card with DaisyUI
    const fileCard = h('div', { 
        class: 'card bg-base-200 shadow-md hover:shadow-lg transition-shadow mb-4',
        id: `file-${safeFile.id}`,
        'data-id': safeFile.id
    });
    
    const cardBody = h('div', { class: 'card-body p-4' });
    
    // File header with checkbox (if enabled), name and storage type badge
    const fileHeaderContent = [];
    
    // Add checkbox if enabled
    if (showCheckbox) {
        const checkbox = h('input', {
            type: 'checkbox',
            id: `file-checkbox-${safeFile.id}`,
            class: 'checkbox checkbox-primary',
            checked: checked,
            onchange: (e) => {
                if (onSelectionChange) {
                    onSelectionChange(safeFile.id, e.target.checked);
                }
            }
        });
        fileHeaderContent.push(h('div', { class: 'flex items-center' }, checkbox));
    }
    
    // Enhanced storage type badge function
    const getStorageBadge = () => {
        switch (safeFile.storageType) {
            case 'ipfs-independent':
                return h('div', { class: 'badge badge-accent gap-1' }, 
                    h('span', {}, '🌐⚡'),
                    h('span', {}, 'Direct IPFS')
                );
            case 'local-with-ipfs':
                return h('div', { class: 'badge badge-secondary gap-1' }, 
                    h('span', {}, '🌐💾'),
                    h('span', {}, 'Local + IPFS')
                );
            case 'local-only':
                return h('div', { class: 'badge badge-outline gap-1' }, 
                    h('span', {}, '💾'),
                    h('span', {}, 'Local')
                );
            default:
                // Fallback for legacy files
                if (safeFile.ipfsHash) {
                    return h('div', { class: 'badge badge-secondary gap-1' }, 
                        h('span', {}, '🌐'),
                        h('span', {}, 'IPFS')
                    );
                } else {
                    return h('div', { class: 'badge badge-outline gap-1' }, 
                        h('span', {}, '💾'),
                        h('span', {}, 'Local')
                    );
                }
        }
    };
    
    // File name and badge container
    const nameAndBadgeContainer = h('div', { class: 'flex justify-between items-start flex-1 ml-2' },
        h('h4', { class: 'card-title text-base font-medium' }, safeFile.originalName),
        getStorageBadge()
    );
    fileHeaderContent.push(nameAndBadgeContainer);
    
    const fileHeader = h('div', { 
        class: showCheckbox ? 'flex items-start mb-2' : 'flex justify-between items-start mb-2'
    }, ...fileHeaderContent);
    
    // Add image preview if it's an image file
    if (safeFile.mimetype && safeFile.mimetype.startsWith('image/')) {
        const previewUrl = safeFile.ipfsUrl || safeFile.fileUrl;
        if (previewUrl && previewUrl !== '#') {
            // Create a container for the image preview
            const imageContainer = h('div', {
                class: 'my-3 flex justify-center'
            });
            
            // For local files (protected), we need to fetch with auth and create a blob URL
            if (!safeFile.ipfsUrl && safeFile.fileUrl) {
                // This is a local file, fetch it with authentication
                const imagePreview = h('div', {
                    class: 'loading loading-spinner loading-md',
                    style: 'max-width: 150px; max-height: 150px;'
                });
                imageContainer.appendChild(imagePreview);
                
                // Fetch the image with authentication and create blob URL
                (async () => {
                    try {
                        const response = await fetch(previewUrl, {
                            headers: {
                                'Authorization': `Bearer ${getAuthToken()}`
                            }
                        });
                        
                        if (response.ok) {
                            const blob = await response.blob();
                            const blobUrl = URL.createObjectURL(blob);
                            
                            const imgElement = h('img', {
                                src: blobUrl,
                                alt: `Preview of ${safeFile.originalName}`,
                                class: 'rounded object-cover',
                                style: 'max-width: 150px; max-height: 150px;',
                                onload: () => {
                                    // Replace loading spinner with actual image
                                    imageContainer.innerHTML = '';
                                    imageContainer.appendChild(imgElement);
                                },
                                onerror: () => {
                                    // Replace loading spinner with error message
                                    imageContainer.innerHTML = '';
                                    const errorMsg = h('div', {
                                        class: 'text-error text-sm'
                                    }, '❌ Preview failed');
                                    imageContainer.appendChild(errorMsg);
                                    console.warn(`Failed to load preview for ${safeFile.originalName}`);
                                }
                            });
                            
                            // Add the image to container so it starts loading
                            // The onload event will handle replacing the loading spinner
                            imageContainer.appendChild(imgElement);
                            
                            // Clean up blob URL after some time to free memory
                            setTimeout(() => {
                                URL.revokeObjectURL(blobUrl);
                            }, 60000); // Clean up after 1 minute
                            
                        } else {
                            throw new Error(`HTTP ${response.status}`);
                        }
                    } catch (error) {
                        // Replace loading spinner with error message
                        imageContainer.innerHTML = '';
                        const errorMsg = h('div', {
                            class: 'text-error text-sm'
                        }, '❌ Preview failed');
                        imageContainer.appendChild(errorMsg);
                        console.warn(`Failed to load preview for ${safeFile.originalName}: ${error.message}`);
                    }
                })();
            } else if (safeFile.ipfsUrl) {
                // For IPFS files, try to fetch with auth first (for gateway), fallback to direct IPFS
                const imagePreview = h('div', {
                    class: 'loading loading-spinner loading-md',
                    style: 'max-width: 150px; max-height: 150px;'
                });
                imageContainer.appendChild(imagePreview);
                
                (async () => {
                    try {
                        // First try with auth token (for local gateway)
                        let imageUrl = safeFile.ipfsUrl;
                        
                        // If using local gateway, add token
                        if (imageUrl.includes('127.0.0.1:8765/gateway/ipfs/')) {
                            imageUrl = `${imageUrl}?token=${getAuthToken()}`;
                        }
                        
                        const imgElement = h('img', {
                            src: imageUrl,
                            alt: `Preview of ${safeFile.originalName}`,
                            class: 'rounded object-cover',
                            style: 'max-width: 150px; max-height: 150px;',
                            onload: () => {
                                // Replace loading spinner with actual image
                                imageContainer.innerHTML = '';
                                imageContainer.appendChild(imgElement);
                            },
                            onerror: () => {
                                console.warn(`Failed to load IPFS preview from gateway, trying public IPFS`);
                                
                                // Fallback to public IPFS gateway
                                const fallbackImg = h('img', {
                                    src: `https://ipfs.io/ipfs/${safeFile.ipfsHash}`,
                                    alt: `Preview of ${safeFile.originalName}`,
                                    class: 'rounded object-cover',
                                    style: 'max-width: 150px; max-height: 150px;',
                                    onload: () => {
                                        imageContainer.innerHTML = '';
                                        imageContainer.appendChild(fallbackImg);
                                    },
                                    onerror: () => {
                                        imageContainer.innerHTML = '';
                                        const errorMsg = h('div', {
                                            class: 'text-error text-sm'
                                        }, '❌ Preview failed');
                                        imageContainer.appendChild(errorMsg);
                                        console.warn(`Failed to load IPFS preview for ${safeFile.originalName}`);
                                    }
                                });
                                imageContainer.appendChild(fallbackImg);
                            }
                        });
                        
                        imageContainer.appendChild(imgElement);
                        
                    } catch (error) {
                        imageContainer.innerHTML = '';
                        const errorMsg = h('div', {
                            class: 'text-error text-sm'
                        }, '❌ Preview failed');
                        imageContainer.appendChild(errorMsg);
                        console.warn(`Failed to load IPFS preview for ${safeFile.originalName}: ${error.message}`);
                    }
                })();
            }
            
            cardBody.appendChild(imageContainer);
        }
    }
    
    // File metadata
    const fileMeta = h('div', { class: 'text-sm text-base-content/70 mb-3' },
        `${formatFileSize(safeFile.size)} • ${safeFile.mimetype}`,
        h('br'),
        `Uploaded: ${uploadDate}`
    );
    
    cardBody.appendChild(fileHeader);
    
    cardBody.appendChild(fileMeta);
    
    // IPFS info if available
    if (safeFile.ipfsHash) {
        // Prepare IPFS gateway URL with auth token if using local gateway
        let gatewayUrl = safeFile.ipfsUrl;
        if (gatewayUrl && gatewayUrl.includes('127.0.0.1:8765/gateway/ipfs/')) {
            gatewayUrl = `${gatewayUrl}?token=${getAuthToken()}`;
        }
        
        const ipfsInfo = h('div', { class: 'bg-base-300 p-3 rounded-lg mb-3 text-xs' },
            h('div', { class: 'font-medium text-secondary mb-1' }, 'IPFS Details:'),
            h('div', { class: 'break-all' }, `Hash: ${safeFile.ipfsHash}`),
            h('a', { 
                href: gatewayUrl || safeFile.ipfsUrl, 
                target: '_blank',
                class: 'link link-secondary text-xs'
            }, 'View on IPFS Gateway →')
        );
        cardBody.appendChild(ipfsInfo);
    }
    
    // Action buttons
    const actionButtons = [];
    
    // Share button (sempre disponibile per tutti i file)
    actionButtons.push(h('button', {
        class: 'btn btn-sm btn-outline btn-info',
        onclick: async () => {
            await showShareModal(safeFile);
        },
        title: 'Create shared link with optional password'
    }, '🔗 Share'));
    
    // Different actions based on storage type
    if (safeFile.storageType === 'ipfs-independent') {
        // For IPFS independent files
        if (safeFile.ipfsHash) {
            // View button with proper gateway URL and token
            let viewUrl = safeFile.ipfsUrl;
            if (viewUrl && viewUrl.includes('127.0.0.1:8765/gateway/ipfs/')) {
                viewUrl = `${viewUrl}?token=${getAuthToken()}`;
            }
            
            actionButtons.push(h('button', {
                class: 'btn btn-sm btn-outline btn-accent',
                onclick: () => window.open(viewUrl || `https://ipfs.io/ipfs/${safeFile.ipfsHash}`, '_blank'),
                title: 'View on IPFS'
            }, '🌐 View'));
            
            // Pin/Unpin functionality for IPFS files
            actionButtons.push(h('button', {
                class: 'btn btn-sm btn-outline btn-warning',
                onclick: async () => {
                    if (confirm(`Unpin "${safeFile.originalName}" from IPFS?\n\nThis will remove it from your IPFS node but it may still be available on other nodes.`)) {
                        setIsLoading(true);
                        try {
                            const result = await unpinFileFromIpfs(safeFile.ipfsHash);
                            if (result) {
                                showToast(`✅ File unpinned from IPFS: ${safeFile.originalName}`, 'success');
                                await loadAllFiles();
                            }
                        } catch (error) {
                            showToast(`❌ Failed to unpin file: ${error.message}`, 'error');
                        } finally {
                            setIsLoading(false);
                        }
                    }
                },
                title: 'Unpin from IPFS node'
            }, '📌 Unpin'));
        }
        
        // Delete button for IPFS independent files
        actionButtons.push(h('button', {
            class: 'btn btn-sm btn-outline btn-error',
            onclick: async () => {
                if (confirm(`Delete "${safeFile.originalName}" from IPFS?\n\nThis will remove it from your IPFS node. The file may still be available on other IPFS nodes.`)) {
                    const result = await deleteIpfsFile(safeFile.ipfsHash, safeFile.originalName);
                    if (result) {
                        // Refresh will be handled by deleteIpfsFile
                    }
                }
            },
            title: 'Delete from IPFS network'
        }, '🗑️ Delete'));
        
    } else {
        // For local files (with or without IPFS backup)
        
        // Download button (always available for local files)
        actionButtons.push(h('button', {
            class: 'btn btn-sm btn-outline btn-primary',
            onclick: () => {
                const url = `/api/files/download/${safeFile.id}?token=${getAuthToken()}`;
                const a = document.createElement('a');
                a.href = url;
                a.download = safeFile.originalName;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            },
            title: 'Download file'
        }, '📥 Download'));
        
        // IPFS actions for local files
        if (safeFile.ipfsHash) {
            // File is already on IPFS - View button with proper token
            let viewUrl = safeFile.ipfsUrl;
            if (viewUrl && viewUrl.includes('127.0.0.1:8765/gateway/ipfs/')) {
                viewUrl = `${viewUrl}?token=${getAuthToken()}`;
            }
            
            actionButtons.push(h('button', {
                class: 'btn btn-sm btn-outline btn-accent',
                onclick: () => window.open(viewUrl || `https://ipfs.io/ipfs/${safeFile.ipfsHash}`, '_blank'),
                title: 'View on IPFS'
            }, '🌐 View'));
            
            actionButtons.push(h('button', {
                class: 'btn btn-sm btn-outline btn-warning',
                onclick: async () => {
                    if (confirm(`Remove "${safeFile.originalName}" from IPFS?\n\nThis will keep the local copy but remove it from IPFS.`)) {
                        setIsLoading(true);
                        try {
                            await unpinFileFromIpfs(safeFile.id);
                            await loadAllFiles();
                        } finally {
                            setIsLoading(false);
                        }
                    }
                },
                title: 'Remove from IPFS (keep local copy)'
            }, '📌 Unpin'));
        } else {
            // File not on IPFS yet
            actionButtons.push(h('button', {
                class: 'btn btn-sm btn-outline btn-secondary',
                onclick: async () => {
                    await uploadFileToIpfs(safeFile);
                },
                title: 'Upload to IPFS network'
            }, '🌐 Pin to IPFS'));
        }
        
        // Delete local file
        actionButtons.push(h('button', {
            class: 'btn btn-sm btn-outline btn-error',
            onclick: async () => {
                if (confirm(`Delete "${safeFile.originalName}" completely?\n\nThis action cannot be undone.`)) {
                    const result = await deleteFile(safeFile.id);
                    if (result) {
                        await loadAllFiles();
                    }
                }
            },
            title: 'Delete file completely'
        }, '🗑️ Delete'));
    }
    
    const actions = h('div', { class: 'card-actions justify-end gap-2 flex-wrap' });
    
    actionButtons.forEach((button) => {
        actions.appendChild(button);
    });
    
    cardBody.appendChild(actions);
    fileCard.appendChild(cardBody);
    
    return fileCard;
}

/**
 * Upload a local file to IPFS
 */
async function uploadFileToIpfs(file) {
    try {
        // Check if IPFS is enabled
        const ipfsStatus = getIpfsStatus();
        if (!ipfsStatus.enabled) {
            showToast('IPFS is not enabled. Please enable IPFS first.', 'warning');
            return false;
        }
        
        if (confirm(`Upload "${file.originalName}" to IPFS?\n\nThis will make the file available on the IPFS network.`)) {
            setIsLoading(true);
            showToast('Uploading file to IPFS...', 'info');
            
            try {
                // First try the main upload-existing endpoint
                const response = await fetch('/api/ipfs/upload-existing', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${getAuthToken()}`
                    },
                    body: JSON.stringify({
                        fileId: file.id,
                        fileName: file.originalName || file.name
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        showToast(`✅ File uploaded to IPFS: ${data.ipfsHash}`, 'success');
                        // Refresh file list to show updated IPFS status
                        setTimeout(() => loadAllFiles(), 1000);
                        return true;
                    } else {
                        throw new Error(data.error || 'Upload failed');
                    }
                } else if (response.status === 404) {
                    // Main endpoint not available, try fallback method
                    console.error('The /api/ipfs/upload-existing endpoint returned 404. This might indicate:');
                    console.error('1. Server needs to be restarted');
                    console.error('2. IPFS routes are not properly mounted');
                    console.error('3. Server configuration issue');
                    
                    showToast('❌ Main upload endpoint unavailable, trying alternative method...', 'warning');
                    
                    // FALLBACK METHOD: Fetch file and re-upload via direct upload endpoint
                    console.log('🔄 Attempting alternative upload method...');
                    showToast('🔄 Attempting alternative upload method...', 'info');
                    
                    // Try to fetch the original file
                    const fileUrl = file.fileUrl || `/uploads/${file.name}`;
                    console.log(`Fetching file from: ${fileUrl}`);
                    
                    const fileResponse = await fetch(fileUrl, {
                        headers: {
                            'Authorization': `Bearer ${getAuthToken()}`
                        }
                    });
                    
                    if (!fileResponse.ok) {
                        throw new Error(`Failed to fetch original file: ${fileResponse.status}`);
                    }
                    
                    // Convert response to blob
                    const fileBlob = await fileResponse.blob();
                    
                    // Create FormData for the alternative upload
                    const formData = new FormData();
                    formData.append('file', fileBlob, file.originalName || file.name);
                    formData.append('customName', file.originalName || file.name);
                    
                    // Upload via direct IPFS upload endpoint
                    const alternativeResponse = await fetch('/api/ipfs/upload', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${getAuthToken()}`
                        },
                        body: formData
                    });
                    
                    if (alternativeResponse.ok) {
                        const alternativeData = await alternativeResponse.json();
                        if (alternativeData.success) {
                            showToast(`✅ File uploaded to IPFS using alternative method: ${alternativeData.ipfsHash}`, 'success');
                            console.log('✅ Alternative upload method succeeded:', alternativeData);
                            
                            // Refresh file list to show updated IPFS status
                            setTimeout(() => loadAllFiles(), 1000);
                            return true;
                        } else {
                            throw new Error(alternativeData.error || 'Alternative upload failed');
                        }
                    } else {
                        throw new Error(`Alternative upload endpoint also failed: ${alternativeResponse.status}`);
                    }
                } else {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
            } catch (error) {
                console.error('Upload to IPFS failed:', error);
                showToast(`❌ Failed to upload file to IPFS: ${error.message}`, 'error');
                return false;
            } finally {
                setIsLoading(false);
            }
        }
    } catch (error) {
        console.error('Error in uploadFileToIpfs:', error);
        showToast(`❌ Error: ${error.message}`, 'error');
        setIsLoading(false);
        return false;
    }
}

/**
 * File search form component with DaisyUI
 */
export function FileSearchForm() {
    const searchForm = h('div', { class: 'card bg-base-200 shadow-md mb-4' },
        h('div', { class: 'card-body p-4' },
            h('h4', { class: 'card-title text-base mb-3' }, '🔍 Search Files'),
            h('div', { class: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4' },
                h('input', {
                    type: 'text',
                    id: 'file-name-search',
                    placeholder: 'File name',
                    class: 'input input-bordered input-sm'
                }),
                h('input', {
                    type: 'text',
                    id: 'file-mimetype-search',
                    placeholder: 'MIME type',
                    class: 'input input-bordered input-sm'
                }),
                h('input', {
                    type: 'number',
                    id: 'file-min-size',
                    placeholder: 'Min size (bytes)',
                    class: 'input input-bordered input-sm'
                }),
                h('input', {
                    type: 'number',
                    id: 'file-max-size',
                    placeholder: 'Max size (bytes)',
                    class: 'input input-bordered input-sm'
                })
            ),
            h('button', {
                id: 'search-files',
                class: 'btn btn-primary btn-sm',
                onclick: handleSearch
            }, '🔎 Search Files')
        )
    );
    
    function handleSearch() {
        const nameFilter = document.getElementById('file-name-search')?.value || '';
        const mimetypeFilter = document.getElementById('file-mimetype-search')?.value || '';
        const minSizeFilter = document.getElementById('file-min-size')?.value || '';
        const maxSizeFilter = document.getElementById('file-max-size')?.value || '';
        
        const searchParams = {};
        if (nameFilter) searchParams.name = nameFilter;
        if (mimetypeFilter) searchParams.mimetype = mimetypeFilter;
        if (minSizeFilter) searchParams.minSize = minSizeFilter;
        if (maxSizeFilter) searchParams.maxSize = maxSizeFilter;
        
        let searchMsg = 'Searching for files';
        if (Object.keys(searchParams).length > 0) {
            searchMsg += ' matching: ' + Object.entries(searchParams)
                .map(([key, value]) => `${key}="${value}"`)
                .join(', ');
        }
        showToast(searchMsg, 'info');
        
        loadFiles(searchParams);
    }
    
    return searchForm;
}

/**
 * Empty state component
 */
export function EmptyState(message = 'No files found') {
    return h('div', { class: 'flex flex-col items-center justify-center py-12 text-center' },
        h('div', { class: 'text-6xl mb-4' }, '📁'),
        h('div', { class: 'text-xl font-medium text-base-content/70' }, message)
    );
}

/**
 * Loading state component
 */
export function LoadingState(message = 'Loading...') {
    return h('div', { class: 'flex items-center justify-center py-12' },
        h('span', { class: 'loading loading-spinner loading-lg text-primary mr-4' }),
        h('span', { class: 'text-lg' }, message)
    );
}

/**
 * Debug function to test IPFS endpoints
 */
async function debugIpfsEndpoints() {
    const endpoints = [
        { name: 'IPFS Status', url: '/api/ipfs/status', method: 'GET' },
        { name: 'IPFS Health Check', url: '/api/ipfs/health-check', method: 'GET' },
        { name: 'IPFS Upload Existing', url: '/api/ipfs/upload-existing', method: 'POST' },
        { name: 'IPFS Upload Direct', url: '/api/ipfs/upload', method: 'POST' },
        { name: 'IPFS Metadata', url: '/api/ipfs/metadata', method: 'GET' }
    ];
    
    console.log('🔍 Testing IPFS endpoints...');
    showToast('🔍 Testing IPFS endpoints...', 'info', 3000);
    
    for (const endpoint of endpoints) {
        try {
            const options = {
                method: endpoint.method,
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`,
                    'Content-Type': 'application/json'
                }
            };
            
            // Add test body for POST requests
            if (endpoint.method === 'POST') {
                if (endpoint.url.includes('upload-existing')) {
                    options.body = JSON.stringify({ fileId: 'test-id', fileName: 'test.txt' });
                } else if (endpoint.url.includes('/upload')) {
                    // Skip direct upload test as it needs multipart data
                    console.log(`⏭️ Skipping ${endpoint.name} - requires multipart form data`);
                    continue;
                }
            }
            
            const response = await fetch(endpoint.url, options);
            const statusText = response.ok ? '✅' : '❌';
            
            console.log(`${statusText} ${endpoint.name}: ${response.status} ${response.statusText}`);
            
            if (!response.ok && endpoint.url.includes('upload-existing')) {
                console.error(`❌ ${endpoint.name} failed - this is the problematic endpoint!`);
                showToast(`❌ Upload to IPFS endpoint not working (${response.status})`, 'error', 5000);
            }
            
        } catch (error) {
            console.error(`❌ ${endpoint.name}: ${error.message}`);
        }
    }
    
    console.log('🔍 IPFS endpoint testing complete');
    showToast('🔍 Check console for detailed results', 'info', 3000);
}

// ==================== SHARED LINKS SYSTEM ====================

/**
 * Show modal to create shared link
 */
async function showShareModal(file) {
    try {
        console.log(`[ShareModal] Opening share modal for file: ${file.originalName}`);
        
        // Remove existing modal if present
        const existingModal = document.getElementById('share-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create modal
        const modal = h('div', {
            id: 'share-modal',
            class: 'modal modal-open'
        });
        
        const modalBox = h('div', { class: 'modal-box w-11/12 max-w-2xl' });
        
        // Modal header
        const modalHeader = h('div', { class: 'flex justify-between items-center mb-4' },
            h('h3', { class: 'font-bold text-lg' }, `🔗 Share "${file.originalName}"`),
            h('button', {
                class: 'btn btn-sm btn-circle btn-ghost',
                onclick: () => closeShareModal()
            }, '✕')
        );
        
        // Form
        const form = h('form', { id: 'share-form', class: 'space-y-4' });
        
        // Password field
        const passwordGroup = h('div', { class: 'form-control' },
            h('label', { class: 'label' },
                h('span', { class: 'label-text' }, 'Password (optional)')
            ),
            h('input', {
                type: 'password',
                id: 'share-password',
                class: 'input input-bordered',
                placeholder: 'Leave empty for no password protection'
            }),
            h('label', { class: 'label' },
                h('span', { class: 'label-text-alt' }, 'If set, users will need this password to download the file')
            )
        );
        
        // Expiration
        const expirationGroup = h('div', { class: 'form-control' },
            h('label', { class: 'label' },
                h('span', { class: 'label-text' }, 'Expires in')
            ),
            h('select', {
                id: 'share-expiration',
                class: 'select select-bordered'
            },
                h('option', { value: '3600' }, '1 hour'),
                h('option', { value: '21600' }, '6 hours'),
                h('option', { value: '86400', selected: true }, '24 hours'),
                h('option', { value: '604800' }, '7 days'),
                h('option', { value: '2592000' }, '30 days'),
                h('option', { value: '0' }, 'Never expires')
            )
        );
        
        // Max downloads
        const downloadsGroup = h('div', { class: 'form-control' },
            h('label', { class: 'label' },
                h('span', { class: 'label-text' }, 'Max downloads')
            ),
            h('select', {
                id: 'share-max-downloads',
                class: 'select select-bordered'
            },
                h('option', { value: '1' }, '1 download'),
                h('option', { value: '5' }, '5 downloads'),
                h('option', { value: '10', selected: true }, '10 downloads'),
                h('option', { value: '25' }, '25 downloads'),
                h('option', { value: '100' }, '100 downloads'),
                h('option', { value: '999999' }, 'Unlimited')
            )
        );
        
        // Description
        const descriptionGroup = h('div', { class: 'form-control' },
            h('label', { class: 'label' },
                h('span', { class: 'label-text' }, 'Description (optional)')
            ),
            h('textarea', {
                id: 'share-description',
                class: 'textarea textarea-bordered',
                placeholder: 'Add a note about this shared file...',
                rows: 2
            })
        );
        
        // Buttons
        const buttonGroup = h('div', { class: 'modal-action' },
            h('button', {
                type: 'button',
                class: 'btn btn-ghost',
                onclick: () => closeShareModal()
            }, 'Cancel'),
            h('button', {
                type: 'submit',
                class: 'btn btn-primary',
                onclick: async (e) => {
                    e.preventDefault();
                    await createShareLink(file);
                }
            }, '🔗 Create Share Link')
        );
        
        // Assemble form
        form.appendChild(passwordGroup);
        form.appendChild(expirationGroup);
        form.appendChild(downloadsGroup);
        form.appendChild(descriptionGroup);
        form.appendChild(buttonGroup);
        
        // Assemble modal
        modalBox.appendChild(modalHeader);
        modalBox.appendChild(form);
        modal.appendChild(modalBox);
        modal.appendChild(h('div', {
            class: 'modal-backdrop',
            onclick: () => closeShareModal()
        }));
        
        // Add to DOM
        document.body.appendChild(modal);
        
        // Focus on password field
        setTimeout(() => {
            const passwordInput = document.getElementById('share-password');
            if (passwordInput) passwordInput.focus();
        }, 100);
        
    } catch (error) {
        console.error('[ShareModal] Error showing share modal:', error);
        showToast(`❌ Error opening share modal: ${error.message}`, 'error');
    }
}

/**
 * Close share modal
 */
function closeShareModal() {
    const modal = document.getElementById('share-modal');
    if (modal) {
        modal.remove();
    }
}

/**
 * Create shared link
 */
async function createShareLink(file) {
    try {
        const password = document.getElementById('share-password')?.value || '';
        const expiresIn = parseInt(document.getElementById('share-expiration')?.value || '86400');
        const maxDownloads = parseInt(document.getElementById('share-max-downloads')?.value || '10');
        const description = document.getElementById('share-description')?.value || '';
        
        setIsLoading(true);
        showToast('🔗 Creating shared link...', 'info');
        
        const requestData = {
            fileId: file.id,
            expiresIn: expiresIn,
            maxDownloads: maxDownloads
        };
        
        // Add optional fields
        if (password.trim()) {
            requestData.password = password.trim();
        }
        if (description.trim()) {
            requestData.description = description.trim();
        }
        
        console.log('[ShareLink] Creating share link with data:', {
            ...requestData,
            password: requestData.password ? '[HIDDEN]' : 'none'
        });
        
        const response = await fetch('/api/files/create-share-link', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${getAuthToken()}`
            },
            body: JSON.stringify(requestData)
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            console.log('[ShareLink] Share link created successfully:', data.shareData);
            
            // Close modal
            closeShareModal();
            
            // Show success modal with link
            showShareLinkModal(data.shareData);
            
            showToast(`✅ Shared link created for "${file.originalName}"`, 'success');
        } else {
            throw new Error(data.error || 'Failed to create shared link');
        }
        
    } catch (error) {
        console.error('[ShareLink] Error creating shared link:', error);
        showToast(`❌ Failed to create shared link: ${error.message}`, 'error');
    } finally {
        setIsLoading(false);
    }
}

/**
 * Show modal with created share link
 */
function showShareLinkModal(shareData) {
    try {
        // Remove existing modal if present
        const existingModal = document.getElementById('share-link-result-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create modal
        const modal = h('div', {
            id: 'share-link-result-modal',
            class: 'modal modal-open'
        });
        
        const modalBox = h('div', { class: 'modal-box w-11/12 max-w-3xl' });
        
        // Modal header
        const modalHeader = h('div', { class: 'flex justify-between items-center mb-4' },
            h('h3', { class: 'font-bold text-lg' }, `✅ Share Link Created`),
            h('button', {
                class: 'btn btn-sm btn-circle btn-ghost',
                onclick: () => closeShareLinkModal()
            }, '✕')
        );
        
        // File info
        const fileInfo = h('div', { class: 'bg-base-200 p-4 rounded-lg mb-4' },
            h('div', { class: 'font-medium' }, `📁 ${shareData.fileName}`),
            h('div', { class: 'text-sm text-base-content/70 mt-1' },
                `🔐 ${shareData.hasPassword ? 'Password protected' : 'No password'} • `,
                `📊 Max ${shareData.maxDownloads} downloads • `,
                `⏰ ${shareData.expiresAt ? `Expires ${new Date(shareData.expiresAt).toLocaleString()}` : 'Never expires'}`
            ),
            shareData.description ? h('div', { class: 'text-sm mt-2 italic' }, `"${shareData.description}"`) : null
        );
        
        // Share URL
        const urlGroup = h('div', { class: 'form-control mb-4' },
            h('label', { class: 'label' },
                h('span', { class: 'label-text font-medium' }, 'Share URL')
            ),
            h('div', { class: 'flex gap-2' },
                h('input', {
                    type: 'text',
                    id: 'share-url-input',
                    class: 'input input-bordered flex-1',
                    value: shareData.shareUrl,
                    readonly: true
                }),
                h('button', {
                    class: 'btn btn-primary',
                    onclick: () => copyShareUrl(shareData.shareUrl)
                }, '📋 Copy')
            )
        );
        
        // Instructions
        const instructions = h('div', { class: 'bg-info/10 p-4 rounded-lg mb-4' },
            h('div', { class: 'font-medium mb-2' }, '📋 How to use:'),
            h('ul', { class: 'text-sm space-y-1' },
                h('li', {}, '• Share the URL above with anyone you want to give access'),
                shareData.hasPassword ? 
                    h('li', {}, '• Recipients will need the password you set to download the file') :
                    h('li', {}, '• Anyone with the link can download the file (no password required)'),
                h('li', {}, `• The link ${shareData.expiresAt ? `expires on ${new Date(shareData.expiresAt).toLocaleString()}` : 'never expires'}`),
                h('li', {}, `• Maximum ${shareData.maxDownloads} downloads allowed`)
            )
        );
        
        // Action buttons
        const buttonGroup = h('div', { class: 'flex gap-2 justify-end' },
            h('button', {
                class: 'btn btn-ghost',
                onclick: () => closeShareLinkModal()
            }, 'Close'),
            h('button', {
                class: 'btn btn-secondary',
                onclick: () => showManageLinksModal()
            }, '🔗 Manage All Links'),
            h('button', {
                class: 'btn btn-primary',
                onclick: () => copyShareUrl(shareData.shareUrl)
            }, '📋 Copy Link')
        );
        
        // Assemble modal
        modalBox.appendChild(modalHeader);
        modalBox.appendChild(fileInfo);
        modalBox.appendChild(urlGroup);
        modalBox.appendChild(instructions);
        modalBox.appendChild(buttonGroup);
        modal.appendChild(modalBox);
        modal.appendChild(h('div', {
            class: 'modal-backdrop',
            onclick: () => closeShareLinkModal()
        }));
        
        // Add to DOM
        document.body.appendChild(modal);
        
        // Select URL for easy copying
        setTimeout(() => {
            const urlInput = document.getElementById('share-url-input');
            if (urlInput) {
                urlInput.select();
            }
        }, 100);
        
    } catch (error) {
        console.error('[ShareLinkModal] Error showing share link modal:', error);
        showToast(`❌ Error showing results: ${error.message}`, 'error');
    }
}

/**
 * Close share link result modal
 */
function closeShareLinkModal() {
    const modal = document.getElementById('share-link-result-modal');
    if (modal) {
        modal.remove();
    }
}

/**
 * Copy share URL to clipboard
 */
async function copyShareUrl(url) {
    try {
        await navigator.clipboard.writeText(url);
        showToast('📋 Share link copied to clipboard!', 'success', 2000);
    } catch (error) {
        console.error('[ShareLink] Error copying to clipboard:', error);
        
        // Fallback: select the input
        const input = document.getElementById('share-url-input');
        if (input) {
            input.select();
            try {
                document.execCommand('copy');
                showToast('📋 Share link copied to clipboard!', 'success', 2000);
            } catch (fallbackError) {
                showToast('❌ Failed to copy link. Please select and copy manually.', 'error');
            }
        } else {
            showToast('❌ Failed to copy link to clipboard', 'error');
        }
    }
}

/**
 * Show modal to manage all shared links
 */
async function showManageLinksModal() {
    try {
        setIsLoading(true);
        
        // Fetch user's shared links
        const response = await fetch('/api/files/shared-links', {
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        if (!response.ok) {
            throw new Error(`Failed to fetch shared links: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            throw new Error(data.error || 'Failed to fetch shared links');
        }
        
        // Close any existing modals
        closeShareLinkModal();
        
        // Remove existing manage modal if present
        const existingModal = document.getElementById('manage-links-modal');
        if (existingModal) {
            existingModal.remove();
        }
        
        // Create modal
        const modal = h('div', {
            id: 'manage-links-modal',
            class: 'modal modal-open'
        });
        
        const modalBox = h('div', { class: 'modal-box w-11/12 max-w-4xl max-h-[80vh] overflow-y-auto' });
        
        // Modal header
        const modalHeader = h('div', { class: 'flex justify-between items-center mb-4' },
            h('h3', { class: 'font-bold text-lg' }, `🔗 Manage Shared Links (${data.count})`),
            h('button', {
                class: 'btn btn-sm btn-circle btn-ghost',
                onclick: () => closeManageLinksModal()
            }, '✕')
        );
        
        // Links list
        const linksList = h('div', { class: 'space-y-3' });
        
        if (data.sharedLinks.length === 0) {
            linksList.appendChild(h('div', { class: 'text-center py-8' },
                h('div', { class: 'text-4xl mb-2' }, '🔗'),
                h('div', { class: 'text-lg' }, 'No shared links yet'),
                h('div', { class: 'text-sm text-base-content/70' }, 'Create shared links from the file list')
            ));
        } else {
            data.sharedLinks.forEach(link => {
                const linkCard = createSharedLinkCard(link);
                linksList.appendChild(linkCard);
            });
        }
        
        // Buttons
        const buttonGroup = h('div', { class: 'modal-action' },
            h('button', {
                class: 'btn btn-ghost',
                onclick: () => closeManageLinksModal()
            }, 'Close'),
            h('button', {
                class: 'btn btn-primary',
                onclick: async () => {
                    closeManageLinksModal();
                    // Refresh the links by calling this function again
                    setTimeout(() => showManageLinksModal(), 100);
                }
            }, '🔄 Refresh')
        );
        
        // Assemble modal
        modalBox.appendChild(modalHeader);
        modalBox.appendChild(linksList);
        modalBox.appendChild(buttonGroup);
        modal.appendChild(modalBox);
        modal.appendChild(h('div', {
            class: 'modal-backdrop',
            onclick: () => closeManageLinksModal()
        }));
        
        // Add to DOM
        document.body.appendChild(modal);
        
    } catch (error) {
        console.error('[ManageLinks] Error showing manage links modal:', error);
        showToast(`❌ Failed to load shared links: ${error.message}`, 'error');
    } finally {
        setIsLoading(false);
    }
}

/**
 * Close manage links modal
 */
function closeManageLinksModal() {
    const modal = document.getElementById('manage-links-modal');
    if (modal) {
        modal.remove();
    }
}

/**
 * Create shared link card for manage modal
 */
function createSharedLinkCard(link) {
    const isExpired = link.expiresAt && link.expiresAt < Date.now();
    const isExhausted = link.downloadCount >= link.maxDownloads;
    const isActive = !isExpired && !isExhausted;
    
    const statusBadge = isExpired ? 
        h('div', { class: 'badge badge-error' }, '⏰ Expired') :
        isExhausted ?
        h('div', { class: 'badge badge-warning' }, '📊 Exhausted') :
        h('div', { class: 'badge badge-success' }, '✅ Active');
    
    const card = h('div', { 
        class: `card bg-base-200 shadow compact ${!isActive ? 'opacity-60' : ''}`
    },
        h('div', { class: 'card-body' },
            h('div', { class: 'flex justify-between items-start mb-2' },
                h('div', { class: 'font-medium' }, `📁 ${link.fileName}`),
                statusBadge
            ),
            h('div', { class: 'text-xs text-base-content/70 mb-2 space-y-1' },
                h('div', {}, 
                    `🔐 ${link.hasPassword ? 'Password protected' : 'No password'} • `,
                    `📊 ${link.downloadCount}/${link.maxDownloads} downloads • `,
                    `⏰ ${link.expiresAt ? `Expires ${new Date(link.expiresAt).toLocaleString()}` : 'Never expires'}`
                ),
                h('div', {}, `📅 Created: ${new Date(link.createdAt).toLocaleString()}`),
                link.description ? h('div', { class: 'italic' }, `"${link.description}"`) : null
            ),
            h('div', { class: 'flex gap-2 justify-end' },
                isActive ? h('button', {
                    class: 'btn btn-xs btn-primary',
                    onclick: () => copyShareUrl(link.shareUrl)
                }, '📋 Copy') : null,
                isActive ? h('button', {
                    class: 'btn btn-xs btn-info',
                    onclick: () => window.open(link.shareUrl, '_blank')
                }, '🔗 Open') : null,
                h('button', {
                    class: 'btn btn-xs btn-error',
                    onclick: () => revokeSharedLink(link.token, link.fileName)
                }, '🗑️ Revoke')
            )
        )
    );
    
    return card;
}

/**
 * Revoke shared link
 */
async function revokeSharedLink(token, fileName) {
    try {
        if (!confirm(`Revoke shared link for "${fileName}"?\n\nThis action cannot be undone and the link will stop working immediately.`)) {
            return;
        }
        
        setIsLoading(true);
        showToast('🗑️ Revoking shared link...', 'info');
        
        const response = await fetch(`/api/files/share/${token}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${getAuthToken()}`
            }
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`✅ Shared link revoked for "${fileName}"`, 'success');
            
            // Refresh the manage modal if it's open
            const manageModal = document.getElementById('manage-links-modal');
            if (manageModal) {
                setTimeout(() => showManageLinksModal(), 500);
            }
        } else {
            throw new Error(data.error || 'Failed to revoke shared link');
        }
        
    } catch (error) {
        console.error('[RevokeLink] Error revoking shared link:', error);
        showToast(`❌ Failed to revoke shared link: ${error.message}`, 'error');
    } finally {
        setIsLoading(false);
    }
}
