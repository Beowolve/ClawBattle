import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './ollama.js';

function withMockedFetch(handler) {
  const originalFetch = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = originalFetch; };
}

test('ollama adapter omits Authorization header when no API key is set', async () => {
  const originalKey = process.env.OLLAMA_API_KEY;
  const originalBase = process.env.OLLAMA_BASE_URL;
  delete process.env.OLLAMA_API_KEY;
  delete process.env.OLLAMA_BASE_URL;

  let capturedHeaders = null;
  let capturedUrl = null;
  const restore = withMockedFetch(async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options?.headers ?? {};
    return {
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '```html\n<div>ok</div>\n```' }, eval_count: 5 }),
    };
  });

  try {
    const result = await generate({ model: 'llama3', prompt: 'hi', images: [] });
    assert.equal(result.code, '<div>ok</div>');
    assert.equal(capturedUrl, 'http://localhost:11434/api/chat');
    assert.equal(capturedHeaders.Authorization, undefined);
  } finally {
    restore();
    if (originalKey === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalBase;
  }
});

test('ollama adapter sends Authorization: Bearer when OLLAMA_API_KEY is set', async () => {
  const originalKey = process.env.OLLAMA_API_KEY;
  const originalBase = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_API_KEY = 'sk-ollama-test';
  process.env.OLLAMA_BASE_URL = 'https://ollama.com';

  let capturedHeaders = null;
  let capturedUrl = null;
  const restore = withMockedFetch(async (url, options) => {
    capturedUrl = url;
    capturedHeaders = options?.headers ?? {};
    return {
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '```html\n<div>cloud</div>\n```' }, eval_count: 9 }),
    };
  });

  try {
    const result = await generate({ model: 'gpt-oss:120b', prompt: 'hi', images: [] });
    assert.equal(result.code, '<div>cloud</div>');
    assert.equal(capturedUrl, 'https://ollama.com/api/chat');
    assert.equal(capturedHeaders.Authorization, 'Bearer sk-ollama-test');
  } finally {
    restore();
    if (originalKey === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = originalKey;
    if (originalBase === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalBase;
  }
});

test('ollama adapter trims whitespace in OLLAMA_API_KEY', async () => {
  const originalKey = process.env.OLLAMA_API_KEY;
  process.env.OLLAMA_API_KEY = '  padded-key  ';

  let capturedHeaders = null;
  const restore = withMockedFetch(async (_url, options) => {
    capturedHeaders = options?.headers ?? {};
    return {
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '```html\n<div>ok</div>\n```' }, eval_count: 1 }),
    };
  });

  try {
    await generate({ model: 'llama3', prompt: 'hi', images: [] });
    assert.equal(capturedHeaders.Authorization, 'Bearer padded-key');
  } finally {
    restore();
    if (originalKey === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = originalKey;
  }
});

test('ollama adapter treats blank OLLAMA_API_KEY as unset', async () => {
  const originalKey = process.env.OLLAMA_API_KEY;
  process.env.OLLAMA_API_KEY = '   ';

  let capturedHeaders = null;
  const restore = withMockedFetch(async (_url, options) => {
    capturedHeaders = options?.headers ?? {};
    return {
      ok: true,
      status: 200,
      json: async () => ({ message: { content: '```html\n<div>ok</div>\n```' }, eval_count: 1 }),
    };
  });

  try {
    await generate({ model: 'llama3', prompt: 'hi', images: [] });
    assert.equal(capturedHeaders.Authorization, undefined);
  } finally {
    restore();
    if (originalKey === undefined) delete process.env.OLLAMA_API_KEY;
    else process.env.OLLAMA_API_KEY = originalKey;
  }
});
