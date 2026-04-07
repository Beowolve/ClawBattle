import { useMemo } from 'react';

export default function TargetGrid({ targets, type, onSelect }) {
  const sorted = useMemo(
    () => [...targets].sort((a, b) => (a.target_number ?? a.id) - (b.target_number ?? b.id)),
    [targets],
  );

  if (!targets.length) return <div className="stateBox">No targets loaded.</div>;

  const imageKey = type === 'battle'
    ? t => `/api/targets/battle/${t.id}/image`
    : t => `/api/targets/daily/${t.key}/image`;

  return (
    <div className="targetGrid" style={{ padding: '14px' }}>
      {sorted.map(t => (
        <div key={t.id ?? t.key} className="targetCard targetCardClickable" onClick={() => onSelect?.(t)}>
          <img
            className="targetImage"
            src={imageKey(t)}
            alt={t.name ?? t.key}
            loading="lazy"
          />
          <div className="targetCardBody">
            <div className="targetCardName" title={t.name ?? t.key}>{t.name ?? t.key}</div>
            <div className="targetCardMeta">
              {type === 'battle' ? `Battle ${t.battle_number} / ID ${t.id}` : t.key}
            </div>
            {t.colors?.length > 0 && (
              <div className="targetCardMeta">{t.colors.join(', ')}</div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
