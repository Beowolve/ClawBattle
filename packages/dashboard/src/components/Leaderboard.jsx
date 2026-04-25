import { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { IS_PUBLIC } from '../hooks/useData.js';
import DeleteLeaderboardRunsDialog from './DeleteLeaderboardRunsDialog.jsx';
import ReasoningBadge, { modelReasoningTitle, reasoningFilterLabel } from './ReasoningBadge.jsx';

const EMPTY_REASONING_FILTER = '__empty__';

const HUMAN_BASELINE_TITLES = {
  'human/top1': 'Human top1: average of the best known human leaderboard score per target.',
  'human/top10': 'Human top10: average of the top 10 human leaderboard entries per target.',
  'human/rank100': 'Human rank100: average score of the 100th-ranked human leaderboard entry per target; approximates the Top 100 entry threshold.',
  'human/expert-player': 'Human expert-player: p90 human leaderboard score per target, representing a strong expert-level player.',
  'human/avg-player': 'Human avg-player: p50 human leaderboard score per target, representing the median listed human player.',
};

const SHOW_HUMAN_STORAGE_KEY = 'clawbattle.leaderboard.showHuman';

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
  const [showHuman, setShowHuman] = useState(
    () => localStorage.getItem(SHOW_HUMAN_STORAGE_KEY) === 'true',
  );
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [deletingKey, setDeletingKey] = useState(null);
  const queryClient = useQueryClient();

  function getRowDeleteKey(row) {
    return `${row.isBaseline ? 'baseline' : 'run'}__${row.model}__${row.reasoningEffort ?? ''}__${row.promptVersions?.join(',') ?? ''}`;
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

  const filterOptionRows = useMemo(
    () => showHuman ? rows : rows.filter(r => !r.isBaseline),
    [rows, showHuman],
  );
  const providers = useMemo(() => [...new Set(filterOptionRows.map(r => r.provider).filter(Boolean))].sort(), [filterOptionRows]);
  const reasoningOptions = useMemo(() => {
    const values = [...new Set(filterOptionRows.map(r => r.reasoningEffort ?? ''))];
    return values.sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    });
  }, [filterOptionRows]);

  const sorted = useMemo(() => {
    let filtered = showHuman ? rows : rows.filter(r => !r.isBaseline);
    if (filterProvider) filtered = filtered.filter(r => r.provider === filterProvider);
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
  }, [rows, sortKey, sortDir, filterProvider, filterReasoning, filterModel, showHuman]);

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(getColumn(key)?.numeric ? 'desc' : 'asc');
    }
  }

  function handleShowHumanChange(checked) {
    setShowHuman(checked);
    localStorage.setItem(SHOW_HUMAN_STORAGE_KEY, String(checked));
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
                {reasoningFilterLabel(reasoning)}
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
        <label className="filterCheckbox filterCheckbox--right">
          <input
            type="checkbox"
            checked={showHuman}
            onChange={e => handleShowHumanChange(e.target.checked)}
          />
          <span>Human Scores</span>
        </label>
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
              <tr key={getRowDeleteKey(row)} className={row.isBaseline ? 'baselineRow baselineRow--human' : undefined}>
                <td className="rank">{i + 1}</td>
                <td
                  className="modelName"
                  title={row.isBaseline
                    ? HUMAN_BASELINE_TITLES[row.model] ?? 'Human baseline from human_stats.json.'
                    : modelReasoningTitle(row.model, row.reasoningEffort)}
                >
                  {row.isBaseline ? (
                    <span className="baselineModel" title={HUMAN_BASELINE_TITLES[row.model] ?? 'Human baseline from human_stats.json.'}>{row.model}</span>
                  ) : (
                    <button className="modelLink" onClick={() => onModelSelect?.(row.model, row.reasoningEffort)}>
                      {row.model}
                    </button>
                  )}
                </td>
                <td><ReasoningBadge value={row.reasoningEffort} showEmpty /></td>
                <td className="muted">
                  {row.isBaseline
                    ? `targets 1-${row.baselineTargetMax ?? row.targets}`
                    : row.promptVersions?.length ? row.promptVersions.join(', ') : '-'}
                </td>
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
                    {row.isBaseline ? '-' : (
                      <button
                        className="deleteButton"
                        disabled={deletingKey === getRowDeleteKey(row)}
                        onClick={() => openDeleteDialog(row)}
                      >
                        {deletingKey === getRowDeleteKey(row) ? '...' : 'Delete'}
                      </button>
                    )}
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
