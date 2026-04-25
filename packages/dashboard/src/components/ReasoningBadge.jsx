const KNOWN_REASONING_VARIANTS = new Set(['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const LEGACY_REASONING_LABEL = 'legacy';

export function normalizeReasoning(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function reasoningVariant(value) {
  const normalized = normalizeReasoning(value);
  if (!normalized) return 'legacy';
  return KNOWN_REASONING_VARIANTS.has(normalized) ? normalized : 'custom';
}

export function reasoningLabel(value, { showEmpty = false } = {}) {
  const label = String(value ?? '').trim();
  if (!label && showEmpty) return LEGACY_REASONING_LABEL;
  return label;
}

export function reasoningFilterLabel(value) {
  return String(value ?? '').trim() || 'Legacy default';
}

export function reasoningTitle(value) {
  const normalized = normalizeReasoning(value);
  if (normalized === 'default') {
    return 'Default: no reasoning parameter was sent; the provider/model default behavior applies.';
  }
  if (!normalized) {
    return 'Legacy default: this older run stored NULL before explicit default reasoning was tracked.';
  }
  return `Reasoning: ${String(value).trim()}`;
}

export function modelReasoningTitle(model, reasoning) {
  const label = reasoningLabel(reasoning);
  return label ? `${model} [${label}]` : model;
}

export default function ReasoningBadge({ value, showEmpty = false }) {
  const label = reasoningLabel(value, { showEmpty });
  if (!label && !showEmpty) return null;

  return (
    <span
      className={`reasoningBadge reasoningBadge--${reasoningVariant(value)}`}
      title={reasoningTitle(value)}
    >
      {label}
    </span>
  );
}

export function ModelWithReasoning({ model, reasoning }) {
  return (
    <span className="modelConfigLabel">
      <span className="modelConfigLabel__model">{model}</span>
      <ReasoningBadge value={reasoning} />
    </span>
  );
}
