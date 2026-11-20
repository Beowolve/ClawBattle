import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateTextCost } from './model-pricing.js';

test('calculateTextCost uses canonical model aliases and cached input pricing', () => {
  const cost = calculateTextCost({
    provider: 'openai',
    model: 'gpt-5.4-mini-2026-03-17',
    usage: {
      prompt_tokens: 1_000_000,
      completion_tokens: 100_000,
      prompt_tokens_details: { cached_tokens: 200_000 },
    },
  });

  assert.equal(cost, 1.065);
});

test('calculateTextCost returns null for unknown pricing', () => {
  const cost = calculateTextCost({
    provider: 'openai',
    model: 'unknown-model',
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 1000,
    },
  });

  assert.equal(cost, null);
});

test('Claude Haiku 5.5 switches all rates only above 100,000 input tokens, including cache hits', () => {
  for (const [input, expected] of [[100_000, 0.0555], [100_001, 0.2775005]]) {
    assert.equal(calculateTextCost({
      provider: 'anthropic',
      model: 'claude-haiku-5-5',
      usage: { input_tokens: input, input_cached_tokens: 50_000, output_tokens: 100_000 },
    }), expected);
  }
});

