#!/usr/bin/env node
// ClawBattle CLI
// Usage: node cli.js --model openai/gpt-4o --provider openrouter --targets battle --attempts 3

import { parseArgs } from 'node:util';
import { runBenchmark } from './benchmark.js';
import { closeBrowser } from '../core/renderer.js';

const { values } = parseArgs({
  options: {
    model:      { type: 'string' },
    provider:   { type: 'string', default: 'openrouter' },
    targets:    { type: 'string', default: 'battle' },
    'target-id': { type: 'string' },
    attempts:     { type: 'string', default: '3' },
    prompt:     { type: 'string', default: process.env.PROMPT_VERSION ?? 'v3' },
    concurrency: { type: 'string', default: '1' },
    retries:     { type: 'string', default: '0' },
    reasoning:            { type: 'string' },   // low | medium | high
  }
});

if (!values.model) {
  console.error('Error: --model is required');
  console.error('Example: node cli.js --model openai/gpt-4o --targets battle');
  process.exit(1);
}

try {
  await runBenchmark({
    model:              values.model,
    provider:           values.provider,
    targetType:         values.targets,
    targetId:           values['target-id'],
    attempts:           parseInt(values.attempts),
    promptVersion:      values.prompt,
    concurrency:        parseInt(values.concurrency),
    retries:            parseInt(values.retries),
    reasoningEffort:    values.reasoning ?? undefined,
  });
} finally {
  await closeBrowser().catch(() => {});
}
