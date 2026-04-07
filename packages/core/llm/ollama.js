// LLM Adapter – Ollama (local models)
import { extractCode } from './extract-code.js';

export async function generate({ model, prompt, images }) {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

  const message = { role: 'user', content: prompt };
  if (images?.length) {
    message.images = images.map(buf => buf.toString('base64'));
  }

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [message], stream: false }),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Ollama error');

  return {
    code: extractCode(data.message.content),
    tokensUsed: data.eval_count ?? 0,
  };
}
