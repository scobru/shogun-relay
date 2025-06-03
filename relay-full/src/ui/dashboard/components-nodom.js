import { h, setEffect, setSignal } from './nodom.js';
import {
    getIsLoading,
    setIsLoading,
    getToasts,
    setToasts,
    getActiveTab,
    setActiveTab,
    getServerStatus,
    getNetworkStatus,
    getFileStats,
    formatFileSize,
    handleLogout,
    showToast,
    deleteFile,
    loadFiles,
    toggleTheme,
    getTheme,
    getFiles,
    setFiles,
    getIpfsStatus,
    getIpfsConnectionStatus,
    testPeerConnection,
    reconnectToPeer,
    removePeer,
    pinFileToIpfs,
    unpinFileFromIpfs,
    checkIpfsPinStatus,
    getAuthToken
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
                            localStorage.removeItem('app-toasts');
                            setToasts([]);
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
 * Stats Grid Component
 */
export function StatsGrid() {
    const grid = h('div', { class: 'grid grid-cols-1 md:grid-cols-3 gap-4 mb-6' },
        // Server Status Card
        h('div', { class: 'stat bg-base-200 rounded-lg shadow' },
            h('div', { class: 'stat-figure text-secondary' },
                h('div', { class: 'text-2xl' }, '🖥️')
            ),
            h('div', { class: 'stat-title' }, 'Server Status'),
            h('div', { 
                class: 'stat-value text-sm',
                id: 'server-status' 
            }, () => getServerStatus().status),
            h('div', { class: 'stat-desc' },
                'Port: ',
                h('span', { id: 'server-port' }, () => getServerStatus().port)
            )
        ),
        
        // GunDB Connections Card
        h('div', { class: 'stat bg-base-200 rounded-lg shadow' },
            h('div', { class: 'stat-figure text-secondary' },
                h('div', { class: 'text-2xl' }, '🔗')
            ),
            h('div', { class: 'stat-title' }, 'GunDB Connections'),
            h('div', { 
                class: 'stat-value text-primary',
                id: 'peer-count' 
            }, () => getNetworkStatus().peerCount),
            h('div', { class: 'stat-desc' },
                'Status: ',
                h('span', { id: 'network-status' }, () => getNetworkStatus().status)
            )
        ),
        
        // Files Stats Card
        h('div', { class: 'stat bg-base-200 rounded-lg shadow' },
            h('div', { class: 'stat-figure text-secondary' },
                h('div', { class: 'text-2xl' }, '📁')
            ),
            h('div', { class: 'stat-title' }, 'Files Uploaded'),
            h('div', { 
                class: 'stat-value text-accent',
                id: 'file-count' 
            }, () => getFileStats().count),
            h('div', { class: 'stat-desc' },
                'Total: ',
                h('span', { id: 'total-size' }, () => formatFileSize(getFileStats().totalSize))
            )
        )
    );
    
    return grid;
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
            h('div', { id: 'network-info', class: 'flex gap-4 mt-4' },
                h('div', { class: 'badge badge-primary badge-lg' },
                    'Peers: ',
                    h('strong', { id: 'peer-count-detail' }, () => getNetworkStatus().peerCount)
                ),
                h('div', { class: 'badge badge-secondary badge-lg' },
                    'Status: ',
                    h('strong', { id: 'network-status-detail' }, () => getNetworkStatus().status)
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
                const fileCount = getFileStats().count;
                return fileCount > 0 ? { text: fileCount.toString(), type: 'info' } : null;
            },
            ariaLabel: 'View and manage uploaded files'
        },
        { 
            id: 'upload', 
            label: 'Upload', 
            icon: '⬆️',
            getBadge: () => {
                const isLoading = getIsLoading();
                const ipfsStatus = getIpfsStatus();
                if (isLoading) {
                    return { text: '●', type: 'warning' };
                }
                return ipfsStatus.enabled ? { text: 'IPFS', type: 'success' } : null;
            },
            ariaLabel: 'Upload new files to the system'
        },
        { 
            id: 'network', 
            label: 'Network', 
            icon: '🌐',
            getBadge: () => {
                const networkStatus = getNetworkStatus();
                const peerCount = networkStatus.peerCount;
                if (peerCount > 1) {
                    return { text: peerCount.toString(), type: 'success' };
                } else if (peerCount === 1) {
                    return { text: 'LOCAL', type: 'warning' };
                } else {
                    return { text: '!', type: 'error' };
                }
            },
            ariaLabel: 'Manage network connections and peers'
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
                        return;
                    default:
                        return;
                }
                
                const targetTab = tabs[targetIndex];
                setActiveTab(targetTab.id);
                
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
    
    // File name and badge container
    const nameAndBadgeContainer = h('div', { class: 'flex justify-between items-start flex-1 ml-2' },
        h('h4', { class: 'card-title text-base font-medium' }, safeFile.originalName),
        safeFile.ipfsHash 
            ? h('div', { class: 'badge badge-secondary' }, '🌐 IPFS')
            : h('div', { class: 'badge badge-outline' }, '💾 Local')
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
            } else {
                // For IPFS files, we can use the URL directly since they're public
                const imagePreview = h('img', {
                    src: previewUrl,
                    alt: `Preview of ${safeFile.originalName}`,
                    class: 'rounded object-cover',
                    style: 'max-width: 150px; max-height: 150px;',
                    onerror: (e) => { 
                        e.target.style.display = 'none';
                        const errorMsg = h('div', {
                            class: 'text-error text-sm'
                        }, '❌ Preview failed');
                        imageContainer.appendChild(errorMsg);
                        console.warn(`Failed to load IPFS preview for ${safeFile.originalName} from ${previewUrl}`);
                    }
                });
                imageContainer.appendChild(imagePreview);
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
        const ipfsInfo = h('div', { class: 'bg-base-300 p-3 rounded-lg mb-3 text-xs' },
            h('div', { class: 'font-medium text-secondary mb-1' }, 'IPFS Details:'),
            h('div', { class: 'break-all' }, `Hash: ${safeFile.ipfsHash}`),
            h('a', { 
                href: safeFile.ipfsUrl, 
                target: '_blank',
                class: 'link link-secondary text-xs'
            }, 'View on IPFS Gateway →')
        );
        cardBody.appendChild(ipfsInfo);
    }
    
    // Action buttons
    const actions = h('div', { class: 'card-actions justify-end gap-2 flex-wrap' });
    
    // View file button
    const viewUrl = safeFile.ipfsHash ? safeFile.ipfsUrl : safeFile.fileUrl;
    if (viewUrl && viewUrl !== '#') {
        const viewButton = h('button', { 
            class: 'btn btn-primary btn-sm',
            onclick: async () => {
                // For IPFS files, open directly
                if (safeFile.ipfsHash) {
                    window.open(viewUrl, '_blank');
                } else {
                    // For local files, fetch with auth and create blob URL
                    try {
                        showToast('Loading file...', 'info', 2000);
                        const response = await fetch(viewUrl, {
                            headers: {
                                'Authorization': `Bearer ${getAuthToken()}`
                            }
                        });
                        
                        if (response.ok) {
                            const blob = await response.blob();
                            const blobUrl = URL.createObjectURL(blob);
                            
                            // Open in new tab
                            const newWindow = window.open(blobUrl, '_blank');
                            
                            // Clean up blob URL after some time
                            setTimeout(() => {
                                URL.revokeObjectURL(blobUrl);
                            }, 60000); // Clean up after 1 minute
                            
                            if (!newWindow) {
                                showToast('Popup blocked. Please allow popups for this site.', 'warning');
                            }
                        } else {
                            throw new Error(`HTTP ${response.status}`);
                        }
                    } catch (error) {
                        console.error('Error opening file:', error);
                        showToast(`Error opening file: ${error.message}`, 'error');
                    }
                }
            }
        }, '👁️ View');
        actions.appendChild(viewButton);
    }
    
    // Upload to IPFS button (for local files only)
    if (!safeFile.ipfsHash) {
        const uploadToIpfsButton = h('button', { 
            class: 'btn btn-secondary btn-sm',
            onclick: async () => {
                await uploadFileToIpfs(safeFile);
            }
        }, '🌐 Upload to IPFS');
        actions.appendChild(uploadToIpfsButton);
    }
    
    // Copy IPFS hash button (for IPFS files only)
    if (safeFile.ipfsHash) {
        const copyButton = h('button', { 
            class: 'btn btn-secondary btn-sm',
            onclick: async () => {
                try {
                    await navigator.clipboard.writeText(safeFile.ipfsHash);
                    showToast('IPFS hash copied to clipboard', 'success');
                } catch (error) {
                    showToast(`Error copying: ${error.message}`, 'error');
                }
            }
        }, '📋 Copy Hash');
        actions.appendChild(copyButton);

        // Pin/Unpin buttons for IPFS files
        const pinButtonContainer = h('div', { class: 'flex gap-1' });
        
        // Check pin status and create appropriate button
        const createPinButton = async () => {
            try {
                const isPinned = await checkIpfsPinStatus(safeFile.ipfsHash);
                
                if (isPinned) {
                    // Unpin button
                    const unpinButton = h('button', { 
                        class: 'btn btn-warning btn-sm',
                        onclick: async () => {
                            const success = await unpinFileFromIpfs(safeFile.id, safeFile.ipfsHash);
                            if (success) {
                                // Recreate the pin button after successful unpin
                                pinButtonContainer.innerHTML = '';
                                const newPinButton = await createPinButton();
                                pinButtonContainer.appendChild(newPinButton);
                            }
                        }
                    }, '📌 Unpin');
                    return unpinButton;
                } else {
                    // Pin button
                    const pinButton = h('button', { 
                        class: 'btn btn-success btn-sm',
                        onclick: async () => {
                            const success = await pinFileToIpfs(safeFile.id, safeFile.ipfsHash);
                            if (success) {
                                // Recreate the pin button after successful pin
                                pinButtonContainer.innerHTML = '';
                                const newUnpinButton = await createPinButton();
                                pinButtonContainer.appendChild(newUnpinButton);
                            }
                        }
                    }, '📍 Pin');
                    return pinButton;
                }
            } catch (error) {
                console.error('Error checking pin status:', error);
                // Return a disabled button with error state
                return h('button', { 
                    class: 'btn btn-disabled btn-sm',
                    title: 'Error checking pin status'
                }, '❌ Pin Error');
            }
        };
        
        // Initialize pin button
        (async () => {
            try {
                const pinButton = await createPinButton();
                pinButtonContainer.appendChild(pinButton);
            } catch (error) {
                console.error('Error initializing pin button:', error);
                // Add fallback disabled button
                const fallbackButton = h('button', { 
                    class: 'btn btn-disabled btn-sm',
                    title: 'Failed to load pin status'
                }, '❓ Pin Status');
                pinButtonContainer.appendChild(fallbackButton);
            }
        })();
        
        actions.appendChild(pinButtonContainer);
    }
    
    // Delete button (only show if not in batch mode to avoid confusion)
    if (!showCheckbox) {
        const deleteButton = h('button', { 
            class: 'btn btn-error btn-sm',
            onclick: async () => {
                if (confirm(`Are you sure you want to delete "${safeFile.originalName}"?`)) {
                    try {
                        await deleteFile(safeFile.id);
                        document.getElementById(`file-${safeFile.id}`)?.remove();
                    } catch (error) {
                        showToast(`Error deleting file: ${error.message}`, 'error');
                    }
                }
            }
        }, '🗑️ Delete');
        actions.appendChild(deleteButton);
    }
    
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
            
            // Make API call to upload file to IPFS
            const response = await fetch('/api/ipfs/upload-existing', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${getAuthToken()}`
                },
                body: JSON.stringify({
                    fileId: file.id,
                    fileName: file.originalName
                })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                showToast(`File uploaded to IPFS successfully!`, 'success');
                
                // Refresh the files list to show updated IPFS info
                // Use a throttled approach to prevent multiple rapid refreshes
                try {
                    // Clear localStorage cache
                    localStorage.setItem('files-data', JSON.stringify([]));
                    setFiles([]);
                    
                    // Wait a moment before refreshing to allow server to process
                    setTimeout(() => {
                        loadFiles();
                    }, 1000);
                } catch (refreshError) {
                    console.error("Error refreshing files after IPFS upload:", refreshError);
                }
                
                return true;
            } else {
                throw new Error(data.error || 'Unknown error');
            }
        }
    } catch (error) {
        console.error('Error uploading file to IPFS:', error);
        showToast(`Failed to upload to IPFS: ${error.message}`, 'error');
        return false;
    } finally {
        setIsLoading(false);
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
 * Peer item component with DaisyUI styling
 */
export function PeerItem(peer) {
    if (!peer || typeof peer !== 'object') {
        console.error('Invalid peer object:', peer);
        return h('div', { class: 'alert alert-error' }, 'Invalid peer data');
    }
    
    const safePeer = {
        url: peer.url || peer.peer || 'Unknown URL',
        connected: peer.connected || false,
        status: peer.status || 'unknown',
        latency: peer.latency || null,
        lastSeen: peer.lastSeen || null
    };
    
    // Create peer card
    const peerCard = h('div', { 
        class: `card bg-base-200 shadow-md mb-4 ${safePeer.connected ? 'border-l-4 border-success' : 'border-l-4 border-error'}`,
        id: `peer-${btoa(safePeer.url)}`,
        'data-url': safePeer.url
    });
    
    const cardBody = h('div', { class: 'card-body p-4' });
    
    // Peer header
    const peerHeader = h('div', { class: 'flex justify-between items-start mb-2' },
        h('h4', { class: 'card-title text-base font-medium break-all' }, safePeer.url),
        h('div', { 
            class: `badge ${safePeer.connected ? 'badge-success' : 'badge-error'}`
        }, safePeer.connected ? '🟢 Connected' : '🔴 Disconnected')
    );
    
    // Peer metadata
    const peerMeta = h('div', { class: 'text-sm text-base-content/70 mb-3' },
        `Status: ${safePeer.status}`,
        safePeer.latency ? ` • Latency: ${safePeer.latency}ms` : '',
        safePeer.lastSeen ? h('br') : '',
        safePeer.lastSeen ? `Last seen: ${new Date(safePeer.lastSeen).toLocaleString()}` : ''
    );
    
    cardBody.appendChild(peerHeader);
    cardBody.appendChild(peerMeta);
    
    // Action buttons
    const actions = h('div', { class: 'card-actions justify-end gap-2' });
    
    // Test connection button
    const testButton = h('button', { 
        class: 'btn btn-outline btn-sm',
        onclick: async () => {
            const result = await testPeerConnection(safePeer.url);
            if (result && result.success) {
                const method = result.method || 'unknown';
                const latency = result.latency || 'unknown';
                showToast(`✅ Connection test successful via ${method} (${latency}ms)`, 'success');
            } else {
                const error = result?.error || 'Unknown error';
                const method = result?.method || 'unknown';
                showToast(`❌ Connection test failed via ${method}: ${error}`, 'error');
            }
        }
    }, '🔍 Test');
    actions.appendChild(testButton);
    
    // Reconnect button (only if disconnected)
    if (!safePeer.connected) {
        const reconnectButton = h('button', { 
            class: 'btn btn-warning btn-sm',
            onclick: async () => {
                await reconnectToPeer(safePeer.url);
            }
        }, '🔄 Reconnect');
        actions.appendChild(reconnectButton);
    }
    
    // Remove button
    const removeButton = h('button', { 
        class: 'btn btn-error btn-sm',
        onclick: async () => {
            if (confirm(`Are you sure you want to remove peer "${safePeer.url}"?`)) {
                await removePeer(safePeer.url);
            }
        }
    }, '🗑️ Remove');
    actions.appendChild(removeButton);
    
    cardBody.appendChild(actions);
    peerCard.appendChild(cardBody);
    
    return peerCard;
}

/**
 * Read-only peer item component (no remove button)
 * Shows configured peers from config.json with test and reconnect options only
 */
export function PeerItemReadOnly(peer) {
    if (!peer || typeof peer !== 'object') {
        console.error('Invalid peer object:', peer);
        return h('div', { class: 'alert alert-error' }, 'Invalid peer data');
    }
    
    const safePeer = {
        url: peer.url || peer.peer || 'Unknown URL',
        connected: peer.connected || false,
        status: peer.status || 'unknown',
        latency: peer.latency || null,
        lastSeen: peer.lastSeen || null
    };
    
    // Create peer card
    const peerCard = h('div', { 
        class: `card bg-base-200 shadow-md mb-4 ${safePeer.connected ? 'border-l-4 border-success' : 'border-l-4 border-error'}`,
        id: `peer-${btoa(safePeer.url)}`,
        'data-url': safePeer.url
    });
    
    const cardBody = h('div', { class: 'card-body p-4' });
    
    // Peer header with config badge
    const peerHeader = h('div', { class: 'flex justify-between items-start mb-2' },
        h('div', { class: 'flex flex-col gap-2' },
            h('h4', { class: 'card-title text-base font-medium break-all' }, safePeer.url),
            h('div', { class: 'flex gap-2' },
                h('div', { 
                    class: `badge ${safePeer.connected ? 'badge-success' : 'badge-error'}`
                }, safePeer.connected ? '🟢 Connected' : '🔴 Disconnected'),
                h('div', { 
                    class: 'badge badge-info'
                }, '⚙️ Configured')
            )
        )
    );
    
    // Peer metadata
    const peerMeta = h('div', { class: 'text-sm text-base-content/70 mb-3' },
        `Status: ${safePeer.status}`,
        safePeer.latency ? ` • Latency: ${safePeer.latency}ms` : '',
        safePeer.lastSeen ? h('br') : '',
        safePeer.lastSeen ? `Last seen: ${new Date(safePeer.lastSeen).toLocaleString()}` : ''
    );
    
    cardBody.appendChild(peerHeader);
    cardBody.appendChild(peerMeta);
    
    // Action buttons (senza Remove)
    const actions = h('div', { class: 'card-actions justify-end gap-2' });
    
    // Test connection button
    const testButton = h('button', { 
        class: 'btn btn-outline btn-sm',
        onclick: async () => {
            const result = await testPeerConnection(safePeer.url);
            if (result && result.success) {
                const method = result.method || 'unknown';
                const latency = result.latency || 'unknown';
                showToast(`✅ Connection test successful via ${method} (${latency}ms)`, 'success');
            } else {
                const error = result?.error || 'Unknown error';
                const method = result?.method || 'unknown';
                showToast(`❌ Connection test failed via ${method}: ${error}`, 'error');
            }
        }
    }, '🔍 Test');
    actions.appendChild(testButton);
    
    // Reconnect button (only if disconnected)
    if (!safePeer.connected) {
        const reconnectButton = h('button', { 
            class: 'btn btn-warning btn-sm',
            onclick: async () => {
                await reconnectToPeer(safePeer.url);
            }
        }, '🔄 Reconnect');
        actions.appendChild(reconnectButton);
    }
    
    cardBody.appendChild(actions);
    peerCard.appendChild(cardBody);
    
    return peerCard;
}
