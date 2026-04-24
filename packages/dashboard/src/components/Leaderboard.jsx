import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { IS_PUBLIC } from '../hooks/useData.js';
import DeleteLeaderboardRunsDialog from './DeleteLeaderboardRunsDialog.jsx';
import ReasoningBadge, { modelReasoningTitle } from './ReasoningBadge.jsx';

const EMPTY_REASONING_FILTER = '__empty__';

const COLS = [
  { key: 'rank', label: '#' },
  { key: 'model', label: 'Model', style: { width: '100%' } },
  { key: 'reasoningEffort', label: 'Reasoning' },
  { key: 'promptVersions', label: 'Prompt' },
  { key: 'targets', label: 'Targets', numeric: true },
  { key: 'avgScore', label: 'Avg Score', numeric: true },
  { key: 'avgMatch', label: 'Avg Match', numeric: true },
  { key: 'perfectCount', label: '100% #', numeric: true },
  { key: 'perfectRate', label: '100% Rate', numeric: true },
  { key: 'totalCost', label: 'Total Cost', numeric: true },
  { key: 'avgCost', label: 'Avg Cost', numeric: true },
  { key: 'avgDuration', label: 'Avg Time', numeric: true },
  ...(!IS_PUBLIC ? [{ key: 'actions', label: '' }] : []),
];

function getColumn(key) {
  return COLS.find(col => col.key === key);
}

function getSortValue(row, key) {
  if (key === 'promptVersions') {
    return row.promptVersions?.join(', ') ?? '';
  }
  return row[key];
}

function compareSortValues(left, right) {
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }

  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export default function Leaderboard({ rows, onModelSelect }) {
  const [sortKey, setSortKey] = useState('avgScore');
  const [sortDir, setSortDir] = useState('desc');
  const [filterProvider, setFilterProvider] = useState('');
  const [filterReasoning, setFilterReasoning] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [deletingKey, setDeletingKey] = useState(null);
  const queryClient = useQueryClient();

  function getRowDeleteKey(row) {
    return `${row.model}__${row.reasoningEffort ?? ''}__${row.promptVersions?.join(',') ?? ''}`;
  }

  function openDeleteDialog(row) {
    setDeleteDialog({
      row,
      selectedPrompts: [...(row.promptVersions ?? [])],
    });
  }

  function closeDeleteDialog() {
    if (deletingKey) return;
    setDeleteDialog(null);
  }

  function togglePrompt(promptVersion) {
    setDeleteDialog(current => {
      if (!current) return current;
      const selectedPrompts = current.selectedPrompts.includes(promptVersion)
        ? current.selectedPrompts.filter(value => value !== promptVersion)
        : [...current.selectedPrompts, promptVersion].sort();
      return { ...current, selectedPrompts };
    });
  }

  function selectAllPrompts() {
    setDeleteDialog(current => current ? {
      ...current,
      selectedPrompts: [...(current.row.promptVersions ?? [])],
    } : current);
  }

  function clearPrompts() {
    setDeleteDialog(current => current ? { ...current, selectedPrompts: [] } : current);
  }

  async function confirmDelete() {
    if (!deleteDialog) return;

    const { row, selectedPrompts } = deleteDialog;
    const deleteKey = getRowDeleteKey(row);
    const payload = {
      model: row.model,
      reasoningEffort: row.reasoningEffort ?? null,
      promptVersions: selectedPrompts,
    };

    setDeletingKey(deleteKey);
    try {
      const response = await fetch('/api/runs/group', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Delete failed');

      queryClient.invalidateQueries({ queryKey: ['leaderboard'] });
      queryClient.invalidateQueries({ queryKey: ['insights'] });
      queryClient.invalidateQueries({ queryKey: ['results'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
      setDeleteDialog(null);
    } finally {
      setDeletingKey(null);
    }
  }

  const providers = useMemo(() => [...new Set(rows.map(r => r.provider).filter(Boolean))].sort(), [rows]);
  const reasoningOptions = useMemo(() => {
    const values = [...new Set(rows.map(r => r.reasoningEffort ?? ''))];
    return values.sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    });
  }, [rows]);

  const sorted = useMemo(() => {
    let filtered = filterProvider ? rows.filter(r => r.provider === filterProvider) : rows;
    if (filterReasoning !== '') {
      const reasoningValue = filterReasoning === EMPTY_REASONING_FILTER ? '' : filterReasoning;
      filtered = filtered.filter(r => (r.reasoningEffort ?? '') === reasoningValue);
    }
    if (filterModel) filtered = filtered.filter(r => r.model.toLowerCase().includes(filterModel.toLowerCase()));
    return [...filtered].sort((a, b) => {
      const left = getSortValue(a, sortKey);
      const right = getSortValue(b, sortKey);

      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;

      const cmp = compareSortValues(left, right);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortKey, sortDir, filterProvider, filterReasoning, filterModel]);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(getColumn(key)?.numeric ? 'desc' : 'asc');
    }
  }

  if (!rows.length) return <div className="stateBox">No results yet.</div>;

  return (
    <div>
      <div className="filtersBar filtersBar--panel">
        <span className="filterLabel">Provider:</span>
        <select className="filterSelect" value={filterProvider} onChange={e => setFilterProvider(e.target.value)}>
          <option value="">All</option>
          {providers.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <span className="filterLabel">Reasoning:</span>
        <select className="filterSelect" value={filterReasoning} onChange={e => setFilterReasoning(e.target.value)}>
          <option value="">All</option>
          {reasoningOptions.map(reasoning => (
            <option key={reasoning || EMPTY_REASONING_FILTER} value={reasoning || EMPTY_REASONING_FILTER}>
              {reasoning || 'No reasoning'}
            </option>
          ))}
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
                const sortable = col.key !== 'rank' && col.key !== 'actions';
                return (
                  <th
                    key={col.key}
                    className={`${sortable ? 'sortable' : ''} ${sortKey === col.key ? 'sorted' : ''}`}
                    style={col.style}
                    onClick={sortable ? () => handleSort(col.key) : undefined}
                    title={col.title}
                  >
                    {col.label}{sortKey === col.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={getRowDeleteKey(row)}>
                <td className="rank">{i + 1}</td>
                <td className="modelName" title={modelReasoningTitle(row.model, row.reasoningEffort)}>
                  <button className="modelLink" onClick={() => onModelSelect?.(row.model, row.reasoningEffort)}>
                    {row.model}
                  </button>
                </td>
                <td><ReasoningBadge value={row.reasoningEffort} showEmpty /></td>
                <td className="muted">{row.promptVersions?.length ? row.promptVersions.join(', ') : '-'}</td>
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
                {!IS_PUBLIC && (
                  <td>
                    <button
                      className="deleteButton"
                      disabled={deletingKey === getRowDeleteKey(row)}
                      onClick={() => openDeleteDialog(row)}
                    >
                      {deletingKey === getRowDeleteKey(row) ? '...' : 'Delete'}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!IS_PUBLIC && deleteDialog && (
        <DeleteLeaderboardRunsDialog
          row={deleteDialog.row}
          selectedPrompts={deleteDialog.selectedPrompts}
          deleting={deletingKey === getRowDeleteKey(deleteDialog.row)}
          onTogglePrompt={togglePrompt}
          onSelectAll={selectAllPrompts}
          onClear={clearPrompts}
          onCancel={closeDeleteDialog}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
