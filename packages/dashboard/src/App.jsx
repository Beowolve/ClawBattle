import { useState, useMemo } from 'react';
import { useResults, useRuns, useBattleTargets, useDailyTargets } from './hooks/useData.js';
import Header from './components/Header.jsx';
import KpiCard from './components/KpiCard.jsx';
import Leaderboard from './components/Leaderboard.jsx';
import TargetGrid from './components/TargetGrid.jsx';
import TargetTable from './components/TargetTable.jsx';
import RunHistory from './components/RunHistory.jsx';
import StartRun from './components/StartRun.jsx';
import TargetDetail from './components/TargetDetail.jsx';
import Insights from './components/Insights.jsx';

const TABS = [
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'targets', label: 'Targets' },
  { id: 'insights', label: 'Insights' },
  { id: 'runs', label: 'Run History' },
  { id: 'run', label: '+ Run' },
];

function computeKpis(runs, battleTargets) {
  if (!runs.length) return { totalRuns: 0, avgBestScore: '-', totalCost: '-', models: 0 };

  const bestPerModelTarget = {};
  for (const r of runs) {
    const key = `${r.model}__${r.target_id}__${r.target_type}`;
    if (!bestPerModelTarget[key] || r.score > bestPerModelTarget[key]) {
      bestPerModelTarget[key] = r.score;
    }
  }

  const scores = Object.values(bestPerModelTarget).filter(s => s != null);
  const avgBestScore = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : '-';
  const totalCost = runs.reduce((a, r) => a + (r.cost ?? 0), 0);
  const models = new Set(runs.map(r => r.model)).size;

  return {
    totalRuns: runs.length,
    avgBestScore,
    totalCost: totalCost > 0 ? '$' + totalCost.toFixed(4) : '-',
    models,
  };
}

export default function App() {
  const [tab, setTab] = useState('leaderboard');
  const [targetType, setTargetType] = useState('battle');
  const [targetView, setTargetView] = useState('table');
  const [runStatus, setRunStatus] = useState('idle');
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [resumeTarget, setResumeTarget] = useState(null);
  const [promptFilter, setPromptFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState(null);

  function handleModelSelect(model) {
    setModelFilter(model);
    setTargetView('table');
    setTab('targets');
  }

  function handleResume(meta) {
    setResumeTarget(meta);
    setTab('run');
  }

  const resultsQ = useResults();
  const runsQ = useRuns();
  const battleQ = useBattleTargets();
  const dailyQ = useDailyTargets();

  const runs = resultsQ.data ?? [];
  const runMeta = runsQ.data ?? [];
  const battleTargets = battleQ.data ?? [];
  const dailyTargets = dailyQ.data ?? [];

  const runPromptVersion = useMemo(
    () => Object.fromEntries(runMeta.map(m => [m.run_id, m.prompt_version])),
    [runMeta],
  );

  const promptVersions = useMemo(
    () => [...new Set(runMeta.map(m => m.prompt_version).filter(Boolean))].sort(),
    [runMeta],
  );

  const filteredRuns = useMemo(
    () => promptFilter === 'all'
      ? runs
      : runs.filter(r => runPromptVersion[r.run_id] === promptFilter),
    [runs, promptFilter, runPromptVersion],
  );

  const kpis = useMemo(() => computeKpis(filteredRuns, battleTargets), [filteredRuns, battleTargets]);

  const sortedTargets = useMemo(() => {
    const list = targetType === 'battle' ? battleTargets : dailyTargets;
    return [...list].sort((a, b) => (a.target_number ?? a.id) - (b.target_number ?? b.id));
  }, [targetType, battleTargets, dailyTargets]);

  const isLoading = resultsQ.isLoading || battleQ.isLoading;

  return (
    <div className="appRoot">
      <div className="topBand" />
      <Header />
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
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {promptVersions.length > 1 && (
                  <select
                    className="filterSelect"
                    value={promptFilter}
                    onChange={e => setPromptFilter(e.target.value)}
                  >
                    <option value="all">all prompts</option>
                    {promptVersions.map(v => <option key={v} value={v}>{v}</option>)}
                  </select>
                )}
                <span>{filteredRuns.length} run{filteredRuns.length !== 1 ? 's' : ''}</span>
              </span>
            </div>
            {isLoading
              ? <div className="stateBox">Loading...</div>
              : <Leaderboard runs={filteredRuns} onModelSelect={handleModelSelect} />
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
                  runs={runs}
                  onBack={() => setSelectedTarget(null)}
                  onPrev={selectedIdx > 0 ? () => setSelectedTarget(sortedTargets[selectedIdx - 1]) : null}
                  onNext={selectedIdx < sortedTargets.length - 1 ? () => setSelectedTarget(sortedTargets[selectedIdx + 1]) : null}
                />
              );
            })() : (
              <>
                <div className="filtersBar" style={{ marginBottom: 12 }}>
                  <button
                    className={`tabButton ${targetType === 'battle' ? 'active' : ''}`}
                    onClick={() => setTargetType('battle')}
                  >
                    Battle ({battleTargets.length})
                  </button>
                  <button
                    className={`tabButton ${targetType === 'daily' ? 'active' : ''}`}
                    onClick={() => setTargetType('daily')}
                  >
                    Daily ({dailyTargets.length})
                  </button>
                  {modelFilter && (
                    <span className="modelFilterBadge">
                      {modelFilter}
                      <button className="modelFilterClear" onClick={() => setModelFilter(null)}>✕</button>
                    </span>
                  )}
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
                    <h2>{targetType === 'battle' ? 'Battle Targets' : 'Daily Targets'}</h2>
                  </div>
                  {battleQ.isLoading || dailyQ.isLoading
                    ? <div className="stateBox">Loading...</div>
                    : targetView === 'table'
                      ? <TargetTable
                          targets={sortedTargets}
                          type={targetType}
                          runs={runs}
                          modelFilter={modelFilter}
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
            <div className="panelHeader" style={{ marginBottom: 12 }}>
              <h2>Insights</h2>
              <span>{runs.length} run{runs.length !== 1 ? 's' : ''} across {new Set(runs.map(r => r.model)).size} model{new Set(runs.map(r => r.model)).size !== 1 ? 's' : ''}</span>
            </div>
            {isLoading
              ? <div className="stateBox">Loading...</div>
              : <Insights
                  runs={filteredRuns}
                  battleTargets={battleTargets}
                  dailyTargets={dailyTargets}
                  onSelectTarget={(target, type) => {
                    setTargetType(type);
                    setSelectedTarget(target);
                    setTab('targets');
                  }}
                />
            }
          </div>
        )}

        {tab === 'runs' && (
          <div className="panel">
            <div className="panelHeader">
              <h2>Run History</h2>
              <span>{runs.length} entries</span>
            </div>
            {resultsQ.isLoading
              ? <div className="stateBox">Loading...</div>
              : <RunHistory runs={runs} runMeta={runMeta} onResume={handleResume} />
            }
          </div>
        )}

        <div style={{ display: tab === 'run' ? '' : 'none' }}>
          <StartRun
            onStatusChange={setRunStatus}
            resumeTarget={resumeTarget}
            onResumeConsumed={() => setResumeTarget(null)}
          />
        </div>
      </main>
      <footer className="appFooter">
        ClawBattle – AI Model Benchmark
      </footer>
    </div>
  );
}
