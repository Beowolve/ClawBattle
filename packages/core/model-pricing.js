import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalModel } from './model-aliases.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PRICING_PATH = resolve(ROOT, 'config/model-pricing.json');
const TOKENS_PER_MILLION = 1_000_000;

let pricesByModel;

function loadPrices() {
  if (pricesByModel) return pricesByModel;

  const raw = readFileSync(PRICING_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  pricesByModel = parsed.prices ?? {};
  return pricesByModel;
}

function tokenCount(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function calculateTextCost({ provider, model, usage }) {
  if (!usage) return null;

  const canonical = canonicalModel(provider, model);
  const prices = loadPrices()[canonical];
  if (!prices) return null;

  const inputTokens = tokenCount(usage.prompt_tokens ?? usage.input_tokens);
  const cachedInputTokens = tokenCount(
    usage.prompt_tokens_details?.cached_tokens
      ?? usage.input_tokens_details?.cached_tokens
      ?? usage.input_cached_tokens,
  );
  const billableInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const outputTokens = tokenCount(usage.completion_tokens ?? usage.output_tokens);
  const cachedInputPrice = Number(prices.cachedInput ?? prices.input);

  const cost =
    (billableInputTokens * Number(prices.input ?? 0)
      + cachedInputTokens * cachedInputPrice
      + outputTokens * Number(prices.output ?? 0)) / TOKENS_PER_MILLION;

  return Number.isFinite(cost) ? cost : null;
}

