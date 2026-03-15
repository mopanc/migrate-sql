import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createMigrator } from '../src/runner.js'
import type { DatabaseAdapter, MigrationRecord } from '../src/types.js'

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
          if (match[1].endsWith('_lock')) {
            tables[match[1]].push({ id: 1, locked_by: params[0] })
          } else {
            tables[match[1]].push({
              id: params[0],
              applied_at: new Date().toISOString(),
              checksum: params[1] ?? null,
            })
          }
        }
        return []
      }

      // DELETE
      if (sql.includes('DELETE FROM')) {
        const match = sql.match(/DELETE FROM\s+(\w+)/)
        if (match && match[1].endsWith('_lock')) {
          tables[match[1]] = []
          return []
        }
        if (match && params) {
          tables[match[1]] = (tables[match[1]] ?? []).filter(r => r.id !== params[0])
        }
        return []
      }

      // SELECT id, applied_at, checksum (full records)
      if (sql.includes('SELECT id, applied_at, checksum')) {
        const match = sql.match(/FROM\s+(\w+)/)
        if (match) {
          return (tables[match[1]] ?? [])
            .sort((a, b) => String(a.id).localeCompare(String(b.id)))
            .map(r => ({ id: r.id, applied_at: r.applied_at, checksum: r.checksum }))
        }
        return []
      }

      // SELECT id FROM (simple list)
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

  it('up() stores checksums for applied migrations', async () => {
    createFile('001_init.up.sql', 'CREATE TABLE t1 (id INT);')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)

    const records = db.tables['_migrations'] as MigrationRecord[]
    assert.strictEqual(records.length, 1)
    assert.ok(records[0].checksum, 'checksum should be stored')
    assert.strictEqual(typeof records[0].checksum, 'string')
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

describe('info()', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('returns null version when no migrations applied', async () => {
    createFile('001_init.up.sql', 'SELECT 1;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()
    const info = await migrator.info(db)

    assert.strictEqual(info.version, null)
    assert.strictEqual(info.lastAppliedAt, null)
    assert.strictEqual(info.total, 1)
    assert.strictEqual(info.appliedCount, 0)
    assert.strictEqual(info.pendingCount, 1)
  })

  it('returns current version and counts', async () => {
    createFile('001_init.up.sql', 'SELECT 1;')
    createFile('002_second.up.sql', 'SELECT 2;')
    createFile('003_third.up.sql', 'SELECT 3;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)

    const info = await migrator.info(db)

    assert.strictEqual(info.version, '003_third')
    assert.ok(info.lastAppliedAt)
    assert.strictEqual(info.total, 3)
    assert.strictEqual(info.appliedCount, 3)
    assert.strictEqual(info.pendingCount, 0)
    assert.strictEqual(info.applied.length, 3)
    assert.strictEqual(info.pending.length, 0)
  })

  it('shows pending migrations after partial apply', async () => {
    createFile('001_init.up.sql', 'SELECT 1;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)
    createFile('002_second.up.sql', 'SELECT 2;')

    const info = await migrator.info(db)

    assert.strictEqual(info.version, '001_init')
    assert.strictEqual(info.appliedCount, 1)
    assert.strictEqual(info.pendingCount, 1)
    assert.deepStrictEqual(info.pending, ['002_second'])
  })
})

describe('validate()', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('returns valid when checksums match', async () => {
    createFile('001_init.up.sql', 'CREATE TABLE t1 (id INT);')
    createFile('002_second.up.sql', 'CREATE TABLE t2 (id INT);')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)
    const result = await migrator.validate(db)

    assert.strictEqual(result.valid, true)
    assert.strictEqual(result.issues.length, 0)
  })

  it('detects checksum mismatch when file is modified', async () => {
    createFile('001_init.up.sql', 'CREATE TABLE t1 (id INT);')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)

    // Modify the file after applying
    createFile('001_init.up.sql', 'CREATE TABLE t1 (id INT, name TEXT);')

    const result = await migrator.validate(db)

    assert.strictEqual(result.valid, false)
    assert.strictEqual(result.issues.length, 1)
    assert.strictEqual(result.issues[0].type, 'checksum_mismatch')
    assert.strictEqual(result.issues[0].id, '001_init')
  })

  it('detects missing files for applied migrations', async () => {
    createFile('001_init.up.sql', 'SELECT 1;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)

    // Delete the migration file
    rmSync(join(TEST_DIR, '001_init.up.sql'))

    const result = await migrator.validate(db)

    assert.strictEqual(result.valid, false)
    assert.strictEqual(result.issues.length, 1)
    assert.strictEqual(result.issues[0].type, 'missing_file')
  })

  it('reports multiple issues at once', async () => {
    createFile('001_init.up.sql', 'SELECT 1;')
    createFile('002_second.up.sql', 'SELECT 2;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)

    // Modify one, delete another
    createFile('001_init.up.sql', 'MODIFIED;')
    rmSync(join(TEST_DIR, '002_second.up.sql'))

    const result = await migrator.validate(db)

    assert.strictEqual(result.valid, false)
    assert.strictEqual(result.issues.length, 2)
  })
})

describe('dryRun()', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('returns SQL for pending migrations without executing', async () => {
    createFile('001_init.up.sql', 'CREATE TABLE t1 (id INT);')
    createFile('002_second.up.sql', 'ALTER TABLE t1 ADD name TEXT;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()
    const result = await migrator.dryRun(db)

    assert.strictEqual(result.steps.length, 2)
    assert.strictEqual(result.steps[0].id, '001_init')
    assert.strictEqual(result.steps[0].sql, 'CREATE TABLE t1 (id INT);')
    assert.strictEqual(result.steps[1].id, '002_second')
    assert.strictEqual(result.steps[1].sql, 'ALTER TABLE t1 ADD name TEXT;')

    // Should NOT have executed the migration SQL
    assert.ok(!db.executed.some(s => s.includes('CREATE TABLE t1')))
  })

  it('returns empty steps when all migrations applied', async () => {
    createFile('001_init.up.sql', 'SELECT 1;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)
    const result = await migrator.dryRun(db)

    assert.strictEqual(result.steps.length, 0)
  })

  it('only includes pending migrations', async () => {
    createFile('001_init.up.sql', 'SELECT 1;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)
    createFile('002_second.up.sql', 'SELECT 2;')

    const result = await migrator.dryRun(db)

    assert.strictEqual(result.steps.length, 1)
    assert.strictEqual(result.steps[0].id, '002_second')
  })
})

describe('locking', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('releases lock after successful up()', async () => {
    createFile('001_init.up.sql', 'SELECT 1;')

    const migrator = createMigrator({ directory: TEST_DIR })
    const db = createMockAdapter()

    await migrator.up(db)

    // Lock table should be empty (lock released)
    const lockTable = db.tables['_migrations_lock'] ?? []
    assert.strictEqual(lockTable.length, 0)
  })

  it('releases lock after failed up()', async () => {
    createFile('001_init.up.sql', 'WILL FAIL;')

    const migrator = createMigrator({ directory: TEST_DIR })

    const db = createMockAdapter()
    const originalQuery = db.query.bind(db)
    db.query = async (sql: string, params?: unknown[]) => {
      // Fail when executing the actual migration SQL
      if (sql.trim() === 'WILL FAIL;') {
        throw new Error('DB error')
      }
      return originalQuery(sql, params)
    }

    await assert.rejects(() => migrator.up(db), /DB error/)

    // Lock should still be released
    const lockTable = db.tables['_migrations_lock'] ?? []
    assert.strictEqual(lockTable.length, 0)
  })
})
