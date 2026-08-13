import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from './pool.js';

const migrationsDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

export async function migrate() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const filenames = (await fs.readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith('.sql'))
      .sort();
    const appliedResult = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedResult.rows.map((row) => row.filename));

    for (const filename of filenames) {
      if (applied.has(filename)) continue;

      const sql = await fs.readFile(path.join(migrationsDirectory, filename), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${filename} failed: ${error.message}`, { cause: error });
      }
    }
  } finally {
    client.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(async () => {
      console.log('Database migrations applied.');
      await closePool();
    })
    .catch(async (error) => {
      console.error(error.message);
      await closePool();
      process.exitCode = 1;
    });
}
