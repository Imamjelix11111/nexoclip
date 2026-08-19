import test from 'node:test';
import assert from 'node:assert/strict';
import { toJobListItem } from '../../src/lib/jobs/jobDisplay.js';

test('uses the result display contract when present', () => {
  const item = toJobListItem({
    id: 'j1', kind: 'video', status: 'succeeded',
    result: { kind: 'video', title: 'Beach render', outputUrl: 'https://x/y.mp4', thumbnailUrl: 'https://x/t.png' },
  });
  assert.deepEqual(item, {
    id: 'j1', kind: 'video', title: 'Beach render', status: 'succeeded',
    outputUrl: 'https://x/y.mp4', thumbnailUrl: 'https://x/t.png',
  });
});

test('falls back to a kind-based title when result is missing', () => {
  const item = toJobListItem({ id: 'j2', kind: 'image', status: 'running', result: null });
  assert.equal(item.title, 'Image generation');
  assert.equal(item.status, 'running');
  assert.equal(item.outputUrl, null);
});
