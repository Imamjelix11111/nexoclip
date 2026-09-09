import pg from 'pg';
import { pathToFileURL } from 'node:url';

const { Pool } = pg;

export const PLACEHOLDER_OWNER_USER_ID = '00000000-0000-0000-0000-000000000001';
export const MIGRATION_MARKER_KEY = 'spite.placeholder-ownership.v1';

const APP_SETTINGS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS app_settings (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )
`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function runSpiteOwnershipMigration({
  mainDb,
  spiteDb,
  env = process.env,
  now = () => new Date(),
} = {}) {
  if (!mainDb) throw new Error('mainDb is required');
  if (!spiteDb) throw new Error('spiteDb is required');

  const existingMarker = await readExistingMarker(spiteDb);
  if (existingMarker) {
    return markerResult('already_migrated', existingMarker);
  }

  const owner = await resolveOwnerUserId({ mainDb, env });
  const completedAt = asDate(now()).toISOString();

  return spiteDb.transaction(async (tx) => {
    await tx.query(APP_SETTINGS_TABLE_SQL);

    const markerResultRow = await tx.query(
      `SELECT value FROM app_settings WHERE key = $1 FOR UPDATE`,
      [MIGRATION_MARKER_KEY],
    );
    const lockedMarker = parseMarker(markerResultRow.rows[0]?.value);
    if (lockedMarker) {
      return markerResult('already_migrated', lockedMarker);
    }

    const updateResult = await tx.query(
      `
        UPDATE projects
        SET userid = $1,
            updatedat = NOW()
        WHERE userid = $2
      `,
      [owner.userId, PLACEHOLDER_OWNER_USER_ID],
    );

    const marker = {
      ownerUserId: owner.userId,
      migratedProjectCount: Number(updateResult.rowCount ?? 0),
      placeholderOwnerUserId: PLACEHOLDER_OWNER_USER_ID,
      completedAt,
      usedDeterministicFirstUser: owner.usedDeterministicFirstUser,
    };

    await tx.query(
      `
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ($1, $2, NOW())
        ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value,
            updated_at = NOW()
      `,
      [MIGRATION_MARKER_KEY, JSON.stringify(marker)],
    );

    return markerResult('migrated', marker);
  });
}

export function createPgAdapter(connectionString) {
  if (!String(connectionString || '').trim()) {
    throw new Error('connectionString is required');
  }

  const pool = new Pool({ connectionString });

  return {
    async query(text, params = []) {
      const result = await pool.query(text, params);
      return { rows: result.rows, rowCount: result.rowCount };
    },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const tx = {
          async query(text, params = []) {
            const result = await client.query(text, params);
            return { rows: result.rows, rowCount: result.rowCount };
          },
        };
        const result = await work(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original failure.
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

async function readExistingMarker(spiteDb) {
  return spiteDb.transaction(async (tx) => {
    await tx.query(APP_SETTINGS_TABLE_SQL);
    const result = await tx.query(
      `SELECT value FROM app_settings WHERE key = $1 FOR UPDATE`,
      [MIGRATION_MARKER_KEY],
    );
    return parseMarker(result.rows[0]?.value);
  });
}

async function resolveOwnerUserId({ mainDb, env }) {
  const configured = String(env.SPITE_OWNER_USER_ID || '').trim();
  if (configured) {
    assertNotPlaceholderOwner(configured, 'SPITE_OWNER_USER_ID');
    assertUuid(configured, 'SPITE_OWNER_USER_ID');
    return {
      userId: configured,
      usedDeterministicFirstUser: false,
    };
  }

  if (String(env.NODE_ENV || '').trim() === 'production') {
    throw new Error('SPITE_OWNER_USER_ID is required in production');
  }

  if (String(env.SPITE_ALLOW_DETERMINISTIC_FIRST_USER || '').trim() !== '1') {
    throw new Error('Set SPITE_OWNER_USER_ID or explicitly allow deterministic first-user fallback');
  }

  const result = await mainDb.query(
    `SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1`,
  );
  const firstUserId = String(result.rows[0]?.id || '').trim();
  if (!firstUserId) {
    throw new Error('Cannot determine SPITE owner: main database has no users');
  }

  assertNotPlaceholderOwner(firstUserId, 'first user id');
  assertUuid(firstUserId, 'first user id');
  return {
    userId: firstUserId,
    usedDeterministicFirstUser: true,
  };
}

function parseMarker(value) {
  if (!value) return null;

  let parsed;
  try {
    parsed = typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const ownerUserId = String(parsed.ownerUserId || '').trim();
  const migratedProjectCount = Number(parsed.migratedProjectCount);
  const placeholderOwnerUserId = String(parsed.placeholderOwnerUserId || '').trim();
  const completedAt = String(parsed.completedAt || '').trim();
  const usedDeterministicFirstUser = parsed.usedDeterministicFirstUser;

  if (!ownerUserId || !isUuid(ownerUserId)) return null;
  if (!Number.isInteger(migratedProjectCount) || migratedProjectCount < 0) return null;
  if (placeholderOwnerUserId !== PLACEHOLDER_OWNER_USER_ID) return null;
  if (!completedAt || Number.isNaN(Date.parse(completedAt))) return null;
  if (typeof usedDeterministicFirstUser !== 'boolean') return null;

  return {
    ownerUserId,
    migratedProjectCount,
    placeholderOwnerUserId,
    completedAt,
    usedDeterministicFirstUser,
  };
}

function markerResult(status, marker) {
  return {
    status,
    ownerUserId: marker.ownerUserId,
    migratedProjectCount: marker.migratedProjectCount,
    markerKey: MIGRATION_MARKER_KEY,
    placeholderOwnerUserId: marker.placeholderOwnerUserId || PLACEHOLDER_OWNER_USER_ID,
    usedDeterministicFirstUser: marker.usedDeterministicFirstUser === true,
  };
}

function assertUuid(value, label) {
  if (!isUuid(value)) {
    throw new Error(`${label} must be a valid UUID`);
  }
}

function isUuid(value) {
  return UUID_PATTERN.test(value);
}

function assertNotPlaceholderOwner(value, label) {
  if (value === PLACEHOLDER_OWNER_USER_ID) {
    throw new Error(`${label} must not be the placeholder owner UUID`);
  }
}

function asDate(value) {
  return value instanceof Date ? value : new Date(value);
}

async function main() {
  const mainUrl = String(process.env.DATABASE_URL_NEXOCLIP || '').trim();
  const spiteUrl = String(process.env.DATABASE_URL_SPITE || '').trim();

  if (!mainUrl) {
    throw new Error('DATABASE_URL_NEXOCLIP is required');
  }
  if (!spiteUrl) {
    throw new Error('DATABASE_URL_SPITE is required');
  }

  const mainDb = createPgAdapter(mainUrl);
  const spiteDb = createPgAdapter(spiteUrl);

  try {
    const result = await runSpiteOwnershipMigration({ mainDb, spiteDb });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await Promise.allSettled([mainDb.close?.(), spiteDb.close?.()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
