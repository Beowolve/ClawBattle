// Orchestrates a single claimed attempt: prompt → adapter → render → score → DB write.
// All external dependencies (adapter, render, scorer, sanitiser, previous-attempt lookup)
// are injected so the function is fully testable without hitting real network/Chromium.

import { completeAttempt, failAttempt } from '../db/adapters/sqlite/queue.js';
import { getPreviousAttempt } from '../db/adapters/sqlite/previous-attempt.js';

function buildBasePrompt(template, { width, height, colors, chromeVersion }) {
  return template
    .replace('{{WIDTH}}', width)
    .replace('{{HEIGHT}}', height)
    .replace('{{COLORS}}', colors.join(', '))
    .replace('{{CHROME_VERSION}}', chromeVersion);
}

function buildFollowupPrompt(basePrompt, appendix, previousCode) {
  return basePrompt + '\n' + appendix.replace('{{PREVIOUS_CODE}}', previousCode ?? '');
}

function classifyError(err) {
  if (err?.name === 'PolicyViolationError') return 'policy_violation';
  return 'runtime_error';
}

function isPermanent(err) {
  return err?.name === 'AbortError' || err?.name === 'PolicyViolationError';
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Short in-claim retry for transient LLM failures (network hiccup, rate limits,
// flaky gateways). Permanent errors (policy, abort) bypass the loop.
async function generateWithRetry(adapter, args, retries, delayMs) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await adapter.generate(args);
    } catch (err) {
      lastErr = err;
      if (isPermanent(err) || i === retries) throw err;
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  throw lastErr;
}

export async function processClaim({
  db, claim,
  adapter, render, computeMatch, computeScore, sanitizeCode,
  model, reasoningEffort,
  promptTemplate, followupAppendix,
  targetDef, targetBuffer,
  width, height, chromeVersion,
  onProgress, signal,
  internalRetries = 2,
  internalRetryDelayMs = 300,
}) {
  const basePrompt = buildBasePrompt(promptTemplate, {
    width, height, colors: targetDef.colors, chromeVersion,
  });

  // Load and re-render the direct predecessor for follow-up context.
  let previousCode = null;
  let previousRender = null;
  if (claim.attempt > 1) {
    const prev = getPreviousAttempt(db, claim.run_id, claim.target_id, claim.attempt);
    if (prev?.code) {
      try {
        const sanitized = sanitizeCode(prev.code);
        const rendered = await render(sanitized, { signal });
        previousCode = sanitized;
        previousRender = rendered;
      } catch (err) {
        if (err?.name === 'AbortError') throw err;
        // Seed failed → fall back to base prompt for this attempt.
        previousCode = null;
        previousRender = null;
      }
    }
  }

  const isFollowup = previousRender !== null;
  const prompt = isFollowup
    ? buildFollowupPrompt(basePrompt, followupAppendix, previousCode)
    : basePrompt;
  const images = isFollowup ? [targetBuffer, previousRender] : [targetBuffer];

  const t0 = Date.now();
  let raw;
  try {
    raw = await generateWithRetry(
      adapter,
      { model, prompt, images, reasoningEffort, signal },
      internalRetries,
      internalRetryDelayMs,
    );
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    failAttempt(db, claim.id, claim.claim_token, err.message);
    onProgress?.({
      type: 'attempt_error',
      targetId: claim.target_id,
      attempt: claim.attempt,
      errorType: classifyError(err),
      message: err.message,
    });
    return { status: 'error', message: err.message };
  }

  let code, rendered, matchInfo, cssBattleScore;
  try {
    code = sanitizeCode(raw.code);
    rendered = await render(code, { signal });
    matchInfo = computeMatch(rendered, targetBuffer);
    cssBattleScore = computeScore(code.length, matchInfo.match);
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    failAttempt(db, claim.id, claim.claim_token, err.message);
    onProgress?.({
      type: 'attempt_error',
      targetId: claim.target_id,
      attempt: claim.attempt,
      errorType: classifyError(err),
      message: err.message,
    });
    return { status: 'error', message: err.message };
  }

  const durationMs = Date.now() - t0;
  const finishedAt = new Date().toISOString();

  completeAttempt(db, claim.id, claim.claim_token, {
    match: matchInfo.matchPercent,
    score: cssBattleScore,
    code,
    codeLength: code.length,
    tokensUsed: raw.tokensUsed ?? null,
    cost: raw.cost ?? null,
    durationMs,
    finishedAt,
  });

  onProgress?.({
    type: 'attempt',
    targetId: claim.target_id,
    attempt: claim.attempt,
    matchPercent: matchInfo.matchPercent,
    perfect: matchInfo.isProxyPerfect,
  });

  return {
    status: 'done',
    matchPercent: matchInfo.matchPercent,
    score: cssBattleScore,
    isProxyPerfect: matchInfo.isProxyPerfect,
  };
}
