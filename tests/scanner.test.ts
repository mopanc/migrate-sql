import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { scanMigrations } from '../src/scanner.js'

const TEST_DIR = join(import.meta.dirname ?? '.', '_test_migrations')

function createFile(name: string, content = '') {
  writeFileSync(join(TEST_DIR, name), content)
}

describe('scanMigrations', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('returns empty array for empty directory', () => {
    const result = scanMigrations(TEST_DIR)
    assert.deepStrictEqual(result, [])
  })

  it('parses migration files correctly', () => {
    createFile('001_create_users.up.sql', 'CREATE TABLE users (id INT);')
    createFile('001_create_users.down.sql', 'DROP TABLE users;')

    const result = scanMigrations(TEST_DIR)
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].number, 1)
    assert.strictEqual(result[0].name, 'create_users')
    assert.strictEqual(result[0].id, '001_create_users')
    assert.ok(result[0].upPath.endsWith('001_create_users.up.sql'))
    assert.ok(result[0].downPath?.endsWith('001_create_users.down.sql'))
  })

  it('sorts migrations by number', () => {
    createFile('003_add_index.up.sql')
    createFile('001_create_users.up.sql')
    createFile('002_add_email.up.sql')

    const result = scanMigrations(TEST_DIR)
    assert.strictEqual(result.length, 3)
    assert.strictEqual(result[0].number, 1)
    assert.strictEqual(result[1].number, 2)
    assert.strictEqual(result[2].number, 3)
  })

  it('handles migrations without down files', () => {
    createFile('001_init.up.sql')

    const result = scanMigrations(TEST_DIR)
    assert.strictEqual(result.length, 1)
    assert.strictEqual(result[0].downPath, null)
  })

  it('ignores non-migration files', () => {
    createFile('001_init.up.sql')
    createFile('README.md')
    createFile('.gitkeep')
    createFile('notes.txt')

    const result = scanMigrations(TEST_DIR)
    assert.strictEqual(result.length, 1)
  })

  it('throws on missing directory', () => {
    assert.throws(
      () => scanMigrations('/nonexistent/path'),
      /not found/,
    )
  })

  it('throws when down exists without up', () => {
    createFile('001_broken.down.sql')

    assert.throws(
      () => scanMigrations(TEST_DIR),
      /no .up.sql/,
    )
  })
})
