import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generate } from './openrouter.js';

function withMockedFetch(handler) {
  const originalFetch = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = originalFetch; };
}

async function withProviderConfigFile(config, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawbattle-openrouter-config-'));
  const filePath = path.join(dir, 'openrouter.providers.json');
  fs.writeFileSync(filePath, JSON.stringify(config), 'utf8');

  try {
    return await fn(filePath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('openrouter adapter uses ClawBattle site as default HTTP-Referer', async () => {
  const original = {
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_HTTP_REFERER: process.env.OPENROUTER_HTTP_REFERER,
    OPENROUTER_APP_TITLE: process.env.OPENROUTER_APP_TITLE,
    OPENROUTER_PROVIDER_CONFIG_PATH: process.env.OPENROUTER_PROVIDER_CONFIG_PATH,
  };
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_HTTP_REFERER;
  delete process.env.OPENROUTER_APP_TITLE;
  delete process.env.OPENROUTER_PROVIDER_CONFIG_PATH;

  let capturedHeaders = null;
  const restore = withMockedFetch(async (_url, options) => {
    capturedHeaders = options?.headers ?? null;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '```html\n<div>ok</div>\n```' } }],
        usage: { total_tokens: 12, cost: 0.001 },
      }),
    };
  });

  try {
    const result = await generate({ model: 'moonshotai/kimi-k2.6', prompt: 'test', images: [] });
    assert.equal(result.code, '<div>ok</div>');
    assert.equal(capturedHeaders['HTTP-Referer'], 'https://beowolve.github.io/ClawBattle/');
    assert.equal(capturedHeaders['X-Title'], 'ClawBattle');
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = original.OPENROUTER_API_KEY;
    process.env.OPENROUTER_HTTP_REFERER = original.OPENROUTER_HTTP_REFERER;
    process.env.OPENROUTER_APP_TITLE = original.OPENROUTER_APP_TITLE;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = original.OPENROUTER_PROVIDER_CONFIG_PATH;
  }
});

test('openrouter adapter accepts multimodal content arrays and extracts code', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_PROVIDER_CONFIG_PATH;

  const restore = withMockedFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: {
          content: [
            { type: 'text', text: '```html\n<div>array-content</div>\n```' },
          ],
        },
      }],
      usage: { total_tokens: 7 },
    }),
  }));

  try {
    const result = await generate({ model: 'moonshotai/kimi-k2.6', prompt: 'test', images: [] });
    assert.equal(result.code, '<div>array-content</div>');
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter reports finish_reason for empty responses', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_PROVIDER_CONFIG_PATH;

  const restore = withMockedFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content: '' }, finish_reason: 'length' }],
      usage: { total_tokens: 0 },
    }),
  }));

  try {
    await assert.rejects(
      () => generate({ model: 'moonshotai/kimi-k2.6', prompt: 'test', images: [] }),
      (err) => {
        assert.match(err.message, /OpenRouter: empty response/);
        assert.match(err.message, /finish_reason=length/);
        return true;
      },
    );
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter disables reasoning entirely when reasoningEffort="none"', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_PROVIDER_CONFIG_PATH;

  let capturedBody = null;
  const restore = withMockedFetch(async (_url, options) => {
    capturedBody = JSON.parse(options?.body ?? '{}');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '```html\n<div>ok</div>\n```' } }],
        usage: { total_tokens: 3 },
      }),
    };
  });

  try {
    await generate({ model: 'm/x', prompt: 'test', images: [], reasoningEffort: 'none' });
    assert.deepEqual(capturedBody.reasoning, { enabled: false });
    assert.equal(capturedBody.reasoning.effort, undefined);
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter passes reasoningEffort="minimal" through as effort', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_PROVIDER_CONFIG_PATH;

  let capturedBody = null;
  const restore = withMockedFetch(async (_url, options) => {
    capturedBody = JSON.parse(options?.body ?? '{}');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '```html\n<div>ok</div>\n```' } }],
        usage: { total_tokens: 3 },
      }),
    };
  });

  try {
    await generate({ model: 'm/x', prompt: 'test', images: [], reasoningEffort: 'minimal' });
    assert.deepEqual(capturedBody.reasoning, { effort: 'minimal' });
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter omits reasoning block when reasoningEffort is empty', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_PROVIDER_CONFIG_PATH;

  let capturedBody = null;
  const restore = withMockedFetch(async (_url, options) => {
    capturedBody = JSON.parse(options?.body ?? '{}');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '```html\n<div>ok</div>\n```' } }],
        usage: { total_tokens: 3 },
      }),
    };
  });

  try {
    await generate({ model: 'm/x', prompt: 'test', images: [] });
    assert.equal(capturedBody.reasoning, undefined);
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter omits reasoning block when reasoningEffort="default"', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-key';

  let capturedBody = null;
  const restore = withMockedFetch(async (_url, options) => {
    capturedBody = JSON.parse(options?.body ?? '{}');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '```html\n<div>ok</div>\n```' } }],
        usage: { total_tokens: 3 },
      }),
    };
  });

  try {
    await generate({ model: 'm/x', prompt: 'test', images: [], reasoningEffort: 'default' });
    assert.equal(capturedBody.reasoning, undefined);
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = originalKey;
  }
});

test('openrouter adapter applies forced provider routing from config', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';

  try {
    await withProviderConfigFile({
      modelProviderOverrides: {
        'openai/gpt-5-mini': 'openai',
      },
    }, async (configPath) => {
      process.env.OPENROUTER_PROVIDER_CONFIG_PATH = configPath;

      let capturedBody = null;
      const restore = withMockedFetch(async (_url, options) => {
        capturedBody = JSON.parse(options?.body ?? '{}');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '```html\n<div>ok</div>\n```' } }],
            usage: { total_tokens: 1 },
          }),
        };
      });

      try {
        await generate({ model: 'openai/gpt-5-mini', prompt: 'test', images: [] });
        assert.deepEqual(capturedBody.provider, {
          order: ['openai'],
          allow_fallbacks: false,
        });
      } finally {
        restore();
      }
    });
  } finally {
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter applies provider routing from namespace wildcard override', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';

  try {
    await withProviderConfigFile({
      modelProviderOverrides: {
        'moonshotai/*': 'io.net',
      },
    }, async (configPath) => {
      process.env.OPENROUTER_PROVIDER_CONFIG_PATH = configPath;

      let capturedBody = null;
      const restore = withMockedFetch(async (_url, options) => {
        capturedBody = JSON.parse(options?.body ?? '{}');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '```html\n<div>ok</div>\n```' } }],
            usage: { total_tokens: 1 },
          }),
        };
      });

      try {
        await generate({ model: 'moonshotai/kimi-k2.6', prompt: 'test', images: [] });
        assert.deepEqual(capturedBody.provider, {
          order: ['io.net'],
          allow_fallbacks: false,
        });
      } finally {
        restore();
      }
    });
  } finally {
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter prefers exact model override over namespace wildcard', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';

  try {
    await withProviderConfigFile({
      modelProviderOverrides: {
        'moonshotai/*': 'io.net',
        'moonshotai/kimi-k2.6': 'targon',
      },
    }, async (configPath) => {
      process.env.OPENROUTER_PROVIDER_CONFIG_PATH = configPath;

      let capturedBody = null;
      const restore = withMockedFetch(async (_url, options) => {
        capturedBody = JSON.parse(options?.body ?? '{}');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '```html\n<div>ok</div>\n```' } }],
            usage: { total_tokens: 1 },
          }),
        };
      });

      try {
        await generate({ model: 'moonshotai/kimi-k2.6', prompt: 'test', images: [] });
        assert.deepEqual(capturedBody.provider, {
          order: ['targon'],
          allow_fallbacks: false,
        });
      } finally {
        restore();
      }
    });
  } finally {
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter accepts raw provider object from config', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';

  try {
    await withProviderConfigFile({
      modelProviderOverrides: {
        'openai/gpt-5-mini': {
          order: ['openai', 'anthropic'],
          allow_fallbacks: true,
        },
      },
    }, async (configPath) => {
      process.env.OPENROUTER_PROVIDER_CONFIG_PATH = configPath;

      let capturedBody = null;
      const restore = withMockedFetch(async (_url, options) => {
        capturedBody = JSON.parse(options?.body ?? '{}');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '```html\n<div>ok</div>\n```' } }],
            usage: { total_tokens: 1 },
          }),
        };
      });

      try {
        await generate({ model: 'openai/gpt-5-mini', prompt: 'test', images: [] });
        assert.deepEqual(capturedBody.provider, {
          order: ['openai', 'anthropic'],
          allow_fallbacks: true,
        });
      } finally {
        restore();
      }
    });
  } finally {
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter surfaces upstream provider error details when no content is returned', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_PROVIDER_CONFIG_PATH;

  const restore = withMockedFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      error: {
        message: 'Provider returned error',
        code: 520,
        metadata: {
          provider_name: 'io-net/int4',
          raw: 'upstream 502: model variant not deployed',
        },
      },
    }),
  }));

  try {
    await assert.rejects(
      () => generate({ model: 'moonshotai/kimi-k2.6', prompt: 'test', images: [] }),
      (err) => {
        assert.match(err.message, /OpenRouter: Provider returned error/);
        assert.match(err.message, /code=520/);
        assert.match(err.message, /provider=io-net\/int4/);
        assert.match(err.message, /upstream 502: model variant not deployed/);
        return true;
      },
    );
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter keeps partial content when OpenRouter flags data.error but choices have usable output', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_PROVIDER_CONFIG_PATH;

  const restore = withMockedFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      error: {
        message: 'Provider returned error',
        code: 520,
        metadata: { provider_name: 'io-net/int4' },
      },
      choices: [{
        message: { content: '```html\n<div>partial</div>\n```' },
        finish_reason: 'length',
        native_finish_reason: 'length',
      }],
      usage: { total_tokens: 9960, cost: 0.049 },
    }),
  }));

  try {
    const result = await generate({ model: 'moonshotai/kimi-k2.6', prompt: 'test', images: [] });
    assert.equal(result.code, '<div>partial</div>');
    assert.equal(result.tokensUsed, 9960);
    assert.equal(result.cost, 0.049);
    assert.match(result.warning, /Provider returned error/);
    assert.match(result.warning, /finish_reason=length/);
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter marks empty-response errors as permanent (skip retries)', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_PROVIDER_CONFIG_PATH;

  const restore = withMockedFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }),
  }));

  try {
    await assert.rejects(
      () => generate({ model: 'm/x', prompt: 'test', images: [] }),
      (err) => err.permanent === true && /empty response/.test(err.message),
    );
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter marks "No endpoints found" as permanent', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_PROVIDER_CONFIG_PATH;

  const restore = withMockedFetch(async () => ({
    ok: false,
    status: 404,
    json: async () => ({ error: { message: 'No endpoints found for m/x.', code: 404 } }),
  }));

  try {
    await assert.rejects(
      () => generate({ model: 'm/x', prompt: 'test', images: [] }),
      (err) => err.permanent === true && /No endpoints found/.test(err.message),
    );
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter marks HTTP 4xx auth errors as permanent', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_PROVIDER_CONFIG_PATH;

  const restore = withMockedFetch(async () => ({
    ok: false,
    status: 401,
    json: async () => ({ error: { message: 'Unauthorized', code: 401 } }),
  }));

  try {
    await assert.rejects(
      () => generate({ model: 'm/x', prompt: 'test', images: [] }),
      (err) => err.permanent === true,
    );
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter does NOT mark transient 5xx as permanent', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_PROVIDER_CONFIG_PATH;

  const restore = withMockedFetch(async () => ({
    ok: false,
    status: 503,
    json: async () => ({ error: { message: 'Upstream unavailable', code: 503 } }),
  }));

  try {
    await assert.rejects(
      () => generate({ model: 'm/x', prompt: 'test', images: [] }),
      (err) => err.permanent !== true,
    );
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter surfaces native_finish_reason in empty-response errors', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_PROVIDER_CONFIG_PATH;

  const restore = withMockedFetch(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{
        message: { content: '' },
        finish_reason: 'length',
        native_finish_reason: 'MAX_TOKENS',
      }],
      usage: { total_tokens: 12000 },
    }),
  }));

  try {
    await assert.rejects(
      () => generate({ model: 'moonshotai/kimi-k2.6', prompt: 'test', images: [] }),
      (err) => {
        assert.match(err.message, /OpenRouter: empty response/);
        assert.match(err.message, /finish_reason=length/);
        assert.match(err.message, /native_finish_reason=MAX_TOKENS/);
        return true;
      },
    );
  } finally {
    restore();
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter fails fast for invalid provider config', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';

  try {
    await withProviderConfigFile({
      modelProviderOverrides: {
        'openai/gpt-5-mini': 123,
      },
    }, async (configPath) => {
      process.env.OPENROUTER_PROVIDER_CONFIG_PATH = configPath;

      await assert.rejects(
        () => generate({ model: 'openai/gpt-5-mini', prompt: 'test', images: [] }),
        (error) => {
          assert.match(error.message, /must be a string, string\[\] or provider object/);
          return true;
        },
      );
    });
  } finally {
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});

test('openrouter adapter rejects global "*" provider overrides', async () => {
  const originalKey = process.env.OPENROUTER_API_KEY;
  const originalConfigPath = process.env.OPENROUTER_PROVIDER_CONFIG_PATH;
  process.env.OPENROUTER_API_KEY = 'test-key';

  try {
    await withProviderConfigFile({
      modelProviderOverrides: {
        '*': 'openai',
      },
    }, async (configPath) => {
      process.env.OPENROUTER_PROVIDER_CONFIG_PATH = configPath;

      await assert.rejects(
        () => generate({ model: 'moonshotai/kimi-k2.6', prompt: 'test', images: [] }),
        (error) => {
          assert.match(error.message, /does not support "\*" overrides/);
          return true;
        },
      );
    });
  } finally {
    process.env.OPENROUTER_API_KEY = originalKey;
    process.env.OPENROUTER_PROVIDER_CONFIG_PATH = originalConfigPath;
  }
});
