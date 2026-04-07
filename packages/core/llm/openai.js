// LLM Adapter – OpenAI (direct)
import { extractCode } from './extract-code.js';
import { buildUserMessage } from './build-message.js';

export async function generate({ model, prompt, images }) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: buildUserMessage(prompt, images) }],
    }),
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
  };
}
