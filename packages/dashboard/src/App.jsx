import { useState, useMemo } from 'react';
import {
  useResults, useBattleTargets, useDailyTargets,
  useLeaderboard, useInsights,
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

function computeKpisFromLeaderboard(data) {
  if (!data?.rows?.length) return { totalRuns: 0, avgBestScore: '-', totalCost: '-', models: 0 };
  const totalTargets = data.rows.reduce((a, r) => a + r.targets, 0);
  const weightedScore = data.rows.reduce((a, r) => a + (r.avgScore ?? 0) * r.targets, 0);
  const avgBestScore = totalTargets > 0 ? (weightedScore / totalTargets).toFixed(2) : '-';
  return {
    totalRuns: data.totalAttempts,
    avgBestScore,
    totalCost: data.totalCost > 0 ? '$' + data.totalCost.toFixed(4) : '-',
    models: data.models,
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

  // Leaderboard and Insights fetch their own aggregated data eagerly
  const leaderboardQ = useLeaderboard(promptFilter);
  const insightsQ = useInsights(promptFilter);

  // Raw results loaded lazily — only when the Targets tab is open
  const resultsQ = useResults({ enabled: tab === 'targets' });
  const battleQ = useBattleTargets();
  const dailyQ = useDailyTargets();

  const runs = resultsQ.data ?? [];
  const battleTargets = battleQ.data ?? [];
  const dailyTargets = dailyQ.data ?? [];

  // Prompt versions come from the leaderboard response (always available)
  const promptVersions = leaderboardQ.data?.promptVersions ?? [];

  const filteredRuns = useMemo(
    () => promptFilter === 'all' ? runs : runs.filter(r => r.prompt_version === promptFilter),
    [runs, promptFilter],
  );

  const models = useMemo(
    () => [...new Set(leaderboardQ.data?.rows?.map(r => r.model) ?? [])].sort(),
    [leaderboardQ.data],
  );

  const reasoningOptions = useMemo(() => {
    const values = new Set(
      filteredRuns
        .filter(r => r.target_type === targetType)
        .map(r => r.reasoning_effort ?? ''),
    );
    return [...values].sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    });
  }, [filteredRuns, targetType]);

  // KPIs derived from leaderboard aggregation — available without loading raw runs
  const kpis = computeKpisFromLeaderboard(leaderboardQ.data);

  const sortedTargets = useMemo(() => {
    const list = targetType === 'battle' ? battleTargets : dailyTargets;
    const sorted = [...list].sort((a, b) => (a.target_number ?? a.id) - (b.target_number ?? b.id));
    if (IS_PUBLIC && targetType === 'battle') {
      const targetIdsWithRuns = new Set(
        filteredRuns.filter(r => r.target_type === 'battle').map(r => Number(r.target_id))
      );
      return sorted.filter(t => targetIdsWithRuns.has(Number(t.id)));
    }
    return sorted;
  }, [targetType, battleTargets, dailyTargets, filteredRuns]);

  return (
    <div className="appRoot">
      <div className="topBand" />
      <Header promptVersions={promptVersions} promptFilter={promptFilter} onPromptChange={handlePromptFilter} />
      <main className="appContent">
        <div className="kpiGrid">
          <KpiCard title="Total Runs" value={kpis.totalRuns} />
          <KpiCard title="Models Tested" value={kpis.models} />
          <KpiCard title="Avg Best Score" value={kpis.avgBestScore} sub="best attempt per target" />
          <KpiCard title="Total Cost" value={kpis.totalCost} />
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
                  runs={filteredRuns}
                  modelFilter={modelFilter}
                  reasoningFilter={reasoningFilter}
                  models={models}
                  reasoningOptions={reasoningOptions}
                  onModelFilterChange={setModelFilter}
                  onReasoningFilterChange={setReasoningFilter}
                  onBack={() => setSelectedTarget(null)}
                  onPrev={selectedIdx > 0 ? () => setSelectedTarget(sortedTargets[selectedIdx - 1]) : null}
                  onNext={selectedIdx < sortedTargets.length - 1 ? () => setSelectedTarget(sortedTargets[selectedIdx + 1]) : null}
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
                  {battleQ.isLoading || resultsQ.isLoading
                    ? <div className="stateBox">Loading...</div>
                    : targetView === 'table'
                      ? <TargetTable
                          targets={sortedTargets}
                          type={targetType}
                          runs={filteredRuns}
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
