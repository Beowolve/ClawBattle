import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestBody, generate } from './anthropic.js';

const model = 'claude-sonnet-4-6';

function setEnv(t, name, value) {
  const previous = process.env[name];
  t.after(() => {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  });
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('anthropic request defaults to 16384 tokens and preserves the image order', (t) => {
  setEnv(t, 'ANTHROPIC_MAX_TOKENS');
  const body = buildRequestBody({ model, prompt: 'Recreate the target', images: [Buffer.from('target'), Buffer.from('previous')], reasoningEffort: 'default' });
  assert.deepEqual(body, {
    model,
    max_tokens: 16384,
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'Recreate the target' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'dGFyZ2V0' } },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'cHJldmlvdXM=' } },
    ] }],
  });
});

test('anthropic authenticates directly, forwards cancellation and reads text and usage', async (t) => {
  setEnv(t, 'ANTHROPIC_API_KEY', 'test-key');
  setEnv(t, 'ANTHROPIC_MAX_TOKENS', '32768');
  const { signal } = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url, request) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['x-api-key'], 'test-key');
    assert.equal(request.headers['anthropic-version'], '2026-10-21');
    assert.equal(request.signal, signal);
    assert.equal(JSON.parse(request.body).max_tokens, 32768);
    assert.deepEqual(JSON.parse(request.body).output_config, { effort: 'medium' });
    assert.deepEqual(JSON.parse(request.body), buildRequestBody({ model, prompt: 'test', reasoningEffort: 'medium' }));
    return Response.json({
      content: [
        { type: 'thinking', thinking: 'ignored' },
        { type: 'text', text: '```html\n<div>ok</div>\n```' },
      ],
      usage: { input_tokens: 800_000, cache_read_input_tokens: 200_000, output_tokens: 100_000 },
    });
  });

  assert.deepEqual(await generate({ model, prompt: 'test', signal, reasoningEffort: 'medium' }), {
    code: '<div>ok</div>', tokensUsed: 1_100_000, cost: 3.96,
  });
});

test('anthropic omits unsupported effort levels from the request', () => {
  assert.equal(buildRequestBody({ model, prompt: 'test', reasoningEffort: 'xhigh' }).output_config, undefined);
});

test('anthropic reports a missing API key before sending a request', async (t) => {
  setEnv(t, 'ANTHROPIC_API_KEY');
  const fetch = t.mock.method(globalThis, 'fetch');
  await assert.rejects(generate({ model, prompt: 'test' }), /ANTHROPIC_API_KEY/);
  assert.equal(fetch.mock.callCount(), 0);
});

test('anthropic rejects an invalid token limit before sending a request', async (t) => {
  setEnv(t, 'ANTHROPIC_API_KEY', 'test-key');
  setEnv(t, 'ANTHROPIC_MAX_TOKENS', '16384x');
  const fetch = t.mock.method(globalThis, 'fetch');
  await assert.rejects(generate({ model, prompt: 'test' }), { message: /ANTHROPIC_MAX_TOKENS/, permanent: true });
  assert.equal(fetch.mock.callCount(), 0);
});

test('anthropic distinguishes authentication errors from retryable rate limits', async (t) => {
  setEnv(t, 'ANTHROPIC_API_KEY', 'test-key');
  setEnv(t, 'ANTHROPIC_MAX_TOKENS', '');
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({
    error: { message: 'Invalid API key' },
  }, { status: 401 }));

  await assert.rejects(generate({ model, prompt: 'test' }), { message: 'Anthropic: Invalid API key', permanent: true });
  fetch.mock.mockImplementation(async () => new Response('Too many requests', { status: 429 }));
  await assert.rejects(generate({ model, prompt: 'test' }), { message: 'Anthropic: HTTP 429', permanent: false });
});
