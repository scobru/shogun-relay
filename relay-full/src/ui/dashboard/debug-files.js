/**
 * Debug script to test file loading functionality
 * Run this in browser console to debug file display issues
 */

// Debug function to check file state
window.debugFileState = function() {
    console.log('=== FILE STATE DEBUG ===');
    
    // Check localStorage
    const storedFiles = localStorage.getItem('files-data');
    console.log('1. LocalStorage files-data:', storedFiles);
    
    if (storedFiles) {
        try {
            const parsed = JSON.parse(storedFiles);
            console.log('   - Parsed files count:', Array.isArray(parsed) ? parsed.length : 'Not array');
            if (Array.isArray(parsed) && parsed.length > 0) {
                console.log('   - Sample file structure:', parsed[0]);
                
                // Check storage types
                const typeBreakdown = parsed.reduce((acc, f) => {
                    const type = f.storageType || 'undefined';
                    acc[type] = (acc[type] || 0) + 1;
                    return acc;
                }, {});
                console.log('   - Storage type breakdown:', typeBreakdown);
            }
        } catch (e) {
            console.error('   - Error parsing stored files:', e);
        }
    }
    
    // Check if getFiles function exists and works
    if (typeof getFiles === 'function') {
        const currentFiles = getFiles();
        console.log('2. getFiles() result:', currentFiles.length, 'files');
        if (currentFiles.length > 0) {
            console.log('   - First file:', currentFiles[0]);
        }
    } else {
        console.log('2. getFiles function not available');
    }
    
    // Check active tab
    if (typeof getActiveTab === 'function') {
        console.log('3. Active tab:', getActiveTab());
    }
    
    // Check loading state
    if (typeof getIsLoading === 'function') {
        console.log('4. Is loading:', getIsLoading());
    }
    
    // Check UI elements
    const filesContainer = document.getElementById('files-display-container');
    console.log('5. Files container element:', filesContainer ? 'Found' : 'Not found');
    if (filesContainer) {
        console.log('   - Container content length:', filesContainer.innerHTML.length);
        console.log('   - Child elements:', filesContainer.children.length);
    }
    
    // Check filter buttons
    const filterButtons = document.getElementById('storage-filter-buttons');
    console.log('6. Filter buttons:', filterButtons ? 'Found' : 'Not found');
    
    console.log('========================');
    
    return {
        storedFilesCount: storedFiles ? (JSON.parse(storedFiles).length || 0) : 0,
        currentFilesCount: typeof getFiles === 'function' ? getFiles().length : 0,
        activeTab: typeof getActiveTab === 'function' ? getActiveTab() : 'unknown',
        isLoading: typeof getIsLoading === 'function' ? getIsLoading() : 'unknown',
        hasContainer: !!filesContainer,
        hasFilterButtons: !!filterButtons
    };
};

// Debug function to force file refresh
window.debugForceRefresh = function() {
    console.log('=== FORCING FILE REFRESH ===');
    
    if (typeof loadAllFiles === 'function') {
        console.log('Calling loadAllFiles()...');
        loadAllFiles().then(files => {
            console.log('loadAllFiles completed, got', files.length, 'files');
            
            // Force UI refresh
            if (typeof window.refreshFilesDisplay === 'function') {
                console.log('Calling refreshFilesDisplay()...');
                window.refreshFilesDisplay();
                console.log('refreshFilesDisplay completed');
            } else {
                console.log('refreshFilesDisplay function not available');
            }
        }).catch(error => {
            console.error('loadAllFiles failed:', error);
        });
    } else {
        console.log('loadAllFiles function not available');
    }
    
    console.log('============================');
};

// Debug function to test upload functionality
window.debugTestUpload = function() {
    console.log('=== TESTING UPLOAD FUNCTIONALITY ===');
    
    // Create a simple test file
    const testContent = 'Debug test file created at ' + new Date().toISOString();
    const testFile = new File([testContent], 'debug-test.txt', { type: 'text/plain' });
    
    console.log('Created test file:', testFile.name, testFile.size, 'bytes');
    
    const formData = new FormData();
    formData.append('file', testFile);
    formData.append('uploadId', 'debug_test_' + Date.now());
    formData.append('customName', testFile.name);
    
    console.log('Attempting upload...');
    
    return fetch('/upload', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${getAuthToken ? getAuthToken() : 'missing-token'}`
        },
        body: formData
    })
    .then(response => {
        console.log('Upload response status:', response.status);
        return response.json();
    })
    .then(result => {
        console.log('Upload result:', result);
        
        if (result.success) {
            console.log('✅ Upload successful!');
            console.log('File ID:', result.file?.id);
            console.log('File URL:', result.file?.fileUrl);
            
            // Force refresh after upload
            setTimeout(() => {
                console.log('Forcing refresh after test upload...');
                window.debugForceRefresh();
            }, 1000);
        } else {
            console.error('❌ Upload failed:', result.error);
        }
        
        return result;
    })
    .catch(error => {
        console.error('❌ Upload error:', error);
        return { success: false, error: error.message };
    });
};

// Debug function to check server endpoints
window.debugCheckEndpoints = function() {
    console.log('=== CHECKING SERVER ENDPOINTS ===');
    
    const endpoints = [
        '/api/files/all',
        '/api/ipfs/files',
        '/api/ipfs/status'
    ];
    
    const token = getAuthToken ? getAuthToken() : null;
    
    const results = {};
    
    const checkEndpoint = async (endpoint) => {
        try {
            console.log(`Checking ${endpoint}...`);
            const response = await fetch(endpoint, {
                headers: token ? { 'Authorization': `Bearer ${token}` } : {}
            });
            
            const data = await response.json();
            
            results[endpoint] = {
                status: response.status,
                ok: response.ok,
                data: data
            };
            
            console.log(`${endpoint}: ${response.status} ${response.ok ? '✅' : '❌'}`);
            if (endpoint === '/api/files/all' && data.files) {
                console.log(`  - Files count: ${data.files.length}`);
            }
            if (endpoint === '/api/ipfs/files' && data.files) {
                console.log(`  - IPFS files count: ${data.files.length}`);
            }
        } catch (error) {
            console.error(`${endpoint}: Error -`, error.message);
            results[endpoint] = { error: error.message };
        }
    };
    
    return Promise.all(endpoints.map(checkEndpoint)).then(() => {
        console.log('=== ENDPOINT CHECK COMPLETE ===');
        console.log('Results summary:', results);
        return results;
    });
};

// Debug function to clear all cached data
window.debugClearCache = function() {
    console.log('=== CLEARING ALL CACHED DATA ===');
    
    // Clear localStorage
    localStorage.removeItem('files-data');
    localStorage.removeItem('app-toasts');
    console.log('✅ Cleared localStorage');
    
    // Clear UI state if functions are available
    if (typeof setFiles === 'function') {
        setFiles([]);
        console.log('✅ Cleared files state');
    }
    
    // Clear UI display
    const filesContainer = document.getElementById('files-display-container');
    if (filesContainer) {
        filesContainer.innerHTML = '<div class="text-center py-8">Cache cleared. Loading...</div>';
        console.log('✅ Cleared UI display');
    }
    
    console.log('Cache cleared. Run debugForceRefresh() to reload.');
};

// Debug function to simulate file upload without actual file
window.debugSimulateUpload = function() {
    console.log('=== SIMULATING FILE UPLOAD ===');
    
    const fakeFileData = {
        id: 'debug-' + Date.now(),
        name: 'debug-file.txt',
        originalName: 'debug-file.txt',
        mimeType: 'text/plain',
        mimetype: 'text/plain',
        size: 123,
        url: '/debug/fake-file.txt',
        fileUrl: '/debug/fake-file.txt',
        timestamp: Date.now(),
        uploadedAt: Date.now(),
        verified: true,
        storageType: 'local-only',
        source: 'debug'
    };
    
    console.log('Creating fake file data:', fakeFileData);
    
    // Add to localStorage
    let currentFiles = [];
    try {
        const stored = localStorage.getItem('files-data');
        if (stored) {
            currentFiles = JSON.parse(stored);
        }
    } catch (e) {
        console.warn('Error reading current files:', e);
    }
    
    currentFiles.push(fakeFileData);
    localStorage.setItem('files-data', JSON.stringify(currentFiles));
    
    // Update state if available
    if (typeof setFiles === 'function') {
        setFiles(currentFiles);
    }
    
    console.log('✅ Fake file added to storage and state');
    
    // Trigger refresh
    setTimeout(() => {
        if (typeof window.refreshFilesDisplay === 'function') {
            window.refreshFilesDisplay();
            console.log('✅ UI refreshed');
        }
    }, 100);
    
    return fakeFileData;
};

console.log('🐛 Debug functions loaded:');
console.log('- window.debugFileState() - Check current file state');
console.log('- window.debugForceRefresh() - Force file list refresh');
console.log('- window.debugTestUpload() - Test file upload functionality');
console.log('- window.debugCheckEndpoints() - Check server endpoints');
console.log('- window.debugClearCache() - Clear all cached data');
console.log('- window.debugSimulateUpload() - Add fake file for testing');

// Auto-run debug when script loads
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('🐛 File debug script loaded. Available functions:');
        console.log('   - window.debugFileState() - Check current file state');
        console.log('   - window.debugForceRefresh() - Force refresh files');
        console.log('   - window.debugAPIEndpoints() - Test API endpoints');
    });
} 