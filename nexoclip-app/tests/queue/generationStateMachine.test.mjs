import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERATION_STATES,
  transitionGeneration,
  retryDelayMs,
  isRetryableFailure,
  GenerationTransitionError,
} from '../../src/queue/generationStateMachine.js';

test('allows the provider-neutral queued to running to processing to succeeded flow', () => {
  assert.equal(transitionGeneration('queued', 'running'), 'running');
  assert.equal(transitionGeneration('running', 'processing'), 'processing');
  assert.equal(transitionGeneration('processing', 'succeeded'), 'succeeded');
});

test('rejects invalid and terminal transitions', () => {
  assert.throws(() => transitionGeneration('queued', 'succeeded'), GenerationTransitionError);
  assert.throws(() => transitionGeneration('succeeded', 'running'), GenerationTransitionError);
  assert.throws(() => transitionGeneration('processing', 'queued'), GenerationTransitionError);
  assert.deepEqual(GENERATION_STATES, ['queued', 'running', 'processing', 'succeeded', 'failed']);
});

test('classifies retryable failures and bounds exponential backoff', () => {
  assert.equal(isRetryableFailure({ retryable: true }), true);
  assert.equal(isRetryableFailure({ code: 'PROVIDER_UNAVAILABLE' }), true);
  assert.equal(isRetryableFailure({ code: 'PROVIDER_INVALID_REQUEST' }), false);
  assert.equal(retryDelayMs(1, { baseDelayMs: 100, maxDelayMs: 500 }), 100);
  assert.equal(retryDelayMs(3, { baseDelayMs: 100, maxDelayMs: 500 }), 400);
  assert.equal(retryDelayMs(5, { baseDelayMs: 100, maxDelayMs: 500 }), 500);
});

test('timeout errors are retryable with bounded attempts', () => {
  assert.equal(isRetryableFailure({ code: 'GENERATION_TIMEOUT' }), true);
  assert.equal(isRetryableFailure({ code: 'GENERATION_TIMEOUT', retryable: false }), false);
});
