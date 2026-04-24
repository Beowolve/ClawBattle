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

