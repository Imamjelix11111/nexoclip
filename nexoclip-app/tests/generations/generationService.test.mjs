import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImageGenerationInput, validateVimaxGenerationInput, normalizeSaaSImageGenerationResult } from '../../src/services/generationService.js';

test('validates a provider-neutral image generation request', () => {
  assert.deepEqual(validateImageGenerationInput({
    prompt: '  A red fox in snow  ',
    model: 'flux-dev',
    aspectRatio: '1:1',
  }), {
    prompt: 'A red fox in snow',
    model: 'flux-dev',
    parameters: { aspectRatio: '1:1' },
  });
});

test('validates a structured ViMax render request without image-only fields', () => {
  assert.deepEqual(validateVimaxGenerationInput({
    kind: 'vimax_render_video', sessionId: 'session-1', input: { render_mode: 'foreground' }, idempotencyKey: 'r1',
  }), {
    kind: 'vimax_render_video', prompt: 'Render ViMax storyboard video', model: 'vimax',
    operation: 'vimax_render_video',
    parameters: { sessionId: 'session-1', input: { render_mode: 'foreground' } },
  });
});

test('rejects unknown ViMax kinds and invalid session identifiers', () => {
  assert.throws(() => validateVimaxGenerationInput({ kind: 'image', sessionId: 's1' }), /ViMax generation kind is invalid/);
  assert.throws(() => validateVimaxGenerationInput({ kind: 'vimax_render_video', sessionId: '../etc' }), /ViMax session id is invalid/);
});

test('rejects ViMax fields outside the closed admission DTO', () => {
  const request = { kind: 'vimax_render_video', sessionId: 'session-1', input: {}, idempotencyKey: 'r1' };
  for (const field of ['workspaceId', 'tenantRoot', 'credentials', 'parameters']) {
    assert.throws(() => validateVimaxGenerationInput({ ...request, [field]: 'untrusted' }), /ViMax generation request is invalid/);
  }
});

test('rejects an image generation request without a prompt', () => {
  assert.throws(() => validateImageGenerationInput({ model: 'flux-dev' }), /Generation prompt is required/);
});

test('preserves Canvas model-specific aspect ratios', () => {
  assert.deepEqual(validateImageGenerationInput({
    prompt: 'wide cinematic fox', model: 'google/gemini-3-pro-image', aspectRatio: '21:9',
  }).parameters, { aspectRatio: '21:9' });
});

test('rejects unsupported image generation parameters', () => {
  assert.throws(() => validateImageGenerationInput({ prompt: 'fox', model: 'flux-dev', aspectRatio: '2:1' }), /Aspect ratio is invalid/);
});

test('normalizes a SaaS generation response for the existing image studio contract', () => {
  assert.deepEqual(normalizeSaaSImageGenerationResult({
    id: 'g1', status: 'succeeded', result: { url: 'local://download?key=x' },
    outputs: [{ download: { url: 'local://download?key=y' } }],
  }), { url: 'local://download?key=y', generationId: 'g1', status: 'succeeded' });
});
