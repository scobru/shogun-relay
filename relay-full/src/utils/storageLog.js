/**** Optimized storage log adapter ****/

class StorageLog {
  constructor(Gun, gun, options = {}) {
    this.gun = gun;
    this.Gun = Gun;
    this.options = {
      enabled: options.enabled !== false, // Default enabled
      logLevel: options.logLevel || 'info', // 'debug', 'info', 'warn', 'error', 'none'
      maxLogsPerSecond: options.maxLogsPerSecond || 10, // Throttling
      logGets: options.logGets !== false, // Default log GETs
      logPuts: options.logPuts !== false, // Default log PUTs
      useAsyncLogging: options.useAsyncLogging !== false, // Non-blocking logs
      logToFile: options.logToFile || false,
      logFile: options.logFile || 'gun-operations.log',
      ...options
    };

    // Throttling state
    this.logCount = 0;
    this.lastLogReset = Date.now();
    this.logQueue = [];
    this.isProcessingQueue = false;

    if (this.options.enabled) {
      this.init();
    }
  }

  /**
   * Check if we should log based on throttling limits
   */
  shouldLog() {
    const now = Date.now();
    
    // Reset counter every second
    if (now - this.lastLogReset >= 1000) {
      this.logCount = 0;
      this.lastLogReset = now;
    }

    // Check throttling limit
    if (this.logCount >= this.options.maxLogsPerSecond) {
      return false;
    }

    this.logCount++;
    return true;
  }

  /**
   * Process log queue asynchronously to avoid blocking
   */
  async processLogQueue() {
    if (this.isProcessingQueue || this.logQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      while (this.logQueue.length > 0) {
        const logEntry = this.logQueue.shift();
        
        if (this.options.useAsyncLogging) {
          // Use setImmediate to yield control back to event loop
          await new Promise(resolve => setImmediate(resolve));
        }

        // Only log if level is not 'none' and in debug mode
        if (this.options.logLevel !== 'none' && this.options.logLevel === 'debug') {
          console.log(logEntry.message, logEntry.data);
        }

        // Optional file logging
        if (this.options.logToFile) {
          // TODO: Implement file logging if needed
          // fs.appendFileSync(this.options.logFile, JSON.stringify(logEntry) + '\n');
        }
      }
    } catch (error) {
      // Only log errors, not processing info
      if (this.options.logLevel !== 'none') {
        console.error('Error processing log queue:', error);
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Add entry to log queue
   */
  queueLog(type, data) {
    if (!this.options.enabled || !this.shouldLog()) {
      return;
    }

    const logEntry = {
      timestamp: Date.now(),
      type: type,
      message: type === 'GET' ? '**⬅️** GET' : '**➡️** PUT',
      data: data,
    };

    if (this.options.useAsyncLogging) {
      this.logQueue.push(logEntry);
      // Process queue on next tick to avoid blocking
      setImmediate(() => this.processLogQueue());
    } else {
      // Immediate logging only in debug mode
      if (this.options.logLevel === 'debug') {
        console.log(logEntry.message, logEntry.data);
      }
    }
  }

  /**
   * Initialize Gun event listeners
   */
  init() {
    if (!this.options.enabled) {
      return;
    }

    // GET operations logging
    if (this.options.logGets) {
      this.gun.on("get", function (WireMessage) {
        this.to.next(WireMessage);
        
        // Queue the log instead of immediate console.log
        if (this.storageLog) {
          this.storageLog.queueLog('GET', WireMessage.get);
        }
      });
    }

    // PUT operations logging  
    if (this.options.logPuts) {
      this.gun.on("put", function (WireMessage) {
        this.to.next(WireMessage);
        
        // Queue the log instead of immediate console.log
        if (this.storageLog) {
          this.storageLog.queueLog('PUT', WireMessage.put);
        }
      });
    }

    // Store reference to this instance for access in Gun callbacks
    this.gun.storageLog = this;
  }

  /**
   * Update logging options at runtime
   */
  updateOptions(newOptions) {
    this.options = { ...this.options, ...newOptions };
    
    if (!this.options.enabled) {
      this.logQueue = []; // Clear queue if disabled
    }
  }

  /**
   * Get current statistics
   */
  getStats() {
    return {
      enabled: this.options.enabled,
      queueSize: this.logQueue.length,
      logsThisSecond: this.logCount,
      maxLogsPerSecond: this.options.maxLogsPerSecond,
      isProcessingQueue: this.isProcessingQueue,
      options: this.options,
    };
  }

  /**
   * Disable logging temporarily
   */
  disable() {
    this.options.enabled = false;
    this.logQueue = [];
  }

  /**
   * Enable logging
   */
  enable() {
    this.options.enabled = true;
  }
}

export default StorageLog;
