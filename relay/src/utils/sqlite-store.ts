/**
 * SQLite Store Adapter for Gun Radisk
 * 
 * Implements the store interface required by radisk:
 * - get(file, cb): Read data from SQLite
 * - put(file, data, cb): Write data to SQLite
 * - list(cb): List all files (optional)
 */

import Database from 'better-sqlite3';
import { loggers } from './logger';
import path from 'path';
import fs from 'fs';

const log = loggers.sqlite;

type GetCallback = (err: mb<Error>, data: mb<str>) => void;
type PutCallback = (err: mb<Error>, ok: mb<num>) => void;
type ListCallback = (file: mb<str>) => void;

interface SQLiteStoreOptions {
  dbPath?: str;
  file?: str;
}

interface PreparedStatement {
  get: (file: str) => mb<{ data: str }>;
  run: (...args: arr<unknown>) => void;
  all: () => arr<{ file: str }>;
}

class SQLiteStore {
  private dbPath: str;
  private file: str;
  private isClosed: bool;
  private db: Database.Database;
  private getStmt: PreparedStatement;
  private putStmt: PreparedStatement;
  private listStmt: PreparedStatement;
  private deleteStmt: PreparedStatement;

  constructor(options: SQLiteStoreOptions = {}) {
    this.dbPath = options.dbPath || path.join(process.cwd(), 'data', 'gun.db');
    this.file = options.file || 'radata';
    this.isClosed = false; // Track if database is closed

    // Ensure data directory exists
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    // Initialize SQLite database
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL'); // Better performance for concurrent reads

    // Create table for storing radisk files
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS radisk_files (
        file TEXT PRIMARY KEY NOT NULL,
        data TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
      
      CREATE INDEX IF NOT EXISTS idx_radisk_files_updated ON radisk_files(updated_at);
    `);

    // Prepared statements for better performance
    this.getStmt = this.db.prepare('SELECT data FROM radisk_files WHERE file = ?') as unknown as PreparedStatement;
    // Use unixepoch() for timestamp (SQLite 3.38+) or fallback to strftime with single quotes
    // Calculate timestamp in JavaScript to avoid SQL string literal issues
    this.putStmt = this.db.prepare('INSERT OR REPLACE INTO radisk_files (file, data, updated_at) VALUES (?, ?, ?)') as unknown as PreparedStatement;
    this.listStmt = this.db.prepare('SELECT file FROM radisk_files ORDER BY file') as unknown as PreparedStatement;
    this.deleteStmt = this.db.prepare('DELETE FROM radisk_files WHERE file = ?') as unknown as PreparedStatement;

    log.info({ path: this.dbPath }, 'SQLite store initialized');
  }

  /**
   * Get data from SQLite
   * @param file - File name (encoded)
   * @param cb - Callback(err, data)
   */
  get(file: str, cb: GetCallback): void {
    // Check if database is closed (during shutdown)
    if (this.isClosed) {
      // Silently return null during shutdown to avoid errors
      // GunDB may still have pending operations during shutdown
      return cb(und, und);
    }

    try {
      const row = this.getStmt.get(file);
      if (row) {
        cb(und, row.data);
      } else {
        cb(und, und); // File not found, return undefined
      }
    } catch (err) {
      // If error is due to closed database, return undefined silently
      if (err instanceof Error && err.message.includes('not open')) {
        this.isClosed = true; // Mark as closed
        return cb(und, und);
      }
      cb(err as Error, und);
    }
  }

  /**
   * Put data to SQLite
   * @param file - File name (encoded)
   * @param data - Data to store (JSON string)
   * @param cb - Callback(err, ok)
   */
  put(file: str, data: str, cb: PutCallback): void {
    // Check if database is closed (during shutdown)
    if (this.isClosed) {
      // Silently ignore writes during shutdown
      return cb(und, 1);
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
      this.putStmt.run(file, data, timestamp);
      cb(und, 1); // Success
    } catch (err) {
      // If error is due to closed database, silently ignore
      if (err instanceof Error && err.message.includes('not open')) {
        this.isClosed = true; // Mark as closed
        return cb(und, 1);
      }
      cb(err as Error, und);
    }
  }

  /**
   * List all files
   * @param cb - Callback(file) called for each file, then with undefined when done
   */
  list(cb: ListCallback): void {
    // Check if database is closed (during shutdown)
    if (this.isClosed) {
      // Signal completion immediately during shutdown
      return cb(und);
    }

    try {
      const rows = this.listStmt.all();
      for (const row of rows) {
        cb(row.file);
      }
      cb(und); // Signal completion
    } catch (err) {
      // If error is due to closed database, mark as closed and signal completion
      if (err instanceof Error && err.message.includes('not open')) {
        this.isClosed = true; // Mark as closed
      }
      cb(und); // On error, just signal completion
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db && !this.isClosed) {
      // Mark as closed first to prevent new operations
      this.isClosed = true;
      this.db.close();
      log.info('SQLite store closed');
    }
  }
}

export default SQLiteStore;
