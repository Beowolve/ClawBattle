import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REASONING_PATH = resolve(ROOT, 'config/model-reasoning.json');

export const DEFAULT_REASONING_EFFORT = 'default';

let reasoningConfig;

function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeModel(value) {
  return String(value ?? '').trim();
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(v => normalizeKey(v)).filter(Boolean))];
}

export function loadReasoningConfig() {
  if (reasoningConfig) return reasoningConfig;

  const raw = readFileSync(REASONING_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const defaultOption = normalizeKey(parsed.defaultOption) || DEFAULT_REASONING_EFFORT;

  const providerDefaults = {};
  for (const [provider, values] of Object.entries(parsed.providerDefaults ?? {})) {
    const options = uniqueStrings(values);
    providerDefaults[normalizeKey(provider)] = options.includes(defaultOption)
      ? options
      : [defaultOption, ...options];
  }

  const modelOverrides = {};
  for (const [provider, models] of Object.entries(parsed.modelOverrides ?? {})) {
    const providerName = normalizeKey(provider);
    modelOverrides[providerName] = {};
    for (const [model, values] of Object.entries(models ?? {})) {
      const options = uniqueStrings(values);
      modelOverrides[providerName][normalizeModel(model)] = options.includes(defaultOption)
        ? options
        : [defaultOption, ...options];
    }
  }

  reasoningConfig = {
    version: parsed.version ?? 1,
    description: parsed.description ?? '',
    defaultOption,
    providerDefaults,
    modelOverrides,
  };
  return reasoningConfig;
}

export function getReasoningOptions(provider, model) {
  const config = loadReasoningConfig();
  const providerName = normalizeKey(provider);
  const modelName = normalizeModel(model);
  const override = config.modelOverrides[providerName]?.[modelName];
  if (override?.length) return override;
  return config.providerDefaults[providerName] ?? [config.defaultOption];
}

export function normalizeReasoningEffort(provider, model, value) {
  const config = loadReasoningConfig();
  const normalized = normalizeKey(value) || config.defaultOption;
  return getReasoningOptions(provider, model).includes(normalized)
    ? normalized
    : config.defaultOption;
}

export function shouldSendReasoningEffort(value) {
  return normalizeKey(value) !== '' && normalizeKey(value) !== DEFAULT_REASONING_EFFORT;
}
