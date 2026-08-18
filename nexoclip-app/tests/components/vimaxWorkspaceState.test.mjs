import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreDurableJob, saveDurableJob} from '../../components/vimax/reused/vimaxWorkspaceState.ts';

test('restores only the durable job belonging to the selected session', () => {
  const storage = new Map();
  saveDurableJob('session-a', {id: 'job-a', status: 'running'}, storage);
  saveDurableJob('session-b', {id: 'job-b', status: 'queued'}, storage);
  assert.deepEqual(restoreDurableJob('session-a', storage), {id: 'job-a', status: 'running'});
  assert.equal(restoreDurableJob('session-c', storage), undefined);
});

test('ignores malformed persisted durable job data', () => {
  const storage = new Map([['vimax-durable-jobs', '{bad json']]);
  assert.equal(restoreDurableJob('session-a', storage), undefined);
});
