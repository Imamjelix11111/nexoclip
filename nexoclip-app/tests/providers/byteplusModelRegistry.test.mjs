import test from 'node:test';
import assert from 'node:assert/strict';
import { getDirectProvider } from '../../src/providers/providerRegistry.js';
import {
  t2iModels,
  i2iModels,
  t2vModels,
  i2vModels,
  OPENROUTER_IMAGE_MODEL_MAP,
  OPENROUTER_VIDEO_MODEL_MAP,
} from '../../packages/studio/src/models.js';

test('maps official BytePlus image model IDs', () => {
  assert.deepEqual(getDirectProvider('dola-seedream-5-0-pro-260628'), { provider: 'byteplus', model: 'dola-seedream-5-0-pro-260628' });
  assert.deepEqual(getDirectProvider('seedream-5-0-260128'), { provider: 'byteplus', model: 'seedream-5-0-260128' });
  assert.deepEqual(getDirectProvider('seedream-5-0-lite-260128'), { provider: 'byteplus', model: 'seedream-5-0-260128' });
  assert.deepEqual(getDirectProvider('seedream-4-5-251128'), { provider: 'byteplus', model: 'seedream-4-5-251128' });
  assert.deepEqual(getDirectProvider('seedream-4-0-250828'), { provider: 'byteplus', model: 'seedream-4-0-250828' });
  assert.deepEqual(getDirectProvider('seedream-3.0-t2i'), { provider: 'byteplus', model: 'seedream-3.0-t2i' });
});

test('maps official BytePlus video model IDs and UI aliases', () => {
  assert.deepEqual(getDirectProvider('dreamina-seedance-2-5-260628'), { provider: 'byteplus', model: 'dreamina-seedance-2-5-260628' });
  assert.deepEqual(getDirectProvider('bytedance/seedance-2.5'), { provider: 'byteplus', model: 'dreamina-seedance-2-5-260628' });
  assert.deepEqual(getDirectProvider('dreamina-seedance-2-0-260128'), { provider: 'byteplus', model: 'dreamina-seedance-2-0-260128' });
  assert.deepEqual(getDirectProvider('dreamina-seedance-2-0-fast-260128'), { provider: 'byteplus', model: 'dreamina-seedance-2-0-fast-260128' });
  assert.deepEqual(getDirectProvider('dreamina-seedance-2-0-mini-260615'), { provider: 'byteplus', model: 'dreamina-seedance-2-0-mini-260615' });
  assert.deepEqual(getDirectProvider('seedance-1-5-pro-251215'), { provider: 'byteplus', model: 'seedance-1-5-pro-251215' });
  assert.deepEqual(getDirectProvider('seedance-v2.0-t2v'), { provider: 'byteplus', model: 'dreamina-seedance-2-0-260128' });
  assert.deepEqual(getDirectProvider('bytedance/seedance-2.0'), { provider: 'byteplus', model: 'dreamina-seedance-2-0-260128' });
});

test('maps the UI Seedream OpenRouter aliases to official BytePlus image models', () => {
  assert.deepEqual(getDirectProvider('bytedance-seed/seedream-5-0-pro'), { provider: 'byteplus', model: 'dola-seedream-5-0-pro-260628' });
  assert.deepEqual(getDirectProvider('bytedance-seed/seedream-4.5'), { provider: 'byteplus', model: 'seedream-4-5-251128' });
});

test('exposes unfiltered Seedream deployments as text and reference-image choices', () => {
  const expected = [
    ['seedream-4.5-unfiltered', 'Seedream 4.5 Unfiltered', 'ep-20260907150312-xx7gf'],
    ['seedream-5.0-lite-unfiltered', 'Seedream 5.0 Lite Unfiltered', 'ep-20260907150433-zg8fr'],
  ];

  for (const [id, name, endpoint] of expected) {
    const textModel = t2iModels.find((model) => model.id === id);
    assert.equal(textModel?.name, name);
    if (id === 'seedream-4.5-unfiltered') assert.deepEqual(textModel.inputs.resolution.enum, ['2K', '4K']);
    const editModel = i2iModels.find((model) => model.id === `${id}-edit`);
    assert.equal(editModel?.name, `${name} Edit`);
    assert.equal(editModel?.maxImages, 10);
    if (id === 'seedream-4.5-unfiltered') assert.deepEqual(editModel.inputs.resolution.enum, ['2K', '4K']);
    assert.equal(OPENROUTER_IMAGE_MODEL_MAP[id], endpoint);
    assert.equal(OPENROUTER_IMAGE_MODEL_MAP[`${id}-edit`], endpoint);
    assert.deepEqual(getDirectProvider(endpoint), { provider: 'byteplus', model: endpoint });
  }
});

test('exposes the unfiltered Seedance 2.5 endpoint with standard duration choices', () => {
  const endpoint = 'ep-20260904190604-p8pjl';
  const textModel = t2vModels.find((model) => model.id === 'seedance-2.5-unfiltered-text-to-video');
  const imageModel = i2vModels.find((model) => model.id === 'seedance-2.5-unfiltered-image-to-video');

  assert.equal(textModel?.name, 'Seedance 2.5 Unfiltered');
  assert.deepEqual(textModel?.inputs?.duration?.enum, [5, 10, 15]);
  assert.equal(imageModel?.name, 'Seedance 2.5 Unfiltered');
  assert.equal(imageModel?.imageField, 'image_url');
  assert.deepEqual(imageModel?.inputs?.duration?.enum, [5, 10, 15]);
  assert.equal(OPENROUTER_VIDEO_MODEL_MAP[textModel.id], endpoint);
  assert.equal(OPENROUTER_VIDEO_MODEL_MAP[imageModel.id], endpoint);
  assert.deepEqual(getDirectProvider(endpoint), { provider: 'byteplus', model: endpoint });
});

test('exposes the complete ByteDance-branded Seedance 2.5 Unfiltered video family', () => {
  const endpoint = 'ep-20260904190604-p8pjl';
  const expected = {
    'seedance-2.5-unfiltered-text-to-video': t2vModels,
    'seedance-2.5-unfiltered-text-to-video-480p': t2vModels,
    'seedance-2.5-unfiltered-image-to-video': i2vModels,
    'seedance-2.5-unfiltered-image-to-video-480p': i2vModels,
    'seedance-2.5-unfiltered-first-last-frame': i2vModels,
    'seedance-2.5-unfiltered-first-last-frame-480p': i2vModels,
    'seedance-2.5-unfiltered-omni-reference': i2vModels,
    'seedance-2.5-unfiltered-omni-reference-480p': i2vModels,
  };

  for (const [id, models] of Object.entries(expected)) {
    const model = models.find((entry) => entry.id === id);
    assert.equal(model?.provider, 'bytedance', `${id} should show the ByteDance logo`);
    assert.equal(model?.provider_name, 'ByteDance', `${id} should have a ByteDance label`);
    assert.equal(OPENROUTER_VIDEO_MODEL_MAP[id], endpoint, `${id} routing`);
    if (id.endsWith('-480p')) assert.deepEqual(model?.inputs?.resolution?.enum, ['480p']);
  }

  assert.equal(i2vModels.find((model) => model.id === 'seedance-2.5-unfiltered-first-last-frame')?.lastImageField, 'last_image');
  assert.equal(i2vModels.find((model) => model.id === 'seedance-2.5-unfiltered-first-last-frame-480p')?.lastImageField, 'last_image');
});

test('maps 3D IDs to no media fallback', () => {
  assert.equal(getDirectProvider('Hyper3D-Gen2'), null);
  assert.equal(getDirectProvider('Hitem3D-2.0'), null);
});
