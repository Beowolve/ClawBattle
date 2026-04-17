import { useMemo, useState, useEffect, useCallback } from 'react';
import { IS_PUBLIC } from '../hooks/useData.js';

export default function TargetDetail({ target, type, runs, modelFilter, models, onModelFilterChange, onBack, onPrev, onNext }) {
  const [selected, setSelected] = useState(null);

  // Callback ref re-runs whenever selected changes, guaranteeing the write
  // happens after the node is in the DOM with a ready contentDocument.
  const iframeRef = useCallback((node) => {
    if (!node) return;
    const doc = node.contentDocument;
    doc.open();
    doc.write(selected?.code ?? '');
    doc.close();
  }, [selected]);

  const targetId = type === 'battle' ? target.id : target.key;
  const imageUrl = IS_PUBLIC
    ? (target.image_url ?? null)
    : type === 'battle'
      ? `/api/targets/battle/${target.id}/image`
      : `/api/targets/daily/${target.key}/image`;

  const solutions = useMemo(() => {
    let filtered = runs.filter(r =>
      Number(r.target_id) === Number(targetId) && r.target_type === type && r.code,
    );
    if (modelFilter) filtered = filtered.filter(r => r.model === modelFilter);
    return [...filtered].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }, [runs, targetId, type, modelFilter]);

  // Auto-select best result
  useEffect(() => {
    setSelected(solutions[0] ?? null);
  }, [solutions]);

  return (
    <div className="targetDetailWrap">

      {/* Sticky top: header + code/preview/target */}
      <div className="targetDetailSticky">
        <div className="targetDetailHeader">
          <button className="backButton" onClick={onBack}>← Back</button>
          <button className="navButton" onClick={onPrev} disabled={!onPrev}>‹ Prev</button>
          <button className="navButton" onClick={onNext} disabled={!onNext}>Next ›</button>
          {imageUrl && <img className="targetDetailThumb" src={imageUrl} alt={target.name ?? target.key} />}
          <div>
            {type === 'battle' ? (
              <a
                className="targetDetailName targetDetailLink"
                href={`https://cssbattle.dev/play/${target.id}`}
                target="_blank"
                rel="noreferrer"
              >
                {target.name}
              </a>
            ) : (
              <div className="targetDetailName">{target.name ?? target.key}</div>
            )}
            <div className="targetDetailMeta">
              {type === 'battle' ? `Battle ${target.battle_number} / ID ${target.id}` : target.key}
              {target.colors?.length ? ` · ${target.colors.join(', ')}` : ''}
            </div>
          </div>
          {selected && (
            <div className="targetDetailSelected">
              <span className="targetDetailSelectedModel" title={selected.model}>{selected.model}</span>
              <span className="targetDetailSelectedMeta">
                attempt {selected.attempt} · {selected.match?.toFixed(2)}% · score {selected.score?.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        <div className="targetDetailPreviewRow">
          {/* Left: code */}
          <pre className="targetDetailCode">{selected?.code ?? 'Select a solution below.'}</pre>

          {/* Center: rendered preview */}
          <div className="targetDetailFrame">
            <div className="targetDetailFrameLabel">Solution</div>
            <iframe ref={iframeRef} title="solution preview" className="solutionIframe" scrolling="no" />
          </div>

          {/* Right: target image */}
          {imageUrl && (
            <div className="targetDetailFrame">
              <div className="targetDetailFrameLabel">Target</div>
              <img className="solutionTargetImg" src={imageUrl} alt="target" />
            </div>
          )}
        </div>
      </div>

      {/* Scrollable solutions table */}
      <div className="panel" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderBottom: 'none' }}>
        <div className="panelHeader">
          <h2>Solutions</h2>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {models?.length > 0 && (
              <select
                className="filterSelect"
                value={modelFilter ?? ''}
                onChange={e => onModelFilterChange?.(e.target.value || null)}
              >
                <option value="">All models</option>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            <span>{solutions.length} attempts with code</span>
          </span>
        </div>
        {solutions.length === 0 ? (
          <div className="stateBox">No solutions recorded for this target yet.</div>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Prompt</th>
                  <th>Run</th>
                  <th className="numeric">Attempt</th>
                  <th className="numeric">Match</th>
                  <th className="numeric">Score</th>
                  <th className="numeric">Chars</th>
                  <th className="numeric">Cost</th>
                </tr>
              </thead>
              <tbody>
                {solutions.map(r => (
                  <tr
                    key={r.id}
                    className={`solutionRow ${selected?.id === r.id ? 'solutionRowActive' : ''}`}
                    onClick={() => setSelected(r)}
                  >
                    <td className="modelName" title={r.model}>{r.model}</td>
                    <td className="muted" style={{ fontSize: '0.82rem' }}>{r.prompt_version ?? '-'}</td>
                    <td className="muted" style={{ fontSize: '0.82rem' }}>{r.run_id?.slice(0, 8)}</td>
                    <td className="numeric muted">{r.attempt}</td>
                    <td className={`numeric ${r.match >= 100 ? 'perfect' : ''}`}>
                      {r.match != null ? r.match.toFixed(2) + '%' : '-'}
                    </td>
                    <td className={`numeric ${r.score >= 990 ? 'perfect' : ''}`}>
                      {r.score != null ? r.score.toFixed(2) : '-'}
                    </td>
                    <td className="numeric muted">{r.code_length ?? '-'}</td>
                    <td className="numeric muted">{r.cost != null ? '$' + r.cost.toFixed(5) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
