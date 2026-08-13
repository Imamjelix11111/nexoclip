import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjectInput } from '../../src/services/projectService.js';

test('validates and normalizes project input', () => {
  assert.deepEqual(validateProjectInput({ name: ' My Project ' }), {
    name: 'My Project', slug: 'my-project', description: null,
  });
});

test('rejects an empty project name', () => {
  assert.throws(() => validateProjectInput({ name: ' ' }), /Project name is required/);
});
