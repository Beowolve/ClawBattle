const KNOWN_REASONING_VARIANTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'max']);

export function normalizeReasoning(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function reasoningVariant(value) {
  const normalized = normalizeReasoning(value);
  if (!normalized) return 'empty';
  return KNOWN_REASONING_VARIANTS.has(normalized) ? normalized : 'custom';
}

export function reasoningLabel(value) {
  return String(value ?? '').trim();
}

export function modelReasoningTitle(model, reasoning) {
  const label = reasoningLabel(reasoning);
  return label ? `${model} [${label}]` : model;
}

export default function ReasoningBadge({ value, showEmpty = false }) {
  const label = reasoningLabel(value);
  if (!label && !showEmpty) return null;

  return (
    <span className={`reasoningBadge reasoningBadge--${reasoningVariant(value)}`}>
      {label || '-'}
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
