import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';

function buildLeaderboard(runs) {
  // Total cost + attempt count = sum of ALL attempts per model+reasoning
  const costByModel = {};
  const attemptsByModel = {};
  for (const r of runs) {
    const k = `${r.model}__${r.reasoning_effort ?? ''}`;
    attemptsByModel[k] = (attemptsByModel[k] ?? 0) + 1;
    if (r.cost != null) costByModel[k] = (costByModel[k] ?? 0) + r.cost;
  }

  // Scores/match/duration = best attempt per model+reasoning+target
  const byModelTarget = {};
  for (const r of runs) {
    const key = `${r.model}__${r.reasoning_effort ?? ''}__${r.target_id}__${r.target_type}`;
    if (!byModelTarget[key] || r.score > byModelTarget[key].score) {
      byModelTarget[key] = r;
    }
  }

  const byModel = {};
  for (const r of Object.values(byModelTarget)) {
    const modelKey = `${r.model}__${r.reasoning_effort ?? ''}`;
    if (!byModel[modelKey]) {
      byModel[modelKey] = { model: r.model, reasoningEffort: r.reasoning_effort ?? null, provider: r.provider, scores: [], matches: [], durations: [], perfectCount: 0, promptVersions: new Set() };
    }
    const m = byModel[modelKey];
    if (r.score != null) m.scores.push(r.score);
    if (r.match != null) m.matches.push(r.match);
    if (r.duration_ms != null) m.durations.push(r.duration_ms);
    if (r.match >= 100) m.perfectCount++;
    if (r.prompt_version) m.promptVersions.add(r.prompt_version);
  }

  return Object.values(byModel).map(m => ({
    model: m.model,
    reasoningEffort: m.reasoningEffort,
    provider: m.provider,
    promptVersions: [...m.promptVersions].sort(),
    avgScore: m.scores.length ? m.scores.reduce((a, b) => a + b, 0) / m.scores.length : null,
    avgMatch: m.matches.length ? m.matches.reduce((a, b) => a + b, 0) / m.matches.length : null,
    totalCost: costByModel[`${m.model}__${m.reasoningEffort ?? ''}`] ?? null,
    avgCost: costByModel[`${m.model}__${m.reasoningEffort ?? ''}`] != null ? costByModel[`${m.model}__${m.reasoningEffort ?? ''}`] / attemptsByModel[`${m.model}__${m.reasoningEffort ?? ''}`] : null,
    avgDuration: m.durations.length ? m.durations.reduce((a, b) => a + b, 0) / m.durations.length : null,
    targets: m.scores.length,
    perfectCount: m.perfectCount,
    perfectRate: m.scores.length ? m.perfectCount / m.scores.length : null,
  }));
}

const COLS = [
  { key: 'rank', label: '#' },
  { key: 'model', label: 'Model' },
  { key: 'promptVersions', label: 'Prompt' },
  { key: 'reasoningEffort', label: 'Reasoning' },
  { key: 'targets', label: 'Targets', numeric: true },
  { key: 'avgScore', label: 'Avg Score', numeric: true },
  { key: 'avgMatch', label: 'Avg Match', numeric: true },
  { key: 'perfectCount', label: '100% #', numeric: true },
  { key: 'perfectRate', label: '100% Rate', numeric: true },
  { key: 'totalCost', label: 'Total Cost', numeric: true },
  { key: 'avgCost', label: 'Avg Cost', numeric: true },
  { key: 'avgDuration', label: 'Avg Time', numeric: true },
  { key: 'actions', label: '' },
];

export default function Leaderboard({ runs, onModelSelect }) {
  const [sortKey, setSortKey] = useState('avgScore');
  const [sortDir, setSortDir] = useState('desc');
  const [filterProvider, setFilterProvider] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [deleting, setDeleting] = useState(null);
  const queryClient = useQueryClient();

  async function handleDelete(model) {
    if (!window.confirm(`Delete all runs for "${model}"?`)) return;
    setDeleting(model);
    try {
      await fetch(`/api/runs?model=${encodeURIComponent(model)}`, { method: 'DELETE' });
      queryClient.invalidateQueries({ queryKey: ['results'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    } finally {
      setDeleting(null);
    }
  }

  const rows = useMemo(() => buildLeaderboard(runs), [runs]);

  const providers = useMemo(() => [...new Set(rows.map(r => r.provider).filter(Boolean))].sort(), [rows]);

  const sorted = useMemo(() => {
    let filtered = filterProvider ? rows.filter(r => r.provider === filterProvider) : rows;
    if (filterModel) filtered = filtered.filter(r => r.model.toLowerCase().includes(filterModel.toLowerCase()));
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
  }, [rows, sortKey, sortDir, filterProvider, filterModel]);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  if (!runs.length) return <div className="stateBox">No results yet.</div>;

  return (
    <div>
      <div className="filtersBar" style={{ padding: '10px 14px', borderBottom: '1px solid var(--border-color)' }}>
        <span className="filterLabel">Provider:</span>
        <select className="filterSelect" value={filterProvider} onChange={e => setFilterProvider(e.target.value)}>
          <option value="">All</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="filterLabel">Model:</span>
        <input
          className="filterInput"
          type="text"
          placeholder="Filter by model…"
          value={filterModel}
          onChange={e => setFilterModel(e.target.value)}
        />
      </div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              {COLS.map(col => {
                const sortable = col.key !== 'rank' && col.key !== 'model' && col.key !== 'actions';
                return (
                  <th
                    key={col.key}
                    className={`${sortable ? 'sortable' : ''} ${sortKey === col.key ? 'sorted' : ''}`}
                    onClick={sortable ? () => handleSort(col.key) : undefined}
                  >
                    {col.label}{sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={row.model}>
                <td className="rank">{i + 1}</td>
                <td className="modelName" title={row.model}>
                  <button className="modelLink" onClick={() => onModelSelect?.(row.model)}>
                    {row.model}{row.reasoningEffort ? ` [${row.reasoningEffort}]` : ''}
                  </button>
                </td>
                <td className="muted">{row.promptVersions.length ? row.promptVersions.join(', ') : '-'}</td>
                <td className="muted">{row.reasoningEffort ?? '-'}</td>
                <td className="numeric">{row.targets}</td>
                <td className={`numeric ${row.avgScore >= 990 ? 'perfect' : ''}`}>
                  {row.avgScore != null ? row.avgScore.toFixed(2) : '-'}
                </td>
                <td className="numeric">{row.avgMatch != null ? row.avgMatch.toFixed(2) + '%' : '-'}</td>
                <td className={`numeric ${row.perfectCount > 0 ? 'perfect' : ''}`}>{row.perfectCount}</td>
                <td className={`numeric ${row.perfectRate > 0 ? 'perfect' : ''}`}>{row.perfectRate != null ? (row.perfectRate * 100).toFixed(1) + '%' : '-'}</td>
                <td className="numeric muted">{row.totalCost != null ? '$' + row.totalCost.toFixed(4) : '-'}</td>
                <td className="numeric muted">{row.avgCost != null ? '$' + row.avgCost.toFixed(4) : '-'}</td>
                <td className="numeric muted">{row.avgDuration != null ? (row.avgDuration / 1000).toFixed(1) + 's' : '-'}</td>
                <td>
                  <button
                    className="deleteButton"
                    disabled={deleting === row.model}
                    onClick={() => handleDelete(row.model)}
                  >
                    {deleting === row.model ? '...' : 'Delete'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
