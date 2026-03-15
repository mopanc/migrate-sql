/**
 * Database adapter interface. Users provide their own implementation
 * wrapping their preferred database client (pg, better-sqlite3, mysql2, etc.).
 */
export interface DatabaseAdapter {
  /** Execute a SQL statement and return rows (if any) */
  query(sql: string, params?: unknown[]): Promise<unknown[]>
}

export interface MigrationConfig {
  /** Path to the directory containing .sql migration files */
  directory: string
  /** Name of the tracking table. Default: '_migrations' */
  table?: string
}

export interface MigrationFile {
  /** Migration number extracted from filename (e.g., 1 from 001_create_users) */
  number: number
  /** Migration name (e.g., 'create_users') */
  name: string
  /** Full identifier (e.g., '001_create_users') */
  id: string
  /** Absolute path to the .up.sql file */
  upPath: string
  /** Absolute path to the .down.sql file, if it exists */
  downPath: string | null
}

export interface MigrationRecord {
  id: string
  applied_at: string
}

export interface MigrationStatus {
  applied: string[]
  pending: string[]
}

export interface MigrationResult {
  applied: string[]
  skipped: string[]
}
