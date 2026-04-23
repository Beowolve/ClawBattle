import { useMemo, useState } from 'react';
import ReasoningBadge from './ReasoningBadge.jsx';

const COLS = [
  { key: 'num',           label: '#',          numeric: true },
  { key: 'name',          label: 'Name',       numeric: false },
  { key: 'bestModel',     label: 'Best Model', numeric: false },
  { key: 'bestPrompt',    label: 'Prompt',     numeric: false },
  { key: 'bestReasoning', label: 'Reasoning',  numeric: false },
  { key: 'bestScore',     label: 'Score',      numeric: true },
  { key: 'bestMatch',     label: 'Match',      numeric: true },
  { key: 'attempts',      label: 'Attempts',   numeric: true },
];

export default function TargetTable({ targets, type, runs, modelFilter, reasoningFilter, onSelect }) {
  const [sortKey, setSortKey] = useState('num');
  const [sortDir, setSortDir] = useState('asc');
  const rows = useMemo(() => {
    return targets.map(t => {
      const targetId = type === 'battle' ? t.id : t.key;
      let targetRuns = runs.filter(r =>
        Number(r.target_id) === Number(targetId) && r.target_type === type,
      );
      if (modelFilter) targetRuns = targetRuns.filter(r => r.model === modelFilter);
      if (reasoningFilter != null) {
        targetRuns = targetRuns.filter(r => (r.reasoning_effort ?? '') === reasoningFilter);
      }

      let best = null;
      for (const r of targetRuns) {
        if (!best || (r.score ?? -Infinity) > (best.score ?? -Infinity)) best = r;
      }

      return {
        target: t,
        num: t.target_number ?? t.id ?? 0,
        name: t.name ?? t.key ?? '',
        bestModel: modelFilter ? null : (best?.model ?? null),
        bestPrompt: best?.prompt_version ?? null,
        bestReasoning: best?.reasoning_effort ?? null,
        bestScore: best?.score ?? null,
        bestMatch: best?.match ?? null,
        attempts: targetRuns.length,
      };
    });
  }, [targets, type, runs, modelFilter, reasoningFilter]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir]);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'num' ? 'asc' : 'desc');
    }
  }

  if (!targets.length) return <div className="stateBox">No targets loaded.</div>;

  return (
    <div className="tableWrap">
      <table>
        <thead>
          <tr>
            {COLS.map(col => (
              <th
                key={col.key}
                className={`sortable ${sortKey === col.key ? 'sorted' : ''} ${col.numeric ? 'numeric' : ''}`}
                onClick={() => handleSort(col.key)}
              >
                {col.label}{sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => (
            <tr
              key={row.target.id ?? row.target.key}
              className="solutionRow"
              onClick={() => onSelect?.(row.target)}
            >
              <td className="numeric">{row.num}</td>
              <td>{row.name}</td>
              <td className="modelName" title={row.bestModel ?? ''}>{row.bestModel ?? '—'}</td>
              <td className="muted">{row.bestPrompt ?? '—'}</td>
              <td><ReasoningBadge value={row.bestReasoning} showEmpty /></td>
              <td className={`numeric ${row.bestScore >= 990 ? 'perfect' : ''}`}>
                {row.bestScore != null ? row.bestScore.toFixed(2) : '—'}
              </td>
              <td className={`numeric ${row.bestMatch >= 100 ? 'perfect' : ''}`}>
                {row.bestMatch != null ? row.bestMatch.toFixed(2) + '%' : '—'}
              </td>
              <td className="numeric muted">{row.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
