import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionRecord,
  findActiveSession,
  revokeSession,
} from '../../src/repositories/sessionRepository.js';

function fakeClient(result) {
  return {
    calls: [],
    async query(text, values) {
      this.calls.push({ text, values });
      return result;
    },
  };
}

test('creates a session with parameterized values', async () => {
  const client = fakeClient({ rows: [{ id: 'session-1' }] });
  const expiresAt = new Date('2030-01-01T00:00:00Z');

  const session = await createSessionRecord(client, {
    userId: 'user-1',
    tokenHash: Buffer.alloc(32),
    expiresAt,
  });

  assert.deepEqual(session, { id: 'session-1' });
  assert.deepEqual(client.calls[0].values, ['user-1', Buffer.alloc(32), expiresAt]);
  assert.match(client.calls[0].text, /INSERT INTO sessions/);
});

test('finds only active non-expired sessions', async () => {
  const client = fakeClient({ rows: [{ id: 'session-1', user_id: 'user-1' }] });

  const session = await findActiveSession(client, Buffer.alloc(32));

  assert.equal(session.id, 'session-1');
  assert.match(client.calls[0].text, /revoked_at IS NULL/);
  assert.match(client.calls[0].text, /expires_at > now\(\)/);
});

test('returns whether a session was revoked', async () => {
  const client = fakeClient({ rowCount: 1, rows: [{ id: 'session-1' }] });

  assert.equal(await revokeSession(client, Buffer.alloc(32)), true);
  assert.match(client.calls[0].text, /UPDATE sessions/);
});
