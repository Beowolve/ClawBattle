import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCode, getCodePolicyViolations, sanitizeCode, PolicyViolationError } from './code.js';

test('normalizeCode strips BOM and normalizes line endings', () => {
  const input = '\uFEFF<div>ok</div>\r\n<style>body{}</style>\r';
  const normalized = normalizeCode(input);
  assert.equal(normalized, '<div>ok</div>\n<style>body{}</style>\n');
});

test('getCodePolicyViolations reports disallowed patterns', () => {
  const violations = getCodePolicyViolations('<script>alert(1)</script><svg></svg>');
  assert.deepEqual(violations, [
    'JavaScript <script> tags are not allowed',
    '<svg> tags are not allowed',
  ]);
});

test('sanitizeCode allows plain HTML/CSS', () => {
  const safeCode = '<style>body{margin:0;background:#fff}</style><div></div>';
  assert.equal(sanitizeCode(safeCode), safeCode);
});

test('sanitizeCode allows iframe when no external resource is referenced', () => {
  const safeIframe = '<iframe srcdoc="<style>body{margin:0}</style><div></div>"></iframe>';
  assert.equal(sanitizeCode(safeIframe), safeIframe);
});

test('sanitizeCode rejects external resources and JavaScript', () => {
  const unsafe = '<img src="https://example.com/x.png" onload="alert(1)">';
  assert.throws(
    () => sanitizeCode(unsafe),
    err => err instanceof PolicyViolationError
      && err.violations.includes('Disallowed resource URL in src/href is not allowed')
      && err.violations.includes('Inline JavaScript event handlers are not allowed'),
  );
});

test('sanitizeCode rejects iframe with external src', () => {
  const unsafeIframe = '<iframe src="https://example.com/embed"></iframe>';
  assert.throws(
    () => sanitizeCode(unsafeIframe),
    err => err instanceof PolicyViolationError
      && err.violations.includes('Disallowed resource URL in src/href is not allowed'),
  );
});

test('sanitizeCode rejects data URLs in src', () => {
  const unsafeDataUrl = '<img src="data:image/png;base64,AAAA">';
  assert.throws(
    () => sanitizeCode(unsafeDataUrl),
    err => err instanceof PolicyViolationError
      && err.violations.includes('Disallowed resource URL in src/href is not allowed'),
  );
});

test('sanitizeCode rejects disallowed URLs in srcset', () => {
  const unsafeSrcSet = '<img srcset="small.png 1x, data:image/png;base64,AAAA 2x">';
  assert.throws(
    () => sanitizeCode(unsafeSrcSet),
    err => err instanceof PolicyViolationError
      && err.violations.includes('Disallowed resource URL in srcset is not allowed'),
  );
});

