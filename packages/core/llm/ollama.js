// LLM Adapter – Ollama (local models)
import { extractCode } from './extract-code.js';

export function buildRequestBody({ model, prompt, images }) {
  const message = { role: 'user', content: prompt };
  if (images?.length) {
    message.images = images.map(buf => buf.toString('base64'));
  }
  return { model, messages: [message], stream: false };
}

export async function generate({ model, prompt, images, signal }) {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
  const apiKey = process.env.OLLAMA_API_KEY?.trim();
  const body = buildRequestBody({ model, prompt, images });
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    signal,
    headers,
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Ollama error');

  return {
    code: extractCode(data.message.content),
    tokensUsed: data.eval_count ?? 0,
  };
}
