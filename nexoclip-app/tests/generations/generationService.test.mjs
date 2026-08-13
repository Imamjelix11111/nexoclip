import test from 'node:test';
import assert from 'node:assert/strict';
import { validateImageGenerationInput, normalizeSaaSImageGenerationResult } from '../../src/services/generationService.js';

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

test('rejects an image generation request without a prompt', () => {
  assert.throws(() => validateImageGenerationInput({ model: 'flux-dev' }), /Generation prompt is required/);
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
