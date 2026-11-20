import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalModel } from './model-aliases.js';

test('Claude API IDs and snapshot aliases resolve to the same model as OpenRouter', () => {
  const idsByModel = {
    'anthropic/claude-haiku-4.5': ['claude-haiku-4-5', 'claude-haiku-4-5-20251001'],
    'anthropic/claude-sonnet-4': ['claude-sonnet-4-0', 'claude-sonnet-4-20250514', 'claude-4-sonnet-20250514'],
    'anthropic/claude-opus-5.5': ['claude-opus-5-5'],
  };
  for (const [canonical, ids] of Object.entries(idsByModel)) {
    for (const id of ids) {
      assert.equal(canonicalModel('anthropic', id), canonicalModel('openrouter', canonical));
    }
  }
});
