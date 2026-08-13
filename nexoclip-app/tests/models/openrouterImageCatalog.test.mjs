import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENROUTER_IMAGE_MODEL_MAP,
  openRouterT2IModels,
  openRouterI2IModels,
} from '../../packages/studio/src/models.js';

test('maps Nano Banana to the OpenRouter image model', () => {
  assert.equal(OPENROUTER_IMAGE_MODEL_MAP['nano-banana'], 'google/gemini-2.5-flash-image');
});

test('keeps only explicitly mapped text-to-image models', () => {
  assert.ok(openRouterT2IModels.some((model) => model.id === 'nano-banana'));
  assert.ok(openRouterT2IModels.some((model) => model.id === 'gpt-image-2'));
  assert.ok(!openRouterT2IModels.some((model) => model.id === 'flux-dev'));
  assert.ok(!openRouterT2IModels.some((model) => model.id === 'ai-anime-generator'));
});

test('keeps only explicitly mapped image-to-image models', () => {
  assert.ok(openRouterI2IModels.some((model) => model.id === 'nano-banana-edit'));
  assert.ok(openRouterI2IModels.some((model) => model.id === 'gpt-image-2-edit'));
  assert.ok(!openRouterI2IModels.some((model) => model.id === 'ai-image-upscaler'));
});

test('filtered catalogs preserve the original model objects', () => {
  const model = openRouterT2IModels.find((item) => item.id === 'nano-banana');
  assert.equal(model.endpoint, 'nano-banana');
  assert.equal(model.provider, 'google');
});
