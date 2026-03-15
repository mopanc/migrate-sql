import { readFileSync } from 'node:fs'
import type { DatabaseAdapter, MigrationConfig, MigrationResult, MigrationStatus } from './types.js'
import { scanMigrations } from './scanner.js'
import { MigrationTracker } from './tracker.js'

const DEFAULT_TABLE = '_migrations'

export function createMigrator(config: MigrationConfig) {
  const table = config.table ?? DEFAULT_TABLE
  const tracker = new MigrationTracker(table)

  return {
    /**
     * Run all pending migrations in order.
     */
    async up(db: DatabaseAdapter): Promise<MigrationResult> {
      await tracker.init(db)

      const all = scanMigrations(config.directory)
      const applied = await tracker.getApplied(db)
      const appliedSet = new Set(applied)

      const pending = all.filter(m => !appliedSet.has(m.id))
      const result: MigrationResult = { applied: [], skipped: [] }

      for (const migration of pending) {
        const sql = readFileSync(migration.upPath, 'utf-8')
        await db.query(sql)
        await tracker.record(db, migration.id)
        result.applied.push(migration.id)
      }

      return result
    },

    /**
     * Rollback the most recently applied migration.
     */
    async down(db: DatabaseAdapter): Promise<MigrationResult> {
      await tracker.init(db)

      const applied = await tracker.getApplied(db)
      const result: MigrationResult = { applied: [], skipped: [] }

      if (applied.length === 0) {
        return result
      }

      const lastId = applied[applied.length - 1]
      const all = scanMigrations(config.directory)
      const migration = all.find(m => m.id === lastId)

      if (!migration) {
        throw new Error(`Migration "${lastId}" not found in directory`)
      }

      if (!migration.downPath) {
        throw new Error(`Migration "${lastId}" has no .down.sql file`)
      }

      const sql = readFileSync(migration.downPath, 'utf-8')
      await db.query(sql)
      await tracker.remove(db, lastId)
      result.applied.push(lastId)

      return result
    },

    /**
     * Get the current migration status.
     */
    async status(db: DatabaseAdapter): Promise<MigrationStatus> {
      await tracker.init(db)

      const all = scanMigrations(config.directory)
      const applied = await tracker.getApplied(db)
      const appliedSet = new Set(applied)

      return {
        applied,
        pending: all.filter(m => !appliedSet.has(m.id)).map(m => m.id),
      }
    },
  }
}
