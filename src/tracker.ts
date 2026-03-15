import type { DatabaseAdapter } from './types.js'

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
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

  /** Record a migration as applied */
  async record(db: DatabaseAdapter, id: string): Promise<void> {
    await db.query(
      `INSERT INTO ${this.table} (id) VALUES ($1)`,
      [id],
    )
  }

  /** Remove a migration record (for rollback) */
  async remove(db: DatabaseAdapter, id: string): Promise<void> {
    await db.query(
      `DELETE FROM ${this.table} WHERE id = $1`,
      [id],
    )
  }
}
