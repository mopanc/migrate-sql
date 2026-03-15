import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { checksumFile } from '../src/checksum.js'

const TEST_DIR = join(import.meta.dirname ?? '.', '_test_checksum')

describe('checksumFile', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('returns consistent hash for same content', () => {
    const file = join(TEST_DIR, 'test.sql')
    writeFileSync(file, 'CREATE TABLE users (id INT);')

    const hash1 = checksumFile(file)
    const hash2 = checksumFile(file)

    assert.strictEqual(hash1, hash2)
  })

  it('returns different hash for different content', () => {
    const file1 = join(TEST_DIR, 'a.sql')
    const file2 = join(TEST_DIR, 'b.sql')
    writeFileSync(file1, 'CREATE TABLE a (id INT);')
    writeFileSync(file2, 'CREATE TABLE b (id INT);')

    assert.notStrictEqual(checksumFile(file1), checksumFile(file2))
  })

  it('returns a 16-character hex string', () => {
    const file = join(TEST_DIR, 'test.sql')
    writeFileSync(file, 'SELECT 1;')

    const hash = checksumFile(file)
    assert.strictEqual(hash.length, 16)
    assert.match(hash, /^[0-9a-f]+$/)
  })

  it('detects content changes', () => {
    const file = join(TEST_DIR, 'test.sql')
    writeFileSync(file, 'CREATE TABLE users (id INT);')
    const before = checksumFile(file)

    writeFileSync(file, 'CREATE TABLE users (id INT, name TEXT);')
    const after = checksumFile(file)

    assert.notStrictEqual(before, after)
  })
})
