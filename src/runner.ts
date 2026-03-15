import { readFileSync } from 'node:fs'
import type {
  DatabaseAdapter,
  DryRunResult,
  MigrationConfig,
  MigrationInfo,
  MigrationResult,
  MigrationStatus,
  ValidationResult,
} from './types.js'
import { scanMigrations } from './scanner.js'
import { MigrationTracker } from './tracker.js'
import { checksumFile } from './checksum.js'

const DEFAULT_TABLE = '_migrations'

export function createMigrator(config: MigrationConfig) {
  const table = config.table ?? DEFAULT_TABLE
  const tracker = new MigrationTracker(table)

  return {
    /**
     * Run all pending migrations in order.
     * Acquires a lock to prevent concurrent execution.
     */
    async up(db: DatabaseAdapter): Promise<MigrationResult> {
      await tracker.init(db)
      await tracker.lock(db)

      try {
        const all = scanMigrations(config.directory)
        const applied = await tracker.getApplied(db)
        const appliedSet = new Set(applied)

        const pending = all.filter(m => !appliedSet.has(m.id))
        const result: MigrationResult = { applied: [], skipped: [] }

        for (const migration of pending) {
          const sql = readFileSync(migration.upPath, 'utf-8')
          const checksum = checksumFile(migration.upPath)
          await db.query(sql)
          await tracker.record(db, migration.id, checksum)
          result.applied.push(migration.id)
        }

        return result
      } finally {
        await tracker.unlock(db)
      }
    },

    /**
     * Rollback the most recently applied migration.
     */
    async down(db: DatabaseAdapter): Promise<MigrationResult> {
      await tracker.init(db)
      await tracker.lock(db)

      try {
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
      } finally {
        await tracker.unlock(db)
      }
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

    /**
     * Get detailed info about the current migration state.
     * Shows version, timestamps, and pending count.
     */
    async info(db: DatabaseAdapter): Promise<MigrationInfo> {
      await tracker.init(db)

      const all = scanMigrations(config.directory)
      const records = await tracker.getRecords(db)
      const appliedIds = new Set(records.map(r => r.id))
      const pending = all.filter(m => !appliedIds.has(m.id)).map(m => m.id)

      const lastRecord = records.length > 0 ? records[records.length - 1] : null

      return {
        version: lastRecord?.id ?? null,
        lastAppliedAt: lastRecord?.applied_at ?? null,
        total: all.length,
        appliedCount: records.length,
        pendingCount: pending.length,
        applied: records,
        pending,
      }
    },

    /**
     * Validate migration integrity.
     * Checks for checksum mismatches and missing files.
     */
    async validate(db: DatabaseAdapter): Promise<ValidationResult> {
      await tracker.init(db)

      const all = scanMigrations(config.directory)
      const fileMap = new Map(all.map(m => [m.id, m]))
      const records = await tracker.getRecords(db)
      const issues: ValidationResult['issues'] = []

      for (const record of records) {
        const file = fileMap.get(record.id)

        if (!file) {
          issues.push({
            id: record.id,
            type: 'missing_file',
            message: `Applied migration "${record.id}" has no corresponding file on disk`,
          })
          continue
        }

        if (record.checksum) {
          const currentChecksum = checksumFile(file.upPath)
          if (currentChecksum !== record.checksum) {
            issues.push({
              id: record.id,
              type: 'checksum_mismatch',
              message: `Migration "${record.id}" was modified after being applied (expected ${record.checksum}, got ${currentChecksum})`,
            })
          }
        }
      }

      return {
        valid: issues.length === 0,
        issues,
      }
    },

    /**
     * Preview what SQL would run without executing anything.
     */
    async dryRun(db: DatabaseAdapter): Promise<DryRunResult> {
      await tracker.init(db)

      const all = scanMigrations(config.directory)
      const applied = await tracker.getApplied(db)
      const appliedSet = new Set(applied)

      const pending = all.filter(m => !appliedSet.has(m.id))
      const steps = pending.map(migration => ({
        id: migration.id,
        sql: readFileSync(migration.upPath, 'utf-8'),
      }))

      return { steps }
    },
  }
}
