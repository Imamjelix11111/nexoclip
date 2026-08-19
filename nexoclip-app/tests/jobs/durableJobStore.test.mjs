import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberActiveJob, forgetActiveJob, restoreActiveJobs } from '../../src/lib/jobs/durableJobStore.js';

function mapStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}

test('remembers and restores active jobs per workspace', () => {
  const s = mapStorage();
  rememberActiveJob('ws-1', 'j1', s);
  rememberActiveJob('ws-1', 'j2', s);
  rememberActiveJob('ws-2', 'j9', s);
  assert.deepEqual(restoreActiveJobs('ws-1', s).sort(), ['j1', 'j2']);
  assert.deepEqual(restoreActiveJobs('ws-2', s), ['j9']);
});

test('forgetActiveJob drops only that id', () => {
  const s = mapStorage();
  rememberActiveJob('ws-1', 'j1', s);
  rememberActiveJob('ws-1', 'j2', s);
  forgetActiveJob('ws-1', 'j1', s);
  assert.deepEqual(restoreActiveJobs('ws-1', s), ['j2']);
});

test('restore tolerates missing and malformed storage', () => {
  assert.deepEqual(restoreActiveJobs('ws-1', mapStorage()), []);
  assert.deepEqual(restoreActiveJobs('ws-1', mapStorage({ 'nexoclip-active-jobs': '{bad json' })), []);
  assert.deepEqual(restoreActiveJobs('ws-1', mapStorage({ 'nexoclip-active-jobs': '5' })), []);
});

test('remembering the same id twice does not duplicate it', () => {
  const s = mapStorage();
  rememberActiveJob('ws-1', 'j1', s);
  rememberActiveJob('ws-1', 'j1', s);
  assert.deepEqual(restoreActiveJobs('ws-1', s), ['j1']);
});
