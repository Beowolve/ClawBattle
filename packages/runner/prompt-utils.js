export function buildBasePrompt(template, { width, height, colors, chromeVersion }) {
  return template
    .replace('{{WIDTH}}', width)
    .replace('{{HEIGHT}}', height)
    .replace('{{COLORS}}', colors.join(', '))
    .replace('{{CHROME_VERSION}}', chromeVersion);
}

export function buildFollowupPrompt(basePrompt, appendix, { code = '', match = null, score = null } = {}) {
  const matchStr = match != null ? match.toFixed(2) + '%' : 'unknown';
  const scoreStr = score != null ? score.toFixed(2) : 'unknown';
  return basePrompt + '\n' + appendix
    .replace('{{PREVIOUS_CODE}}', code)
    .replace('{{PREVIOUS_MATCH}}', matchStr)
    .replace('{{PREVIOUS_SCORE}}', scoreStr);
}
