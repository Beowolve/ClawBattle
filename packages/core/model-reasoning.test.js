import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getReasoningOptions,
  normalizeReasoningEffort,
  shouldSendReasoningEffort,
} from './model-reasoning.js';

test('model reasoning returns provider defaults', () => {
  assert.deepEqual(
    getReasoningOptions('openai', 'gpt-5.4'),
    ['default', 'low', 'medium', 'high', 'xhigh'],
  );
  assert.deepEqual(getReasoningOptions('ollama', 'llama3'), ['default']);
});

test('model reasoning overrides provider defaults for default-only OpenRouter models', () => {
  assert.deepEqual(getReasoningOptions('openrouter', 'qwen/qwen3.6-plus'), ['default']);
  assert.deepEqual(getReasoningOptions('openrouter', 'xiaomi/mimo-v2.5'), ['default']);
  assert.deepEqual(getReasoningOptions('openrouter', 'z-ai/glm-5v-turbo'), ['default']);
  assert.deepEqual(getReasoningOptions('openrouter', 'google/gemma-4-31b-it'), ['default']);
});

test('model reasoning falls back for unknown providers and invalid values', () => {
  assert.deepEqual(getReasoningOptions('unknown', 'm'), ['default']);
  assert.equal(normalizeReasoningEffort('openrouter', 'unknown/model', 'HIGH'), 'high');
  assert.equal(normalizeReasoningEffort('openrouter', 'qwen/qwen3.6-plus', 'medium'), 'default');
  assert.equal(normalizeReasoningEffort('ollama', 'llama3', 'medium'), 'default');
});

test('default reasoning is not sent as provider effort', () => {
  assert.equal(shouldSendReasoningEffort('default'), false);
  assert.equal(shouldSendReasoningEffort(undefined), false);
  assert.equal(shouldSendReasoningEffort('high'), true);
});
