import { extractCode } from './extract-code.js';
import { calculateTextCost } from '../model-pricing.js';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MAX_TOKENS = 8192;

export function buildRequestBody({ model, prompt, images = [] }) {
  const content = [
    { type: 'text', text: prompt },
    ...images.map(image => ({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: image.toString('base64') },
    })),
  ];
  return { model, max_tokens: MAX_TOKENS, messages: [{ role: 'user', content }] };
}

export async function generate({ model, prompt, images, signal, onBeforeRequest, requestAttempt }) {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(new Error('Anthropic: set ANTHROPIC_API_KEY to use this provider'), { permanent: true });
  }

  const body = buildRequestBody({ model, prompt, images });
  onBeforeRequest?.({ provider: 'anthropic', endpoint: ENDPOINT, method: 'POST', requestAttempt, body });
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2026-10-21',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(error => {
    if (error.name !== 'SyntaxError') throw error;
    return null;
  });
  if (!response.ok || data?.error) {
    const message = data?.error?.message ?? `HTTP ${response.status}`;
    const permanent = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
    throw Object.assign(new Error(`Anthropic: ${message}`), { permanent });
  }

  const text = data?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n');
  if (!text?.trim()) {
    throw new Error(`Anthropic: no text in response (stop reason: ${data?.stop_reason ?? 'unknown'})`);
  }

  const cachedInput = data.usage?.cache_read_input_tokens ?? 0;
  const cacheWrite = data.usage?.cache_creation_input_tokens ?? 0;
  const input = (data.usage?.input_tokens ?? 0) + cachedInput;
  const output = data.usage?.output_tokens ?? 0;
  return {
    code: extractCode(text),
    tokensUsed: input + cacheWrite + output,
    cost: data.usage && !cacheWrite ? calculateTextCost({
      provider: 'anthropic', model, usage: { input_tokens: input, input_cached_tokens: cachedInput, output_tokens: output },
    }) : null,
  };
}
