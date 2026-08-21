import test from 'node:test';
import assert from 'node:assert/strict';
import { historyItemsFromJobs } from '../../components/DurableJobHistory.js';

test('keeps only succeeded jobs with an output url, newest-first order preserved', () => {
  const jobs = [
    { id: 'a', kind: 'image', status: 'succeeded', result: { kind: 'image', title: 'One', outputUrl: 'https://x/a.png' } },
    { id: 'b', kind: 'image', status: 'running', result: null },
    { id: 'c', kind: 'image', status: 'succeeded', result: { kind: 'image', title: 'Two', outputUrl: 'https://x/c.png' } },
  ];
  const items = historyItemsFromJobs(jobs);
  assert.deepEqual(items, [
    { id: 'a', url: 'https://x/a.png', title: 'One', kind: 'image' },
    { id: 'c', url: 'https://x/c.png', title: 'Two', kind: 'image' },
  ]);
});
