import { useState, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useResultsPage, useResultsCount, useRuns } from '../hooks/useData.js';

const PAGE_SIZE = 100;

const COLS = [
  { key: 'run_id',          label: 'Run ID' },
  { key: 'model',           label: 'Model' },
  { key: 'prompt_version',  label: 'Prompt' },
  { key: 'reasoning_effort', label: 'Reasoning' },
  { key: 'target_id',       label: 'Target',   numeric: true },
  { key: 'target_type',     label: 'Type' },
  { key: 'attempt',         label: 'Attempt',  numeric: true },
  { key: 'match',           label: 'Match',    numeric: true },
  { key: 'score',           label: 'Score',    numeric: true },
  { key: 'code_length',     label: 'Chars',    numeric: true },
  { key: 'cost',            label: 'Cost',     numeric: true },
  { key: 'duration_ms',     label: 'Duration', numeric: true },
  { key: 'created_at',      label: 'Created' },
];

export default function RunHistory({ onResume }) {
  const queryClient = useQueryClient();
  const [selectedRun, setSelectedRun] = useState('');
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(0);

  // Reset to page 0 whenever filter/sort changes
  useEffect(() => { setPage(0); }, [selectedRun, sortKey, sortDir]);

  const runsQ = useRuns();
  const runMeta = runsQ.data ?? [];

  const pageQ = useResultsPage({ page, sort: sortKey, dir: sortDir, runId: selectedRun });
  const countQ = useResultsCount(selectedRun);

  const rows = pageQ.data ?? [];
  const total = countQ.data?.count ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);

  const metaById = useMemo(() => {
    const m = {};
    for (const r of runMeta) m[r.run_id] = r;
    return m;
  }, [runMeta]);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  if (!runsQ.isLoading && !runMeta.length && !rows.length) {
    return <div className="stateBox">No runs yet.</div>;
  }

  return (
    <div>
      <div className="filtersBar filtersBar--panel">
        <span className="filterLabel">Run:</span>
        <select className="filterSelect" value={selectedRun} onChange={e => setSelectedRun(e.target.value)}>
          <option value="">All</option>
          {runMeta.map(meta => {
            const label = `${meta.model} – ${meta.started_at?.slice(0, 16) ?? meta.run_id}`;
            const prefix = meta.status === 'running' ? '⏳ ' : meta.status === 'incomplete' ? '⚠️ ' : '';
            return <option key={meta.run_id} value={meta.run_id}>{prefix}{label}</option>;
          })}
        </select>
        {onResume && (
          <>
            {selectedRun && metaById[selectedRun]?.status === 'incomplete' && (
              <span style={{ color: 'var(--warning-color, #e6a817)', fontSize: '0.82em', display: 'flex', alignItems: 'center', gap: 4 }}>
                ⚠️ Incomplete — some targets had all attempts fail
              </span>
            )}
            <button
              className="deleteButton"
              style={{ color: 'var(--primary-color)', borderColor: 'var(--primary-color)' }}
              disabled={!selectedRun}
              onClick={() => {
                const meta = metaById[selectedRun];
                onResume({ runId: selectedRun, model: meta?.model ?? '', provider: meta?.provider ?? 'openrouter' });
              }}
            >
              Resume
            </button>
            {(() => {
              const meta = metaById[selectedRun];
              const canDelete = !!selectedRun && meta && Number(meta.attempt_count ?? 0) === 0;
              return (
                <button
                  className="deleteButton"
                  disabled={!canDelete}
                  title={!selectedRun ? 'Select a run' : !canDelete ? 'Run has saved attempts — cannot delete' : 'Delete empty run'}
                  onClick={async () => {
                    if (!confirm(`Delete empty run ${selectedRun.slice(0, 8)}?`)) return;
                    const res = await fetch(`/api/runs/${selectedRun}`, { method: 'DELETE' });
                    if (!res.ok) {
                      const { error } = await res.json().catch(() => ({}));
                      alert(`Delete failed: ${error ?? res.status}`);
                      return;
                    }
                    setSelectedRun('');
                    queryClient.invalidateQueries({ queryKey: ['runs'] });
                    queryClient.invalidateQueries({ queryKey: ['results'] });
                  }}
                >
                  Delete
                </button>
              );
            })()}
          </>
        )}
        {pageCount > 1 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="muted" style={{ fontSize: '0.85em' }}>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <button className="deleteButton" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <button className="deleteButton" disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </div>
      <div className="tableWrap">
        {pageQ.isLoading
          ? <div className="stateBox">Loading…</div>
          : (
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
              {rows.map(r => (
                <tr key={r.id} className="runRow">
                  <td className="runId muted">{r.run_id?.slice(0, 8)}</td>
                  <td className="modelName" title={r.model}>
                    {r.model}{r.reasoning_effort ? ` [${r.reasoning_effort}]` : ''}
                  </td>
                  <td className="muted">{r.prompt_version ?? '-'}</td>
                  <td className="muted">{r.reasoning_effort ?? '-'}</td>
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
        )}
      </div>
    </div>
  );
}
