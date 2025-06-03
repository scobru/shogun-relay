import {
  init,
  setSignal,
  setEffect,
  setMemo,
  h,
  Fragment,
  auth,
  logout,
  getNamespace,
} from "./nodom.js";

// Global state signals
const [getIsAuthenticated, setIsAuthenticated] = setSignal(false, {
  key: "auth-status",
});
const [getIsLoading, setIsLoading] = setSignal(false, {
  key: "loading-status",
});
const [getActiveTab, setActiveTab] = setSignal("files", { key: "active-tab" });
const [_getToasts, _setToasts] = setSignal([], {
  key: "toast-notifications",
  bypass: true,
});
const [getServerStatus, setServerStatus] = setSignal(
  { status: "Unknown", port: "8765" },
  { key: "server-status" }
);
const [getNetworkStatus, setNetworkStatus] = setSignal(
  { peerCount: 0, status: "Disconnected" },
  { key: "network-status" }
);
const [getFileStats, setFileStats] = setSignal(
  { count: 0, totalSize: 0 },
  { key: "file-stats" }
);
const [_getFiles, _setFiles] = setSignal([], {
  key: "files-data",
  bypass: true,
});
const [getIpfsStatus, setIpfsStatus] = setSignal(
  { enabled: false, service: "IPFS-CLIENT" },
  { key: "ipfs-status" }
);
const [getIpfsConnectionStatus, setIpfsConnectionStatus] = setSignal(
  { status: "unknown", message: "Unknown" },
  { key: "ipfs-connection-status" }
);
// Tema signal
const [getTheme, setTheme] = setSignal(
  localStorage.getItem("app-theme") || "light",
  { key: "app-theme" }
);

// Network and peer management signals
const [getPeers, setPeers] = setSignal([], {
  key: "network-peers",
  bypass: true,
});
const [getPeerConnections, setPeerConnections] = setSignal(
  {},
  { key: "peer-connections", bypass: true }
);

// Debouncing per evitare richieste multiple
let networkUpdateTimeout = null;
let networkTabActive = false;

// Sistema per evitare spam di toast di errore
let lastErrorToastTime = new Map();
const errorToastCooldown = 5000; // 5 secondi tra errori simili

// Keep track of the last IPFS check time to prevent too many calls
let lastIpfsCheckTime = 0;
const ipfsCheckDebounceTime = 5000; // 5 seconds minimum between checks
let ipfsCheckInProgress = false;

// Store gun instance globally for reuse
let gunInstance = null;

// Track if event listeners are already set up
let eventListenersSetup = false;

// Initialize debug module
if (typeof window !== "undefined" && !window.shogunDebug) {
  window.shogunDebug = {
    logs: [],
    errors: [],
    initialized: true,
  };

  // Capture console logs
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;

  console.log = function (...args) {
    window.shogunDebug.logs.push({
      type: "log",
      timestamp: new Date().toISOString(),
      message: args
        .map((arg) =>
          typeof arg === "object" ? JSON.stringify(arg) : String(arg)
        )
        .join(" "),
    });
    originalConsoleLog.apply(console, args);
  };

  console.error = function (...args) {
    window.shogunDebug.errors.push({
      type: "error",
      timestamp: new Date().toISOString(),
      message: args
        .map((arg) =>
          typeof arg === "object" ? JSON.stringify(arg) : String(arg)
        )
        .join(" "),
    });
    originalConsoleError.apply(console, args);
  };

  console.log("Debug module initialized");
}

// Throttling for file loading to prevent duplicates
let isLoadingFiles = false;
let loadFilesTimeout = null;
let lastLoadRequest = 0;
let lastLoadedFileCount = 0; // Track file count to detect unnecessary updates

/**
 * Initialize event listeners for file management - called once
 */
function initializeFileEventListeners() {
  if (eventListenersSetup) {
    console.log('[Events] File event listeners already set up, skipping');
    return;
  }
  
  console.log('[Events] Setting up file event listeners');
  
  // Listen for custom filesUpdated events to update UI
  document.addEventListener('filesUpdated', (event) => {
    console.log('[Events] Files updated event received:', event.detail);
    // UI updates are handled by individual components
  });
  
  // Listen for tab changes to refresh files if needed
  document.addEventListener('tabChanged', (event) => {
    console.log('[Events] Tab changed event received:', event.detail);
    if (event.detail.tab === 'files') {
      // Small delay to allow UI to render
      setTimeout(() => {
        const currentFiles = getFiles();
        if (currentFiles.length === 0) {
          console.log('[Events] Files tab activated with no files, loading...');
          loadFiles();
        }
      }, 100);
    }
  });
  
  // Listen for storage changes (for multi-tab sync)
  window.addEventListener('storage', (event) => {
    if (event.key === 'files-data' && event.newValue) {
      try {
        const newFiles = JSON.parse(event.newValue);
        if (Array.isArray(newFiles)) {
          console.log('[Events] Files updated from another tab, syncing...');
          _setFiles(newFiles);
          updateFileStats(newFiles);
        }
      } catch (err) {
        console.error('[Events] Error syncing files from storage:', err);
      }
    }
  });
  
  eventListenersSetup = true;
  console.log('[Events] File event listeners setup complete');
}

/**
 * Load all files - improved with better duplicate prevention
 */
export async function loadFiles(searchParams = {}) {
  const now = Date.now();
  
  // Enhanced duplicate prevention with time-based throttling
  if (isLoadingFiles || getIsLoading()) {
    console.log("[LoadFiles] Already loading, skipping duplicate call");
    return;
  }
  
  // Prevent rapid successive calls (less than 1 second apart)
  if (now - lastLoadRequest < 1000) {
    console.log("[LoadFiles] Request too soon after last one, throttling");
    return;
  }
  
  lastLoadRequest = now;
  
  // Clear any pending load timeout
  if (loadFilesTimeout) {
    clearTimeout(loadFilesTimeout);
    loadFilesTimeout = null;
  }
  
  isLoadingFiles = true;
  setIsLoading(true);
  
  console.log(`[LoadFiles] Starting file load at ${new Date().toISOString()}`);

  try {
    // Verify authentication
    if (!(await checkAuth())) {
      setIsLoading(false);
      isLoadingFiles = false;
      return;
    }

    // Get current files for comparison to prevent unnecessary updates
    const currentFiles = getFiles();
    const currentFileIds = currentFiles.map(f => f.id).sort();

    // Construct URL with search parameters
    let url = "/files/all";
    if (Object.keys(searchParams).length > 0) {
      const queryParams = new URLSearchParams();
      for (const key in searchParams) {
        if (searchParams[key]) {
          queryParams.append(key, searchParams[key]);
        }
      }
      url = `/files/search?${queryParams.toString()}`;
    }

    // Add timestamp to prevent caching
    url += (url.includes("?") ? "&" : "?") + "_t=" + Date.now();

    const token = getAuthToken();
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      // Support both 'files' and 'results' property names
      const fileArray = data.files || data.results || [];

      // Enhanced debug logging
      console.log("DEBUG: Raw API response:", data);
      console.log("DEBUG: File array length:", fileArray.length);
      console.log("DEBUG: First few files:", fileArray.slice(0, 3));

      // Process files to ensure IPFS files are properly identified and remove duplicates
      const processedFiles = [];
      const seenIds = new Set();
      const seenContent = new Map(); // Track by content to detect duplicates
      
      console.log(`[LoadFiles] Processing ${fileArray.length} files from API...`);
      
      fileArray.forEach((file, index) => {
        if (!file || typeof file !== 'object') {
          console.warn(`[LoadFiles] Skipping invalid file at index ${index}:`, file);
          return;
        }
        
        // Skip if we've already seen this ID
        if (seenIds.has(file.id)) {
          console.warn(`[LoadFiles] Skipping duplicate file ID: ${file.id}`);
          return;
        }
        
        // Create content signature for duplicate detection
        const contentSignature = `${file.originalName || file.name}_${file.size}_${file.mimetype || file.mimeType}`;
        
        // Check for content duplicates
        if (seenContent.has(contentSignature)) {
          const existingFile = seenContent.get(contentSignature);
          console.warn(`[LoadFiles] Found content duplicate: ${file.id} matches ${existingFile.id}`);
          
          // Keep the file with the higher timestamp
          const newTimestamp = parseInt(file.timestamp || file.uploadedAt || 0);
          const existingTimestamp = parseInt(existingFile.timestamp || existingFile.uploadedAt || 0);
          
          if (newTimestamp > existingTimestamp) {
            // Remove the older file from processed files
            const oldIndex = processedFiles.findIndex(f => f.id === existingFile.id);
            if (oldIndex !== -1) {
              processedFiles.splice(oldIndex, 1);
              seenIds.delete(existingFile.id);
              console.log(`[LoadFiles] Replacing older duplicate ${existingFile.id} with ${file.id}`);
            }
          } else {
            console.log(`[LoadFiles] Keeping existing file ${existingFile.id}, skipping ${file.id}`);
            return; // Skip this duplicate
          }
        }
        
        // Create a clean processed file with all fields preserved
        const processedFile = { ...file };

        // Make sure IPFS hash is properly set
        if (file.ipfsHash) {
          console.log(
            `File with IPFS hash found: ${file.id}, hash: ${file.ipfsHash}`
          );

          // Ensure URL points to IPFS when a hash is available
          const ipfsGateway = getIpfsStatus().gateway || "https://ipfs.io/ipfs";
          processedFile.ipfsUrl =
            file.ipfsUrl || `${ipfsGateway}/${file.ipfsHash}`;
        }

        processedFiles.push(processedFile);
        seenIds.add(file.id);
        seenContent.set(contentSignature, processedFile);
      });

      // Debug log file entries with IPFS data
      const ipfsFiles = processedFiles.filter((file) => file.ipfsHash);
      if (ipfsFiles.length > 0) {
        console.log(
          `Found ${ipfsFiles.length} files with IPFS hashes:`,
          ipfsFiles.map((f) => ({
            id: f.id,
            name: f.originalName,
            hash: f.ipfsHash,
          }))
        );
      } else {
        console.warn(
          "No files with IPFS hashes found. This could be normal if no files have been uploaded to IPFS."
        );
      }

      // Check if files have actually changed before updating
      const newFileIds = processedFiles.map(f => f.id).sort();
      const hasChanged = JSON.stringify(currentFileIds) !== JSON.stringify(newFileIds);
      
      // Also check if the count is the same to avoid unnecessary updates
      const countChanged = processedFiles.length !== lastLoadedFileCount;
      
      if (!hasChanged && !countChanged && processedFiles.length === currentFiles.length) {
        console.log("[LoadFiles] No changes detected, skipping update");
        return;
      }

      // Handle files as a plain JS array, not through Gun
      // Update state - use a safer way to update the files array
      try {
        // Log the file data for debugging
        console.log(
          `[LoadFiles] Updating files: ${processedFiles.length} unique files from API (${ipfsFiles.length} IPFS files)`
        );
        console.log(`[LoadFiles] Previous count: ${lastLoadedFileCount}, New count: ${processedFiles.length}`);

        // Store files in localStorage first
        localStorage.setItem("files-data", JSON.stringify(processedFiles));

        // Then update state (without triggering GunDB save)
        _setFiles(processedFiles);
        
        // Update the file count tracker
        lastLoadedFileCount = processedFiles.length;

        // Update file stats
        updateFileStats(processedFiles);
        
        // Trigger UI update
        const event = new CustomEvent('filesUpdated', { detail: { files: processedFiles } });
        document.dispatchEvent(event);
        
        console.log(`[LoadFiles] Successfully updated ${processedFiles.length} files`);
        
      } catch (err) {
        console.error("Error updating files:", err);
        // Fallback to direct DOM update if needed
        const fileListEl = document.getElementById("file-list");
        if (fileListEl) {
          fileListEl.innerHTML =
            processedFiles.length === 0
              ? '<div class="empty-state">No files found</div>'
              : "";
        }
      }

      if (processedFiles.length === 0) {
        console.warn("No files found after processing");
        lastLoadedFileCount = 0;
      }
    } else {
      // Reset files safely
      try {
        localStorage.setItem("files-data", JSON.stringify([]));
        _setFiles([]);
        updateFileStats([]);
        lastLoadedFileCount = 0;
      } catch (err) {
        console.error("Error resetting files:", err);
      }
      console.warn("API returned success: false");
    }
  } catch (error) {
    console.error(`Error loading files: ${error.message}`);
    showToast(`Failed to load files: ${error.message}`, "error");

    // Reset files on error
    try {
      localStorage.setItem("files-data", JSON.stringify([]));
      _setFiles([]);
      updateFileStats([]);
      lastLoadedFileCount = 0;
    } catch (err) {
      console.error("Error resetting files on error:", err);
    }
  } finally {
    setIsLoading(false);
    isLoadingFiles = false;
    console.log(`[LoadFiles] Completed file load at ${new Date().toISOString()}`);
  }
}

/**
 * Update file statistics
 */
function updateFileStats(files) {
  let totalSize = 0;
  files.forEach((file) => {
    totalSize += parseInt(file.size || 0);
  });

  setFileStats({
    count: files.length,
    totalSize,
  });
}

/**
 * Format file size
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

/**
 * Show toast notification with spam protection
 */
export function showToast(message, type = "info", duration = 5000) {
  try {
    // Get current toasts from localStorage - ensure it's always an array
    let currentToasts = [];
    try {
      const storedToasts = localStorage.getItem("app-toasts");
      if (storedToasts && storedToasts !== "undefined" && storedToasts.trim() !== "") {
        const parsed = JSON.parse(storedToasts);
        currentToasts = Array.isArray(parsed) ? parsed : [];
      }
    } catch (parseError) {
      console.warn("Error parsing stored toasts in showToast, resetting:", parseError);
      localStorage.removeItem("app-toasts");
      currentToasts = [];
    }

    // Create toast object
    const toast = {
      id: Date.now() + Math.random(),
      message,
      type,
      timestamp: Date.now(),
    };

    // Prevent spam for similar error messages within a short timeframe
    const recentSimilarToast = currentToasts.find(
      (t) =>
        t.message === message &&
        Date.now() - t.timestamp < 2000 && // Within 2 seconds
        t.type === type
    );

    if (recentSimilarToast && type === "error") {
      console.log("Toast error spam blocked:", message);
      return; // Don't show duplicate error messages quickly
    }

    // Remove old toasts (keep only last 10)
    if (currentToasts.length >= 10) {
      currentToasts = currentToasts.slice(-9); // Keep last 9, add 1 new = 10 total
    }

    // Add new toast
    currentToasts.push(toast);

    // Ensure we always pass an array to setToasts
    if (!Array.isArray(currentToasts)) {
      console.error("Current toasts is not an array, resetting:", currentToasts);
      currentToasts = [toast];
    }

    // Update localStorage and state
    localStorage.setItem("app-toasts", JSON.stringify(currentToasts));
    _setToasts(currentToasts);

    // Auto-remove after duration
    if (duration > 0) {
      setTimeout(() => {
        removeToast(toast.id);
      }, duration);
    }
  } catch (error) {
    console.error("Error in showToast:", error);
    // Fallback: try to show a basic toast
    try {
      const fallbackToast = {
        id: Date.now(),
        message: message || "Unknown message",
        type: type || "info",
        timestamp: Date.now(),
      };
      localStorage.setItem("app-toasts", JSON.stringify([fallbackToast]));
      _setToasts([fallbackToast]);
      
      if (duration > 0) {
        setTimeout(() => {
          removeToast(fallbackToast.id);
        }, duration);
      }
    } catch (fallbackError) {
      console.error("Critical error in toast fallback:", fallbackError);
    }
  }
}

function removeToast(id) {
  try {
    // Get current toasts from localStorage - ensure it's always an array
    let currentToasts = [];
    try {
      const storedToasts = localStorage.getItem("app-toasts");
      if (storedToasts && storedToasts !== "undefined" && storedToasts.trim() !== "") {
        const parsed = JSON.parse(storedToasts);
        currentToasts = Array.isArray(parsed) ? parsed : [];
      }
    } catch (parseError) {
      console.warn("Error parsing stored toasts in removeToast, resetting:", parseError);
      localStorage.removeItem("app-toasts");
      currentToasts = [];
    }

    // Filter out the toast with the given ID
    const updatedToasts = currentToasts.filter((toast) => toast && toast.id !== id);

    // Ensure we always pass an array
    if (!Array.isArray(updatedToasts)) {
      console.error("Updated toasts is not an array, resetting:", updatedToasts);
      localStorage.setItem("app-toasts", JSON.stringify([]));
      _setToasts([]);
      return;
    }

    // Save to localStorage and update state
    localStorage.setItem("app-toasts", JSON.stringify(updatedToasts));
    _setToasts(updatedToasts);
  } catch (err) {
    console.error("Error in removeToast:", err);
    // Fallback: clear all toasts
    try {
      localStorage.setItem("app-toasts", JSON.stringify([]));
      _setToasts([]);
    } catch (fallbackError) {
      console.error("Critical error in removeToast fallback:", fallbackError);
    }
  }
}

/**
 * Delete a file
 */
export async function deleteFile(fileId, fileName) {
  try {
    // Verify authentication
    if (!(await checkAuth())) {
      showToast("Authentication required to delete files", "error");
      return;
    }

    // Show confirmation dialog
    if (!confirm(`Are you sure you want to delete "${fileName || fileId}"?`)) {
      return;
    }

    // Show loading
    setIsLoading(true);
    console.log(`[DeleteFile] Starting deletion of file: ${fileId}`);

    const response = await fetch(`/files/${fileId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      showToast("File deleted successfully", "success");
      console.log(`[DeleteFile] File ${fileId} deleted successfully on server`);

      // Force refresh the file list immediately
      await forceRefreshFileList();
      
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (error) {
    console.error(`[DeleteFile] Error deleting file: ${error.message}`);
    showToast(`Error deleting file: ${error.message}`, "error");
  } finally {
    setIsLoading(false);
  }
}

/**
 * Force refresh the file list after deletion or modification
 */
async function forceRefreshFileList() {
  try {
    console.log('[ForceRefresh] Starting forced file list refresh...');
    
    // Clear all local caches first
    localStorage.setItem("files-data", JSON.stringify([]));
    _setFiles([]);
    updateFileStats([]);
    lastLoadedFileCount = 0;
    
    // Clear any pending timeouts to prevent conflicts
    if (loadFilesTimeout) {
      clearTimeout(loadFilesTimeout);
      loadFilesTimeout = null;
    }
    
    // Reset throttling flags temporarily
    const originalLastLoadRequest = lastLoadRequest;
    lastLoadRequest = 0; // Reset to allow immediate load
    
    // Add cache busting parameter
    const cacheBuster = Date.now();
    
    // Directly fetch from server with cache busting
    const token = getAuthToken();
    const response = await fetch(`/files/all?_nocache=${cacheBuster}&_force=true`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        const fileArray = data.files || data.results || [];
        console.log(`[ForceRefresh] Fetched ${fileArray.length} files from server`);

        // Process files to remove duplicates
        const processedFiles = [];
        const seenIds = new Set();
        
        fileArray.forEach((file) => {
          if (file && file.id && !seenIds.has(file.id)) {
            processedFiles.push(file);
            seenIds.add(file.id);
          }
        });

        // Update localStorage and state
        localStorage.setItem("files-data", JSON.stringify(processedFiles));
        _setFiles(processedFiles);
        updateFileStats(processedFiles);
        lastLoadedFileCount = processedFiles.length;

        // Trigger UI update event
        const event = new CustomEvent('filesUpdated', { 
          detail: { files: processedFiles, source: 'forceRefresh' } 
        });
        document.dispatchEvent(event);
        
        console.log(`[ForceRefresh] Successfully refreshed with ${processedFiles.length} files`);
      }
    } else {
      console.error('[ForceRefresh] Server returned error:', response.status);
      // Fallback to loadFiles if direct fetch fails
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay
      lastLoadRequest = 0; // Reset throttling
      await loadFiles();
    }
    
    // Restore original last load request time (but not too restrictive)
    lastLoadRequest = Math.max(originalLastLoadRequest, Date.now() - 2000);
    
  } catch (error) {
    console.error('[ForceRefresh] Error during forced refresh:', error);
    // Fallback to standard loadFiles
    try {
      lastLoadRequest = 0; // Reset throttling for fallback
      await loadFiles();
    } catch (fallbackError) {
      console.error('[ForceRefresh] Fallback refresh also failed:', fallbackError);
    }
  }
}

/**
 * Update IPFS status
 */
export async function updateIpfsStatus() {
  try {
    const response = await fetch("/api/ipfs/status", {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    });

    const data = await response.json();

    if (data.success) {
      setIpfsStatus({
        enabled: data.status.enabled,
        service: data.status.nodeType || "IPFS-CLIENT",
        nodeUrl: data.status.nodeUrl,
        gateway: data.status.gateway || data.status.defaultGateway,
      });

      // Check connection status if IPFS is enabled
      if (data.status.enabled) {
        checkIpfsConnection();
      }
    } else {
      console.error("Error retrieving IPFS status:", data.error);
    }
  } catch (error) {
    console.error(`Error checking IPFS status: ${error.message}`);
  }
}

/**
 * Check IPFS connection
 */
export async function checkIpfsConnection() {
  try {
    // Debounce the check to prevent too many calls
    const now = Date.now();
    if (now - lastIpfsCheckTime < ipfsCheckDebounceTime) {
      console.log(
        `IPFS check debounced. Last check was ${
          (now - lastIpfsCheckTime) / 1000
        }s ago.`
      );
      return getIpfsConnectionStatus(); // Return current status instead of checking again
    }

    // Prevent multiple simultaneous checks
    if (ipfsCheckInProgress) {
      console.log("IPFS check already in progress");
      return getIpfsConnectionStatus();
    }

    // Set flags to prevent concurrent checks
    ipfsCheckInProgress = true;
    lastIpfsCheckTime = now;

    // Show checking status
    const status = {
      status: "checking",
      message: "Checking...",
    };
    setIpfsConnectionStatus(status);

    // First get the current IPFS configuration
    const configResponse = await fetch("/api/ipfs/status", {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
      // Add cache busting to avoid stale responses
      cache: "no-cache",
    }).catch((error) => {
      console.error("Error fetching IPFS status:", error);
      throw new Error("Network error: Could not connect to server");
    });

    if (!configResponse.ok) {
      throw new Error(`Failed to get IPFS status: ${configResponse.status}`);
    }

    const configData = await configResponse.json();
    console.log("Current IPFS configuration:", configData.status);

    // If IPFS is not enabled, update status and return
    if (!configData.status.enabled) {
      const disabledStatus = {
        status: "disabled",
        message: "IPFS disabled",
      };
      setIpfsConnectionStatus(disabledStatus);
      ipfsCheckInProgress = false;
      return disabledStatus;
    }

    // Make API call to check connection health
    try {
      const healthResponse = await fetch("/api/ipfs/health-check", {
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
        // Add timeout to avoid hanging requests
        signal: AbortSignal.timeout(5000),
        // Add cache busting
        cache: "no-cache",
      });

      if (!healthResponse.ok) {
        throw new Error(`Health check API error: ${healthResponse.status}`);
      }

      const healthData = await healthResponse.json();
      console.log("IPFS health check result:", healthData);

      // Process health check result
      let resultStatus;
      if (!healthData.enabled) {
        showToast("IPFS is disabled", "info");
        resultStatus = {
          status: "disabled",
          message: "IPFS disabled",
        };
      } else if (healthData.success) {
        showToast("IPFS connection verified successfully", "success");

        // Log connection details
        if (healthData.health && healthData.health.details) {
          console.log("IPFS connection details:", healthData.health.details);
        }

        resultStatus = {
          status: "connected",
          message: "Connected",
        };
      } else {
        let errorDetails = "";
        if (healthData.health && healthData.health.error) {
          errorDetails = `: ${healthData.health.error}`;
        }

        showToast(`Error in IPFS connection${errorDetails}`, "error");
        console.error("IPFS connection error:", healthData);

        resultStatus = {
          status: "error",
          message: healthData.message || "Connection error",
        };
      }

      setIpfsConnectionStatus(resultStatus);
      ipfsCheckInProgress = false;
      return resultStatus;
    } catch (healthError) {
      console.error("Health check failed:", healthError);

      let resultStatus;
      // Handle possible CORS issues or timeout
      if (
        healthError.name === "AbortError" ||
        healthError.message.includes("ERR_CONNECTION_REFUSED")
      ) {
        showToast(
          "IPFS health check timeout - server might be unreachable",
          "warning"
        );
        resultStatus = {
          status: "error",
          message: "Server unreachable",
        };
      } else {
        showToast(`IPFS health check error: ${healthError.message}`, "error");
        resultStatus = {
          status: "error",
          message: "API error",
        };
      }

      setIpfsConnectionStatus(resultStatus);
      ipfsCheckInProgress = false;
      return resultStatus;
    }
  } catch (error) {
    console.error("IPFS connection check error:", error);

    let message = "Network error";
    if (error.message.includes("ERR_CONNECTION_REFUSED")) {
      message = "Server unreachable";
      showToast("Server connection refused. Is the server running?", "error");
    } else {
      showToast(`IPFS connection check error: ${error.message}`, "error");
    }

    const resultStatus = {
      status: "error",
      message: message,
    };

    setIpfsConnectionStatus(resultStatus);
    ipfsCheckInProgress = false;
    return resultStatus;
  }
}

/**
 * Debug command handler
 */
export async function handleDebugCommand() {
  try {
    // Create a debug object to collect information
    const debugData = {
      timestamp: new Date().toISOString(),
      browser: navigator.userAgent,
      url: window.location.href,
      serverStatus: getServerStatus(),
      ipfsStatus: getIpfsStatus(),
      networkStatus: getNetworkStatus(),
      storage: {},
    };

    // Collect user info if available
    try {
      const token = getAuthToken();
      if (token) {
        const tokenData = getTokenData();
        if (tokenData) {
          debugData.user = {
            id: tokenData.id,
            username: tokenData.username,
            exp: new Date(tokenData.exp * 1000).toISOString(),
            isExpired: isTokenExpired(),
          };
        }
      }
    } catch (e) {
      debugData.userError = e.message;
    }

    // Collect local storage data (excluding sensitive info)
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        // Skip sensitive data
        if (key.includes("token") || key.includes("auth")) continue;

        try {
          const value = localStorage.getItem(key);
          // Try to parse as JSON
          try {
            debugData.storage[key] = JSON.parse(value);
          } catch (e) {
            // Store as string if not JSON
            debugData.storage[key] = value;
          }
        } catch (e) {
          debugData.storage[key] = "[Error reading value]";
        }
      }
    } catch (e) {
      debugData.storageError = e.message;
    }

    // Get console logs from debug module
    debugData.consoleLogs = window.shogunDebug?.logs || [];
    debugData.consoleErrors = window.shogunDebug?.errors || [];

    // Format and display debug info
    console.log("DEBUG DATA:", debugData);

    // Update the log container with debug information
    const logContainer = document.getElementById("log-container");
    if (logContainer) {
      // Clear previous content
      logContainer.innerHTML = "";

      // Add timestamp
      const timestampLine = document.createElement("div");
      timestampLine.className = "log-info";
      timestampLine.textContent = `Debug info collected at ${debugData.timestamp}`;
      logContainer.appendChild(timestampLine);

      // Add debug info
      const infoLines = Object.entries(debugData.storage).map(([key, value]) => {
        const line = document.createElement("div");
        line.className = "log-info";
        line.textContent = `${key}: ${value}`;
        return line;
      });
      infoLines.forEach((line) => logContainer.appendChild(line));
    }
  } catch (error) {
    console.error("Error handling debug command:", error);
    showToast("Error handling debug command", "error");
  }
}

/**
 * Update server status
 */
export async function updateServerStatus() {
  try {
    const response = await fetch("/api/status", {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
        "Cache-Control": "no-cache, no-store, must-revalidate",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Update server status
    setServerStatus({
      status: data.status || "Unknown",
      port: window.location.port || "8765",
      version: data.server?.version || "1.0.0",
      timestamp: data.timestamp,
    });

    console.log("Server status updated:", data);

    return data;
  } catch (error) {
    console.error(`Error updating server status: ${error.message}`);
    setServerStatus({
      status: "Error",
      port: window.location.port || "8765",
      error: error.message,
    });
  }
}

/**
 * Monitor GunDB connection
 * @param {Gun} gun - The Gun instance to monitor
 */
function monitorGunConnection(gun) {
  if (!gun) return;

  // Update network status initially
  setNetworkStatus({
    peerCount: 1, // Local is a peer
    status: "Connected",
  });

  // Set up interval for checking connection
  const connectionCheckInterval = setInterval(() => {
    // Ping Gun to check connection
    const pingRef = gun.get("_ping");
    const timestamp = Date.now();

    pingRef.put({ timestamp }, (ack) => {
      if (ack.err) {
        console.error(`Gun connection error: ${ack.err}`);
        setNetworkStatus({
          peerCount: 0,
          status: "Disconnected",
        });
      } else {
        // Update connection status on successful ping
        setNetworkStatus({
          peerCount: 1, // At least one peer (the server)
          status: "Connected",
        });
      }
    });
  }, 10000); // Check every 10 seconds

  // Clean up interval on page unload
  window.addEventListener("beforeunload", () => {
    clearInterval(connectionCheckInterval);
  });
}

/**
 * Get current peer information with error handling and debouncing
 */
export async function updatePeerStatus() {
  try {
    const response = await fetch("/api/network/peers", {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      // Update peers list
      setPeers(data.peers || []);

      // Update peer connections info
      setPeerConnections(data.peerInfo || {});

      // Update network status
      const connectedPeers = Object.values(data.peerInfo || {}).filter(
        (info) => info.connected
      );
      setNetworkStatus({
        peerCount: connectedPeers.length + 1, // +1 for local
        status: connectedPeers.length > 0 ? "Connected" : "Local Only",
      });

      return data;
    }
  } catch (error) {
    console.error(`Error updating peer status: ${error.message}`);
    
    // Only show toast if it's not a network/server error during startup
    if (!error.message.includes("Failed to fetch") || getServerStatus().status !== "Unknown") {
      showToast(`Failed to update peer status: ${error.message}`, "error");
    }
  }
}

/**
 * Add a new peer to the network
 */
export async function addPeer(peerUrl) {
  try {
    setIsLoading(true);

    // Validate URL format
    if (!peerUrl || !peerUrl.startsWith("http")) {
      throw new Error("Invalid peer URL. Must start with http:// or https://");
    }

    const response = await fetch("/api/network/peers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify({ peer: peerUrl }),
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      showToast(`Peer added successfully: ${peerUrl}`, "success");

      // Update peer status
      await updatePeerStatus();

      // Force Gun instance to connect to new peer
      if (gunInstance) {
        gunInstance.opt({ peers: [peerUrl] });
      }

      return true;
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (error) {
    console.error(`Error adding peer: ${error.message}`);
    showToast(`Failed to add peer: ${error.message}`, "error");
    return false;
  } finally {
    setIsLoading(false);
  }
}

/**
 * Remove a peer from the network
 */
export async function removePeer(peerUrl) {
  try {
    setIsLoading(true);

    const response = await fetch(
      `/api/network/peers/${encodeURIComponent(peerUrl)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      showToast(`Peer removed successfully: ${peerUrl}`, "success");

      // Update peer status
      await updatePeerStatus();

      return true;
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (error) {
    console.error(`Error removing peer: ${error.message}`);
    showToast(`Failed to remove peer: ${error.message}`, "error");
    return false;
  } finally {
    setIsLoading(false);
  }
}

/**
 * Reconnect to a specific peer
 */
export async function reconnectToPeer(peerUrl) {
  try {
    setIsLoading(true);
    showToast(`🔄 Reconnecting to peer: ${peerUrl}`, "info");

    const response = await fetch(
      `/api/network/peers/${encodeURIComponent(peerUrl)}/reconnect`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
        signal: AbortSignal.timeout(20000), // Increased timeout for reconnection
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: Server error`);
    }

    const data = await response.json();

    if (data.success) {
      const latencyInfo = data.latency ? ` (${data.latency}ms)` : '';
      const preTestInfo = data.preTestPassed ? ' ✅' : data.preTestPassed === false ? ' ⚠️' : '';
      
      switch (data.status) {
        case 'connected':
          showToast(`✅ Successfully reconnected to peer${latencyInfo}${preTestInfo}`, "success");
          break;
        case 'connected-unverified':
          showToast(`🟡 Reconnected but verification inconclusive${latencyInfo}${preTestInfo}`, "warning");
          if (data.warning) {
            console.warn(`Verification warning for ${peerUrl}:`, data.warning);
          }
          break;
        default:
          showToast(`🔄 Reconnection initiated${latencyInfo}${preTestInfo}`, "info");
      }

      // Wait a moment then update peer status
      setTimeout(() => {
        updatePeerStatus();
      }, 2000);

      return true;
    } else {
      // Handle failure case with detailed error from backend
      const errorMsg = data.error || "Unknown reconnection error";
      const latencyInfo = data.latency ? ` (${data.latency}ms)` : '';
      const errorTypeInfo = data.errorType ? ` [${data.errorType}]` : '';
      
      // Provide user-friendly messages based on error type
      let userMessage = errorMsg;
      if (data.errorType === 'timeout') {
        userMessage = "Connection timeout - peer may be offline or overloaded";
      } else if (data.errorType === 'dns') {
        userMessage = "DNS resolution failed - check the peer hostname";
      } else if (data.errorType === 'refused') {
        userMessage = "Connection refused - peer is not accepting connections";
      } else if (data.errorType === 'unreachable') {
        userMessage = "Host unreachable - network or firewall issue";
      } else if (data.errorType === 'ssl') {
        userMessage = "SSL certificate error - peer has invalid certificates";
      }
      
      throw new Error(`${userMessage}${latencyInfo}${errorTypeInfo}`);
    }
  } catch (error) {
    console.error(`Error reconnecting to peer:`, error);
    
    // Provide more helpful error messages
    let userMessage = error.message;
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      userMessage = "Reconnection timeout - peer may be offline or unreachable";
    } else if (error.message.includes('NetworkError') || error.message.includes('fetch')) {
      userMessage = "Network error - check your internet connection";
    } else if (error.message.includes('HTTP 500')) {
      userMessage = "Server error during reconnection - please try again";
    } else if (error.message.includes('HTTP 400')) {
      userMessage = "Invalid peer URL format";
    }
    
    showToast(`❌ Failed to reconnect: ${userMessage}`, "error");
    return false;
  } finally {
    setIsLoading(false);
  }
}

/**
 * Test connection to a specific peer
 */
export async function testPeerConnection(peerUrl) {
  try {
    setIsLoading(true);
    showToast(`🔍 Testing connection to: ${peerUrl}`, "info");

    const response = await fetch(
      `/api/network/peers/${encodeURIComponent(peerUrl)}/test`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
        },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: Server error`);
    }

    const data = await response.json();

    if (data.success) {
      const latencyInfo = data.latency ? ` (${data.latency}ms)` : '';
      const methodInfo = data.method ? ` via ${data.method}` : '';
      showToast(`✅ Connection test successful${latencyInfo}${methodInfo}`, "success");
      return {
        success: true,
        method: data.method,
        latency: data.latency,
        status: data.status,
        message: data.message
      };
    } else {
      // Use specific error message from backend
      const errorMsg = data.error || "Unknown connection error";
      const latencyInfo = data.latency ? ` (${data.latency}ms)` : '';
      const methodInfo = data.method ? ` via ${data.method}` : '';
      
      showToast(`❌ Connection test failed${methodInfo}: ${errorMsg}${latencyInfo}`, "error");
      return {
        success: false,
        error: errorMsg,
        errorType: data.errorType,
        method: data.method,
        latency: data.latency,
        details: data.details
      };
    }
  } catch (error) {
    console.error(`Error testing peer connection:`, error);
    
    // Provide more helpful error messages
    let userMessage = error.message;
    if (error.name === 'AbortError' || error.message.includes('timeout')) {
      userMessage = "Test timeout - peer may be offline or unreachable";
    } else if (error.message.includes('NetworkError') || error.message.includes('fetch')) {
      userMessage = "Network error - check your internet connection";
    } else if (error.message.includes('HTTP 500')) {
      userMessage = "Server error - please try again later";
    } else if (error.message.includes('HTTP 400')) {
      userMessage = "Invalid peer URL format";
    }
    
    showToast(`❌ Connection test failed: ${userMessage}`, "error");
    return {
      success: false,
      error: userMessage,
      method: 'client-error',
      originalError: error.message
    };
  } finally {
    setIsLoading(false);
  }
}

/**
 * Pin a file to IPFS
 */
export async function pinFileToIpfs(fileId, ipfsHash) {
  try {
    if (!ipfsHash) {
      // Get file data to extract IPFS hash
      const files = getFiles();
      const file = files.find(f => f.id === fileId);
      if (!file || !file.ipfsHash) {
        showToast("❌ File does not have an IPFS hash", "error");
        return false;
      }
      ipfsHash = file.ipfsHash;
    }
    
    setIsLoading(true);
    showToast("📌 Pinning file to IPFS...", "info");

    const response = await fetch(`/api/ipfs/pin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify({ hash: ipfsHash })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      showToast("✅ File pinned to IPFS successfully!", "success");
      
      // Refresh files to show updated pin status with delay to prevent duplicates
      loadFilesTimeout = setTimeout(() => {
        if (!isLoadingFiles) {
          loadFiles();
        }
      }, 1000);
      
      return true;
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (error) {
    console.error("Error pinning file to IPFS:", error);
    showToast(`❌ Failed to pin file: ${error.message}`, "error");
    return false;
  } finally {
    setIsLoading(false);
  }
}

/**
 * Unpin a file from IPFS
 */
export async function unpinFileFromIpfs(fileId, ipfsHash) {
  try {
    if (!ipfsHash) {
      // Get file data to extract IPFS hash
      const files = getFiles();
      const file = files.find(f => f.id === fileId);
      if (!file || !file.ipfsHash) {
        showToast("❌ File does not have an IPFS hash", "error");
        return false;
      }
      ipfsHash = file.ipfsHash;
    }
    
    setIsLoading(true);
    showToast("📌 Unpinning file from IPFS...", "info");

    const response = await fetch(`/api/ipfs/unpin`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getAuthToken()}`,
      },
      body: JSON.stringify({ hash: ipfsHash })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      showToast("✅ File unpinned from IPFS successfully!", "success");
      
      // Refresh files to show updated pin status with delay to prevent duplicates
      loadFilesTimeout = setTimeout(() => {
        if (!isLoadingFiles) {
          loadFiles();
        }
      }, 1000);
      
      return true;
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (error) {
    console.error("Error unpinning file from IPFS:", error);
    showToast(`❌ Failed to unpin file: ${error.message}`, "error");
    return false;
  } finally {
    setIsLoading(false);
  }
}

/**
 * Check IPFS pin status for a file
 */
export async function checkIpfsPinStatus(ipfsHash) {
  try {
    if (!ipfsHash) {
      return false;
    }
    
    const response = await fetch(`/api/ipfs/pin-status/${ipfsHash}`, {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.success ? data.isPinned : false;
  } catch (error) {
    console.error("Error checking IPFS pin status:", error);
    return false;
  }
}

/**
 * Toggle between light and dark theme
 */
export function toggleTheme() {
  const currentTheme = getTheme();
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  
  // Update theme state
  setTheme(newTheme);
  
  // Update localStorage
  localStorage.setItem('app-theme', newTheme);
  
  // Apply theme to document
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', newTheme);
    
    // Also update the body class for additional theme support
    document.body.className = document.body.className.replace(/theme-\w+/g, '');
    document.body.classList.add(`theme-${newTheme}`);
  }
  
  console.log(`Theme switched to: ${newTheme}`);
  showToast(`🎨 Theme changed to ${newTheme} mode`, 'success', 2000);
}

/**
 * Initialize GunDB instance with proper configuration
 */
export function initGun() {
  if (gunInstance) {
    console.log('[GunDB] Using existing Gun instance');
    return gunInstance;
  }

  try {
    // Check if Gun is available globally (loaded via CDN)
    if (typeof Gun === 'undefined') {
      throw new Error('Gun library not loaded. Make sure gun.js is included via script tag.');
    }

    console.log('[GunDB] Initializing Gun instance...');

    // Initialize Gun with proper configuration
    const gun = new Gun({
      // Use current server as peer
      peers: [
        'http://localhost:8765/gun'
      ],
      radisk: false,
      localStorage: false,
    });

    // Store globally for access from other parts of the app
    gunInstance = gun;
    if (typeof window !== 'undefined') {
      window.gunInstance = gun;
    }

    // Set up connection monitoring
    monitorGunConnection(gun);

    // Test initial connection
    gun.get('_test').put({ 
      timestamp: Date.now(),
      message: 'Gun initialization test' 
    }, (ack) => {
      if (ack.err) {
        console.warn('[GunDB] Initial test failed:', ack.err);
      } else {
        console.log('[GunDB] Initial connection test successful');
      }
    });

    console.log('[GunDB] Gun instance initialized successfully');
    showToast('🔫 GunDB connected successfully', 'success', 3000);

    return gun;

  } catch (error) {
    console.error('[GunDB] Failed to initialize Gun:', error);
    showToast(`❌ GunDB initialization failed: ${error.message}`, 'error');
    
    // Return a mock object to prevent crashes
    return {
      get: () => ({ put: () => {}, on: () => {}, val: () => {} }),
      put: () => {},
      on: () => {},
      opt: () => {}
    };
  }
}

/**
 * Get the current Gun instance
 */
export function getGunInstance() {
  return gunInstance;
}

/**
 * Initialize theme on app startup
 */
export function initializeTheme() {
  const savedTheme = localStorage.getItem('app-theme') || 'light';
  setTheme(savedTheme);
  
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', savedTheme);
    document.body.classList.add(`theme-${savedTheme}`);
  }
  
  console.log(`Theme initialized: ${savedTheme}`);
}

/**
 * Alias for initializeTheme for backwards compatibility
 */
export const initTheme = initializeTheme;

// Export state getters and setters for use in other modules
export { 
  getIsAuthenticated, 
  setIsAuthenticated,
  getIsLoading,
  setIsLoading,
  getActiveTab,
  setActiveTab,
  getToasts,
  setToasts,
  getServerStatus,
  setServerStatus,
  getNetworkStatus,
  setNetworkStatus,
  getFileStats,
  setFileStats,
  getFiles,
  setFiles,
  getIpfsStatus,
  setIpfsStatus,
  getIpfsConnectionStatus,
  setIpfsConnectionStatus,
  getTheme,
  setTheme,
  getPeers,
  setPeers,
  getPeerConnections,
  setPeerConnections,
  initializeFileEventListeners,
  forceRefreshFileList
};

// Internal file management functions (not exported)
function getFiles() {
  try {
    const storedFiles = localStorage.getItem("files-data");
    if (!storedFiles || storedFiles === "undefined" || storedFiles.trim() === "") {
      return [];
    }
    const parsed = JSON.parse(storedFiles);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Error getting files:", err);
    // Clear corrupted data
    localStorage.removeItem("files-data");
    return [];
  }
}

function setFiles(files) {
  try {
    if (!Array.isArray(files)) {
      console.warn("setFiles called with non-array:", files);
      files = [];
    }
    localStorage.setItem("files-data", JSON.stringify(files));
    _setFiles(files);
  } catch (err) {
    console.error("Error setting files:", err);
  }
}

// Internal toast management functions (not exported separately - use the ones from export above)
function getToasts() {
  try {
    const storedToasts = localStorage.getItem("app-toasts");
    if (!storedToasts || storedToasts === "undefined" || storedToasts.trim() === "") {
      return [];
    }
    const parsed = JSON.parse(storedToasts);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("Error getting toasts:", err);
    // Clear corrupted data
    localStorage.removeItem("app-toasts");
    return [];
  }
}

function setToasts(toasts) {
  try {
    if (!Array.isArray(toasts)) {
      console.warn("setToasts called with non-array:", toasts);
      toasts = [];
    }
    localStorage.setItem("app-toasts", JSON.stringify(toasts));
    _setToasts(toasts);
  } catch (err) {
    console.error("Error setting toasts:", err);
  }
}

/**
 * Get authentication token from localStorage
 */
export function getAuthToken() {
  return localStorage.getItem('authToken');
}

/**
 * Check if user is authenticated
 */
export async function checkAuth() {
  const token = getAuthToken();
  if (!token) {
    console.log('[Auth] No token found');
    setIsAuthenticated(false);
    return false;
  }

  try {
    const response = await fetch('/check-websocket', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const isValid = response.ok;
    setIsAuthenticated(isValid);
    
    if (!isValid) {
      console.log('[Auth] Token validation failed');
      // Remove invalid token
      localStorage.removeItem('authToken');
      sessionStorage.removeItem('shogunSession');
    }
    
    return isValid;
  } catch (error) {
    console.error('[Auth] Token verification error:', error);
    setIsAuthenticated(false);
    return false;
  }
}

/**
 * Handle user logout
 */
export function handleLogout() {
  localStorage.removeItem('authToken');
  sessionStorage.removeItem('shogunSession');
  sessionStorage.removeItem('loginTime');
  setIsAuthenticated(false);
  
  showToast('👋 Logged out successfully', 'info');
  
  // Redirect to login page after a brief delay
  setTimeout(() => {
    window.location.href = '/login';
  }, 1000);
}

/**
 * Check if token is expired (basic implementation)
 */
export function isTokenExpired() {
  const loginTime = sessionStorage.getItem('loginTime');
  if (!loginTime) return true;
  
  const now = Date.now();
  const tokenAge = now - parseInt(loginTime);
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  
  return tokenAge > maxAge;
}

/**
 * Get token data (basic implementation)
 */
export function getTokenData() {
  const token = getAuthToken();
  if (!token) return null;
  
  const loginTime = sessionStorage.getItem('loginTime');
  return {
    id: 'user',
    username: 'relay-user',
    exp: loginTime ? Math.floor((parseInt(loginTime) + 24 * 60 * 60 * 1000) / 1000) : 0,
    loginTime: loginTime
  };
}

// Debug function to check upload status
window.debugUploadStatus = function() {
    console.log('=== UPLOAD DEBUG STATUS ===');
    console.log('isUploadInProgress:', isUploadInProgress);
    console.log('isRefreshingAfterUpload:', isRefreshingAfterUpload);
    console.log('uploadClickTimeout:', uploadClickTimeout);
    console.log('recentUploads size:', recentUploads.size);
    console.log('recentUploads entries:', Array.from(recentUploads.entries()));
    console.log('getIsLoading():', getIsLoading());
    
    const uploadBtn = document.getElementById('upload-submit');
    if (uploadBtn) {
        console.log('Upload button disabled:', uploadBtn.disabled);
        console.log('Upload button text:', uploadBtn.textContent);
    }
    console.log('=========================');
    
    return {
        isUploadInProgress,
        isRefreshingAfterUpload,
        uploadClickTimeout,
        recentUploadsCount: recentUploads.size,
        isSystemLoading: getIsLoading()
    };
};

// Debug function to check file state
window.debugFileState = function() {
    console.log('=== FILE STATE DEBUG ===');
    const files = getFiles();
    const localStorageFiles = localStorage.getItem('files-data');
    
    console.log('Files from getFiles():', files.length);
    console.log('Files from localStorage:', localStorageFiles ? JSON.parse(localStorageFiles).length : 'null');
    console.log('lastLoadedFileCount:', lastLoadedFileCount);
    console.log('isLoadingFiles:', isLoadingFiles);
    console.log('lastLoadRequest:', new Date(lastLoadRequest).toLocaleString());
    
    console.log('First 3 files from getFiles():');
    files.slice(0, 3).forEach((file, i) => {
        console.log(`  ${i}: ${file.id} - ${file.originalName || file.name}`);
    });
    
    console.log('File list container state:');
    const fileListContainer = document.getElementById('file-list');
    if (fileListContainer) {
        console.log('  lastFileIds:', fileListContainer.dataset.lastFileIds);
        console.log('  updating:', fileListContainer.dataset.updating);
        console.log('  children count:', fileListContainer.children.length);
    }
    
    console.log('=======================');
    
    return {
        filesCount: files.length,
        localStorageCount: localStorageFiles ? JSON.parse(localStorageFiles).length : 0,
        lastLoadedFileCount,
        isLoadingFiles,
        lastLoadRequest: new Date(lastLoadRequest).toLocaleString()
    };
};

// Force refresh function for emergency cases
window.forceFileRefresh = async function() {
    console.log('🚨 EMERGENCY: Forcing file refresh');
    try {
        await forceRefreshFileList();
        console.log('✅ Emergency refresh completed');
        return true;
    } catch (error) {
        console.error('❌ Emergency refresh failed:', error);
        return false;
    }
};

/**
 * Initialize peer status and load configured peers from server
 */
export async function initializePeers() {
  try {
    console.log('[Peers] Initializing peer connections...');
    
    // Update peer status to get the current configured peers
    await updatePeerStatus();
    
    const peers = getPeers();
    console.log(`[Peers] Loaded ${peers.length} configured peers:`, peers);
    
    if (peers.length > 0) {
      showToast(`🌐 Loaded ${peers.length} configured Gun relays`, 'info', 3000);
      
      // Validate peer configuration and provide suggestions
      const validation = validatePeerConfiguration(peers);
      if (validation.warnings.length > 0) {
        console.warn('[Peers] Configuration warnings:', validation.warnings);
        validation.warnings.forEach(warning => {
          showToast(`⚠️ ${warning}`, 'warning', 8000);
        });
      }
      if (validation.suggestions.length > 0) {
        console.info('[Peers] Configuration suggestions:', validation.suggestions);
      }
      
      // Initialize peer monitoring system
      await initializePeerMonitoring();
    } else {
      console.log('[Peers] No peers configured in server config');
      showToast('⚠️ No peers configured - running in offline mode', 'warning', 5000);
    }
    
    return true;
  } catch (error) {
    console.error('[Peers] Failed to initialize peers:', error);
    showToast('❌ Failed to load peer configuration', 'error');
    return false;
  }
}

/**
 * Initialize peer monitoring system
 */
export async function initializePeerMonitoring() {
  try {
    // Get current peer status
    await updatePeerStatus();
    
    // Set up periodic peer health checks
    setInterval(async () => {
      try {
        await checkPeerHealth();
      } catch (error) {
        console.warn('Peer health check failed:', error);
      }
    }, 30000); // Check every 30 seconds
    
    console.log('[Peers] Peer monitoring system initialized');
  } catch (error) {
    console.error('[Peers] Failed to initialize peer monitoring:', error);
  }
}

/**
 * Check health of all configured peers
 */
async function checkPeerHealth() {
  try {
    const response = await fetch('/api/network/status', {
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.peers && Array.isArray(data.peers)) {
      const disconnectedPeers = data.peers.filter(peer => !peer.connected);
      
      // If we have disconnected peers, try to reconnect to them
      if (disconnectedPeers.length > 0) {
        console.log(`[Peers] Found ${disconnectedPeers.length} disconnected peers`);
        
        // Don't spam reconnections - only try once every few minutes
        const now = Date.now();
        const reconnectInterval = 5 * 60 * 1000; // 5 minutes
        
        for (const peer of disconnectedPeers) {
          const lastReconnectKey = `last_reconnect_${btoa(peer.url || peer.peer)}`;
          const lastReconnect = parseInt(localStorage.getItem(lastReconnectKey) || '0');
          
          if (now - lastReconnect > reconnectInterval) {
            console.log(`[Peers] Auto-reconnecting to ${peer.url || peer.peer}`);
            localStorage.setItem(lastReconnectKey, now.toString());
            
            // Don't await - let it run in background
            reconnectToPeer(peer.url || peer.peer).catch(error => {
              console.warn(`[Peers] Auto-reconnect failed for ${peer.url || peer.peer}:`, error.message);
            });
          }
        }
      }
    }
  } catch (error) {
    // Don't log as error - health checks can fail normally
    console.debug('[Peers] Health check failed:', error.message);
  }
}

/**
 * Validate and suggest improvements for peer configuration
 */
export function validatePeerConfiguration(peers) {
  const suggestions = [];
  const warnings = [];
  
  if (!peers || peers.length === 0) {
    warnings.push('No peers configured - the application will work offline only');
    suggestions.push('Add at least one reliable peer for data synchronization');
    return { suggestions, warnings };
  }
  
  // Check for peer diversity
  const domains = new Set();
  const protocols = new Set();
  
  peers.forEach(peer => {
    try {
      const url = new URL(peer.url || peer);
      domains.add(url.hostname);
      protocols.add(url.protocol);
    } catch (error) {
      warnings.push(`Invalid peer URL: ${peer.url || peer}`);
    }
  });
  
  if (domains.size === 1) {
    suggestions.push('Consider adding peers from different domains for better redundancy');
  }
  
  if (protocols.size === 1) {
    const protocol = Array.from(protocols)[0];
    if (protocol === 'ws:') {
      suggestions.push('Consider adding HTTPS/WSS peers for secure connections');
    }
  }
  
  if (peers.length === 1) {
    suggestions.push('Add more peers for better network resilience');
  }
  
  if (peers.length > 10) {
    warnings.push('Too many peers may cause performance issues');
    suggestions.push('Consider reducing to 3-5 reliable peers');
  }
  
  return { suggestions, warnings };
}