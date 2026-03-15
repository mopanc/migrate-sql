import { readdirSync } from 'node:fs'
import { resolve, join } from 'node:path'
import type { MigrationFile } from './types.js'

const MIGRATION_PATTERN = /^(\d+)_(.+)\.(up|down)\.sql$/

/**
 * Scan a directory for migration files and return them ordered by number.
 * Expected naming: 001_create_users.up.sql / 001_create_users.down.sql
 */
export function scanMigrations(directory: string): MigrationFile[] {
  const dir = resolve(directory)
  let files: string[]

  try {
    files = readdirSync(dir)
  } catch {
    throw new Error(`Migration directory not found: ${dir}`)
  }

  const map = new Map<string, { number: number; name: string; upPath: string | null; downPath: string | null }>()

  for (const file of files) {
    const match = file.match(MIGRATION_PATTERN)
    if (!match) continue

    const [, numStr, name, direction] = match
    const num = parseInt(numStr, 10)
    const id = `${numStr}_${name}`

    if (!map.has(id)) {
      map.set(id, { number: num, name, upPath: null, downPath: null })
    }

    const entry = map.get(id)!
    const fullPath = join(dir, file)

    if (direction === 'up') {
      entry.upPath = fullPath
    } else {
      entry.downPath = fullPath
    }
  }

  const migrations: MigrationFile[] = []

  for (const [id, entry] of map) {
    if (!entry.upPath) {
      throw new Error(`Migration "${id}" has a .down.sql but no .up.sql`)
    }

    migrations.push({
      number: entry.number,
      name: entry.name,
      id,
      upPath: entry.upPath,
      downPath: entry.downPath,
    })
  }

  return migrations.sort((a, b) => a.number - b.number)
}
