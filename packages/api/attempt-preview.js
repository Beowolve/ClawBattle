import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRequestBody as buildOpenRouterRequestBody } from '../core/llm/openrouter.js';
import { buildRequestBody as buildOpenAiRequestBody } from '../core/llm/openai.js';
import { buildRequestBody as buildOllamaRequestBody } from '../core/llm/ollama.js';
import { sanitizeCode } from '../core/utils/code.js';
import { render, getChromeVersion } from '../core/renderer.js';
import { getBattleTargets, getDailyTargets, getPreviousAttempt } from '../db/index.js';
import { buildBasePrompt, buildFollowupPrompt } from '../runner/prompt-utils.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TARGETS_DIR = path.join(ROOT, 'targets');
const PROMPTS_DIR = path.join(ROOT, 'prompts');
const TARGET_WIDTH = 400;
const TARGET_HEIGHT = 300;

function findTargetDefinition(targetType, targetId) {
  if (targetType === 'daily') {
    return getDailyTargets().find((t) => String(t.key) === String(targetId)) ?? null;
  }
  const normalized = String(Math.round(Number(targetId)));
  return getBattleTargets().find((t) => String(Math.round(Number(t.id))) === normalized) ?? null;
}

function buildProviderRequestBody({ provider, model, prompt, images, reasoningEffort }) {
  if (provider === 'openai') {
    return buildOpenAiRequestBody({ model, prompt, images, reasoningEffort });
  }
  if (provider === 'ollama') {
    return buildOllamaRequestBody({ model, prompt, images });
  }
  return buildOpenRouterRequestBody({ model, prompt, images, reasoningEffort });
}

export async function buildAttemptPreview(attempt) {
  const targetDef = findTargetDefinition(attempt.target_type, attempt.target_id);
  if (!targetDef) {
    throw new Error(`target not found for attempt ${attempt.id}: ${attempt.target_type}/${attempt.target_id}`);
  }

  const promptVersion = attempt.prompt_version ?? process.env.PROMPT_VERSION ?? 'v3';
  const promptTemplate = fs.readFileSync(path.join(PROMPTS_DIR, promptVersion, 'prompt.md'), 'utf8');
  const followupAppendix = fs.readFileSync(path.join(PROMPTS_DIR, promptVersion, 'followup.md'), 'utf8');
  const chromeVersion = await getChromeVersion();
  const basePrompt = buildBasePrompt(promptTemplate, {
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    colors: targetDef.colors,
    chromeVersion,
  });

  const targetBuffer = fs.readFileSync(path.join(TARGETS_DIR, 'images', attempt.target_type, `${attempt.target_id}.png`));
  let prompt = basePrompt;
  let images = [targetBuffer];
  let isFollowup = false;

  if (attempt.attempt > 1) {
    const previous = getPreviousAttempt(attempt.run_id, attempt.target_id, attempt.attempt);
    if (previous?.code) {
      try {
        const previousCode = sanitizeCode(previous.code);
        const previousRender = await render(previousCode);
        prompt = buildFollowupPrompt(basePrompt, followupAppendix, {
          code: previousCode,
          match: previous.match ?? null,
          score: previous.score ?? null,
        });
        images = [targetBuffer, previousRender];
        isFollowup = true;
      } catch {
        // Match worker behaviour: if previous code cannot be re-rendered, fall
        // back to a base prompt for this attempt.
        prompt = basePrompt;
        images = [targetBuffer];
        isFollowup = false;
      }
    }
  }

  const requestBody = buildProviderRequestBody({
    provider: attempt.provider,
    model: attempt.model,
    prompt,
    images,
    reasoningEffort: attempt.reasoning_effort ?? null,
  });

  return {
    promptVersion,
    chromeVersion,
    width: TARGET_WIDTH,
    height: TARGET_HEIGHT,
    isFollowup,
    computedPrompt: prompt,
    computedRequestBody: requestBody,
  };
}
