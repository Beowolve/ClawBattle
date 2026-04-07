// Core scorer – wraps pixelmatch
// Returns match (0-100), score (cssbattle formula, 0-1000), and isProxyPerfect.

import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const THRESHOLD = 0.01;
const SCORE_EXPONENT = 3;
const SCORE_FORMULA_FACTOR = 399.99725;
const SCORE_FORMULA_BASE = 0.9905144;
const SCORE_FORMULA_OFFSET = 599.9987;
const IMPERFECT_SCORE_CAP = 599.99;

export const PROXY_PERFECT_MATCH_THRESHOLD = 0.9998;

export function normalizeCode(code) {
  return String(code ?? '')
    .replace(/^\uFEFF/, '')   // strip BOM
    .replace(/\r\n?/g, '\n'); // normalize line endings
}

export function computeScore(codeLength, match) {
  const baseScore = Math.round((SCORE_FORMULA_FACTOR * Math.pow(SCORE_FORMULA_BASE, codeLength) + SCORE_FORMULA_OFFSET) * 100) / 100;
  if (match >= PROXY_PERFECT_MATCH_THRESHOLD) return baseScore;
  return Math.min(IMPERFECT_SCORE_CAP, Math.round(baseScore * Math.pow(match, SCORE_EXPONENT) * 100) / 100);
}

export function score(renderedBuffer, targetBuffer) {
  const img1 = PNG.sync.read(targetBuffer);
  const img2 = PNG.sync.read(renderedBuffer);

  const { width, height } = img1;
  const totalPixels = width * height;

  const diffPixels = pixelmatch(img1.data, img2.data, null, width, height, { threshold: THRESHOLD });

  const match = 1 - diffPixels / totalPixels;
  const matchPercent = Math.round(match * 100 * 100) / 100;
  const isProxyPerfect = match >= PROXY_PERFECT_MATCH_THRESHOLD;

  return { match, matchPercent, diffPixels, totalPixels, isProxyPerfect };
}
