import test from 'node:test';
import assert from 'node:assert/strict';
import {artifactsFromJobResult, restoreDurableJob, saveDurableJob} from '../../components/vimax/reused/vimaxWorkspaceState.ts';

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

test('maps only validated durable result artifacts into the artifact panel model', () => {
  const artifacts = artifactsFromJobResult({
    artifacts: [
      {path: 'outputs/trailer.mp4', name: 'trailer.mp4', kind: 'video'},
      {path: '../secret', name: 'secret', kind: 'video'},
    ],
  });
  assert.deepEqual(artifacts, [{path: 'outputs/trailer.mp4', name: 'trailer.mp4', kind: 'video'}]);
});

test('returns an empty list when the result has no artifacts key', () => {
  assert.deepEqual(artifactsFromJobResult({}), []);
  assert.deepEqual(artifactsFromJobResult(null), []);
});

test('returns an empty list when artifacts is not an array', () => {
  assert.deepEqual(artifactsFromJobResult({artifacts: 'not-an-array'}), []);
  assert.deepEqual(artifactsFromJobResult({artifacts: {path: 'x'}}), []);
});

test('skips non-object entries inside the artifacts array', () => {
  const artifacts = artifactsFromJobResult({
    artifacts: [null, 'string-entry', 42, {path: 'outputs/ok.mp4', name: 'ok.mp4', kind: 'video'}],
  });
  assert.deepEqual(artifacts, [{path: 'outputs/ok.mp4', name: 'ok.mp4', kind: 'video'}]);
});

test('falls back to document kind for an unrecognized or missing kind', () => {
  const artifacts = artifactsFromJobResult({
    artifacts: [
      {path: 'outputs/a.zip', name: 'a.zip', kind: 'archive'},
      {path: 'outputs/b.txt', name: 'b.txt'},
    ],
  });
  assert.deepEqual(artifacts, [
    {path: 'outputs/a.zip', name: 'a.zip', kind: 'document'},
    {path: 'outputs/b.txt', name: 'b.txt', kind: 'document'},
  ]);
});

test('falls back to the path basename when name is absent or blank', () => {
  const artifacts = artifactsFromJobResult({
    artifacts: [
      {path: 'outputs/nested/trailer.mp4', kind: 'video'},
      {path: 'outputs/blank.mp4', name: '   ', kind: 'video'},
    ],
  });
  assert.deepEqual(artifacts, [
    {path: 'outputs/nested/trailer.mp4', name: 'trailer.mp4', kind: 'video'},
    {path: 'outputs/blank.mp4', name: 'blank.mp4', kind: 'video'},
  ]);
});

test('rejects absolute artifact paths', () => {
  const artifacts = artifactsFromJobResult({
    artifacts: [
      {path: '/etc/passwd', name: 'passwd', kind: 'document'},
      {path: 'outputs/safe.mp4', name: 'safe.mp4', kind: 'video'},
    ],
  });
  assert.deepEqual(artifacts, [{path: 'outputs/safe.mp4', name: 'safe.mp4', kind: 'video'}]);
});
