import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ALIASES_PATH = resolve(ROOT, 'config/model-aliases.json');

let aliasesByProvider;

function loadAliases() {
  if (aliasesByProvider) return aliasesByProvider;

  const raw = readFileSync(ALIASES_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  aliasesByProvider = parsed.aliases ?? {};
  return aliasesByProvider;
}

export function canonicalModel(provider, model) {
  const modelName = String(model ?? '').trim();
  if (!modelName) return modelName;

  const providerName = String(provider ?? '').trim();
  const aliases = loadAliases();
  return aliases[providerName]?.[modelName] ?? modelName;
}

