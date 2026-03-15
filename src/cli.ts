#!/usr/bin/env node

import { parseArgs } from 'node:util'
import { createMigrator } from './runner.js'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string', default: './migrations' },
    table: { type: 'string', default: '_migrations' },
    url: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

const command = positionals[0]

if (values.help || !command) {
  console.log(`
migrate-sql — Zero-dependency SQL migration runner

Usage:
  migrate-sql <command> [options]

Commands:
  up        Run all pending migrations
  down      Rollback the last applied migration
  status    Show applied and pending migrations

Options:
  --dir     Migration directory (default: ./migrations)
  --table   Tracking table name (default: _migrations)
  --url     Database URL (default: DATABASE_URL env var)
  -h        Show this help
`)
  process.exit(0)
}

async function createAdapter(url: string) {
  if (url.startsWith('postgres')) {
    try {
      // @ts-expect-error — pg is an optional peer dependency
      const pg = await import('pg')
      const Pool = pg.default?.Pool ?? pg.Pool
      const pool = new Pool({ connectionString: url })
      return {
        query: async (sql: string, params?: unknown[]) => {
          const result = await pool.query(sql, params)
          return result.rows
        },
        close: () => pool.end(),
      }
    } catch {
      console.error('PostgreSQL driver not found. Install it: npm install pg')
      process.exit(1)
    }
  }

  console.error(`Unsupported database URL scheme. Supported: postgres://`)
  process.exit(1)
}

async function main() {
  const dbUrl = values.url ?? process.env.DATABASE_URL

  if (!dbUrl) {
    console.error('No database URL. Set DATABASE_URL or use --url flag.')
    process.exit(1)
  }

  const adapter = await createAdapter(dbUrl)
  const migrator = createMigrator({ directory: values.dir ?? './migrations', table: values.table })

  try {
    switch (command) {
      case 'up': {
        const result = await migrator.up(adapter)
        if (result.applied.length === 0) {
          console.log('No pending migrations.')
        } else {
          for (const id of result.applied) {
            console.log(`  OK    ${id}`)
          }
          console.log(`\nMigrations complete: ${result.applied.length} applied.`)
        }
        break
      }

      case 'down': {
        const result = await migrator.down(adapter)
        if (result.applied.length === 0) {
          console.log('No migrations to rollback.')
        } else {
          for (const id of result.applied) {
            console.log(`  REVERTED  ${id}`)
          }
        }
        break
      }

      case 'status': {
        const status = await migrator.status(adapter)
        console.log('Applied:')
        if (status.applied.length === 0) {
          console.log('  (none)')
        } else {
          for (const id of status.applied) console.log(`  ${id}`)
        }
        console.log('\nPending:')
        if (status.pending.length === 0) {
          console.log('  (none)')
        } else {
          for (const id of status.pending) console.log(`  ${id}`)
        }
        break
      }

      default:
        console.error(`Unknown command: ${command}. Use: up, down, status`)
        process.exit(1)
    }
  } finally {
    if ('close' in adapter) await adapter.close()
  }
}

main().catch(err => {
  console.error(err.message)
  process.exit(1)
})
