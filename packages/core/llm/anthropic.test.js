import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestBody, generate } from './anthropic.js';

const model = 'claude-sonnet-4-6';

function setApiKey(t, key) {
  const previous = process.env.ANTHROPIC_API_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previous;
  });
  if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = key;
}

test('anthropic request preserves the target and previous-render image order', () => {
  const body = buildRequestBody({ model, prompt: 'Recreate the target', images: [Buffer.from('target'), Buffer.from('previous')] });
  assert.deepEqual(body, {
    model,
    max_tokens: 8192,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Recreate the target' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'dGFyZ2V0' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'cHJldmlvdXM=' } },
    ] }],
  });
});

test('anthropic authenticates directly, forwards cancellation and reads text and usage', async (t) => {
  setApiKey(t, 'test-key');
  const { signal } = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['x-api-key'], 'test-key');
    assert.equal(request.headers['anthropic-version'], '2026-10-21');
    assert.equal(request.signal, signal);
    assert.deepEqual(JSON.parse(request.body), buildRequestBody({ model, prompt: 'test' }));
    return Response.json({
      content: [
        { type: 'thinking', thinking: 'ignored' },
        { type: 'text', text: '```html\n<div>ok</div>\n```' },
      ],
      usage: { input_tokens: 800_000, cache_read_input_tokens: 200_000, output_tokens: 100_000 },
    });
  });

  assert.deepEqual(await generate({ model, prompt: 'test', signal }), {
    code: '<div>ok</div>', tokensUsed: 1_100_000, cost: 3.96,
  });
});

test('anthropic reports a missing API key before sending a request', async (t) => {
  setApiKey(t);
  const fetch = t.mock.method(globalThis, 'fetch');
  await assert.rejects(generate({ model, prompt: 'test' }), /ANTHROPIC_API_KEY/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('anthropic distinguishes authentication errors from retryable rate limits', async (t) => {
  setApiKey(t, 'test-key');
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({
    error: { message: 'Invalid API key' },
  }, { status: 401 }));

  await assert.rejects(generate({ model, prompt: 'test' }), { message: 'Anthropic: Invalid API key', permanent: true });
  fetch.mock.mockImplementation(async () => new Response('Too many requests', { status: 429 }));
  await assert.rejects(generate({ model, prompt: 'test' }), { message: 'Anthropic: HTTP 429', permanent: false });
});
