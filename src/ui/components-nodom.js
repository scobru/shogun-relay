import { h, setEffect, setSignal } from './nodom.js';
import {
    getIsLoading,
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
    loadFiles
} from './app-nodom.js';

/**
 * Header Component
 */
export function Header() {
    return h('header', {}, 
        h('h1', {}, 'Shogun Relay Dashboard')
    );
}

/**
 * Navbar Component
 */
export function Navbar() {
    return h('div', { class: 'navbar' },
        h('div', { class: 'nav-links' },
            h('a', { href: '#', class: 'active' }, 'Dashboard'),
            h('a', { href: '#', id: 'debug-command-btn', style: 'color: #ff3366;' }, 'Debug')
        ),
        h('button', { 
            id: 'logout-btn', 
            class: 'logout-btn',
            onclick: handleLogout
        }, 'Logout')
    );
}

/**
 * Toast Container Component
 */
export function ToastContainer() {
    const toastContainer = h('div', { id: 'toast-container', class: 'toast-container' });
    
    setEffect(() => {
        // Get current toasts
        const toasts = getToasts();
        
        // Clear existing content
        toastContainer.innerHTML = '';
        
        // Add toasts
        toasts.forEach(toast => {
            const toastEl = document.createElement('div');
            toastEl.className = `toast toast-${toast.type}`;
            
            const content = document.createElement('div');
            content.textContent = toast.message;
            
            const closeBtn = document.createElement('button');
            closeBtn.className = 'toast-close';
            closeBtn.innerHTML = '✕';
            closeBtn.addEventListener('click', () => {
                // Remove this toast
                setToasts(prev => prev.filter(t => t.id !== toast.id));
            });
            
            toastEl.appendChild(content);
            toastEl.appendChild(closeBtn);
            toastContainer.appendChild(toastEl);
        });
    });
    
    return toastContainer;
}

/**
 * Loading Overlay Component
 */
export function LoadingOverlay() {
    const overlay = h('div', { id: 'loading-overlay', class: 'loading-overlay' },
        h('div', { class: 'loading-spinner' })
    );
    
    setEffect(() => {
        const isLoading = getIsLoading();
        overlay.className = isLoading 
            ? 'loading-overlay active' 
            : 'loading-overlay';
    });
    
    return overlay;
}

/**
 * Dashboard Header Component
 */
export function DashboardHeader() {
    return h('div', { class: 'dashboard-header' },
        h('h2', { class: 'dashboard-title' }, 'System Overview'),
        h('div', { class: 'dashboard-actions' },
            h('button', { id: 'refresh-all' }, 'Refresh Data')
        )
    );
}

/**
 * Stats Grid Component
 */
export function StatsGrid() {
    const grid = h('div', { class: 'grid' },
        // Server Status Card
        h('div', { class: 'stat-card' },
            h('div', { class: 'stat-label' }, 'Server Status'),
            h('div', { class: 'stat-value', id: 'server-status' }, () => getServerStatus().status),
            h('div', { class: 'stat-label' },
                'Port: ',
                h('span', { id: 'server-port' }, () => getServerStatus().port)
            )
        ),
        
        // GunDB Connections Card
        h('div', { class: 'stat-card' },
            h('div', { class: 'stat-label' }, 'GunDB Connections'),
            h('div', { class: 'stat-value', id: 'peer-count' }, () => getNetworkStatus().peerCount),
            h('div', { class: 'stat-label' },
                'Status: ',
                h('span', { id: 'network-status' }, () => getNetworkStatus().status)
            )
        ),
        
        // Files Stats Card
        h('div', { class: 'stat-card' },
            h('div', { class: 'stat-label' }, 'Files Uploaded'),
            h('div', { class: 'stat-value', id: 'file-count' }, () => getFileStats().count),
            h('div', { class: 'stat-label' },
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
    return h('div', { class: 'card' },
        h('div', { class: 'card-header' },
            h('h3', { class: 'card-title' }, 'Server Information')
        ),
        h('p', {},
            'Gun server active on ',
            h('code', {}, h('span', { id: 'origin' }, window.location.origin))
        ),
        h('p', {},
            'WebSocket on ',
            h('code', {}, h('span', { id: 'ws' }, window.location.origin.replace(/^http/, 'ws') + '/gun'))
        ),
        h('div', { id: 'network-info' },
            h('span', { class: 'node-info' },
                'Peers: ',
                h('strong', { id: 'peer-count-detail' }, () => getNetworkStatus().peerCount)
            ),
            h('span', { class: 'node-info' },
                'Status: ',
                h('strong', { id: 'network-status-detail' }, () => getNetworkStatus().status)
            )
        ),
        h('div', { 
            id: 'log-container', 
            class: 'log-container', 
            style: 'display: none'
        })
    );
}

/**
 * Tabs Component
 */
export function Tabs() {
    const tabs = [
        { id: 'files', label: 'Files' },
        { id: 'upload', label: 'Upload File' },
        { id: 'settings', label: 'Settings' }
    ];
    
    const tabsEl = h('div', { class: 'tabs' });
    
    setEffect(() => {
        tabsEl.innerHTML = '';
        const activeTab = getActiveTab();
        
        tabs.forEach(tab => {
            const tabEl = document.createElement('div');
            tabEl.className = tab.id === activeTab ? 'tab active' : 'tab';
            tabEl.setAttribute('data-tab', tab.id);
            tabEl.textContent = tab.label;
            
            tabEl.addEventListener('click', () => {
                setActiveTab(tab.id);
            });
            
            tabsEl.appendChild(tabEl);
        });
    });
    
    return tabsEl;
}

/**
 * File item component
 */
export function FileItem(file) {
    // Check that file is valid before creating the component
    if (!file || typeof file !== 'object') {
        console.error('Invalid file object:', file);
        return h('div', { class: 'file-item error' }, 'Invalid file data');
    }
    
    // Log the file data to debug IPFS hash issues
    console.debug('Processing file item for display:', {
        id: file.id,
        name: file.name || file.originalName,
        hasIpfsHash: !!file.ipfsHash,
        ipfsHash: file.ipfsHash
    });
    
    // Create defensive copy with defaults for missing values
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
    
    // Format upload date safely
    const uploadDate = new Date(safeFile.timestamp).toLocaleString();
    
    // Create the file item container
    const fileItem = h('div', { 
        class: 'file-item', 
        id: `file-${safeFile.id}`,
        'data-id': safeFile.id
    });
    
    // Add IPFS status to the class for styling
    if (safeFile.ipfsHash) {
        fileItem.classList.add('ipfs-file');
    }
    
    // File info section
    const fileInfo = h('div', { class: 'file-info' });
    
    // File name
    const fileName = h('div', { class: 'file-name' }, safeFile.originalName);
    
    // Create IPFS badge with high visibility if it's an IPFS file
    const ipfsBadge = safeFile.ipfsHash 
        ? h('span', { class: 'ipfs-badge', style: 'background-color: #6e3fff; color: white; padding: 2px 6px; border-radius: 4px; margin-left: 5px;' }, 'IPFS')
        : h('span', { class: 'local-badge' }, 'Local');
            
    // File metadata
    const fileMeta = h('div', { class: 'file-meta' },
        `${formatFileSize(safeFile.size)} • ${safeFile.mimetype} • Uploaded: ${uploadDate} `,
        ipfsBadge
    );
    
    fileInfo.appendChild(fileName);
    fileInfo.appendChild(fileMeta);
    
    // Add IPFS info if available
    if (safeFile.ipfsHash) {
        const ipfsInfo = h('div', { class: 'ipfs-info', style: 'margin-top: 5px; font-size: 0.85em; color: #6e3fff;' },
            h('small', {}, `IPFS Hash: ${safeFile.ipfsHash}`),
            h('br'),
            h('small', {}, 
                'IPFS URL: ',
                h('a', { 
                    href: safeFile.ipfsUrl, 
                    target: '_blank',
                    style: 'color: #6e3fff; text-decoration: underline;'
                }, safeFile.ipfsUrl)
            )
        );
        fileInfo.appendChild(ipfsInfo);
    }
    
    // File actions section
    const fileActions = h('div', { class: 'file-actions' });
    
    // View file button
    const viewUrl = safeFile.ipfsHash ? safeFile.ipfsUrl : safeFile.fileUrl;
    if (viewUrl && viewUrl !== '#') {
        const viewButton = h('button', { 
            class: 'view-file',
            onclick: () => window.open(viewUrl, '_blank')
        }, 'View File');
        fileActions.appendChild(viewButton);
    }
    
    // Copy IPFS hash button
    if (safeFile.ipfsHash) {
        const copyButton = h('button', { 
            class: 'copy-hash',
            style: 'background-color: #6e3fff;',
            onclick: async () => {
                try {
                    await navigator.clipboard.writeText(safeFile.ipfsHash);
                    showToast('IPFS hash copied to clipboard', 'success');
                } catch (error) {
                    showToast(`Error copying: ${error.message}`, 'error');
                }
            }
        }, 'Copy Hash');
        fileActions.appendChild(copyButton);
    }
    
    // Delete button
    const deleteButton = h('button', { 
        class: 'delete-file',
        style: 'background-color: #ff3366;',
        onclick: () => {
            deleteFile(safeFile.id, safeFile.originalName);
        }
    }, 'Delete');
    fileActions.appendChild(deleteButton);
    
    // Add sections to file item
    fileItem.appendChild(fileInfo);
    fileItem.appendChild(fileActions);
    
    return fileItem;
}

/**
 * File search form component
 */
export function FileSearchForm() {
    // Create search form container
    const searchForm = h('div', { class: 'search-form' });
    
    // Create input fields directly to avoid reactive issues
    const fileNameInput = h('input', {
        type: 'text',
        id: 'file-name-search',
        placeholder: 'File name'
    });
    
    const mimeTypeInput = h('input', {
        type: 'text',
        id: 'file-mimetype-search',
        placeholder: 'MIME type'
    });
    
    const minSizeInput = h('input', {
        type: 'number',
        id: 'file-min-size',
        placeholder: 'Min size (bytes)'
    });
    
    const maxSizeInput = h('input', {
        type: 'number',
        id: 'file-max-size',
        placeholder: 'Max size (bytes)'
    });
    
    // Create search button
    const searchButton = h('button', {
        id: 'search-files',
        onclick: handleSearch
    }, 'Search');
    
    // Add all elements to form
    searchForm.appendChild(fileNameInput);
    searchForm.appendChild(mimeTypeInput);
    searchForm.appendChild(minSizeInput);
    searchForm.appendChild(maxSizeInput);
    searchForm.appendChild(searchButton);
    
    // Search handler
    function handleSearch() {
        const nameFilter = document.getElementById('file-name-search')?.value || '';
        const mimetypeFilter = document.getElementById('file-mimetype-search')?.value || '';
        const minSizeFilter = document.getElementById('file-min-size')?.value || '';
        const maxSizeFilter = document.getElementById('file-max-size')?.value || '';
        
        // Create search params
        const searchParams = {};
        if (nameFilter) searchParams.name = nameFilter;
        if (mimetypeFilter) searchParams.mimetype = mimetypeFilter;
        if (minSizeFilter) searchParams.minSize = minSizeFilter;
        if (maxSizeFilter) searchParams.maxSize = maxSizeFilter;
        
        // Show toast with search criteria
        let searchMsg = 'Searching for files';
        if (Object.keys(searchParams).length > 0) {
            searchMsg += ' matching: ' + Object.entries(searchParams)
                .map(([key, value]) => `${key}="${value}"`)
                .join(', ');
        }
        showToast(searchMsg, 'info');
        
        // Load files with search params
        loadFiles(searchParams);
    }
    
    return searchForm;
}

/**
 * Empty state component
 */
export function EmptyState(message = 'No files found') {
    return h('div', { class: 'empty-state' }, message);
}

/**
 * Loading state component
 */
export function LoadingState(message = 'Loading...') {
    return h('div', { class: 'loading' }, message);
} 