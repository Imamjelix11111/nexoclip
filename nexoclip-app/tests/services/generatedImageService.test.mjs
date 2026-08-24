import test from 'node:test';
import assert from 'node:assert/strict';
import { persistGeneratedImage } from '../../src/services/generatedImageService.js';

function fakeStorage() {
  const calls = [];
  return { calls, put: async (key, body, contentType) => { calls.push({ key, body, contentType }); return `https://cdn.example/${key}`; } };
}

const fakeQuery = async (_sql, params) => ({ rows: [{ id: 'asset-1', workspace_id: params[0], storage_key: params[1] }] });

test('persists a base64 data URL output', async () => {
  const storage = fakeStorage();
  const result = await persistGeneratedImage({ workspaceId: 'ws-1', dataUrl: 'data:image/png;base64,AAAA', storage, query: fakeQuery });
  assert.equal(storage.calls[0].contentType, 'image/png');
  assert.match(result.url, /^https:\/\/cdn\.example\//);
});

test('downloads and persists a hosted https image URL (e.g. BytePlus pre-signed link)', async () => {
  const storage = fakeStorage();
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://ark-acg.example/out.jpeg?sig=abc');
    return { ok: true, headers: { get: (key) => (key.toLowerCase() === 'content-type' ? 'image/jpeg' : null) }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  const result = await persistGeneratedImage({ workspaceId: 'ws-1', dataUrl: 'https://ark-acg.example/out.jpeg?sig=abc', storage, fetch: fetchImpl, query: fakeQuery });
  assert.equal(storage.calls[0].contentType, 'image/jpeg');
  assert.equal(storage.calls[0].key.endsWith('.jpg'), true);
  assert.match(result.url, /^https:\/\/cdn\.example\//);
});

test('rejects an unsupported content type from a hosted URL', async () => {
  const storage = fakeStorage();
  const fetchImpl = async () => ({ ok: true, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0) });
  await assert.rejects(
    persistGeneratedImage({ workspaceId: 'ws-1', dataUrl: 'https://example.com/not-an-image', storage, fetch: fetchImpl }),
    (error) => { assert.equal(error.code, 'INVALID_IMAGE_OUTPUT'); return true; },
  );
});

test('rejects neither a data URL nor an http(s) URL', async () => {
  const storage = fakeStorage();
  await assert.rejects(
    persistGeneratedImage({ workspaceId: 'ws-1', dataUrl: 'not-a-url', storage, fetch: async () => { throw new Error('should not be called'); } }),
    (error) => { assert.equal(error.code, 'INVALID_IMAGE_OUTPUT'); return true; },
  );
});
