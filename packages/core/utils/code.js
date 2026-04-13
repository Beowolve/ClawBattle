const DISALLOWED_PATTERNS = [
  { pattern: /<\s*script\b/i, reason: 'JavaScript <script> tags are not allowed' },
  { pattern: /\bon\w+\s*=\s*["']/i, reason: 'Inline JavaScript event handlers are not allowed' },
  { pattern: /\bjavascript\s*:/i, reason: 'javascript: URLs are not allowed' },
  { pattern: /<\s*svg\b/i, reason: '<svg> tags are not allowed' },
  { pattern: /\b(src|href)\s*=\s*["']\s*(?:(https?:)?\/\/|(data|blob|file|ftp)\s*:)/i, reason: 'Disallowed resource URL in src/href is not allowed' },
  { pattern: /\bsrcset\s*=\s*["'][^"']*(?:(https?:)?\/\/|(data|blob|file|ftp)\s*:)/i, reason: 'Disallowed resource URL in srcset is not allowed' },
  { pattern: /url\(\s*["']?\s*(?:(https?:)?\/\/|(data|blob|file|ftp)\s*:)/i, reason: 'Disallowed CSS url(...) resource is not allowed' },
  { pattern: /@import\s+(url\()?\s*["']?\s*(?:(https?:)?\/\/|(data|blob|file|ftp)\s*:)/i, reason: 'Disallowed CSS @import resource is not allowed' },
];

export class PolicyViolationError extends Error {
  constructor(violations) {
    super(violations.join('; '));
    this.name = 'PolicyViolationError';
    this.violations = violations;
  }
}

export function normalizeCode(code) {
  return String(code ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n');
}

export function getCodePolicyViolations(code) {
  const normalizedCode = normalizeCode(code);
  return DISALLOWED_PATTERNS
    .filter(({ pattern }) => pattern.test(normalizedCode))
    .map(({ reason }) => reason);
}

export function sanitizeCode(code) {
  const normalizedCode = normalizeCode(code);
  const violations = getCodePolicyViolations(normalizedCode);

  if (violations.length > 0) {
    throw new PolicyViolationError(violations);
  }

  return normalizedCode;
}

