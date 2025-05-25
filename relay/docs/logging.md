# Shogun Relay Logging System

This project uses Winston for advanced logging capabilities. The logging system provides a structured way to log messages with different severity levels, formats them consistently, and outputs them to different destinations.

## Features

- **Multiple Transport Options**: Logs are sent to both the console and log files
- **Log Rotation**: Daily log files with automatic rotation and cleanup
- **Structured Logging**: JSON-formatted logs for easier parsing and analysis
- **Separate Error Logs**: Critical errors are stored in dedicated files
- **Module-Specific Logging**: Different modules use their own loggers for better organization
- **Custom Log Levels**: Standard log levels plus custom emoji indicators

## Log Directories

Logs are stored in the `logs` directory at the project root, with different files based on type:

- `application-YYYY-MM-DD.log`: General application logs
- `error-YYYY-MM-DD.log`: Error-only logs
- `backup-YYYY-MM-DD.log`: Backup-specific logs

## Using the Logger

Import the appropriate module logger based on what component you're working with:

```javascript
import { serverLogger, ipfsLogger, gunLogger, authLogger, backupLogger } from "./utils/logger.js";

// Use the appropriate logger for your module
serverLogger.info("Server starting up");
ipfsLogger.error("IPFS connection failed", { reason: "timeout" });
gunLogger.debug("Gun database transaction", { id: "123", data: {...} });
authLogger.warn("Auth token about to expire");
backupLogger.info("Backup completed", { size: "15MB", location: "/backups/latest" });
```

## Log Levels

Logs have different severity levels (from highest to lowest priority):

- **error**: For critical errors that need immediate attention
- **warn**: For warnings that don't stop execution but should be noted
- **info**: For general information about application state
- **http**: For HTTP request logs
- **verbose**: For more detailed information
- **debug**: For debugging information (typically disabled in production)
- **silly**: For extremely detailed debugging (rarely used)

## Environment Configuration

The logging level can be controlled via the `LOG_LEVEL` environment variable:

```
LOG_LEVEL=debug node src/index.js  # Shows all logs up to debug level
```

## Module-Specific Loggers

We have specialized loggers for different components:

- `serverLogger`: For general server operations
- `ipfsLogger`: For IPFS-related operations
- `gunLogger`: For GunDB-related operations
- `authLogger`: For authentication-related operations
- `backupLogger`: For backup-related operations (with dedicated log file)

## Creating a New Module Logger

If you need a logger for a new module:

```javascript
import { createModuleLogger } from "./utils/logger.js";

// Create a logger for your new module
const myModuleLogger = createModuleLogger("myModule");

// Use it as with other loggers
myModuleLogger.info("My module initialized");
```

## Log Format

Console logs include colorization and emojis for better readability:
```
[2023-08-15 14:32:45] 🚀 info ✅: Server starting up
[2023-08-15 14:32:47] 📦 error ❌: IPFS connection failed {"reason":"timeout"}
```

File logs maintain a similar format but without colors.

## Adding Winston to a Project

If you need to add Winston to a new project:

```bash
npm install winston winston-daily-rotate-file
``` 