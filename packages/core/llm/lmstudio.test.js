import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestBody, generate } from './lmstudio.js';

function withMockedFetch(handler) {
  const originalFetch = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = originalFetch; };
}

test('lmstudio adapter uses local OpenAI-compatible endpoint without Authorization by default', async () => {
  const originalBase = process.env.LM_STUDIO_BASE_URL;
  const originalKey = process.env.LM_STUDIO_API_KEY;
  const originalLegacyKey = process.env.LMSTUDIO_API_KEY;
  delete process.env.LM_STUDIO_BASE_URL;
  delete process.env.LM_STUDIO_API_KEY;
  delete process.env.LMSTUDIO_API_KEY;

  let capturedUrl = null;
  let capturedHeaders = null;
  let capturedBody = null;
  const restore = withMockedFetch(async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options?.headers ?? {};
    capturedBody = JSON.parse(options?.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '```html\n<div>ok</div>\n```' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      }),
    };
  });

  try {
    const result = await generate({ model: 'google/gemma-4-e4b', prompt: 'hi', images: [] });
    assert.equal(result.code, '<div>ok</div>');
    assert.equal(result.tokensUsed, 14);
    assert.equal(result.cost, null);
    assert.equal(capturedUrl, 'http://localhost:1234/v1/chat/completions');
    assert.equal(capturedHeaders.Authorization, undefined);
    assert.equal(capturedBody.model, 'google/gemma-4-e4b');
    assert.equal(capturedBody.stream, false);
  } finally {
    restore();
    if (originalBase === undefined) delete process.env.LM_STUDIO_BASE_URL;
    else process.env.LM_STUDIO_BASE_URL = originalBase;
    if (originalKey === undefined) delete process.env.LM_STUDIO_API_KEY;
    else process.env.LM_STUDIO_API_KEY = originalKey;
    if (originalLegacyKey === undefined) delete process.env.LMSTUDIO_API_KEY;
    else process.env.LMSTUDIO_API_KEY = originalLegacyKey;
  }
});

test('lmstudio adapter trims base URL and sends optional API key', async () => {
  const originalBase = process.env.LM_STUDIO_BASE_URL;
  const originalKey = process.env.LM_STUDIO_API_KEY;
  process.env.LM_STUDIO_BASE_URL = ' http://127.0.0.1:1234/v1/ ';
  process.env.LM_STUDIO_API_KEY = '  local-key  ';

  let capturedUrl = null;
  let capturedHeaders = null;
  const restore = withMockedFetch(async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options?.headers ?? {};
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '<main>plain</main>' } }],
        usage: { total_tokens: 3 },
      }),
    };
  });

  try {
    const result = await generate({ model: 'm', prompt: 'hi', images: [] });
    assert.equal(result.code, '<main>plain</main>');
    assert.equal(capturedUrl, 'http://127.0.0.1:1234/v1/chat/completions');
    assert.equal(capturedHeaders.Authorization, 'Bearer local-key');
  } finally {
    restore();
    if (originalBase === undefined) delete process.env.LM_STUDIO_BASE_URL;
    else process.env.LM_STUDIO_BASE_URL = originalBase;
    if (originalKey === undefined) delete process.env.LM_STUDIO_API_KEY;
    else process.env.LM_STUDIO_API_KEY = originalKey;
  }
});

test('lmstudio adapter emits request metadata for progress logging', async () => {
  const originalBase = process.env.LM_STUDIO_BASE_URL;
  const originalKey = process.env.LM_STUDIO_API_KEY;
  const originalLegacyKey = process.env.LMSTUDIO_API_KEY;
  delete process.env.LM_STUDIO_BASE_URL;
  delete process.env.LM_STUDIO_API_KEY;
  delete process.env.LMSTUDIO_API_KEY;

  const events = [];
  const restore = withMockedFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '<div />' } }],
      usage: { total_tokens: 2 },
    }),
  }));

  try {
    await generate({
      model: 'google/gemma-4-e4b',
      prompt: 'hi',
      images: [],
      requestAttempt: 2,
      onBeforeRequest: (event) => events.push(event),
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].provider, 'lmstudio');
    assert.equal(events[0].endpoint, 'http://localhost:1234/v1/chat/completions');
    assert.equal(events[0].method, 'POST');
    assert.equal(events[0].requestAttempt, 2);
    assert.equal(events[0].body.model, 'google/gemma-4-e4b');
  } finally {
    restore();
    if (originalBase === undefined) delete process.env.LM_STUDIO_BASE_URL;
    else process.env.LM_STUDIO_BASE_URL = originalBase;
    if (originalKey === undefined) delete process.env.LM_STUDIO_API_KEY;
    else process.env.LM_STUDIO_API_KEY = originalKey;
    if (originalLegacyKey === undefined) delete process.env.LMSTUDIO_API_KEY;
    else process.env.LMSTUDIO_API_KEY = originalLegacyKey;
  }
});

test('lmstudio request body does not include reasoning settings', () => {
  const body = buildRequestBody({
    model: 'google/gemma-4-e4b',
    prompt: 'hi',
    images: [],
    reasoningEffort: 'high',
  });
  assert.equal(body.reasoningEffort, undefined);
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.reasoning, undefined);
});

test('lmstudio request body includes configured max_tokens', () => {
  const body = buildRequestBody({
    model: 'google/gemma-4-e4b',
    prompt: 'hi',
    images: [],
    maxTokens: 8192,
  });
  assert.equal(body.max_tokens, 8192);
});

test('lmstudio adapter marks empty responses as permanent', async () => {
  const originalBase = process.env.LM_STUDIO_BASE_URL;
  delete process.env.LM_STUDIO_BASE_URL;

  const restore = withMockedFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '' }, finish_reason: 'length' }],
      usage: { total_tokens: 4096, completion_tokens_details: { reasoning_tokens: 4096 } },
    }),
  }));

  try {
    await assert.rejects(
      () => generate({ model: 'google/gemma-4-e4b', prompt: 'hi', images: [] }),
      (error) => {
        assert.match(error.message, /LM Studio: empty response/);
        assert.match(error.message, /finish_reason=length/);
        assert.match(error.message, /reasoning_tokens=4096/);
        assert.match(error.message, /total_tokens=4096/);
        assert.equal(error.permanent, true);
        return true;
      },
    );
  } finally {
    restore();
    if (originalBase === undefined) delete process.env.LM_STUDIO_BASE_URL;
    else process.env.LM_STUDIO_BASE_URL = originalBase;
  }
});

test('lmstudio adapter includes endpoint and cause for fetch failures', async () => {
  const originalBase = process.env.LM_STUDIO_BASE_URL;
  process.env.LM_STUDIO_BASE_URL = 'http://host.docker.internal:1234/v1';

  const restore = withMockedFetch(async () => {
    const error = new TypeError('fetch failed');
    error.cause = { code: 'ECONNREFUSED', address: '10.0.0.80', port: 1234 };
    throw error;
  });

  try {
    await assert.rejects(
      () => generate({ model: 'google/gemma-4-e4b', prompt: 'hi', images: [] }),
      (error) => {
        assert.match(error.message, /LM Studio: fetch failed for http:\/\/host\.docker\.internal:1234\/v1\/chat\/completions/);
        assert.match(error.message, /ECONNREFUSED/);
        assert.match(error.message, /address=10\.0\.0\.80/);
        assert.match(error.message, /port=1234/);
        return true;
      },
    );
  } finally {
    restore();
    if (originalBase === undefined) delete process.env.LM_STUDIO_BASE_URL;
    else process.env.LM_STUDIO_BASE_URL = originalBase;
  }
});
