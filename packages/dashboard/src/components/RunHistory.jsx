import { useState, useMemo } from 'react';

const COLS = [
  { key: 'run_id',      label: 'Run ID' },
  { key: 'model',       label: 'Model' },
  { key: 'target_id',   label: 'Target',   numeric: true },
  { key: 'target_type', label: 'Type' },
  { key: 'attempt',     label: 'Attempt',  numeric: true },
  { key: 'match',       label: 'Match',    numeric: true },
  { key: 'score',       label: 'Score',    numeric: true },
  { key: 'code_length', label: 'Chars',    numeric: true },
  { key: 'cost',        label: 'Cost',     numeric: true },
  { key: 'duration_ms', label: 'Duration', numeric: true },
  { key: 'created_at',  label: 'Created' },
];

export default function RunHistory({ runs, runMeta, onResume }) {
  const [selectedRun, setSelectedRun] = useState('');
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');

  const metaById = useMemo(() => {
    const m = {};
    for (const r of runMeta) m[r.run_id] = r;
    return m;
  }, [runMeta]);

  const runIds = useMemo(() => [...new Set(runs.map(r => r.run_id))], [runs]);

  const sorted = useMemo(() => {
    const base = selectedRun ? runs.filter(r => r.run_id === selectedRun) : runs;
    return [...base].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [runs, selectedRun, sortKey, sortDir]);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  if (!runs.length) return <div className="stateBox">No runs yet.</div>;

  return (
    <div>
      <div className="filtersBar" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-color)' }}>
        <span className="filterLabel">Run:</span>
        <select className="filterSelect" value={selectedRun} onChange={e => setSelectedRun(e.target.value)}>
          <option value="">All</option>
          {runIds.map(id => {
            const meta = metaById[id];
            const label = meta ? `${meta.model} – ${meta.started_at?.slice(0, 16) ?? id}` : id;
            return <option key={id} value={id}>{label}</option>;
          })}
        </select>
        {onResume && (
          <button
            className="deleteButton"
            style={{ color: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
            disabled={!selectedRun}
            onClick={() => {
              const meta = metaById[selectedRun];
              console.log('[RunHistory] Resume clicked — runId:', selectedRun, 'meta:', meta);
              onResume({ runId: selectedRun, model: meta?.model ?? '', provider: meta?.provider ?? 'openrouter' });
            }}
          >
            Resume
          </button>
        )}
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              {COLS.map(col => (
                <th
                  key={col.key}
                  className={`sortable ${col.numeric ? 'numeric' : ''} ${sortKey === col.key ? 'sorted' : ''}`}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}{sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(r => (
              <tr key={r.id} className="runRow">
                <td className="runId muted">{r.run_id?.slice(0, 8)}</td>
                <td className="modelName" title={r.model}>{r.model}</td>
                <td className="numeric">{r.target_type === 'battle' ? parseInt(r.target_id) : r.target_id}</td>
                <td>
                  <span className={r.target_type === 'battle' ? 'badge badgeBattle' : 'badge badgeDaily'}>
                    {r.target_type}
                  </span>
                </td>
                <td className="numeric muted">{r.attempt}</td>
                <td className="numeric">{r.match != null ? r.match.toFixed(2) + '%' : '-'}</td>
                <td className={`numeric ${r.score >= 990 ? 'perfect' : ''}`}>
                  {r.score != null ? r.score.toFixed(2) : '-'}
                </td>
                <td className="numeric muted">{r.code_length ?? '-'}</td>
                <td className="numeric muted">{r.cost != null ? '$' + r.cost.toFixed(5) : '-'}</td>
                <td className="numeric muted">{r.duration_ms != null ? (r.duration_ms / 1000).toFixed(1) + 's' : '-'}</td>
                <td className="muted">{r.created_at?.slice(0, 16) ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
