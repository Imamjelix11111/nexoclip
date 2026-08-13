import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {readAgentConfig, saveAgentConfig} from './config-store.mjs';

const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vimax-config-'));
  roots.push(root);
  await mkdir(path.join(root, 'configs'), {recursive: true});
  await writeFile(path.join(root, 'configs', 'agent.local.yaml'), [
    'llm:',
    '  model: openai/gpt-oss-20b:free',
    '  api_key: secret-value',
    '',
  ].join('\n'));
  return root;
}

describe('agent model store', () => {
  it('returns only the selectable LLM and image model groups', async () => {
    const config = await readAgentConfig(await fixture());
    expect(config.models).toEqual({
      llm: 'openai/gpt-oss-20b:free',
      image: 'google/gemini-3.1-flash-lite-image',
    });
    expect(config.options.llm.length).toBeGreaterThan(0);
    expect(config.options.image.length).toBeGreaterThan(0);
    expect(JSON.stringify(config)).not.toContain('secret-value');
  });

  it('persists an allowlisted model without changing stored credentials', async () => {
    const root = await fixture();
    await saveAgentConfig(root, {models: {image: 'openai/gpt-5-image-mini'}});
    const saved = await readFile(path.join(root, 'configs', 'agent.local.yaml'), 'utf8');
    expect(saved).toContain('model: openai/gpt-5-image-mini');
    expect(saved).toContain('api_key: secret-value');
  });

  it('rejects fixed groups and models outside the allowlist', async () => {
    const root = await fixture();
    await expect(saveAgentConfig(root, {models: {video: 'bytedance/seedance-2.0'}})).rejects.toThrow(/unknown model group/i);
    await expect(saveAgentConfig(root, {models: {llm: 'not/a-model'}})).rejects.toThrow(/unsupported llm model/i);
  });
});
