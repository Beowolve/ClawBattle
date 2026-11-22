import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestBody, generate } from './openai.js';

function withMockedFetch(handler) {
  const originalFetch = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = originalFetch; };
}

test('openai adapter calculates cost from usage tokens', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';

  const restore = withMockedFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '```html\n<div>ok</div>\n```' } }],
      usage: {
        prompt_tokens: 1_000_000,
        completion_tokens: 100_000,
        total_tokens: 1_100_000,
        prompt_tokens_details: { cached_tokens: 200_000 },
      },
    }),
  }));

  try {
    const result = await generate({
      model: 'gpt-5.4-mini-2026-03-17',
      prompt: 'test',
      images: [],
    });

    assert.equal(result.code, '<div>ok</div>');
    assert.equal(result.tokensUsed, 1_100_000);
    assert.equal(result.cost, 1.065);
  } finally {
    restore();
    process.env.OPENAI_API_KEY = originalKey;
  }
});

test('openai adapter leaves cost null when pricing is unknown', async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';

  const restore = withMockedFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '```html\n<div>ok</div>\n```' } }],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 20,
        total_tokens: 120,
      },
    }),
  }));

  try {
    const result = await generate({
      model: 'unknown-model',
      prompt: 'test',
      images: [],
    });

    assert.equal(result.cost, null);
  } finally {
    restore();
    process.env.OPENAI_API_KEY = originalKey;
  }
});

test('openai adapter omits reasoning_effort when reasoningEffort="default"', () => {
  const body = buildRequestBody({
    model: 'gpt-5.4',
    prompt: 'test',
    images: [],
    reasoningEffort: 'default',
  });
  assert.equal(body.reasoning_effort, undefined);
});

test('openai adapter includes the finish reason when output is empty', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{ message: { content: '' }, finish_reason: 'length' }],
  }));
  await assert.rejects(generate({ model: 'gpt-5.4', prompt: 'test' }), /finish_reason=length/);
});

test('openai adapter preserves the content filter code on API errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    error: { message: 'The request was blocked', code: 'content_filter' },
  }, { status: 400 }));
  await assert.rejects(generate({ model: 'gpt-5.4', prompt: 'test' }), { code: 'content_filter' });
});

test('openai adapter sends explicit reasoning_effort values', () => {
  const body = buildRequestBody({
    model: 'gpt-5.4',
    prompt: 'test',
    images: [],
    reasoningEffort: 'xhigh',
  });
  assert.equal(body.reasoning_effort, 'xhigh');
});
