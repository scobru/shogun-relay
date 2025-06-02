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

/**
 * Cambia tema tra dark e light usando DaisyUI
 */
export function toggleTheme() {
  const currentTheme = getTheme();
  const newTheme = currentTheme === "dark" ? "light" : "dark";

  // Aggiorna tema nel localStorage
  localStorage.setItem("app-theme", newTheme);

  // Aggiorna signal del tema
  setTheme(newTheme);

  // Applica tema al document usando DaisyUI
  document.documentElement.setAttribute("data-theme", newTheme);

  showToast(
    `🎨 ${newTheme === "dark" ? "Dark" : "Light"} theme activated`,
    "success",
    2000
  );
}

/**
 * Inizializza il tema al caricamento dell'app usando DaisyUI
 */
export function initTheme() {
  const savedTheme = localStorage.getItem("app-theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  setTheme(savedTheme);
}

/**
 * Initialize the Gun database
 */
export function initGun() {
  try {
    const token = getAuthToken();

    if (!token) {
      console.error("No auth token found. Gun init aborted.");
      return null;
    }

    // Initialize Gun with the current host
    const peers = [window.location.origin + "/gun"];
    console.log(`Initializing Gun with peers: ${peers.join(", ")}`);

    // Create Gun instance with peers and LocalStorage support
    const gun = Gun({
      peers: peers,
      localStorage: false,
      radisk: false, // Disable Radisk to prevent storage issues
    });

    // Store it in the global variable for reuse
    gunInstance = gun;
    window.gunInstance = gun;

    // Set up connection monitoring
    monitorGunConnection(gun);

    // Update server status on initialization
    updateServerStatus();

    return gun;
  } catch (error) {
    console.error(`Error initializing Gun: ${error.message}`);
    return null;
  }
}

/**
 * Setup Gun connection event listeners
 */
function setupGunConnectionListeners() {
  gunInstance.on("hi", (peer) => {
    const currentStatus = getNetworkStatus();
    setNetworkStatus({
      peerCount: currentStatus.peerCount + 1,
      status: "Connected",
    });
    console.log(`Connected to peer:`, peer);

    // Load files when connected
    setTimeout(() => loadFiles(), 1000);
  });

  gunInstance.on("bye", (peer) => {
    const currentStatus = getNetworkStatus();
    const newPeerCount = Math.max(0, currentStatus.peerCount - 1);
    setNetworkStatus({
      peerCount: newPeerCount,
      status: newPeerCount === 0 ? "Disconnected" : "Connected",
    });
    console.log(`Disconnected from peer:`, peer);
  });

  // Force an initial connection attempt
  setTimeout(() => {
    if (getNetworkStatus().status === "Disconnected") {
      gunInstance.get("_").put({ ping: Date.now() });

      // If still disconnected, assume local connection
      if (getNetworkStatus().status === "Disconnected") {
        setNetworkStatus({
          peerCount: 0,
          status: "Connected (Local Only)",
        });

        // Load files with local connection
        loadFiles();
      }
    }
  }, 3000);
}

/**
 * Auth token management functions
 */
export function getAuthToken() {
  return localStorage.getItem("authToken");
}

export function isTokenExpired() {
  const tokenData = getTokenData();
  if (!tokenData || !tokenData.exp) return true;

  // Admin token never expires
  const token = getAuthToken();
  if (token === "thisIsTheTokenForReals") return false;

  return tokenData.exp * 1000 < Date.now();
}

function getTokenData() {
  const token = getAuthToken();
  if (!token) return null;

  // Admin token is always valid
  if (token === "thisIsTheTokenForReals") {
    return {
      exp: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    };
  }

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch (e) {
    console.error("Error parsing token:", e);
    return null;
  }
}

/**
 * Check authentication status
 */
export async function checkAuth() {
  const token = getAuthToken();
  if (!token) {
    setIsAuthenticated(false);
    return false;
  }

  // Admin token is always valid
  if (token === "thisIsTheTokenForReals") {
    setIsAuthenticated(true);
    return true;
  }

  // Check JWT token expiration
  if (token.split(".").length === 3) {
    if (isTokenExpired()) {
      const refreshed = await refreshToken();
      if (!refreshed) {
        localStorage.removeItem("authToken");
        setIsAuthenticated(false);
        return false;
      }
    }
  }

  setIsAuthenticated(true);
  return true;
}

/**
 * Refresh authentication token
 */
export async function refreshToken() {
  try {
    setIsLoading(true);

    const token = getAuthToken();

    // Skip refresh for admin token
    if (token === "thisIsTheTokenForReals") {
      return true;
    }

    // Only try to refresh actual JWT tokens
    if (!token || token.split(".").length !== 3) {
      return true;
    }

    const response = await fetch("/api/auth/refresh-token", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getAuthToken()}`,
      },
    });

    if (!response.ok) {
      throw new Error("Token refresh failed");
    }

    const data = await response.json();
    if (data.token) {
      localStorage.setItem("authToken", data.token);
      showToast("Session renewed", "success");
      return true;
    }
    return false;
  } catch (error) {
    console.error("Error refreshing token:", error);
    showToast("Unable to renew session. Please try logging in again.", "error");
    return false;
  } finally {
    setIsLoading(false);
  }
}

/**
 * Handle user logout
 */
export function handleLogout() {
  try {
    // Remove auth tokens
    localStorage.removeItem("authToken");
    sessionStorage.removeItem("authToken");

    // Show logout message
    showToast("Logout in corso...", "info", 1000);

    // Wait briefly before redirecting
    setTimeout(() => {
      window.location.replace("/login?logout=true");
    }, 500);
  } catch (error) {
    console.error("Errore durante il logout:", error);
    window.location.href = "/login";
  }
}

/**
 * Load all files
 */
export async function loadFiles(searchParams = {}) {
  setIsLoading(true);

  try {
    // Verify authentication
    if (!(await checkAuth())) {
      setIsLoading(false);
      return;
    }

    // Force refresh of files data
    // Use localStorage instead of GunDB to avoid array errors
    localStorage.setItem("files-data", JSON.stringify([]));
    _setFiles([]);

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
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.success) {
      // Support both 'files' and 'results' property names
      const fileArray = data.files || data.results || [];

      // Process files to ensure IPFS files are properly identified
      const processedFiles = fileArray.map((file) => {
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

        return processedFile;
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

      // Handle files as a plain JS array, not through Gun
      // Update state - use a safer way to update the files array
      try {
        // Log the file data for debugging
        console.log(
          `Loaded ${processedFiles.length} files from API (${ipfsFiles.length} IPFS files)`
        );

        // Store files in localStorage first
        localStorage.setItem("files-data", JSON.stringify(processedFiles));

        // Then update state (without triggering GunDB save)
        _setFiles(processedFiles);

        // Update file stats
        updateFileStats(processedFiles);
      } catch (err) {
        console.error("Error updating files:", err);
        // Fallback to direct DOM update if needed
        const fileListEl = document.getElementById("file-list");
        if (fileListEl) {
          fileListEl.innerHTML =
            fileArray.length === 0
              ? '<div class="empty-state">No files found</div>'
              : "";
        }
      }

      if (processedFiles.length === 0) {
        console.warn("No files found");
      }
    } else {
      // Reset files safely
      try {
        localStorage.setItem("files-data", JSON.stringify([]));
        _setFiles([]);
        updateFileStats([]);
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
    } catch (err) {
      console.error("Error resetting files on error:", err);
    }
  } finally {
    setIsLoading(false);
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
  const id = Date.now();
  const newToast = { id, message, type, timestamp: Date.now() };

  // Sistema anti-spam per errori
  if (type === 'error') {
    const now = Date.now();
    const lastTime = lastErrorToastTime.get(message) || 0;
    
    if (now - lastTime < errorToastCooldown) {
      console.log(`Toast error spam blocked: ${message}`);
      return id; // Non mostrare il toast se è troppo recente
    }
    
    lastErrorToastTime.set(message, now);
    
    // Pulizia delle vecchie entries
    for (const [msg, time] of lastErrorToastTime.entries()) {
      if (now - time > errorToastCooldown * 2) {
        lastErrorToastTime.delete(msg);
      }
    }
  }

  try {
    // Get current toasts from localStorage
    let currentToasts = [];
    const storedToasts = localStorage.getItem("app-toasts");
    if (storedToasts) {
      currentToasts = JSON.parse(storedToasts);
    }

    // Limita il numero massimo di toast a 5
    if (currentToasts.length >= 5) {
      currentToasts = currentToasts.slice(-4); // Mantieni solo gli ultimi 4
    }

    // Add new toast
    currentToasts.push(newToast);

    // Save to localStorage (not GunDB)
    localStorage.setItem("app-toasts", JSON.stringify(currentToasts));

    // Update state (without storing in GunDB)
    _setToasts(currentToasts);

    // Auto-remove toast after duration
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
  } catch (err) {
    console.error("Error in showToast:", err);
  }

  return id;
}

/**
 * Remove a toast by ID
 */
function removeToast(id) {
  try {
    // Get current toasts from localStorage
    let currentToasts = [];
    const storedToasts = localStorage.getItem("app-toasts");
    if (storedToasts) {
      currentToasts = JSON.parse(storedToasts);
    }

    // Filter out the toast with the given ID
    const updatedToasts = currentToasts.filter((toast) => toast.id !== id);

    // Save to localStorage
    localStorage.setItem("app-toasts", JSON.stringify(updatedToasts));

    // Update state
    _setToasts(updatedToasts);
  } catch (err) {
    console.error("Error in removeToast:", err);
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

      // First, clear the files array to avoid showing stale data
      // Use localStorage instead of GunDB to avoid array errors
      localStorage.setItem("files-data", JSON.stringify([]));
      _setFiles([]);

      // Wait for a moment to allow the server to process the deletion
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Add a timestamp parameter to avoid caching
      const timestamp = Date.now();
      const refreshUrl = `/files/all?_nocache=${timestamp}`;

      // Force a refresh with cache-busting headers
      const refreshResponse = await fetch(refreshUrl, {
        headers: {
          Authorization: `Bearer ${getAuthToken()}`,
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
        token: getAuthToken(),
      });

      if (refreshResponse.ok) {
        const refreshData = await refreshResponse.json();
        if (refreshData.success) {
          const fileArray = refreshData.files || refreshData.results || [];
          console.log(`Refreshed ${fileArray.length} files after deletion`);

          // Store in localStorage first
          localStorage.setItem("files-data", JSON.stringify(fileArray));

          // Update state without GunDB
          _setFiles(fileArray);

          // Update stats
          updateFileStats(fileArray);
        }
      }

      // Update file list
      loadFiles();
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (error) {
    showToast(`Error deleting file: ${error.message}`, "error");
  } finally {
    setIsLoading(false);
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

    const response = await fetch(
      `/api/network/peers/${encodeURIComponent(peerUrl)}/reconnect`,
      {
        method: "POST",
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
      showToast(`Reconnecting to peer: ${peerUrl}`, "info");

      // Wait a moment then update status
      setTimeout(() => {
        updatePeerStatus();
      }, 2000);

      return true;
    } else {
      throw new Error(data.error || "Unknown error");
    }
  } catch (error) {
    console.error(`Error reconnecting to peer: ${error.message}`);
    showToast(`Failed to reconnect to peer: ${error.message}`, "error");
    return false;
  } finally {
    setIsLoading(false);
  }
}

/**
 * Test connection to a peer without adding it
 */
export async function testPeerConnection(peerUrl) {
  try {
    setIsLoading(true);

    const response = await fetch("/api/network/peers/test", {
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
      showToast(`Peer connection test successful: ${peerUrl}`, "success");
      return { success: true, latency: data.latency };
    } else {
      throw new Error(data.error || "Connection test failed");
    }
  } catch (error) {
    console.error(`Error testing peer connection: ${error.message}`);
    showToast(`Peer connection test failed: ${error.message}`, "error");
    return { success: false, error: error.message };
  } finally {
    setIsLoading(false);
  }
}

// Export signal getters
export { getIsAuthenticated, setIsAuthenticated };
export { getIsLoading, setIsLoading };
export { getActiveTab, setActiveTab };
export { getServerStatus, setServerStatus };
export { getNetworkStatus, setNetworkStatus };
export { getFileStats, setFileStats };
export { getIpfsStatus, setIpfsStatus };
export { getIpfsConnectionStatus, setIpfsConnectionStatus };
export { getTheme, setTheme };
export { getPeers, setPeers };
export { getPeerConnections, setPeerConnections };

// Export toast functions with different names
export const getToasts = _getToasts;
export const setToasts = _setToasts;

// Export files functions with different names  
export const getFiles = _getFiles;
export const setFiles = _setFiles;