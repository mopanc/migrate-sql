import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createMigrator } from '../src/runner.js'
import type { DatabaseAdapter } from '../src/types.js'

const TEST_DIR = join(import.meta.dirname ?? '.', '_test_runner_migrations')

function createFile(name: string, content = '') {
  writeFileSync(join(TEST_DIR, name), content)
}

/**
 * In-memory mock database adapter for testing.
 * Tracks executed SQL and simulates the migration tracking table.
 */
function createMockAdapter() {
  const tables: Record<string, Record<string, unknown>[]> = {}
  const executed: string[] = []

  const adapter: DatabaseAdapter & { executed: string[]; tables: typeof tables } = {
    executed,
    tables,
    async query(sql: string, params?: unknown[]) {
      executed.push(sql.trim())

      // CREATE TABLE
      if (sql.includes('CREATE TABLE IF NOT EXISTS')) {
        const match = sql.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/)
        if (match) tables[match[1]] = tables[match[1]] ?? []
        return []
      }

      // INSERT
      if (sql.includes('INSERT INTO')) {
        const match = sql.match(/INSERT INTO\s+(\w+)/)
        if (match && params) {
          tables[match[1]] = tables[match[1]] ?? []
          tables[match[1]].push({ id: params[0], applied_at: new Date().toISOString() })
        }
        return []
      }

      // DELETE
      if (sql.includes('DELETE FROM')) {
        const match = sql.match(/DELETE FROM\s+(\w+)/)
        if (match && params) {
          tables[match[1]] = (tables[match[1]] ?? []).filter(r => r.id !== params[0])
        }
        return []
      }

      // SELECT
      if (sql.includes('SELECT id FROM')) {
        const match = sql.match(/SELECT id FROM\s+(\w+)/)
        if (match) {
          return (tables[match[1]] ?? []).sort((a, b) =>
            String(a.id).localeCompare(String(b.id))
          )
        }
        return []
      }

      return []
    },
  }

  return adapter
}

describe('createMigrator', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('up() runs pending migrations in order', async () => {
    createFile('001_create_users.up.sql', 'CREATE TABLE users (id INT);')
    createFile('002_add_email.up.sql', 'ALTER TABLE users ADD email TEXT;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()
    const result = await migrator.up(db)

    assert.deepStrictEqual(result.applied, ['001_create_users', '002_add_email'])
    assert.ok(db.executed.some(s => s.includes('CREATE TABLE users')))
    assert.ok(db.executed.some(s => s.includes('ALTER TABLE users')))
  })

  it('up() skips already applied migrations', async () => {
    createFile('001_init.up.sql', 'SELECT 1;')
    createFile('002_second.up.sql', 'SELECT 2;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)
    const result = await migrator.up(db)

    assert.strictEqual(result.applied.length, 0)
  })

  it('down() rollbacks the last migration', async () => {
    createFile('001_init.up.sql', 'CREATE TABLE t1 (id INT);')
    createFile('001_init.down.sql', 'DROP TABLE t1;')
    createFile('002_second.up.sql', 'CREATE TABLE t2 (id INT);')
    createFile('002_second.down.sql', 'DROP TABLE t2;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)
    const result = await migrator.down(db)

    assert.deepStrictEqual(result.applied, ['002_second'])
    assert.ok(db.executed.some(s => s.includes('DROP TABLE t2')))
  })

  it('down() does nothing when no migrations applied', async () => {
    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    const result = await migrator.down(db)
    assert.strictEqual(result.applied.length, 0)
  })

  it('down() throws when migration has no down file', async () => {
    createFile('001_init.up.sql', 'SELECT 1;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)
    await assert.rejects(
      () => migrator.down(db),
      /no .down.sql/,
    )
  })

  it('status() returns applied and pending', async () => {
    createFile('001_init.up.sql', 'SELECT 1;')
    createFile('002_second.up.sql', 'SELECT 2;')
    createFile('003_third.up.sql', 'SELECT 3;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)
    createFile('004_fourth.up.sql', 'SELECT 4;')

    const status = await migrator.status(db)

    assert.strictEqual(status.applied.length, 3)
    assert.strictEqual(status.pending.length, 1)
    assert.strictEqual(status.pending[0], '004_fourth')
  })

  it('uses custom table name', async () => {
    createFile('001_init.up.sql', 'SELECT 1;')

    const migrator = createMigrator({ directory: TEST_DIR, table: 'schema_versions' })
    const db = createMockAdapter()

    await migrator.up(db)
    assert.ok(db.tables['schema_versions'])
    assert.strictEqual(db.tables['schema_versions'].length, 1)
  })
})
