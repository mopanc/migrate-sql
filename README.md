# migrate-sql

Zero-dependency SQL migration runner. Plain `.sql` files, database-agnostic, with CLI support.

You bring your own database client. The library handles ordering, tracking, and execution.

## Install

```bash
npm install migrate-sql
```

## Usage

### Programmatic

```ts
import { createMigrator } from 'migrate-sql'

const migrator = createMigrator({
  directory: './migrations',
  table: '_migrations',  // optional, default: '_migrations'
})

// Provide a simple adapter wrapping your database client
const adapter = {
  query: (sql, params) => pool.query(sql, params).then(r => r.rows)
}

await migrator.up(adapter)       // run all pending migrations
await migrator.down(adapter)     // rollback last applied migration
await migrator.status(adapter)   // { applied: [...], pending: [...] }
```

### CLI

```bash
# Uses DATABASE_URL environment variable
npx migrate-sql up --dir ./migrations
npx migrate-sql down --dir ./migrations
npx migrate-sql status --dir ./migrations

# Or pass the URL directly
npx migrate-sql up --url postgresql://user:pass@localhost/mydb
```

The CLI requires `pg` for PostgreSQL connections. Install it separately:

```bash
npm install pg
```

## Migration files

Place plain SQL files in your migrations directory with this naming convention:

```
migrations/
  001_create_users.up.sql
  001_create_users.down.sql
  002_add_email.up.sql
  002_add_email.down.sql
  003_create_indexes.up.sql
```

Rules:
- Files must follow the pattern `NNN_name.up.sql` / `NNN_name.down.sql`
- Every migration needs an `.up.sql` file
- `.down.sql` files are optional (but required for rollback)
- Migrations run in numeric order

## Adapter examples

### PostgreSQL (pg)

```ts
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

const adapter = {
  query: async (sql, params) => {
    const result = await pool.query(sql, params)
    return result.rows
  }
}
```

### SQLite (better-sqlite3)

```ts
import Database from 'better-sqlite3'

const db = new Database('app.db')

const adapter = {
  query: async (sql, params) => {
    if (sql.trim().toUpperCase().startsWith('SELECT')) {
      return db.prepare(sql).all(...(params ?? []))
    }
    db.prepare(sql).run(...(params ?? []))
    return []
  }
}
```

## API

### `createMigrator(config)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `directory` | `string` | required | Path to migration files |
| `table` | `string` | `'_migrations'` | Tracking table name |

Returns an object with:

- `up(adapter)` — Run pending migrations. Returns `{ applied: string[], skipped: string[] }`
- `down(adapter)` — Rollback last migration. Returns `{ applied: string[], skipped: string[] }`
- `status(adapter)` — Returns `{ applied: string[], pending: string[] }`

### `DatabaseAdapter`

```ts
interface DatabaseAdapter {
  query(sql: string, params?: unknown[]): Promise<unknown[]>
}
```

### `scanMigrations(directory)`

Low-level function to scan and parse migration files without executing anything.

```ts
import { scanMigrations } from 'migrate-sql'

const migrations = scanMigrations('./migrations')
// [{ number: 1, name: 'create_users', id: '001_create_users', upPath, downPath }]
```

## License

MIT
