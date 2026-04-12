import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';

const COLORS = ['#2f5fb8', '#23897d', '#9c5fe0', '#e07c39', '#c96179', '#6a7895', '#d4a017', '#4a9ced'];

const TOOLTIP = {
  contentStyle: {
    background: 'var(--surface-color)',
    border: '1px solid var(--border-color)',
    borderRadius: 6,
    fontSize: '0.82rem',
  },
  labelStyle: { color: 'var(--heading-color)', fontWeight: 600, marginBottom: 4 },
  itemStyle: { color: 'var(--font-color)' },
  cursor: { fill: 'var(--bg-color)' },
};

// ── Compute helpers ────────────────────────────────────────────────────

function computeTargetDifficulty(runs, battleTargets, dailyTargets) {
  const nameMap = {};
  const objMap = {};
  for (const t of battleTargets) {
    const k = `battle__${t.id}`;
    nameMap[k] = t.name ?? `#${t.id}`;
    objMap[k] = t;
  }
  for (const t of dailyTargets) {
    const k = `daily__${t.key}`;
    nameMap[k] = t.name ?? t.key;
    objMap[k] = t;
  }

  const byTarget = {};
  for (const r of runs) {
    const key = `${r.target_type}__${r.target_id}`;
    if (!byTarget[key]) byTarget[key] = {};
    if (byTarget[key][r.model] == null || r.match > byTarget[key][r.model]) {
      byTarget[key][r.model] = r.match;
    }
  }

  return Object.entries(byTarget)
    .map(([key, modelScores]) => {
      const scores = Object.values(modelScores).filter(s => s != null);
      if (!scores.length) return null;
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const type = key.startsWith('battle__') ? 'battle' : 'daily';
      const rawId = type === 'battle'
        ? String(Math.round(Number(key.replace('battle__', ''))))
        : key.replace('daily__', '');
      return {
        key,
        name: nameMap[key] ?? `#${rawId}`,
        avgMatch: +avg.toFixed(1),
        targetObj: objMap[key] ?? null,
        targetType: type,
        imgUrl: `/api/targets/${type}/${rawId}/image`,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.avgMatch - b.avgMatch);
}

function computeModelConsistency(runs) {
  const byModel = {};
  for (const r of runs) {
    if (r.match == null) continue;
    if (!byModel[r.model]) byModel[r.model] = [];
    byModel[r.model].push(r.match);
  }

  return Object.entries(byModel)
    .map(([model, values]) => {
      const n = values.length;
      const avg = values.reduce((a, b) => a + b, 0) / n;
      const stdDev = Math.sqrt(values.reduce((a, b) => a + (b - avg) ** 2, 0) / n);
      return { model, avgMatch: +avg.toFixed(1), stdDev: +stdDev.toFixed(1), n };
    })
    .sort((a, b) => a.stdDev - b.stdDev);
}

function computeCostEfficiency(runs) {
  const byModel = {};
  for (const r of runs) {
    if (!byModel[r.model]) byModel[r.model] = { bestScores: {}, costs: [] };
    const tKey = `${r.target_type}__${r.target_id}`;
    if (byModel[r.model].bestScores[tKey] == null || r.score > byModel[r.model].bestScores[tKey]) {
      byModel[r.model].bestScores[tKey] = r.score;
    }
    if (r.cost != null) byModel[r.model].costs.push(r.cost);
  }

  return Object.entries(byModel)
    .map(([model, { bestScores, costs }]) => {
      const scores = Object.values(bestScores).filter(s => s != null);
      const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      const avgCost = costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : 0;
      const ratio = avgCost > 0 ? avgScore / (avgCost * 1000) : null;
      return { model, avgScore: +avgScore.toFixed(1), avgCost, ratio };
    })
    .sort((a, b) => (b.ratio ?? -Infinity) - (a.ratio ?? -Infinity));
}

function computeMatchDistribution(runs, modelFilter) {
  const src = modelFilter ? runs.filter(r => r.model === modelFilter) : runs;
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    range: i === 9 ? '90–99' : `${i * 10}–${i * 10 + 9}`,
    count: 0,
  }));
  const perfect = { range: '100', count: 0 };

  for (const r of src) {
    if (r.match == null) continue;
    if (r.match >= 100) { perfect.count++; continue; }
    buckets[Math.min(Math.floor(r.match / 10), 9)].count++;
  }
  return [...buckets, perfect];
}

// ── Custom tooltip for Target Difficulty ───────────────────────────────

function DifficultyTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div style={{
      background: 'var(--surface-color)',
      border: '1px solid var(--border-color)',
      borderRadius: 8,
      padding: '8px',
      fontSize: '0.82rem',
      pointerEvents: 'none',
    }}>
      <img
        src={d.imgUrl}
        alt={d.name}
        style={{ display: 'block', width: 120, height: 90, objectFit: 'cover', borderRadius: 4, marginBottom: 6 }}
      />
      <div style={{ fontWeight: 600, color: 'var(--heading-color)', marginBottom: 2 }}>{d.name}</div>
      <div style={{ color: 'var(--muted-color)' }}>Avg Match: <span style={{ color: 'var(--font-color)' }}>{d.avgMatch}%</span></div>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────

export default function Insights({ runs, battleTargets, dailyTargets, onSelectTarget }) {
  const [distModel, setDistModel] = useState('');

  const models = useMemo(() => [...new Set(runs.map(r => r.model))].sort(), [runs]);
  const difficulty = useMemo(
    () => computeTargetDifficulty(runs, battleTargets, dailyTargets),
    [runs, battleTargets, dailyTargets],
  );
  const consistencyData = useMemo(() => computeModelConsistency(runs), [runs]);
  const costData = useMemo(() => computeCostEfficiency(runs), [runs]);
  const distribution = useMemo(
    () => computeMatchDistribution(runs, distModel),
    [runs, distModel],
  );

  if (!runs.length) {
    return <div className="stateBox">No data yet — run a benchmark first.</div>;
  }

  const diffSlice = difficulty.slice(0, 20);
  const hasCosts = costData.some(d => d.avgCost > 0);


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Row 1 */}
      <div className="panelGrid">

        {/* Target Difficulty */}
        <div className="panel">
          <div className="panelHeader">
            <h2>Target Difficulty</h2>
            <span>avg best score across models · hardest first{difficulty.length > 20 ? ` (top 20 of ${difficulty.length})` : ''}</span>
          </div>
          <div style={{ padding: '12px 4px 8px' }}>
            <ResponsiveContainer width="100%" height={Math.max(180, diffSlice.length * 24)}>
              <BarChart data={diffSlice} layout="vertical" margin={{ left: 8, right: 28, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-color)" />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: 'var(--muted-color)' }}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={82}
                  interval={0}
                  tick={{ fontSize: 11, fill: 'var(--muted-color)' }}
                  tickFormatter={v => v.length > 11 ? v.slice(0, 11) + '…' : v}
                />
                <Tooltip content={<DifficultyTooltip />} />
                <Bar
                  dataKey="avgMatch"
                  fill="#2f5fb8"
                  radius={[0, 3, 3, 0]}
                  maxBarSize={18}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Match Distribution */}
        <div className="panel">
          <div className="panelHeader">
            <h2>Match Distribution</h2>
            <span>
              <select
                className="filterSelect"
                value={distModel}
                onChange={e => setDistModel(e.target.value)}
                style={{ height: 26, fontSize: '0.8rem' }}
              >
                <option value="">All models</option>
                {models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </span>
          </div>
          <div style={{ padding: '12px 4px 4px' }}>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={distribution} margin={{ left: 0, right: 12, top: 4, bottom: 24 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                <XAxis
                  dataKey="range"
                  tick={{ fontSize: 10, fill: 'var(--muted-color)' }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted-color)' }} allowDecimals={false} />
                <Tooltip formatter={v => [v, 'Attempts']} {...TOOLTIP} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]} maxBarSize={32}>
                  {distribution.map(entry => (
                    <Cell
                      key={entry.range}
                      fill={entry.range === '100' ? '#23897d' : '#2f5fb8'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

      </div>

      {/* Row 2 */}
      <div className="panelGrid">

        {/* Model Consistency */}
        <div className="panel">
          <div className="panelHeader">
            <h2>Model Consistency</h2>
            <span>std deviation of match% · lower = more predictable</span>
          </div>
          <div style={{ padding: '12px 4px 8px' }}>
            <ResponsiveContainer width="100%" height={Math.max(180, consistencyData.length * 36)}>
              <BarChart data={consistencyData} layout="vertical" margin={{ left: 8, right: 48, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-color)" />
                <XAxis
                  type="number"
                  domain={[0, dataMax => Math.ceil(dataMax * 1.1)]}
                  tick={{ fontSize: 11, fill: 'var(--muted-color)' }}
                />
                <YAxis
                  type="category"
                  dataKey="model"
                  width={110}
                  interval={0}
                  tick={{ fontSize: 11, fill: 'var(--muted-color)' }}
                  tickFormatter={v => v.length > 15 ? v.slice(0, 15) + '…' : v}
                />
                <Tooltip
                  formatter={(v, name) => name === 'stdDev' ? [`±${v}%`, 'Std Dev'] : [`${v}%`, 'Avg Match']}
                  {...TOOLTIP}
                />
                <Bar dataKey="stdDev" fill="#9c5fe0" radius={[0, 3, 3, 0]} maxBarSize={20} label={{ position: 'right', fontSize: 11, fill: 'var(--muted-color)', formatter: v => `±${v}%` }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cost Efficiency */}
        <div className="panel">
          <div className="panelHeader">
            <h2>Cost Efficiency</h2>
            <span>score per $0.001 · higher is better</span>
          </div>
          {!hasCosts ? (
            <div className="stateBox">No cost data available</div>
          ) : (
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th className="numeric" style={{ width: 32 }}>#</th>
                    <th>Model</th>
                    <th className="numeric">Avg Score</th>
                    <th className="numeric">Avg Cost / req</th>
                    <th className="numeric">Score / $0.001</th>
                  </tr>
                </thead>
                <tbody>
                  {costData.map((row, i) => (
                    <tr key={row.model}>
                      <td className="numeric muted">{i + 1}</td>
                      <td className="modelName">{row.model}</td>
                      <td className="numeric">{row.avgScore.toFixed(1)}</td>
                      <td className="numeric muted">
                        {row.avgCost > 0 ? `$${row.avgCost.toFixed(5)}` : '—'}
                      </td>
                      <td className={`numeric${row.ratio != null ? ' perfect' : ' muted'}`}>
                        {row.ratio != null ? row.ratio.toFixed(1) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
