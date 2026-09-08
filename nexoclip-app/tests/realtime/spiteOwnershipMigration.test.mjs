import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIGRATION_MARKER_KEY,
  PLACEHOLDER_OWNER_USER_ID,
  runSpiteOwnershipMigration,
} from '../../scripts/migrate-spite-ownership.mjs';

function normalize(sql) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function createMainDatabase(users = []) {
  return {
    users: users.map((user) => ({ ...user })),
    queryCalls: [],
    async query(text, params = []) {
      this.queryCalls.push({ text, params });
      const normalized = normalize(text);

      if (normalized.includes('select id from users order by created_at asc, id asc limit 1')) {
        const sorted = [...this.users].sort((a, b) => {
          const createdCompare = String(a.created_at).localeCompare(String(b.created_at));
          if (createdCompare !== 0) return createdCompare;
          return String(a.id).localeCompare(String(b.id));
        });
        return { rows: sorted.length ? [{ id: sorted[0].id }] : [], rowCount: sorted.length ? 1 : 0 };
      }

      throw new Error(`Unhandled main DB SQL: ${normalized}`);
    },
  };
}

function createSpiteDatabase({ projects = [], settings = {}, failMarkerWrite = false } = {}) {
  const state = {
    projects: projects.map((project) => ({ ...project })),
    settings: { ...settings },
  };

  const adapter = {
    state,
    txQueryCalls: [],
    async transaction(work) {
      const snapshot = structuredClone(state);
      const tx = {
        async query(text, params = []) {
          adapter.txQueryCalls.push({ text, params });
          const normalized = normalize(text);

          if (normalized.startsWith('create table if not exists app_settings')) {
            return { rows: [], rowCount: 0 };
          }

          if (normalized.includes('select value from app_settings where key = $1 for update')) {
            const value = state.settings[String(params[0])];
            return value === undefined
              ? { rows: [], rowCount: 0 }
              : { rows: [{ value }], rowCount: 1 };
          }

          if (normalized.includes('update projects set userid = $1, updatedat = now() where userid = $2')) {
            let rowCount = 0;
            for (const project of state.projects) {
              if (project.userid === String(params[1])) {
                project.userid = String(params[0]);
                project.updatedat = 'updated-by-test';
                rowCount += 1;
              }
            }
            return { rows: [], rowCount };
          }

          if (normalized.includes('insert into app_settings (key, value, updated_at) values ($1, $2, now())')) {
            if (failMarkerWrite) {
              throw new Error('marker write failed');
            }
            state.settings[String(params[0])] = String(params[1]);
            return { rows: [], rowCount: 1 };
          }

          throw new Error(`Unhandled spite DB SQL: ${normalized}`);
        },
      };

      try {
        return await work(tx);
      } catch (error) {
        state.projects.splice(0, state.projects.length, ...snapshot.projects.map((project) => ({ ...project })));
        state.settings = { ...snapshot.settings };
        throw error;
      }
    },
  };

  return adapter;
}

function hasTxSql(spiteDb, fragment) {
  const expected = fragment.toLowerCase();
  return spiteDb.txQueryCalls.some(({ text }) => normalize(text).includes(expected));
}

test('uses explicit SPITE_OWNER_USER_ID, updates only placeholder projects, and records a marker', async () => {
  const mainDb = createMainDatabase([
    { id: '550e8400-e29b-41d4-a716-4466554400aa', created_at: '2026-09-08T00:00:00.000Z' },
  ]);
  const spiteDb = createSpiteDatabase({
    projects: [
      { id: 'project-1', userid: PLACEHOLDER_OWNER_USER_ID },
      { id: 'project-2', userid: '550e8400-e29b-41d4-a716-4466554400bb' },
      { id: 'project-3', userid: PLACEHOLDER_OWNER_USER_ID },
    ],
  });

  const result = await runSpiteOwnershipMigration({
    mainDb,
    spiteDb,
    env: {
      SPITE_OWNER_USER_ID: '550e8400-e29b-41d4-a716-446655440001',
    },
    now: () => new Date('2026-09-09T00:00:00.000Z'),
  });

  assert.deepEqual(result, {
    status: 'migrated',
    ownerUserId: '550e8400-e29b-41d4-a716-446655440001',
    migratedProjectCount: 2,
    markerKey: MIGRATION_MARKER_KEY,
    placeholderOwnerUserId: PLACEHOLDER_OWNER_USER_ID,
    usedDeterministicFirstUser: false,
  });
  assert.equal(mainDb.queryCalls.length, 0);
  assert.deepEqual(
    spiteDb.state.projects.map((project) => [project.id, project.userid]),
    [
      ['project-1', '550e8400-e29b-41d4-a716-446655440001'],
      ['project-2', '550e8400-e29b-41d4-a716-4466554400bb'],
      ['project-3', '550e8400-e29b-41d4-a716-446655440001'],
    ],
  );

  const marker = JSON.parse(spiteDb.state.settings[MIGRATION_MARKER_KEY]);
  assert.equal(marker.ownerUserId, '550e8400-e29b-41d4-a716-446655440001');
  assert.equal(marker.migratedProjectCount, 2);
  assert.equal(marker.placeholderOwnerUserId, PLACEHOLDER_OWNER_USER_ID);
  assert.equal(marker.completedAt, '2026-09-09T00:00:00.000Z');
});

test('allows deterministic first-user fallback only when explicitly enabled', async () => {
  const mainDb = createMainDatabase([
    { id: '550e8400-e29b-41d4-a716-4466554400bb', created_at: '2026-09-10T00:00:00.000Z' },
    { id: '550e8400-e29b-41d4-a716-4466554400aa', created_at: '2026-09-09T00:00:00.000Z' },
  ]);
  const spiteDb = createSpiteDatabase({
    projects: [{ id: 'project-1', userid: PLACEHOLDER_OWNER_USER_ID }],
  });

  const result = await runSpiteOwnershipMigration({
    mainDb,
    spiteDb,
    env: {
      SPITE_ALLOW_DETERMINISTIC_FIRST_USER: '1',
    },
  });

  assert.equal(result.ownerUserId, '550e8400-e29b-41d4-a716-4466554400aa');
  assert.equal(result.usedDeterministicFirstUser, true);
  assert.equal(mainDb.queryCalls.length, 1);
});

test('requires explicit SPITE_OWNER_USER_ID in production even when deterministic fallback is enabled', async () => {
  const mainDb = createMainDatabase([
    { id: '550e8400-e29b-41d4-a716-4466554400aa', created_at: '2026-09-09T00:00:00.000Z' },
  ]);
  const spiteDb = createSpiteDatabase({
    projects: [{ id: 'project-1', userid: PLACEHOLDER_OWNER_USER_ID }],
  });

  await assert.rejects(
    runSpiteOwnershipMigration({
      mainDb,
      spiteDb,
      env: {
        NODE_ENV: 'production',
        SPITE_ALLOW_DETERMINISTIC_FIRST_USER: '1',
      },
    }),
    /SPITE_OWNER_USER_ID is required in production/i,
  );
  assert.equal(mainDb.queryCalls.length, 0);
});

test('treats invalid JSON marker as absent and replaces it with a successful marker', async () => {
  const mainDb = createMainDatabase([]);
  const spiteDb = createSpiteDatabase({
    projects: [{ id: 'project-1', userid: PLACEHOLDER_OWNER_USER_ID }],
    settings: {
      [MIGRATION_MARKER_KEY]: '{not-valid-json',
    },
  });

  const result = await runSpiteOwnershipMigration({
    mainDb,
    spiteDb,
    env: {
      SPITE_OWNER_USER_ID: '550e8400-e29b-41d4-a716-446655440001',
    },
  });

  assert.equal(result.status, 'migrated');
  assert.equal(result.migratedProjectCount, 1);
  const marker = JSON.parse(spiteDb.state.settings[MIGRATION_MARKER_KEY]);
  assert.equal(marker.ownerUserId, '550e8400-e29b-41d4-a716-446655440001');
});

test('treats partial marker as absent and replaces it with a successful marker', async () => {
  const mainDb = createMainDatabase([]);
  const spiteDb = createSpiteDatabase({
    projects: [{ id: 'project-1', userid: PLACEHOLDER_OWNER_USER_ID }],
    settings: {
      [MIGRATION_MARKER_KEY]: JSON.stringify({
        ownerUserId: '550e8400-e29b-41d4-a716-446655440001',
      }),
    },
  });

  const result = await runSpiteOwnershipMigration({
    mainDb,
    spiteDb,
    env: {
      SPITE_OWNER_USER_ID: '550e8400-e29b-41d4-a716-446655440001',
    },
  });

  assert.equal(result.status, 'migrated');
  assert.equal(result.migratedProjectCount, 1);
  const marker = JSON.parse(spiteDb.state.settings[MIGRATION_MARKER_KEY]);
  assert.equal(marker.migratedProjectCount, 1);
  assert.equal(marker.placeholderOwnerUserId, PLACEHOLDER_OWNER_USER_ID);
  assert.match(marker.completedAt, /^\d{4}-\d{2}-\d{2}t/i);
});

test('rejects explicit placeholder SPITE_OWNER_USER_ID before project updates or marker writes', async () => {
  const mainDb = createMainDatabase([]);
  const spiteDb = createSpiteDatabase({
    projects: [{ id: 'project-1', userid: PLACEHOLDER_OWNER_USER_ID }],
  });

  await assert.rejects(
    runSpiteOwnershipMigration({
      mainDb,
      spiteDb,
      env: {
        SPITE_OWNER_USER_ID: PLACEHOLDER_OWNER_USER_ID,
      },
    }),
    /SPITE_OWNER_USER_ID must not be the placeholder owner UUID/i,
  );

  assert.equal(spiteDb.state.projects[0].userid, PLACEHOLDER_OWNER_USER_ID);
  assert.equal(hasTxSql(spiteDb, 'update projects set userid'), false);
  assert.equal(hasTxSql(spiteDb, 'insert into app_settings'), false);
});

test('rejects deterministic fallback placeholder owner before project updates or marker writes', async () => {
  const mainDb = createMainDatabase([
    { id: PLACEHOLDER_OWNER_USER_ID, created_at: '2026-09-09T00:00:00.000Z' },
  ]);
  const spiteDb = createSpiteDatabase({
    projects: [{ id: 'project-1', userid: PLACEHOLDER_OWNER_USER_ID }],
  });

  await assert.rejects(
    runSpiteOwnershipMigration({
      mainDb,
      spiteDb,
      env: {
        SPITE_ALLOW_DETERMINISTIC_FIRST_USER: '1',
      },
    }),
    /first user id must not be the placeholder owner UUID/i,
  );

  assert.equal(spiteDb.state.projects[0].userid, PLACEHOLDER_OWNER_USER_ID);
  assert.equal(hasTxSql(spiteDb, 'update projects set userid'), false);
  assert.equal(hasTxSql(spiteDb, 'insert into app_settings'), false);
});

test('is idempotent once the migration marker exists', async () => {
  const mainDb = createMainDatabase([]);
  const spiteDb = createSpiteDatabase({
    projects: [{ id: 'project-1', userid: '550e8400-e29b-41d4-a716-446655440001' }],
    settings: {
      [MIGRATION_MARKER_KEY]: JSON.stringify({
        ownerUserId: '550e8400-e29b-41d4-a716-446655440001',
        migratedProjectCount: 2,
        placeholderOwnerUserId: PLACEHOLDER_OWNER_USER_ID,
        completedAt: '2026-09-09T00:00:00.000Z',
        usedDeterministicFirstUser: false,
      }),
    },
  });

  const result = await runSpiteOwnershipMigration({
    mainDb,
    spiteDb,
    env: {
      NODE_ENV: 'production',
    },
  });

  assert.deepEqual(result, {
    status: 'already_migrated',
    ownerUserId: '550e8400-e29b-41d4-a716-446655440001',
    migratedProjectCount: 2,
    markerKey: MIGRATION_MARKER_KEY,
    placeholderOwnerUserId: PLACEHOLDER_OWNER_USER_ID,
    usedDeterministicFirstUser: false,
  });
  assert.equal(mainDb.queryCalls.length, 0);
});

test('rolls back placeholder ownership updates when marker persistence fails', async () => {
  const mainDb = createMainDatabase([]);
  const spiteDb = createSpiteDatabase({
    projects: [{ id: 'project-1', userid: PLACEHOLDER_OWNER_USER_ID }],
    failMarkerWrite: true,
  });

  await assert.rejects(
    runSpiteOwnershipMigration({
      mainDb,
      spiteDb,
      env: {
        SPITE_OWNER_USER_ID: '550e8400-e29b-41d4-a716-446655440001',
      },
    }),
    /marker write failed/i,
  );

  assert.equal(spiteDb.state.projects[0].userid, PLACEHOLDER_OWNER_USER_ID);
  assert.equal(spiteDb.state.settings[MIGRATION_MARKER_KEY], undefined);
});
