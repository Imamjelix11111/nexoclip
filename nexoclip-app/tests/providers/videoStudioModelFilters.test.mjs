import test from 'node:test';
import assert from 'node:assert/strict';
import {
  v2vModels,
  openRouterV2VModels,
  OPENROUTER_V2V_MODEL_MAP,
} from '../../packages/studio/src/models.js';

test('openRouterV2VModels only contains models present in OPENROUTER_V2V_MODEL_MAP', () => {
  assert.ok(openRouterV2VModels.length > 0, 'expected at least one mapped V2V model');
  for (const model of openRouterV2VModels) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(OPENROUTER_V2V_MODEL_MAP, model.id),
      `${model.id} should be a key in OPENROUTER_V2V_MODEL_MAP`,
    );
  }
});

test('openRouterV2VModels excludes pure-MuAPI V2V models with no OpenRouter mapping', () => {
  const unmapped = v2vModels.find((m) => !OPENROUTER_V2V_MODEL_MAP[m.id]);
  assert.ok(unmapped, 'fixture assumption broken: expected at least one unmapped v2v model to exist');
  assert.equal(
    openRouterV2VModels.some((m) => m.id === unmapped.id),
    false,
    `${unmapped.id} has no OpenRouter mapping and must not appear in openRouterV2VModels`,
  );
});

test('openRouterV2VModels includes the three known-mapped models', () => {
  const ids = openRouterV2VModels.map((m) => m.id);
  assert.ok(ids.includes('runway-aleph-v2v'));
  assert.ok(ids.includes('wan2.7-video-extend'));
  assert.ok(ids.includes('wan2.7-video-edit'));
});
