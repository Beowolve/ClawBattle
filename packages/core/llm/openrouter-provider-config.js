import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DEFAULT_CONFIG_PATH = path.resolve(ROOT, 'config', 'openrouter.providers.json');

function resolveConfigPath(env = process.env) {
  const configuredPath = env.OPENROUTER_PROVIDER_CONFIG_PATH?.trim();
  if (!configuredPath) return DEFAULT_CONFIG_PATH;
  return path.resolve(configuredPath);
}

function parseConfigFile(configPath) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new Error(`OpenRouter provider config unreadable at "${configPath}": ${error.message}`);
  }

  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`OpenRouter provider config invalid JSON at "${configPath}": ${error.message}`);
  }
}

function readOverrides(configPath) {
  const parsed = parseConfigFile(configPath);
  if (parsed == null) return null;

  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`OpenRouter provider config at "${configPath}" must be a JSON object`);
  }

  const overrides = parsed.modelProviderOverrides ?? {};
  if (typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error(`OpenRouter provider config field "modelProviderOverrides" must be an object`);
  }
  if (Object.prototype.hasOwnProperty.call(overrides, '*')) {
    throw new Error(
      `OpenRouter provider config at "${configPath}" does not support "*" overrides; use explicit model ids or "vendor/*" patterns`,
    );
  }
  return overrides;
}

function normalizeOverride(rawOverride, { model, configPath }) {
  if (typeof rawOverride === 'string') {
    const provider = rawOverride.trim();
    if (!provider) throw new Error(`OpenRouter provider override for "${model}" in "${configPath}" cannot be empty`);
    return { order: [provider], allow_fallbacks: false };
  }

  if (Array.isArray(rawOverride)) {
    const order = rawOverride.map((provider) => (typeof provider === 'string' ? provider.trim() : provider));
    if (!order.length || order.some((provider) => typeof provider !== 'string' || !provider)) {
      throw new Error(`OpenRouter provider override array for "${model}" in "${configPath}" must contain only non-empty strings`);
    }
    return { order, allow_fallbacks: false };
  }

  if (rawOverride && typeof rawOverride === 'object') return rawOverride;

  throw new Error(
    `OpenRouter provider override for "${model}" in "${configPath}" must be a string, string[] or provider object`,
  );
}

function findBestPrefixOverride(overrides, model) {
  let bestKey = null;

  for (const key of Object.keys(overrides)) {
    if (!key.endsWith('/*') || key === '/*') continue;
    const prefix = key.slice(0, -1); // keep trailing slash for strict namespace match
    if (!model.startsWith(prefix)) continue;
    if (bestKey == null || key.length > bestKey.length) bestKey = key;
  }

  return bestKey != null ? overrides[bestKey] : null;
}

export function resolveOpenRouterProviderRouting(model, env = process.env) {
  if (typeof model !== 'string' || !model.trim()) return null;

  const configPath = resolveConfigPath(env);
  const overrides = readOverrides(configPath);
  if (!overrides) return null;

  const rawOverride = overrides[model] ?? findBestPrefixOverride(overrides, model);
  if (rawOverride == null) return null;

  return normalizeOverride(rawOverride, { model, configPath });
}
