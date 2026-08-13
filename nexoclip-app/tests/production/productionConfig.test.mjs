import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProductionEnvironment } from '../../scripts/production-config.mjs';

test('accepts the minimum server and worker production environment', () => {
  assert.deepEqual(validateProductionEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://user:pass@db.example/nexoclip',
    MUAPI_API_KEY: 'server-only-key',
    MUAPI_BASE_URL: 'https://api.muapi.ai',
    LOCAL_OBJECT_STORAGE_SECRET: 'long-production-secret',
  }), { ok: true, errors: [] });
});

test('rejects missing or unsafe production secrets without echoing values', () => {
  const result = validateProductionEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://user:pass@db.example/nexoclip',
    MUAPI_API_KEY: 'secret-value',
    LOCAL_OBJECT_STORAGE_SECRET: 'development-only-change-me',
    NEXT_PUBLIC_MUAPI_API_KEY: 'public-secret',
  });

  assert.equal(result.ok, false);
  assert.match(result.errors.join('\n'), /MUAPI_BASE_URL/);
  assert.match(result.errors.join('\n'), /LOCAL_OBJECT_STORAGE_SECRET/);
  assert.match(result.errors.join('\n'), /NEXT_PUBLIC_MUAPI_API_KEY/);
  assert.doesNotMatch(result.errors.join('\n'), /secret-value|public-secret/);
});

test('does not require production-only values for development', () => {
  assert.deepEqual(validateProductionEnvironment({ NODE_ENV: 'development' }), { ok: true, errors: [] });
});
