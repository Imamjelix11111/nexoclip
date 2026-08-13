import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://nexoclip:nexoclip_dev@localhost:5434/nexoclip';
process.env.NODE_ENV = 'test';

const { registerUser } = await import('../../src/services/authService.js');
const { getPool, closePool } = await import('../../src/db/pool.js');
const { SESSION_COOKIE, sessionCookieOptions } = await import('../../src/lib/auth/session.js');
const { loginUser, getCurrentSession } = await import('../../src/services/authService.js');

const email = `login-e2e-${Date.now()}@example.com`;
const password = 'correct horse battery staple';
let userId;

before(async () => {
  const result = await registerUser({ email, password, displayName: 'Login E2E' });
  userId = result.user.id;
});

after(async () => {
  const pool = getPool();
  await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  await closePool();
});

test('POST /api/auth/login sets an opaque HttpOnly cookie and session endpoint authenticates it', async () => {
  const result = await loginUser({ email: email.toUpperCase(), password });

  assert.deepEqual(result.user, {
    id: userId,
    email,
    display_name: 'Login E2E',
  });
  assert.match(result.token, /^[0-9a-f]{64}$/);
  assert.notEqual(result.token, password);

  const activeSession = await getCurrentSession(result.token);
  assert.equal(activeSession.user_id, userId);
  assert.equal(activeSession.email, email);

  // The route applies these options to the opaque result.token.
  assert.equal(sessionCookieOptions().httpOnly, true);
  assert.equal(sessionCookieOptions().path, '/');
});

test('POST /api/auth/login returns a safe 401 for invalid credentials without a session cookie', async () => {
  await assert.rejects(
    loginUser({ email, password: 'wrong password value' }),
    (error) => error.message === 'Invalid email or password',
  );

  const routeSource = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../../app/api/auth/login/route.js', import.meta.url), 'utf8'));
  assert.match(routeSource, /status: 401/);
  assert.match(routeSource, /Invalid email or password/);
  assert.match(routeSource, /response\.cookies\.set\(SESSION_COOKIE, result\.token/);
});
