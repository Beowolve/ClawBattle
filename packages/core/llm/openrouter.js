// LLM Adapter – OpenRouter
import { extractCode } from './extract-code.js';
import { buildUserMessage } from './build-message.js';
import { resolveOpenRouterProviderRouting } from './openrouter-provider-config.js';
import { shouldSendReasoningEffort } from '../model-reasoning.js';

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

const OPENROUTER_CHAT_COMPLETIONS_URL = 'https://openrouter.ai/api/v1/chat/completions';

// HTTP client-error codes we never want to retry: auth/model/endpoint issues don't
// heal themselves on a second identical request, they just burn latency and money.
const PERMANENT_HTTP_STATUS = new Set([400, 401, 403, 404, 422]);

function isStructurallyPermanent(error, httpStatus) {
  if (PERMANENT_HTTP_STATUS.has(httpStatus)) return true;
  const code = Number(error?.code);
  if (Number.isFinite(code) && PERMANENT_HTTP_STATUS.has(code)) return true;
  const message = String(error?.message ?? '');
  if (/no endpoints found/i.test(message)) return true;
  return false;
}

function permanentError(message) {
  const err = new Error(message);
  err.permanent = true;
  return err;
}

function stringifyRaw(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}

function formatErrorMessage(error, httpStatus, choice) {
  const parts = [];
  const base = error?.message ?? error?.code ?? `HTTP ${httpStatus}`;
  parts.push(String(base));

  const details = [];
  if (error?.code != null && error.code !== error?.message) details.push(`code=${error.code}`);
  const providerName = error?.metadata?.provider_name;
  if (providerName) details.push(`provider=${providerName}`);
  const raw = stringifyRaw(error?.metadata?.raw);
  if (raw) details.push(`raw=${raw}`);
  if (choice?.finish_reason) details.push(`finish_reason=${choice.finish_reason}`);
  if (choice?.native_finish_reason && choice.native_finish_reason !== choice.finish_reason) {
    details.push(`native_finish_reason=${choice.native_finish_reason}`);
  }

  if (details.length) parts.push(`(${details.join(', ')})`);
  return parts.join(' ');
}

export function buildRequestBody({ model, prompt, images, reasoningEffort }) {
  const reasoning = {};
  if (reasoningEffort === 'none') {
    // Explicit opt-out: OpenRouter's `enabled: false` tells reasoning-capable
    // models to skip the thinking phase entirely.
    reasoning.enabled = false;
  } else if (shouldSendReasoningEffort(reasoningEffort)) {
    reasoning.effort = reasoningEffort;
  }

  const providerRouting = resolveOpenRouterProviderRouting(model);

  return {
    model,
    messages: [{ role: 'user', content: buildUserMessage(prompt, images) }],
    ...(Object.keys(reasoning).length ? { reasoning } : {}),
    ...(providerRouting ? { provider: providerRouting } : {}),
  };
}

export async function generate({
  model,
  prompt,
  images,
  reasoningEffort,
  signal,
  onBeforeRequest,
  requestAttempt,
}) {
  const body = buildRequestBody({ model, prompt, images, reasoningEffort });
  onBeforeRequest?.({
    provider: 'openrouter',
    endpoint: OPENROUTER_CHAT_COMPLETIONS_URL,
    method: 'POST',
    requestAttempt,
    body,
  });

  const response = await fetch(OPENROUTER_CHAT_COMPLETIONS_URL, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER ?? 'https://beowolve.github.io/ClawBattle/',
      'X-Title': process.env.OPENROUTER_APP_TITLE ?? 'ClawBattle',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  const choice = data.choices?.[0];
  const content = normalizeAssistantContent(choice?.message?.content);

  // Content-first: if the model produced usable output we keep it, even when OpenRouter
  // flags data.error or finish_reason=length. Truncated answers from Kimi with capped
  // token budgets are still useful; we surface the condition as a warning instead.
  if (content) {
    const warnings = [];
    if (data.error) warnings.push(formatErrorMessage(data.error, response.status));
    if (choice?.finish_reason && choice.finish_reason !== 'stop') {
      warnings.push(`finish_reason=${choice.finish_reason}`);
    }
    if (choice?.native_finish_reason && choice.native_finish_reason !== choice.finish_reason) {
      warnings.push(`native_finish_reason=${choice.native_finish_reason}`);
    }
    return {
      code: extractCode(content),
      tokensUsed: data.usage?.total_tokens ?? 0,
      cost: data.usage?.cost ?? null,
      ...(warnings.length ? { warning: warnings.join('; ') } : {}),
    };
  }

  // No content — now we must throw. Check both HTTP status and API-level error
  // (OpenRouter can return errors with HTTP 200).
  if (!response.ok || data.error) {
    const msg = `OpenRouter: ${formatErrorMessage(data.error, response.status, choice)}`;
    const err = new Error(msg);
    if (isStructurallyPermanent(data.error, response.status)) err.permanent = true;
    throw err;
  }

  // Empty response with HTTP 200 and no error: the model exhausted its budget in
  // reasoning or refused silently. A retry with identical params won't help.
  const reasonParts = [];
  if (!choice) reasonParts.push('no choices');
  if (choice?.finish_reason) reasonParts.push(`finish_reason=${choice.finish_reason}`);
  if (choice?.native_finish_reason && choice.native_finish_reason !== choice.finish_reason) {
    reasonParts.push(`native_finish_reason=${choice.native_finish_reason}`);
  }
  if (choice?.message?.refusal) reasonParts.push(`refusal=${choice.message.refusal}`);
  const reason = reasonParts.length ? ` (${reasonParts.join(', ')})` : '';
  throw permanentError(`OpenRouter: empty response${reason}`);
}
