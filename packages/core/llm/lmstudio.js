// LLM Adapter - LM Studio (OpenAI-compatible local server)
import { extractCode } from './extract-code.js';
import { buildUserMessage } from './build-message.js';

const DEFAULT_BASE_URL = 'http://localhost:1234/v1';

function normalizeBaseUrl(value) {
  return String(value ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, '') || DEFAULT_BASE_URL;
}

function normalizeAssistantContent(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part.text === 'string') return part.text;
      return '';
    })
    .join('\n')
    .trim();
}

function formatError(data, status) {
  return data?.error?.message ?? data?.error?.code ?? `HTTP ${status}`;
}

function formatFetchError(error, endpoint) {
  const cause = error?.cause;
  const details = [
    cause?.code,
    cause?.address ? `address=${cause.address}` : null,
    cause?.port ? `port=${cause.port}` : null,
    cause?.message && cause.message !== cause?.code ? cause.message : null,
  ].filter(Boolean);
  return `LM Studio: fetch failed for ${endpoint}${details.length ? ` (${details.join(', ')})` : ''}`;
}

function permanentError(message) {
  const err = new Error(message);
  err.permanent = true;
  return err;
}

function readApiKey() {
  return (process.env.LM_STUDIO_API_KEY ?? process.env.LMSTUDIO_API_KEY ?? '').trim();
}

function usageTotalTokens(usage) {
  const total = Number(usage?.total_tokens);
  if (Number.isFinite(total) && total > 0) return total;

  const prompt = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0);
  const completion = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0);
  const sum = prompt + completion;
  return Number.isFinite(sum) && sum > 0 ? sum : null;
}

function optionalPositiveInteger(value) {
  if (value == null || String(value).trim() === '') return null;
  const parsed = Number.parseInt(String(value).trim(), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function readMaxTokens() {
  return optionalPositiveInteger(process.env.LM_STUDIO_MAX_TOKENS ?? process.env.LMSTUDIO_MAX_TOKENS);
}

function formatEmptyResponse(choice, usage) {
  const details = [];
  if (!choice) details.push('no choices');
  if (choice?.finish_reason) details.push(`finish_reason=${choice.finish_reason}`);
  if (choice?.native_finish_reason && choice.native_finish_reason !== choice.finish_reason) {
    details.push(`native_finish_reason=${choice.native_finish_reason}`);
  }
  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens;
  if (reasoningTokens != null) details.push(`reasoning_tokens=${reasoningTokens}`);
  if (usage?.total_tokens != null) details.push(`total_tokens=${usage.total_tokens}`);
  return `LM Studio: empty response${details.length ? ` (${details.join(', ')})` : ''}`;
}

export function buildRequestBody({ model, prompt, images, maxTokens = readMaxTokens() }) {
  return {
    model,
    messages: [{ role: 'user', content: buildUserMessage(prompt, images) }],
    stream: false,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
  };
}

export async function generate({
  model,
  prompt,
  images,
  signal,
  onBeforeRequest,
  requestAttempt,
}) {
  const body = buildRequestBody({ model, prompt, images });
  const baseUrl = normalizeBaseUrl(process.env.LM_STUDIO_BASE_URL);
  const endpoint = `${baseUrl}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  const apiKey = readApiKey();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  onBeforeRequest?.({
    provider: 'lmstudio',
    endpoint,
    method: 'POST',
    requestAttempt,
    body,
  });

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error(formatFetchError(error, endpoint));
  }

  const data = await response.json();
  if (!response.ok || data.error) {
    throw new Error(`LM Studio: ${formatError(data, response.status)}`);
  }

  const choice = data.choices?.[0];
  const content = normalizeAssistantContent(choice?.message?.content);
  if (!content) {
    throw permanentError(formatEmptyResponse(choice, data.usage));
  }

  const warnings = [];
  if (choice?.finish_reason && choice.finish_reason !== 'stop') {
    warnings.push(`finish_reason=${choice.finish_reason}`);
  }

  return {
    code: extractCode(content),
    tokensUsed: usageTotalTokens(data.usage) ?? 1,
    cost: null,
    ...(warnings.length ? { warning: warnings.join('; ') } : {}),
  };
}
