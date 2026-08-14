import test from 'node:test';
import assert from 'node:assert/strict';
import { createStoryboardRuntimeClient } from '../../src/queue/storyboardRuntimeClient.js';

test('posts only structured worker-owned execution data with the service token', async () => {
  let captured;
  const fetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({ ok: true, result: {} }));
  };
  const client = createStoryboardRuntimeClient({ baseUrl: 'http://ai-storyboard:4173', token: 'secret', fetch });

  await client.execute({
    id: 'g1', workspace_id: 'w1', kind: 'vimax_render_video', parameters: { sessionId: 's1', ignored: 'nope' }, prompt: 'ignored',
  });

  assert.equal(captured.url, 'http://ai-storyboard:4173/internal/v1/jobs/g1/execute');
  assert.equal(captured.init.headers['X-NexoClip-Runtime-Token'], 'secret');
  assert.deepEqual(JSON.parse(captured.init.body), {
    workspace_id: 'w1', kind: 'vimax_render_video', session_id: 's1', input: {},
  });
});

test('drops unknown runtime input fields', async () => {
  let body;
  const client = createStoryboardRuntimeClient({
    baseUrl: 'http://ai-storyboard:4173', token: 'secret', fetch: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ ok: true }));
    },
  });

  await client.execute({
    id: 'g1', workspace_id: 'w1', kind: 'vimax_narrative_planning',
    parameters: { sessionId: 's1', input: { idea: 'moon cat', unknown: 'drop' } },
  });

  assert.deepEqual(body.input, { idea: 'moon cat' });
});

test('returns a safe error for a failed runtime response', async () => {
  const client = createStoryboardRuntimeClient({
    baseUrl: 'http://ai-storyboard:4173', token: 'secret', fetch: async () => new Response('runtime details', { status: 500 }),
  });

  await assert.rejects(
    client.execute({ id: 'g1', workspace_id: 'w1', kind: 'vimax_render_video', parameters: {} }),
    /Storyboard runtime request failed with status 500/,
  );
});
