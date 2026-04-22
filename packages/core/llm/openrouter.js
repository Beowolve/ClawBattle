// LLM Adapter – OpenRouter
import { extractCode } from './extract-code.js';
import { buildUserMessage } from './build-message.js';

export async function generate({ model, prompt, images, reasoningEffort, reasoningMaxTokens, signal }) {
  // OpenRouter's `reasoning.max_tokens` is only honoured by Gemini, Anthropic and
  // Qwen. Models like Moonshot Kimi K2 silently ignore it and run reasoning
  // unbounded. The universal hard cap is the top-level `max_tokens`, which OpenRouter
  // requires to exceed the reasoning budget so the final answer still fits.
  const reasoning = {};
  if (reasoningEffort) reasoning.effort = reasoningEffort;
  if (reasoningMaxTokens != null) reasoning.max_tokens = Number(reasoningMaxTokens);

  const answerBudget = Number(process.env.ANSWER_TOKEN_BUDGET ?? 4096);
  const maxTokens = reasoningMaxTokens != null
    ? Number(reasoningMaxTokens) + answerBudget
    : null;

  const body = {
    model,
    messages: [{ role: 'user', content: buildUserMessage(prompt, images) }],
    ...(Object.keys(reasoning).length ? { reasoning } : {}),
    ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
  };
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://github.com/clawbattle',
      'X-Title': 'ClawBattle',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  // Check both HTTP status and API-level error (OpenRouter can return errors with HTTP 200)
  if (!response.ok || data.error) {
    const msg = data.error?.message ?? data.error?.code ?? `HTTP ${response.status}`;
    throw new Error(`OpenRouter: ${msg}`);
  }
  if (!data.choices?.[0]?.message?.content) {
    throw new Error(`OpenRouter: empty response (no choices)`);
  }

  return {
    code: extractCode(data.choices[0].message.content),
    tokensUsed: data.usage?.total_tokens ?? 0,
    cost: data.usage?.cost ?? null,
  };
}
