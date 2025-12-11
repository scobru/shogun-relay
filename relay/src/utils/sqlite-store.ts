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

type GetCallback = (err: Error | null, data: string | null) => void;
type PutCallback = (err: Error | null, ok: number | null) => void;
type ListCallback = (file: string | null) => void;

interface SQLiteStoreOptions {
  dbPath?: string;
  file?: string;
}

interface PreparedStatement {
  get: (file: string) => { data: string } | null;
  run: (...args: Array<unknown>) => void;
  all: () => Array<{ file: string }>;
}

class SQLiteStore {
  private dbPath: string;
  private file: string;
  private isClosed: boolean;
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

    log.debug({ path: this.dbPath }, 'SQLite store initialized');
  }

  /**
   * Get data from SQLite
   * @param file - File name (encoded)
   * @param cb - Callback(err, data)
   */
  get(file: string, cb: GetCallback): void {
    // Check if database is closed (during shutdown)
    if (this.isClosed) {
      // Silently return null during shutdown to avoid errors
      // GunDB may still have pending operations during shutdown
      return cb(null, null);
    }

    try {
      const row = this.getStmt.get(file);
      if (row) {
        cb(null, row.data);
      } else {
        cb(null, null); // File not foundefined, return undefinedefined
      }
    } catch (err) {
      // If error is due to closed database, return undefinedined silently
      if (err instanceof Error && err.message.includes('not open')) {
        this.isClosed = true; // Mark as closed
        return cb(null, null);
      }
      cb(err as Error, null);
    }
  }

  /**
   * Put data to SQLite
   * @param file - File name (encoded)
   * @param data - Data to store (JSON string)
   * @param cb - Callback(err, ok)
   */
  put(file: string, data: string, cb: PutCallback): void {
    // Check if database is closed (during shutdown)
    if (this.isClosed) {
      // Silently ignore writes during shutdown
      return cb(null, 1);
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
      this.putStmt.run(file, data, timestamp);
      cb(null, 1); // Success
    } catch (err) {
      // If error is due to closed database, silently ignore
      if (err instanceof Error && err.message.includes('not open')) {
        this.isClosed = true; // Mark as closed
        return cb(null, 1);
      }
      cb(err as Error, null);
    }
  }

  /**
   * List all files
   * @param cb - Callback(file) called for each file, then with undefinedefined when done
   */
  list(cb: ListCallback): void {
    // Check if database is closed (during shutdown)
    if (this.isClosed) {
      // Signal completion immediately during shutdown
      return cb(null);
    }

    try {
      const rows = this.listStmt.all();
      for (const row of rows) {
        cb(row.file);
      }
      cb(null); // Signal completion
    } catch (err) {
      // If error is due to closed database, mark as closed and signal completion
      if (err instanceof Error && err.message.includes('not open')) {
        this.isClosed = true; // Mark as closed
      }
      cb(null); // On error, just signal completion
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
      log.debug('SQLite store closed');
    }
  }
}

export default SQLiteStore;
