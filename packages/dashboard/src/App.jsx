import { useState, useMemo } from 'react';
import {
  useBattleTargets, useDailyTargets,
  useLeaderboard, useInsights,
  useTargetResults, useTargetResultsSummary,
  IS_PUBLIC,
} from './hooks/useData.js';
import Header from './components/Header.jsx';
import KpiCard from './components/KpiCard.jsx';
import Leaderboard from './components/Leaderboard.jsx';
import TargetGrid from './components/TargetGrid.jsx';
import TargetTable from './components/TargetTable.jsx';
import RunHistory from './components/RunHistory.jsx';
import StartRun from './components/StartRun.jsx';
import TargetDetail from './components/TargetDetail.jsx';
import Insights from './components/Insights.jsx';
import Sync from './components/Sync.jsx';
import About from './components/About.jsx';

const TABS = [
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'targets', label: 'Targets' },
  { id: 'insights', label: 'Insights' },
  { id: 'about', label: 'About' },
  ...(!IS_PUBLIC ? [
    { id: 'runs', label: 'Run History' },
    { id: 'run', label: '+ Run' },
    { id: 'sync', label: '⇅ Sync' },
  ] : []),
];

const EMPTY_REASONING_FILTER = '__empty__';

function computeKpisFromLeaderboard(data, promptFilter) {
  const promptScope = promptFilter && promptFilter !== 'all'
    ? promptFilter
    : 'all prompts';

  if (!data?.rows?.length) {
    return {
      totalRuns: 0,
      avgBestScore: '-',
      totalCost: '-',
      totalCostSub: `0 attempts | ${promptScope}`,
      models: 0,
      modelSub: `0 configs | 0 entries | ${promptScope}`,
    };
  }

  const benchmarkRows = data.rows.filter(r => !r.isBaseline);
  const modelCount = new Set(benchmarkRows.map(r => r.model)).size;
  const configCount = new Set(benchmarkRows.map(r => `${r.model}__${r.reasoningEffort ?? ''}`)).size;

  const totalTargets = benchmarkRows.reduce((a, r) => a + r.targets, 0);
  const weightedScore = benchmarkRows.reduce((a, r) => a + (r.avgScore ?? 0) * r.targets, 0);
  const avgBestScore = totalTargets > 0 ? (weightedScore / totalTargets).toFixed(2) : '-';
  return {
    totalRuns: data.totalAttempts,
    avgBestScore,
    totalCost: data.totalCost > 0 ? '$' + data.totalCost.toFixed(4) : '-',
    totalCostSub: `${data.totalAttempts} attempts | ${promptScope}`,
    models: modelCount,
    modelSub: `${configCount} configs | ${benchmarkRows.length} entries | ${promptScope}`,
  };
}

export default function App() {
  const [tab, setTabState] = useState(() => {
    const saved = localStorage.getItem('clawbattle.tab');
    return TABS.some(t => t.id === saved) ? saved : 'leaderboard';
  });
  function setTab(next) {
    setTabState(next);
    localStorage.setItem('clawbattle.tab', next);
  }
  const [targetType] = useState('battle');
  const [targetView, setTargetView] = useState('table');
  const [runStatus, setRunStatus] = useState('idle');
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [promptFilter, setPromptFilter] = useState(
    () => localStorage.getItem('clawbattle.promptFilter') ?? 'all',
  );
  function handlePromptFilter(v) {
    setPromptFilter(v);
    localStorage.setItem('clawbattle.promptFilter', v);
  }
  const [modelFilter, setModelFilter] = useState(null);
  const [reasoningFilter, setReasoningFilter] = useState(null);

  function handleModelSelect(model, reasoningEffort) {
    setModelFilter(model);
    setReasoningFilter(reasoningEffort ?? '');
    setTargetView('table');
    setTab('targets');
  }

  // Leaderboard loads first; tab-specific datasets are enabled only when needed.
  const leaderboardQ = useLeaderboard(promptFilter);
  const insightsQ = useInsights(promptFilter, { enabled: tab === 'insights' });

  // Raw results loaded lazily — only when the Targets tab is open
  const selectedTargetId = selectedTarget
    ? (targetType === 'battle' ? selectedTarget.id : selectedTarget.key)
    : null;
  const selectedReasoningFilter = reasoningFilter == null ? undefined : reasoningFilter;

  const targetSummaryQ = useTargetResultsSummary({
    promptFilter,
    enabled: tab === 'targets',
  });
  const targetRunsQ = useTargetResults({
    targetId: selectedTargetId,
    targetType,
    promptFilter,
    model: modelFilter ?? undefined,
    reasoningEffort: selectedReasoningFilter,
    enabled: tab === 'targets' && selectedTarget != null,
  });
  const battleQ = useBattleTargets({ enabled: tab === 'targets' && targetType === 'battle' });
  const dailyQ = useDailyTargets({ enabled: tab === 'targets' && targetType === 'daily' });

  const targetSummaries = targetSummaryQ.data ?? [];
  const selectedTargetRuns = targetRunsQ.data ?? [];
  const battleTargets = battleQ.data ?? [];
  const dailyTargets = dailyQ.data ?? [];

  // Prompt versions come from the leaderboard response (always available)
  const promptVersions = leaderboardQ.data?.promptVersions ?? [];

  const models = useMemo(
    () => [...new Set(
      leaderboardQ.data?.rows?.filter(r => !r.isBaseline).map(r => r.model) ?? [],
    )].sort(),
    [leaderboardQ.data],
  );

  const reasoningOptions = useMemo(() => {
    const values = new Set(
      targetSummaries
        .filter(r => r.target_type === targetType)
        .map(r => r.reasoning_effort ?? ''),
    );
    return [...values].sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    });
  }, [targetSummaries, targetType]);

  // KPIs derived from leaderboard aggregation — available without loading raw runs
  const kpis = computeKpisFromLeaderboard(leaderboardQ.data, promptFilter);

  const sortedTargets = useMemo(() => {
    const list = targetType === 'battle' ? battleTargets : dailyTargets;
    const sorted = [...list].sort((a, b) => (a.target_number ?? a.id) - (b.target_number ?? b.id));
    if (IS_PUBLIC && targetType === 'battle') {
      const targetIdsWithRuns = new Set(
        targetSummaries.filter(r => r.target_type === 'battle').map(r => Number(r.target_id))
      );
      return sorted.filter(t => targetIdsWithRuns.has(Number(t.id)));
    }
    return sorted;
  }, [targetType, battleTargets, dailyTargets, targetSummaries]);

  return (
    <div className="appRoot">
      <div className="topBand" />
      <Header promptVersions={promptVersions} promptFilter={promptFilter} onPromptChange={handlePromptFilter} />
      <main className="appContent">
        <div className="kpiGrid">
          <KpiCard title="Total Runs" value={kpis.totalRuns} />
          <KpiCard title="Models Tested" value={kpis.models} sub={kpis.modelSub} />
          <KpiCard title="Avg Best Score" value={kpis.avgBestScore} sub="best attempt per target" />
          <KpiCard title="Total Cost" value={kpis.totalCost} sub={kpis.totalCostSub} />
        </div>

        <div className="tabs">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tabButton ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === 'run' && runStatus === 'running' && (
                <span className="runDot" />
              )}
            </button>
          ))}
        </div>

        {tab === 'leaderboard' && (
          <div className="panel">
            <div className="panelHeader">
              <h2>Leaderboard</h2>
              <span>{kpis.totalRuns} run{kpis.totalRuns !== 1 ? 's' : ''}</span>
            </div>
            {leaderboardQ.isLoading
              ? <div className="stateBox">Loading...</div>
              : <Leaderboard rows={leaderboardQ.data?.rows ?? []} onModelSelect={handleModelSelect} />
            }
          </div>
        )}

        {tab === 'targets' && (
          <div>
            {selectedTarget ? (() => {
              const selectedIdx = sortedTargets.findIndex(
                t => (t.id ?? t.key) === (selectedTarget.id ?? selectedTarget.key),
              );
              return (
                <TargetDetail
                  target={selectedTarget}
                  type={targetType}
                  targetCount={sortedTargets.length}
                  runs={selectedTargetRuns}
                  modelFilter={modelFilter}
                  reasoningFilter={reasoningFilter}
                  models={models}
                  reasoningOptions={reasoningOptions}
                  onModelFilterChange={setModelFilter}
                  onReasoningFilterChange={setReasoningFilter}
                  onBack={() => setSelectedTarget(null)}
                  onPrev={selectedIdx > 0 ? () => setSelectedTarget(sortedTargets[selectedIdx - 1]) : null}
                  onNext={selectedIdx < sortedTargets.length - 1 ? () => setSelectedTarget(sortedTargets[selectedIdx + 1]) : null}
                  isLoading={targetRunsQ.isLoading}
                />
              );
            })() : (
              <>
                <div className="filtersBar">
                  <button className="tabButton active">
                    Battle ({battleTargets.length})
                  </button>
                  <select
                    className="filterSelect"
                    value={modelFilter ?? ''}
                    onChange={e => setModelFilter(e.target.value || null)}
                  >
                    <option value="">All models</option>
                    {models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select
                    className="filterSelect"
                    value={reasoningFilter === '' ? EMPTY_REASONING_FILTER : (reasoningFilter ?? '')}
                    onChange={e => {
                      const value = e.target.value;
                      setReasoningFilter(value === EMPTY_REASONING_FILTER ? '' : (value || null));
                    }}
                  >
                    <option value="">All reasoning</option>
                    {reasoningOptions.map(r => (
                      <option key={r || EMPTY_REASONING_FILTER} value={r || EMPTY_REASONING_FILTER}>
                        {r || 'No reasoning'}
                      </option>
                    ))}
                  </select>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button
                      className={`tabButton ${targetView === 'grid' ? 'active' : ''}`}
                      onClick={() => setTargetView('grid')}
                    >
                      Grid
                    </button>
                    <button
                      className={`tabButton ${targetView === 'table' ? 'active' : ''}`}
                      onClick={() => setTargetView('table')}
                    >
                      Table
                    </button>
                  </span>
                </div>
                <div className="panel">
                  <div className="panelHeader">
                    <h2>Battle Targets</h2>
                  </div>
                  {battleQ.isLoading || targetSummaryQ.isLoading
                    ? <div className="stateBox">Loading...</div>
                    : targetView === 'table'
                      ? <TargetTable
                          targets={sortedTargets}
                          type={targetType}
                          summaries={targetSummaries}
                          modelFilter={modelFilter}
                          reasoningFilter={reasoningFilter}
                          onSelect={setSelectedTarget}
                        />
                      : <TargetGrid
                          targets={sortedTargets}
                          type={targetType}
                          onSelect={setSelectedTarget}
                        />
                  }
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'insights' && (
          <div>
            {insightsQ.isLoading
              ? <div className="stateBox">Loading...</div>
              : <Insights
                  data={insightsQ.data}
                  onSelectTarget={(target, type) => {
                    setSelectedTarget(target);
                    setTab('targets');
                  }}
                />
            }
          </div>
        )}

        {tab === 'about' && <About />}

        {tab === 'runs' && (
          <div className="panel">
            <div className="panelHeader">
              <h2>Run History</h2>
            </div>
            <RunHistory />
          </div>
        )}

        {tab === 'sync' && <Sync />}

        <div style={{ display: tab === 'run' ? '' : 'none' }}>
          <StartRun onStatusChange={setRunStatus} />
        </div>
      </main>
      <footer className="appFooter">
        ClawBattle – AI Model Benchmark &nbsp;·&nbsp; <span style={{opacity: 0.6}}>v{__APP_VERSION__}</span>
      </footer>
    </div>
  );
}
