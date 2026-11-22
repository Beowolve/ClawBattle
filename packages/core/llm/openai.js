// LLM Adapter – OpenAI (direct)
import { extractCode } from './extract-code.js';
import { buildUserMessage } from './build-message.js';
import { calculateTextCost } from '../model-pricing.js';
import { shouldSendReasoningEffort } from '../model-reasoning.js';

export function buildRequestBody({ model, prompt, images, reasoningEffort }) {
  return {
    model,
    messages: [{ role: 'user', content: buildUserMessage(prompt, images) }],
    ...(shouldSendReasoningEffort(reasoningEffort) ? { reasoning_effort: reasoningEffort } : {}),
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
    throw Object.assign(new Error(`OpenAI: ${msg}`), { code: data.error?.code });
  }
  const choice = data.choices?.[0];
  const content = choice?.message?.content;
  if (!content?.trim()) {
    const reason = choice?.finish_reason ? ` (finish_reason=${choice.finish_reason})` : '';
    throw new Error(`OpenAI: empty response${choice ? reason : ' (no choices)'}`);
  }

  return {
    code: extractCode(content),
    tokensUsed: data.usage?.total_tokens ?? 0,
    cost: calculateTextCost({ provider: 'openai', model, usage: data.usage }),
  };
}
