import { h, setSignal, setEffect } from './nodom.js';
import {
    getActiveTab,
    getFiles,
    getIpfsStatus,
    setIpfsStatus,
    loadFiles,
    showToast,
    updateIpfsStatus,
    getAuthToken,
    formatFileSize,
    getIsLoading,
    setIsLoading,
    checkIpfsConnection,
    getIpfsConnectionStatus,
    setIpfsConnectionStatus,
    setFiles,
    // Import peer management functions
    getPeers,
    getPeerConnections,
    updatePeerStatus,
    addPeer,
    removePeer,
    reconnectToPeer,
    testPeerConnection,
    getNetworkStatus
} from './app-nodom.js';
import { FileSearchForm, FileItem, EmptyState, LoadingState, PeerItem } from './components-nodom.js';

// Debouncing per evitare richieste multiple
let networkUpdateTimeout = null;
let networkTabActive = false;

/**
 * Files Tab Content Component
 */
export function FilesTabContent() {
    const tabContent = h('div', { 
        id: 'files-tab', 
        class: 'tab-content', 
        style: 'display: none;' 
    });
    
    setEffect(() => {
        const isActive = getActiveTab() === 'files';
        tabContent.style.display = isActive ? 'block' : 'none';
        
        if (isActive && tabContent.innerHTML === '') {
            tabContent.innerHTML = '';
            
            // Card header with IPFS status indicator
            const ipfsStatus = getIpfsStatus();
            const ipfsStatusIndicator = h('div', { 
                class: `badge ${ipfsStatus.enabled ? 'badge-success' : 'badge-error'} gap-2`
            }, 
                h('span', {}, ipfsStatus.enabled ? '✅' : '❌'),
                h('span', {}, ipfsStatus.enabled ? 'IPFS Active' : 'IPFS Disabled')
            );
            
            const cardHeader = h('div', { class: 'flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 mb-6' },
                h('div', { class: 'flex items-center gap-3' },
                    h('h3', { class: 'text-2xl font-bold text-base-content' }, '📁 File Management'),
                    ipfsStatusIndicator
                ),
                h('button', { 
                    id: 'refresh-files',
                    class: 'btn btn-primary btn-sm',
                    onclick: () => {
                        loadFiles();
                        showToast('Refreshing files...', 'info');
                    }
                }, '🔄 Refresh Files')
            );
            
            // Search form
            const searchForm = FileSearchForm();
            
            // IPFS filter and controls
            const filterContainer = h('div', { class: 'flex flex-wrap items-center gap-4 mb-6' });
            
            // IPFS filter toggle
            const ipfsFilterContainer = h('div', { class: 'form-control' },
                h('label', { class: 'label cursor-pointer gap-2' },
                    h('input', { 
                        type: 'checkbox', 
                        id: 'ipfs-filter',
                        class: 'checkbox checkbox-secondary'
                    }),
                    h('span', { class: 'label-text font-medium' }, '🌐 Show only IPFS files')
                )
            );
            
            // Debug IPFS metadata button
            const debugIpfsButton = h('button', {
                class: 'btn btn-outline btn-sm',
                onclick: async () => {
                    try {
                        const response = await fetch('/api/ipfs/metadata', {
                            headers: {
                                'Authorization': `Bearer ${getAuthToken()}`
                            }
                        });
                        
                        if (response.ok) {
                            const data = await response.json();
                            console.log('IPFS Metadata:', data);
                            showToast(`IPFS Metadata: ${data.count} entries found`, 'info');
                        } else {
                            showToast('Failed to fetch IPFS metadata', 'error');
                        }
                    } catch (error) {
                        console.error('Error fetching IPFS metadata:', error);
                        showToast(`Error: ${error.message}`, 'error');
                    }
                }
            }, '🔍 Debug IPFS Metadata');
            
            filterContainer.appendChild(ipfsFilterContainer);
            filterContainer.appendChild(debugIpfsButton);
            
            // Create file list container
            const fileListContainer = h('div', { 
                class: 'space-y-4', 
                id: 'file-list' 
            });
            
            // Add these elements to tab content
            tabContent.appendChild(cardHeader);
            tabContent.appendChild(searchForm);
            tabContent.appendChild(filterContainer);
            tabContent.appendChild(fileListContainer);
            
            // Initialize file list
            updateFileList(fileListContainer);
            
            // Add IPFS filter functionality
            const ipfsFilterCheckbox = document.getElementById('ipfs-filter');
            if (ipfsFilterCheckbox) {
                ipfsFilterCheckbox.addEventListener('change', () => {
                    updateFileList(fileListContainer);
                });
            }
        }
    });
    
    // Function to update file list
    function updateFileList(container) {
        if (!container) return;
        
        const files = getFiles();
        const isLoading = getIsLoading();
        const ipfsFilterEnabled = document.getElementById('ipfs-filter')?.checked || false;
        
        // Show loading state
        if (isLoading) {
            container.innerHTML = '';
            container.appendChild(LoadingState('Loading files...'));
            return;
        }
        
        if (!files || !Array.isArray(files) || files.length === 0) {
            container.innerHTML = '';
            container.appendChild(EmptyState('No files found'));
            return;
        }
        
        // Filter for IPFS files if the filter is enabled
        const filteredFiles = ipfsFilterEnabled
            ? files.filter(file => file && file.ipfsHash)
            : files;
            
        if (filteredFiles.length === 0) {
            container.innerHTML = '';
            container.appendChild(EmptyState(`No ${ipfsFilterEnabled ? 'IPFS ' : ''}files found`));
            return;
        }
        
        // Clear container completely to prevent duplicates
        container.innerHTML = '';
        
        // Add a unique identifier to prevent processing the same file list multiple times
        const currentTimestamp = Date.now();
        container.setAttribute('data-last-update', currentTimestamp);
        
        // Display summary
        const ipfsCount = files.filter(file => file && file.ipfsHash).length;
        const summary = h('div', { 
            class: 'stats stats-horizontal shadow mb-6',
            'data-update-id': currentTimestamp
        },
            h('div', { class: 'stat' },
                h('div', { class: 'stat-title' }, 'Total Files'),
                h('div', { class: 'stat-value text-primary' }, filteredFiles.length),
                h('div', { class: 'stat-desc' }, `of ${files.length} files`)
            ),
            h('div', { class: 'stat' },
                h('div', { class: 'stat-title' }, 'IPFS Files'),
                h('div', { class: 'stat-value text-secondary' }, ipfsCount),
                h('div', { class: 'stat-desc' }, 'stored on IPFS')
            )
        );
        container.appendChild(summary);
        
        // Add each file with duplicate prevention
        try {
            // Sort files by timestamp (newest first)
            const sortedFiles = [...filteredFiles].sort((a, b) => {
                const timeA = parseInt(a.timestamp || a.uploadedAt || 0, 10);
                const timeB = parseInt(b.timestamp || b.uploadedAt || 0, 10);
                return timeB - timeA; // Newest first
            });
            
            sortedFiles.forEach((file, index) => {
                if (!file || typeof file !== 'object') return;
                
                // Add unique identifier to prevent duplicate processing
                const fileEl = FileItem(file);
                fileEl.setAttribute('data-file-index', index);
                fileEl.setAttribute('data-update-id', currentTimestamp);
                container.appendChild(fileEl);
            });
            
            console.log(`[FilesTab] Updated file list with ${sortedFiles.length} files at ${currentTimestamp}`);
        } catch (error) {
            console.error('Error displaying files:', error);
            container.innerHTML = '';
            container.appendChild(h('div', { class: 'alert alert-error' }, 
                `Error displaying files: ${error.message}`
            ));
        }
    }
    
    return tabContent;
}

/**
 * Upload Tab Content Component
 */
export function UploadTabContent() {
    const tabContent = h('div', { 
        id: 'upload-tab', 
        class: 'tab-content',
        style: 'display: none;' 
    });
    
    setEffect(() => {
        const isActive = getActiveTab() === 'upload';
        tabContent.style.display = isActive ? 'block' : 'none';
        
        if (isActive && tabContent.innerHTML === '') {
            tabContent.innerHTML = '';
            
            // Card header without IPFS status (since we're not doing direct IPFS upload)
            const cardHeader = h('div', { class: 'flex items-center gap-3 mb-6' },
                h('h3', { class: 'text-2xl font-bold text-base-content' }, '⬆️ Upload File'),
                h('div', { class: 'badge badge-info gap-2' }, 
                    h('span', {}, '💾'),
                    h('span', {}, 'Local Upload')
                )
            );
            
            // Upload form for local storage only
            const uploadForm = createUploadForm();
            
            // Results container
            const resultsContainer = h('div', { 
                id: 'upload-results', 
                class: 'mt-6'
            });
            
            // Add to tab content
            tabContent.appendChild(cardHeader);
            tabContent.appendChild(uploadForm);
            tabContent.appendChild(resultsContainer);
        }
    });
    
    /**
     * Create enhanced upload form for local storage
     */
    function createUploadForm() {
        const form = h('div', { class: 'space-y-6' });
        
        // File upload area with drag & drop styling
        const fileUploadArea = h('div', { 
            class: 'border-2 border-dashed border-base-300 rounded-lg p-8 text-center hover:border-primary transition-colors cursor-pointer bg-base-50',
            onclick: () => document.getElementById('file-upload').click()
        });
        
        // Hidden file input
        const fileInput = h('input', { 
            type: 'file', 
            id: 'file-upload', 
            class: 'hidden',
            multiple: false
        });
        
        // Upload area content
        const uploadAreaContent = h('div', { class: 'space-y-4' },
            h('div', { class: 'text-6xl' }, '📁'),
            h('div', { class: 'space-y-2' },
                h('p', { class: 'text-lg font-medium' }, 'Click to select file or drag & drop'),
                h('p', { class: 'text-sm text-base-content/60' }, 'Files will be stored locally first')
            ),
            h('button', { 
                type: 'button',
                class: 'btn btn-primary btn-lg',
                onclick: (e) => {
                    e.stopPropagation();
                    document.getElementById('file-upload').click();
                }
            }, '📂 Choose File')
        );
        
        // File status display
        const fileStatus = h('div', { 
            id: 'file-upload-status', 
            class: 'mt-4 text-center hidden'
        });
        
        fileUploadArea.appendChild(uploadAreaContent);
        fileUploadArea.appendChild(fileStatus);
        
        // File name input
        const fileNameSection = h('div', { class: 'form-control w-full' },
            h('label', { class: 'label' },
                h('span', { class: 'label-text font-medium' }, '✏️ Custom file name (optional)')
            ),
            h('input', { 
                type: 'text', 
                id: 'file-name', 
                placeholder: 'Enter custom name for the file',
                class: 'input input-bordered w-full'
            }),
            h('label', { class: 'label' },
                h('span', { class: 'label-text-alt' }, 'Leave empty to use original filename')
            )
        );
        
        // Submit button
        const submitBtn = h('button', { 
            type: 'button',
            id: 'upload-submit',
            class: 'btn btn-success btn-lg w-full',
            onclick: handleUpload
        }, '🚀 Upload File');
        
        // Add all elements to form
        form.appendChild(fileInput);
        form.appendChild(fileUploadArea);
        form.appendChild(fileNameSection);
        form.appendChild(submitBtn);
        
        // Add event listeners
        fileInput.addEventListener('change', () => {
            const file = fileInput.files[0];
            if (file) {
                fileStatus.className = 'mt-4 text-center';
                fileStatus.innerHTML = `
                    <div class="alert alert-info">
                        <span>📄 Selected: <strong>${file.name}</strong></span>
                        <span class="text-sm">(${formatFileSize(file.size)})</span>
                    </div>
                `;
            } else {
                fileStatus.className = 'mt-4 text-center hidden';
            }
        });
        
        return form;
    }
    
    // Handle file upload with local storage only
    async function handleUpload() {
        const fileInput = document.getElementById('file-upload');
        const customName = document.getElementById('file-name').value;
        
        if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
            showToast('Please select a file to upload', 'warning');
            return;
        }
        
        const file = fileInput.files[0];
        
        // Show loading
        setIsLoading(true);
        
        try {
            const formData = new FormData();
            formData.append('file', file);
            if (customName) {
                formData.append('customName', customName);
            }
            
            const response = await fetch("/upload", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${getAuthToken()}`
                },
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success) {
                showToast('✅ File uploaded successfully!', 'success');
                
                // Clear form
                fileInput.value = '';
                document.getElementById('file-name').value = '';
                document.getElementById('file-upload-status').className = 'mt-4 text-center hidden';
                
                // Reload files list with throttling to prevent duplicates
                try {
                    // Clear cache first
                    localStorage.setItem('files-data', JSON.stringify([]));
                    setFiles([]);
                    
                    // Wait a moment before refreshing to allow server to process
                    setTimeout(() => {
                        loadFiles();
                    }, 1000);
                } catch (refreshError) {
                    console.error("Error refreshing files after upload:", refreshError);
                }
            } else {
                throw new Error(data.error || "Unknown error");
            }
        } catch (error) {
            console.error("Upload error:", error);
            showToast(`Upload failed: ${error.message}`, 'error');
        } finally {
            setIsLoading(false);
        }
    }
    
    return tabContent;
}

/**
 * Settings Tab Content Component
 */
export function SettingsTabContent() {
    const tabContent = h('div', { 
        class: 'space-y-6 p-4',
        id: 'settings-tab'
    });

    // State for configuration display only (read-only)
    let currentConfig = {};

    // Function to load configuration from server (READ-ONLY)
    async function loadConfiguration() {
        try {
            const response = await fetch('/api/config', {
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                currentConfig = data.config;
                
                // Re-render the configuration display
                renderConfigurationDisplay();
                
                showToast('✅ Configuration loaded from file', 'success');
            } else {
                showToast('❌ Failed to load configuration', 'error');
            }
        } catch (error) {
            console.error('Error loading configuration:', error);
            showToast(`❌ Error loading configuration: ${error.message}`, 'error');
        }
    }

    // Function to reload configuration from file 
    async function reloadConfigurationFromFile() {
        try {
            const response = await fetch('/api/config/reload', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${getAuthToken()}`
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                showToast(`✅ ${data.message}`, 'success');
                
                // After reloading from file, refresh the display
                await loadConfiguration();
            } else {
                const error = await response.json();
                showToast(`❌ Failed to reload configuration: ${error.error}`, 'error');
            }
        } catch (error) {
            console.error('Error reloading configuration:', error);
            showToast(`❌ Error reloading configuration: ${error.message}`, 'error');
        }
    }

    // Function to render the configuration display (READ-ONLY)
    function renderConfigurationDisplay() {
        tabContent.innerHTML = '';
        
        // Card header
        const cardHeader = h('div', { class: 'flex justify-between items-center mb-6' },
            h('h3', { class: 'text-2xl font-bold text-base-content flex items-center gap-2' }, 
                '📋 Server Configuration (Read-Only)'
            ),
            h('div', { class: 'flex gap-2' },
                h('button', {
                    class: 'btn btn-outline btn-sm',
                    onclick: reloadConfigurationFromFile,
                    title: 'Reload configuration from config.json file'
                }, '🔄 Reload From File'),
                h('button', {
                    class: 'btn btn-outline btn-sm',
                    onclick: loadConfiguration,
                    title: 'Refresh display from server'
                }, '↻ Refresh Display')
            )
        );

        // Info message
        const infoMessage = h('div', { class: 'alert alert-info mb-6' },
            h('svg', { class: 'stroke-current shrink-0 h-6 w-6', fill: 'none', viewBox: '0 0 24 24' },
                h('path', { 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-width': '2', d: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' })
            ),
            h('div', {},
                h('h4', { class: 'font-bold' }, 'Configuration Management'),
                h('div', { class: 'text-sm' }, 'This dashboard shows the current configuration loaded from config.json. To modify settings, edit the config.json file and click "Reload From File".')
            )
        );

        // Core Server Settings
        const coreSettingsCard = h('div', { class: 'card bg-base-200 shadow-lg mb-6' },
            h('div', { class: 'card-body' },
                h('h4', { class: 'card-title text-lg mb-4' }, '🖥️ Core Server Settings'),
                h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                    // Environment
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Environment')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.NODE_ENV || 'development')
                    ),
                    // Port
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Port')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.PORT || 8765)
                    ),
                    // HTTPS Port
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'HTTPS Port')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.HTTPS_PORT || 8443)
                    ),
                    // Allowed Origins
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Allowed Origins')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.ALLOWED_ORIGINS || 'Not set')
                    )
                )
            )
        );

        // Security Settings
        const securitySettingsCard = h('div', { class: 'card bg-base-200 shadow-lg mb-6' },
            h('div', { class: 'card-body' },
                h('h4', { class: 'card-title text-lg mb-4' }, '🔒 Security Settings'),
                h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                    // Disable CORS
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'CORS Disabled')),
                        h('div', { class: `badge ${currentConfig.DISABLE_CORS ? 'badge-warning' : 'badge-success'}` }, 
                            currentConfig.DISABLE_CORS ? 'Yes' : 'No'
                        )
                    ),
                    // Disable Gun Auth
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Gun Auth Disabled')),
                        h('div', { class: `badge ${currentConfig.DISABLE_GUN_AUTH ? 'badge-warning' : 'badge-success'}` }, 
                            currentConfig.DISABLE_GUN_AUTH ? 'Yes' : 'No'
                        )
                    ),
                    // Onchain Membership
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Onchain Membership')),
                        h('div', { class: `badge ${currentConfig.ONCHAIN_MEMBERSHIP_ENABLED ? 'badge-success' : 'badge-neutral'}` }, 
                            currentConfig.ONCHAIN_MEMBERSHIP_ENABLED ? 'Enabled' : 'Disabled'
                        )
                    ),
                    // Type Validation
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Type Validation')),
                        h('div', { class: `badge ${currentConfig.TYPE_VALIDATION_ENABLED ? 'badge-success' : 'badge-neutral'}` }, 
                            currentConfig.TYPE_VALIDATION_ENABLED ? 'Enabled' : 'Disabled'
                        )
                    ),
                    // Strict Validation
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Strict Validation')),
                        h('div', { class: `badge ${currentConfig.TYPE_VALIDATION_STRICT ? 'badge-warning' : 'badge-neutral'}` }, 
                            currentConfig.TYPE_VALIDATION_STRICT ? 'Strict' : 'Normal'
                        )
                    )
                )
            )
        );

        // IPFS Settings
        const ipfsSettingsCard = h('div', { class: 'card bg-base-200 shadow-lg mb-6' },
            h('div', { class: 'card-body' },
                h('h4', { class: 'card-title text-lg mb-4' }, '📁 IPFS Settings'),
                h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                    // IPFS Enabled
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'IPFS Status')),
                        h('div', { class: `badge ${currentConfig.IPFS_ENABLED ? 'badge-success' : 'badge-neutral'}` }, 
                            currentConfig.IPFS_ENABLED ? 'Enabled' : 'Disabled'
                        )
                    ),
                    // IPFS Service
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'IPFS Service')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.IPFS_SERVICE || 'IPFS-CLIENT')
                    ),
                    // Node URL
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Node URL')),
                        h('div', { class: 'input input-bordered flex items-center text-sm' }, currentConfig.IPFS_NODE_URL || 'Not set')
                    ),
                    // Gateway
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'Gateway')),
                        h('div', { class: 'input input-bordered flex items-center text-sm' }, currentConfig.IPFS_GATEWAY || 'Not set')
                    )
                )
            )
        );

        // S3 Settings
        const s3SettingsCard = h('div', { class: 'card bg-base-200 shadow-lg mb-6' },
            h('div', { class: 'card-body' },
                h('h4', { class: 'card-title text-lg mb-4' }, '☁️ S3 Storage Settings'),
                h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
                    // S3 Bucket
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'S3 Bucket')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.S3_BUCKET || 'Not configured')
                    ),
                    // S3 Region
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'S3 Region')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.S3_REGION || 'us-east-1')
                    ),
                    // S3 Endpoint
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'S3 Endpoint')),
                        h('div', { class: 'input input-bordered flex items-center text-sm' }, currentConfig.S3_ENDPOINT || 'Not set')
                    ),
                    // S3 Port
                    h('div', { class: 'form-control' },
                        h('label', { class: 'label' }, h('span', { class: 'label-text font-medium' }, 'S3 Port')),
                        h('div', { class: 'input input-bordered flex items-center' }, currentConfig.S3_PORT || 4569)
                    )
                )
            )
        );

        // Peers Configuration
        const peersCard = h('div', { class: 'card bg-base-200 shadow-lg mb-6' },
            h('div', { class: 'card-body' },
                h('h4', { class: 'card-title text-lg mb-4' }, '🌐 Configured Peers'),
                h('div', { class: 'space-y-2' },
                    ...(currentConfig.PEERS && currentConfig.PEERS.length > 0 ? 
                        currentConfig.PEERS.map(peer => 
                            h('div', { class: 'alert alert-info text-sm' },
                                h('span', { class: 'font-mono' }, peer)
                            )
                        ) : 
                        [h('div', { class: 'alert alert-warning' }, 'No peers configured')]
                    )
                )
            )
        );

        // Raw Configuration (collapsible)
        const rawConfigCard = h('div', { class: 'card bg-base-200 shadow-lg' },
            h('div', { class: 'card-body' },
                h('div', { class: 'collapse collapse-arrow' },
                    h('input', { type: 'checkbox' }),
                    h('div', { class: 'collapse-title text-lg font-medium' }, '🔍 Raw Configuration (JSON)'),
                    h('div', { class: 'collapse-content' },
                        h('pre', { class: 'bg-base-300 p-4 rounded-lg text-sm overflow-auto max-h-96' },
                            JSON.stringify(currentConfig, null, 2)
                        )
                    )
                )
            )
        );

        // Add all components to tab content
        tabContent.appendChild(cardHeader);
        tabContent.appendChild(infoMessage);
        tabContent.appendChild(coreSettingsCard);
        tabContent.appendChild(securitySettingsCard);
        tabContent.appendChild(ipfsSettingsCard);
        tabContent.appendChild(s3SettingsCard);
        tabContent.appendChild(peersCard);
        tabContent.appendChild(rawConfigCard);
    }
    
    setEffect(() => {
        const isActive = getActiveTab() === 'settings';
        tabContent.style.display = isActive ? 'block' : 'none';
        
        if (isActive && Object.keys(currentConfig).length === 0) {
            // Load configuration when tab becomes active for the first time
            loadConfiguration();
        }
    });
    
    return tabContent;
}

/**
 * Network Tab Content Component
 */
export function NetworkTabContent() {
    const tabContent = h('div', { 
        id: 'network-tab', 
        class: 'tab-content',
        style: 'display: none;' 
    });
    
    setEffect(() => {
        const isActive = getActiveTab() === 'network';
        tabContent.style.display = isActive ? 'block' : 'none';
        
        if (isActive && !networkTabActive) {
            networkTabActive = true;
            
            // Clear any existing timeout
            if (networkUpdateTimeout) {
                clearTimeout(networkUpdateTimeout);
                networkUpdateTimeout = null;
            }
            
            tabContent.innerHTML = '';
            
            // Card header with network status
            const networkStatus = getNetworkStatus();
            const networkStatusBadge = h('div', { 
                class: `badge ${networkStatus.peerCount > 1 ? 'badge-success' : 'badge-warning'} gap-2`
            }, 
                h('span', {}, networkStatus.peerCount > 1 ? '🟢' : '🟡'),
                h('span', {}, `${networkStatus.peerCount} Peers`)
            );
            
            const cardHeader = h('div', { class: 'flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4 mb-6' },
                h('div', { class: 'flex items-center gap-3' },
                    h('h3', { class: 'text-2xl font-bold text-base-content' }, '🌐 Network & Peer Management'),
                    networkStatusBadge
                ),
                h('button', { 
                    id: 'refresh-network',
                    class: 'btn btn-primary btn-sm',
                    onclick: () => {
                        // Debounce the refresh to avoid multiple calls
                        if (networkUpdateTimeout) {
                            clearTimeout(networkUpdateTimeout);
                        }
                        
                        networkUpdateTimeout = setTimeout(() => {
                            updatePeerStatus();
                            showToast('🔄 Refreshing network status...', 'info');
                            networkUpdateTimeout = null;
                        }, 500);
                    }
                }, '🔄 Refresh Network')
            );
            
            // Network statistics (static content to avoid reactive loops)
            const networkStatsCard = h('div', { class: 'card bg-base-200 shadow-lg mb-6' },
                h('div', { class: 'card-body' },
                    h('h4', { class: 'card-title mb-4' }, '📊 Network Statistics'),
                    h('div', { class: 'stats stats-horizontal w-full' },
                        h('div', { class: 'stat' },
                            h('div', { class: 'stat-figure text-primary' },
                                h('div', { class: 'text-2xl' }, '🌐')
                            ),
                            h('div', { class: 'stat-title' }, 'Total Peers'),
                            h('div', { 
                                class: 'stat-value text-primary',
                                id: 'total-peers-count'
                            }, getPeers().length.toString()),
                            h('div', { class: 'stat-desc' }, 'Configured peers')
                        ),
                        h('div', { class: 'stat' },
                            h('div', { class: 'stat-figure text-success' },
                                h('div', { class: 'text-2xl' }, '✅')
                            ),
                            h('div', { class: 'stat-title' }, 'Connected'),
                            h('div', { 
                                class: 'stat-value text-success',
                                id: 'connected-peers-count'
                            }, (() => {
                                const connections = getPeerConnections();
                                const connected = Object.values(connections).filter(conn => conn.connected);
                                return connected.length.toString();
                            })()),
                            h('div', { class: 'stat-desc' }, 'Active connections')
                        ),
                        h('div', { class: 'stat' },
                            h('div', { class: 'stat-figure text-info' },
                                h('div', { class: 'text-2xl' }, '📡')
                            ),
                            h('div', { class: 'stat-title' }, 'Status'),
                            h('div', { 
                                class: 'stat-value text-info text-sm',
                                id: 'network-status-text'
                            }, networkStatus.status),
                            h('div', { class: 'stat-desc' }, 'Network state')
                        )
                    )
                )
            );
            
            // Add peer form
            const addPeerCard = createAddPeerForm();
            
            // Peer list container
            const peerListCard = h('div', { class: 'card bg-base-200 shadow-lg' },
                h('div', { class: 'card-body' },
                    h('h4', { class: 'card-title mb-4' }, '🔗 Connected Peers'),
                    h('div', { class: 'space-y-4', id: 'peer-list' })
                )
            );
            
            // Add these elements to tab content
            tabContent.appendChild(cardHeader);
            tabContent.appendChild(networkStatsCard);
            tabContent.appendChild(addPeerCard);
            tabContent.appendChild(peerListCard);
            
            // Initialize peer list ONCE when tab becomes active
            updatePeerListOnce();
            
            // Update peer status ONCE with debouncing
            if (networkUpdateTimeout) {
                clearTimeout(networkUpdateTimeout);
            }
            
            networkUpdateTimeout = setTimeout(() => {
                updatePeerStatus().then(() => {
                    updatePeerListOnce();
                    networkUpdateTimeout = null;
                });
            }, 1000);
        }
        
        // Reset flag when tab becomes inactive
        if (!isActive && networkTabActive) {
            networkTabActive = false;
            
            // Clear any pending timeouts
            if (networkUpdateTimeout) {
                clearTimeout(networkUpdateTimeout);
                networkUpdateTimeout = null;
            }
        }
    });
    
    /**
     * Create add peer form with DaisyUI styling
     */
    function createAddPeerForm() {
        const card = h('div', { class: 'card bg-base-200 shadow-lg mb-6' },
            h('div', { class: 'card-body' },
                h('h4', { class: 'card-title mb-4' }, '➕ Add New Peer'),
                
                // URL input
                h('div', { class: 'form-control mb-4' },
                    h('label', { class: 'label' },
                        h('span', { class: 'label-text' }, 'Peer URL')
                    ),
                    h('div', { class: 'join w-full' },
                        h('input', { 
                            type: 'text', 
                            id: 'peer-url-input', 
                            placeholder: 'Enter peer URL (e.g., http://localhost:8765/gun)',
                            class: 'input input-bordered join-item flex-1'
                        }),
                        h('button', { 
                            type: 'button',
                            class: 'btn btn-outline join-item',
                            onclick: async () => {
                                const url = document.getElementById('peer-url-input').value.trim();
                                if (!url) {
                                    showToast('Please enter a peer URL', 'warning');
                                    return;
                                }
                                await testPeerConnection(url);
                            }
                        }, '🔍 Test'),
                        h('button', { 
                            type: 'button',
                            class: 'btn btn-primary join-item',
                            onclick: async () => {
                                const url = document.getElementById('peer-url-input').value.trim();
                                if (!url) {
                                    showToast('Please enter a peer URL', 'warning');
                                    return;
                                }
                                
                                const success = await addPeer(url);
                                if (success) {
                                    document.getElementById('peer-url-input').value = '';
                                    updatePeerListOnce();
                                }
                            }
                        }, '➕ Add Peer')
                    ),
                    h('label', { class: 'label' },
                        h('span', { class: 'label-text-alt' }, 'Enter the full URL of a Gun peer (e.g., http://peer.example.com:8765/gun)')
                    )
                ),
                
                // Preset peer buttons
                h('div', { class: 'space-y-2' },
                    h('div', { class: 'text-sm font-medium text-base-content/70' }, 'Quick add presets:'),
                    h('div', { class: 'flex flex-wrap gap-2' },
                        ['http://localhost:8765/gun', 'http://localhost:3000/gun', 'ws://localhost:8765/gun'].map(peerUrl => 
                            h('button', {
                                type: 'button',
                                class: 'btn btn-outline btn-sm',
                                onclick: () => {
                                    document.getElementById('peer-url-input').value = peerUrl;
                                }
                            }, peerUrl.replace('http://', '').replace('ws://', '').split('/')[0])
                        )
                    )
                )
            )
        );
        
        return card;
    }
    
    // Function to update peer list ONCE when tab becomes active
    function updatePeerListOnce() {
        const container = document.getElementById('peer-list');
        if (!container) return;
        
        const peers = getPeers();
        const peerConnections = getPeerConnections();
        const isLoading = getIsLoading();
        
        // Show loading state
        if (isLoading) {
            container.innerHTML = '';
            container.appendChild(LoadingState('Loading peers...'));
            return;
        }
        
        // Clear container
        container.innerHTML = '';
        
        if (!peers || peers.length === 0) {
            container.appendChild(EmptyState('No peers configured. Add a peer above to get started.'));
            return;
        }
        
        // Combine peer data with connection info
        const enrichedPeers = peers.map(peerUrl => {
            const connectionInfo = peerConnections[peerUrl] || {};
            return {
                url: peerUrl,
                connected: connectionInfo.connected || false,
                status: connectionInfo.status || 'unknown',
                latency: connectionInfo.latency || null,
                lastSeen: connectionInfo.lastSeen || null
            };
        });
        
        // Sort by connection status (connected first)
        enrichedPeers.sort((a, b) => {
            if (a.connected && !b.connected) return -1;
            if (!a.connected && b.connected) return 1;
            return 0;
        });
        
        // Add each peer
        enrichedPeers.forEach(peer => {
            const peerEl = PeerItem(peer);
            container.appendChild(peerEl);
        });
    }
    
    return tabContent;
}

