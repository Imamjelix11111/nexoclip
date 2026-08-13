import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {parse, stringify} from 'yaml';

export const MODEL_OPTIONS = {
  llm: [
    {id: 'openai/gpt-oss-20b:free', label: 'GPT OSS 20B'},
    {id: 'openai/gpt-oss-20b', label: 'GPT OSS 20B (paid)'},
    {id: 'openai/gpt-5-nano', label: 'GPT-5 Nano'},
  ],
  image: [
    {id: 'google/gemini-3.1-flash-lite-image', label: 'Nano Banana 2 Lite'},
    {id: 'google/gemini-2.5-flash-image', label: 'Nano Banana'},
    {id: 'openai/gpt-5-image-mini', label: 'GPT-5 Image Mini'},
  ],
};

const DEFAULT_MODELS = {
  llm: 'openai/gpt-oss-20b:free',
  image: 'google/gemini-3.1-flash-lite-image',
};

export async function readAgentConfig(workspaceRoot) {
  const {payload} = await loadConfig(workspaceRoot);
  return publicConfig(payload);
}

export async function saveAgentConfig(workspaceRoot, input) {
  if (!input || typeof input !== 'object' || !input.models || typeof input.models !== 'object') {
    throw new Error('Model selections are required');
  }
  const {configPath, payload} = await loadConfig(workspaceRoot);
  for (const [group, model] of Object.entries(input.models)) {
    if (!(group in MODEL_OPTIONS)) throw new Error(`Unknown model group: ${group}`);
    if (!MODEL_OPTIONS[group].some((option) => option.id === model)) {
      throw new Error(`Unsupported ${group} model`);
    }
    const section = payload[group] && typeof payload[group] === 'object' ? payload[group] : {};
    section.model = model;
    payload[group] = section;
  }
  await mkdir(path.dirname(configPath), {recursive: true, mode: 0o700});
  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, stringify(payload, {lineWidth: 0}), {mode: 0o600});
  await rename(temporaryPath, configPath);
  return publicConfig(payload);
}

async function loadConfig(workspaceRoot) {
  const configPath = path.join(workspaceRoot, 'configs', 'agent.local.yaml');
  let text = '';
  try {
    text = await readFile(configPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const payload = text ? parse(text) : {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('configs/agent.local.yaml must be a YAML mapping');
  }
  return {configPath, payload};
}

function publicConfig(payload) {
  const models = Object.fromEntries(Object.entries(MODEL_OPTIONS).map(([group, options]) => {
    const configured = payload[group]?.model;
    const model = options.some((option) => option.id === configured) ? configured : DEFAULT_MODELS[group];
    return [group, model];
  }));
  return {models, options: MODEL_OPTIONS};
}
