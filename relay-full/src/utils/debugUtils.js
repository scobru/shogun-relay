/**
 * Debug utilities for Shogun application
 * Based on the specification in shogun-panpot/debug-command
 */

/**
 * Handles the debug command (/debug) by collecting browser diagnostics
 * using MPC server tools.
 */
class DebugUtils {
  /**
   * Process debug command in a browser context
   * @param {Function} messageCallback - Function to add messages to UI
   * @returns {Promise<void>}
   */
  static async processDebugCommand(messageCallback) {
    try {
      console.log("Debug command detected, collecting diagnostics...");
      
      // Add status messages to the UI via callback
      messageCallback("Debug: Running diagnostics...");
      
      // Check if the MPC server is available
      if (typeof window === 'undefined' || typeof window.__MPCServer === 'undefined') {
        messageCallback("Debug: MPC server not available. Cannot collect diagnostics.");
        return;
      }
      
      // Take a screenshot of the current page state
      messageCallback("Debug: Taking screenshot...");
      await window.__MPCServer.call("takeScreenshot", { random_string: "debug_command" });
      
      // Collect console logs
      messageCallback("Debug: Collecting console logs...");
      await window.__MPCServer.call("getConsoleLogs", { random_string: "debug_command" });
      
      // Collect console errors
      messageCallback("Debug: Checking for console errors...");
      await window.__MPCServer.call("getConsoleErrors", { random_string: "debug_command" });
      
      // Collect network logs
      messageCallback("Debug: Collecting network logs...");
      await window.__MPCServer.call("getNetworkLogs", { random_string: "debug_command" });
      
      // Complete the debug process
      messageCallback("Debug: Diagnostics complete. Results have been sent to the server.");
      
    } catch (error) {
      console.error("Error during debug command execution:", error);
      messageCallback("Debug: Error running diagnostics: " + error.message);
    }
  }

  /**
   * Check if a message is a debug command
   * @param {string} message - The message to check
   * @returns {boolean} True if the message is a debug command
   */
  static isDebugCommand(message) {
    return message === "/debug";
  }
}

// For CommonJS environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DebugUtils;
}

// For browser environments
if (typeof window !== 'undefined') {
  window.DebugUtils = DebugUtils;
}

export default DebugUtils; 