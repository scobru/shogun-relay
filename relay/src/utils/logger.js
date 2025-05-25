import winston from 'winston';
import 'winston-daily-rotate-file';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

// Get directory name (ESM equivalent of __dirname)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.resolve(__dirname, '../../../logs');

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Define log levels with emojis
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6
};

// Define level colors
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'blue',
  silly: 'gray'
};

// Define level emojis
const levelEmojis = {
  error: '❌',
  warn: '⚠️',
  info: '✅',
  http: '🌐',
  verbose: '📋',
  debug: '🔍',
  silly: '🤪',
  ipfs: '📦',
  gun: '🔫',
  auth: '🔑',
  backup: '💾',
  server: '🚀'
};

// Add colors to winston
winston.addColors(colors);

// Custom format with emojis and colors
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
    const moduleEmoji = levelEmojis[module] || '🔷';
    const levelEmoji = levelEmojis[level] || '';
    
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = JSON.stringify(meta, null, 2);
    }
    
    return `[${timestamp}] ${moduleEmoji} ${level} ${levelEmoji}: ${message} ${metaStr}`;
  })
);

// File format without colors
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, module, ...meta }) => {
    const moduleEmoji = levelEmojis[module] || '🔷';
    const levelEmoji = levelEmojis[level] || '';
    
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = JSON.stringify(meta, null, 2);
    }
    
    return `[${timestamp}] ${moduleEmoji} ${level} ${levelEmoji}: ${message} ${metaStr}`;
  })
);

// Create file transports
const fileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOGS_DIR, 'application-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '14d',
  format: fileFormat
});

const errorFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOGS_DIR, 'error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '20m',
  maxFiles: '30d',
  level: 'error',
  format: fileFormat
});

// Special backup transport that logs to a separate file
const backupFileTransport = new winston.transports.DailyRotateFile({
  filename: path.join(LOGS_DIR, 'backup-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  maxSize: '10m',
  maxFiles: '30d',
  format: fileFormat
});

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: winston.format.json(),
  defaultMeta: { service: 'shogun-relay' },
  transports: [
    fileTransport,
    errorFileTransport,
    new winston.transports.Console({
      format: consoleFormat
    })
  ],
  exitOnError: false
});

// Create specialized backup logger with the additional transport
const backupLoggerInstance = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: winston.format.json(),
  defaultMeta: { service: 'shogun-relay', module: 'backup' },
  transports: [
    fileTransport,
    errorFileTransport,
    backupFileTransport, // Special transport just for backups
    new winston.transports.Console({
      format: consoleFormat
    })
  ],
  exitOnError: false
});

// Create log stream for Express
logger.stream = {
  write: (message) => {
    logger.http(message.trim());
  }
};

// Helper functions to log with module context
export const createModuleLogger = (module) => {
  // Special case for backup module
  if (module === 'backup') {
    return {
      error: (message, meta = {}) => backupLoggerInstance.error(message, { ...meta }),
      warn: (message, meta = {}) => backupLoggerInstance.warn(message, { ...meta }),
      info: (message, meta = {}) => backupLoggerInstance.info(message, { ...meta }),
      http: (message, meta = {}) => backupLoggerInstance.http(message, { ...meta }),
      verbose: (message, meta = {}) => backupLoggerInstance.verbose(message, { ...meta }),
      debug: (message, meta = {}) => backupLoggerInstance.debug(message, { ...meta }),
      silly: (message, meta = {}) => backupLoggerInstance.silly(message, { ...meta })
    };
  }
  
  // Regular module loggers
  return {
    error: (message, meta = {}) => logger.error(message, { module, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { module, ...meta }),
    info: (message, meta = {}) => logger.info(message, { module, ...meta }),
    http: (message, meta = {}) => logger.http(message, { module, ...meta }),
    verbose: (message, meta = {}) => logger.verbose(message, { module, ...meta }),
    debug: (message, meta = {}) => logger.debug(message, { module, ...meta }),
    silly: (message, meta = {}) => logger.silly(message, { module, ...meta })
  };
};

// Create specialized loggers for different modules
export const serverLogger = createModuleLogger('server');
export const ipfsLogger = createModuleLogger('ipfs');
export const gunLogger = createModuleLogger('gun');
export const authLogger = createModuleLogger('auth');
export const backupLogger = createModuleLogger('backup');

// Export the winston logger instance
export default logger;
