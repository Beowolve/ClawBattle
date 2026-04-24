// LLM Adapter – OpenAI (direct)
import { extractCode } from './extract-code.js';
import { buildUserMessage } from './build-message.js';
import { calculateTextCost } from '../model-pricing.js';

export function buildRequestBody({ model, prompt, images, reasoningEffort }) {
  return {
    model,
    messages: [{ role: 'user', content: buildUserMessage(prompt, images) }],
    ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
  };
}

export async function generate({ model, prompt, images, reasoningEffort, signal }) {
  const body = buildRequestBody({ model, prompt, images, reasoningEffort });
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok || data.error) {
    const msg = data.error?.message ?? data.error?.code ?? `HTTP ${response.status}`;
    throw new Error(`OpenAI: ${msg}`);
  }
  if (!data.choices?.[0]?.message?.content) {
    throw new Error(`OpenAI: empty response (no choices)`);
  }

  return {
    code: extractCode(data.choices[0].message.content),
    tokensUsed: data.usage?.total_tokens ?? 0,
    cost: calculateTextCost({ provider: 'openai', model, usage: data.usage }),
  };
}
