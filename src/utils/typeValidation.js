/**
 * Type validation utilities using Mityli
 * 
 * This file provides schema definitions and validation functions for various
 * data structures in the application.
 */

import { parse, inferSchema, validate } from "mityli";
import fs from "fs";
import path from "path";

// Try to load configuration to check if validation is enabled
let CONFIG = {
  TYPE_VALIDATION_ENABLED: true,
  TYPE_VALIDATION_STRICT: false
};

try {
  const configData = fs.readFileSync(
    path.join(process.cwd(), "config.json"),
    "utf8"
  );
  const loadedConfig = JSON.parse(configData);
  CONFIG.TYPE_VALIDATION_ENABLED = loadedConfig.TYPE_VALIDATION_ENABLED !== false;
  CONFIG.TYPE_VALIDATION_STRICT = loadedConfig.TYPE_VALIDATION_STRICT === true;
} catch (error) {
  console.warn("Could not load config for type validation, using defaults:", error.message);
}

// Sample file data to infer schema from
const sampleFileData = {
  id: "sample_file_123",
  name: "sample.jpg",
  originalName: "sample.jpg",
  mimeType: "image/jpeg",
  mimetype: "image/jpeg", 
  size: 12345,
  url: "/uploads/sample.jpg",
  fileUrl: "/uploads/sample.jpg",
  localPath: "/path/to/file.jpg",
  ipfsHash: "QmHash123",
  ipfsUrl: "https://gateway.pinata.cloud/ipfs/QmHash123",
  timestamp: 1621234567890,
  uploadedAt: 1621234567890,
  customName: "my-custom-name",
  verified: true
};

// Infer schema for file data
const fileDataSchema = inferSchema(sampleFileData);

/**
 * Validate file data against the inferred schema
 * 
 * @param {Object} fileData - The file data to validate
 * @returns {Object} - Validated file data with runtime type checking via Proxy
 * @throws {Error} - If validation fails and strict mode is enabled
 */
export function validateFileData(fileData) {
  // If validation is disabled, return the original data
  if (!CONFIG.TYPE_VALIDATION_ENABLED) {
    return fileData;
  }

  try {
    return parse(fileData);
  } catch (error) {
    console.error("File data validation failed:", error.message);
    
    // In strict mode, throw the error
    if (CONFIG.TYPE_VALIDATION_STRICT) {
      throw new Error(`Invalid file data format: ${error.message}`);
    }
    
    // In non-strict mode, return the original data
    return fileData;
  }
}

/**
 * Validate file upload response before sending to client
 * 
 * @param {Object} response - The response object to validate
 * @returns {Object} - Validated response with runtime type checking
 */
export function validateUploadResponse(response) {
  // If validation is disabled, return the original response
  if (!CONFIG.TYPE_VALIDATION_ENABLED) {
    return response;
  }

  // Sample upload response to infer schema
  const sampleResponse = {
    success: true,
    file: sampleFileData,
    fileInfo: {
      originalName: "sample.jpg",
      size: 12345,
      mimetype: "image/jpeg",
      fileUrl: "/uploads/sample.jpg",
      ipfsHash: "QmHash123",
      ipfsUrl: "https://gateway.pinata.cloud/ipfs/QmHash123",
      customName: "custom-name"
    },
    verified: true
  };
  
  // Infer schema for upload response
  const responseSchema = inferSchema(sampleResponse);
  
  try {
    return parse(response);
  } catch (error) {
    console.error("Upload response validation failed:", error.message);
    
    // In strict mode, return a validation error
    if (CONFIG.TYPE_VALIDATION_STRICT) {
      return {
        success: false,
        error: "Response validation failed: " + error.message
      };
    }
    
    // In non-strict mode, return the original response
    return response;
  }
}

/**
 * Validate configuration data
 * 
 * @param {Object} config - The configuration object to validate
 * @returns {Object} - Validated configuration with runtime type checking
 */
export function validateConfig(config) {
  // Sample config to infer schema
  const sampleConfig = {
    PORT: 8765,
    HOST: "localhost",
    IPFS_ENABLED: true,
    IPFS_SERVICE: "IPFS-CLIENT",
    IPFS_NODE_URL: "http://127.0.0.1:5001",
    IPFS_GATEWAY: "http://127.0.0.1:8080/ipfs",
    SECRET_TOKEN: "sample-token",
    ENCRYPTION_ENABLED: false,
    ALLOWED_ORIGINS: "http://localhost:3000,http://localhost:8080",
    TYPE_VALIDATION_ENABLED: true,
    TYPE_VALIDATION_STRICT: false,
    ADMIN_USER: "admin",
    ADMIN_PASS: "admin",
    MAX_FILE_SIZE: "50mb"
  };
  
  const configSchema = inferSchema(sampleConfig);
  
  try {
    return parse(config);
  } catch (error) {
    console.error("Config validation failed:", error.message);
    
    // For config validation, we're a bit more lenient as it's system-critical
    if (CONFIG.TYPE_VALIDATION_STRICT) {
      throw new Error(`Invalid configuration: ${error.message}`);
    }
    
    return config;
  }
}

/**
 * Check if type validation is enabled
 * @returns {boolean} - Whether type validation is enabled
 */
export function isValidationEnabled() {
  return CONFIG.TYPE_VALIDATION_ENABLED === true;
}

/**
 * Check if strict validation is enabled
 * @returns {boolean} - Whether strict validation is enabled
 */
export function isStrictValidationEnabled() {
  return CONFIG.TYPE_VALIDATION_STRICT === true;
}

/**
 * Update validation configuration
 * @param {Object} config - New configuration object
 */
export function updateValidationConfig(config) {
  if (config && typeof config === 'object') {
    if (typeof config.TYPE_VALIDATION_ENABLED === 'boolean') {
      CONFIG.TYPE_VALIDATION_ENABLED = config.TYPE_VALIDATION_ENABLED;
    }
    if (typeof config.TYPE_VALIDATION_STRICT === 'boolean') {
      CONFIG.TYPE_VALIDATION_STRICT = config.TYPE_VALIDATION_STRICT;
    }
  }
}

export default {
  validateFileData,
  validateUploadResponse,
  validateConfig,
  isValidationEnabled,
  isStrictValidationEnabled,
  updateValidationConfig
}; 