import test from 'node:test';
import assert from 'node:assert/strict';

const { validateVideoGenerationInput } = await import('../../src/services/generationService.js');

test('validates a durable SaaS video request and preserves provider parameters', () => {
  assert.deepEqual(validateVideoGenerationInput({
    kind: 'video', prompt: 'A fox runs', model: 'bytedance/seedance-2.0',
    parameters: { aspectRatio: '9:16', duration: 5, resolution: '720p', seed: 42, referenceImages: ['/api/assets/a/download'] },
  }), {
    kind: 'video', prompt: 'A fox runs', model: 'bytedance/seedance-2.0',
    parameters: { aspectRatio: '9:16', duration: 5, resolution: '720p', seed: 42, referenceImages: ['/api/assets/a/download'] },
  });
});

test('rejects unsafe video reference URLs', () => {
  assert.throws(() => validateVideoGenerationInput({ kind: 'video', prompt: 'x', model: 'bytedance/seedance-2.0', parameters: { referenceVideos: ['https://untrusted.example/video.mp4'] } }), /reference/i);
});
