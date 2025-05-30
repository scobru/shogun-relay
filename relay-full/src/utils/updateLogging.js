#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Updates the codebase to use the new Winston-based logger
 * This script is meant to be run once to migrate console.log to the new logger
 */
async function updateLogging() {
  try {
    console.log('Updating codebase to use Winston logger...');
    
    // Get paths to files to update
    const indexJsPath = path.resolve(__dirname, '../index.js');
    
    // Read the index.js file
    let indexContent = fs.readFileSync(indexJsPath, 'utf8');
    
    // Add the import for logger at the top of the file
    if (!indexContent.includes('import { serverLogger, ipfsLogger, gunLogger, authLogger } from "./utils/logger.js";')) {
      // Find the last import statement
      const lastImportIndex = indexContent.lastIndexOf('import');
      const endOfImportIndex = indexContent.indexOf(';', lastImportIndex) + 1;
      
      // Insert our import after the last import
      const beforeImports = indexContent.substring(0, endOfImportIndex);
      const afterImports = indexContent.substring(endOfImportIndex);
      
      indexContent = `${beforeImports}
import { serverLogger, ipfsLogger, gunLogger, authLogger } from "./utils/logger.js";
${afterImports}`;
    }
    
    // Replace console.log with appropriate logger
    // Server related logs
    indexContent = indexContent.replace(/console\.log\(\s*("|\`)(\*\*🚀\*\*|\*\*☑️\*\*)\s*\[Server\]/g, 'serverLogger.info(');
    indexContent = indexContent.replace(/console\.log\(\s*("|\`)(\*\*🚀\*\*|\*\*☑️\*\*)/g, 'serverLogger.info(');
    
    // Error logs
    indexContent = indexContent.replace(/console\.error\(\s*("|\`)(\*\*❌\*\*)\s*\[Server\]/g, 'serverLogger.error(');
    indexContent = indexContent.replace(/console\.error\(\s*("|\`)(\*\*❌\*\*)/g, 'serverLogger.error(');
    
    // Warning logs
    indexContent = indexContent.replace(/console\.warn\(\s*("|\`)(\*\*⚠️\*\*)/g, 'serverLogger.warn(');
    
    // IPFS related logs
    indexContent = indexContent.replace(/console\.log\(\s*("|\`)(.*IPFS)/g, 'ipfsLogger.info($1');
    
    // GunDB related logs
    indexContent = indexContent.replace(/console\.log\(\s*("|\`)(.*Gun)/g, 'gunLogger.info($1');
    indexContent = indexContent.replace(/console\.log\(\s*("|\`)(.*GUNDB)/g, 'gunLogger.info($1');
    
    // Auth related logs
    indexContent = indexContent.replace(/console\.log\(\s*("|\`)(.*Authentication)/g, 'authLogger.info($1');
    
    // Generic console logs (convert remaining ones)
    indexContent = indexContent.replace(/console\.log\(/g, 'serverLogger.info(');
    indexContent = indexContent.replace(/console\.error\(/g, 'serverLogger.error(');
    indexContent = indexContent.replace(/console\.warn\(/g, 'serverLogger.warn(');
    
    // Save the updated file
    fs.writeFileSync(`${indexJsPath}.updated`, indexContent);
    console.log(`Updated index.js saved as ${indexJsPath}.updated`);
    console.log('Please review the changes before replacing the original file.');
    
    // Provide instructions
    console.log('\nTo apply the changes:');
    console.log(`1. Review the changes in ${indexJsPath}.updated`);
    console.log(`2. If satisfied, run: mv ${indexJsPath}.updated ${indexJsPath}`);
    console.log('3. Restart the server');
    
  } catch (error) {
    console.error('Error updating logging:', error);
  }
}

// Run the update if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  updateLogging();
}

export default updateLogging; 