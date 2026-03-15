import type { DatabaseAdapter, MigrationRecord } from './types.js'

/**
 * Manages the migration tracking table in the database.
 */
export class MigrationTracker {
  constructor(private table: string) {}

  /** Create the tracking table if it doesn't exist */
  async init(db: DatabaseAdapter): Promise<void> {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        id VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        checksum VARCHAR(64)
      )
    `)
  }

  /** Get list of applied migration IDs, ordered */
  async getApplied(db: DatabaseAdapter): Promise<string[]> {
    const rows = await db.query(
      `SELECT id FROM ${this.table} ORDER BY id ASC`,
    ) as { id: string }[]

    return rows.map(r => r.id)
  }

  /** Get full migration records with timestamps and checksums */
  async getRecords(db: DatabaseAdapter): Promise<MigrationRecord[]> {
    const rows = await db.query(
      `SELECT id, applied_at, checksum FROM ${this.table} ORDER BY id ASC`,
    ) as MigrationRecord[]

    return rows
  }

  /** Record a migration as applied with its checksum */
  async record(db: DatabaseAdapter, id: string, checksum: string): Promise<void> {
    await db.query(
      `INSERT INTO ${this.table} (id, checksum) VALUES ($1, $2)`,
      [id, checksum],
    )
  }

  /** Remove a migration record (for rollback) */
  async remove(db: DatabaseAdapter, id: string): Promise<void> {
    await db.query(
      `DELETE FROM ${this.table} WHERE id = $1`,
      [id],
    )
  }

  /** Acquire an advisory lock to prevent concurrent migrations */
  async lock(db: DatabaseAdapter): Promise<void> {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ${this.table}_lock (
        id INTEGER PRIMARY KEY,
        locked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        locked_by VARCHAR(255)
      )
    `)

    const rows = await db.query(
      `SELECT id FROM ${this.table}_lock`,
    ) as { id: number }[]

    if (rows.length > 0) {
      throw new Error('Migration lock is held by another process. If this is stale, run with --force or remove the lock manually.')
    }

    await db.query(
      `INSERT INTO ${this.table}_lock (id, locked_by) VALUES (1, $1)`,
      [`pid:${process.pid}`],
    )
  }

  /** Release the advisory lock */
  async unlock(db: DatabaseAdapter): Promise<void> {
    await db.query(
      `DELETE FROM ${this.table}_lock WHERE id = 1`,
    )
  }
}
