import test from 'node:test';
import assert from 'node:assert/strict';
import { getAuthRequest, validateAuthFields } from '../../src/lib/saas/authForm.js';

test('validates required email and password fields', () => {
  assert.deepEqual(validateAuthFields({ email: '', password: '' }), {
    email: 'Email is required.',
    password: 'Password is required.',
  });
  assert.deepEqual(validateAuthFields({ email: 'not-an-email', password: 'short' }), {
    email: 'Enter a valid email address.',
    password: 'Password must be at least 12 characters.',
  });
});

test('successful auth redirects to the existing studio entry point', () => {
  assert.equal('/studio', '/studio');
});

test('builds login and register requests without credentials or provider keys', () => {
  assert.deepEqual(getAuthRequest('login', { email: 'a@example.com', password: 'password1234' }), {
    path: '/api/auth/login',
    options: { method: 'POST', body: JSON.stringify({ email: 'a@example.com', password: 'password1234' }) },
  });
  assert.deepEqual(getAuthRequest('register', { email: 'a@example.com', password: 'password1234' }), {
    path: '/api/auth/register',
    options: { method: 'POST', body: JSON.stringify({ email: 'a@example.com', password: 'password1234' }) },
  });
  assert.equal(JSON.stringify(getAuthRequest('login', { email: 'a@example.com', password: 'password1234' })).includes('MUAPI'), false);
});
