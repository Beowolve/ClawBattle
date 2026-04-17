import { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts';

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
      {d.imgUrl && (
        <img
          src={d.imgUrl}
          alt={d.name}
          style={{ display: 'block', width: 120, height: 90, objectFit: 'cover', borderRadius: 4, marginBottom: 6 }}
        />
      )}
      <div style={{ fontWeight: 600, color: 'var(--heading-color)', marginBottom: 2 }}>{d.label}: {d.name}</div>
      <div style={{ color: 'var(--muted-color)' }}>Avg Match: <span style={{ color: 'var(--font-color)' }}>{d.avgMatch}%</span></div>
    </div>
  );
}

// data shape: { difficulty, consistency, costEfficiency, distributions, models }
export default function Insights({ data, onSelectTarget }) {
  const [distModel, setDistModel] = useState('');

  if (!data || !data.models?.length) {
    return <div className="stateBox">No data yet — run a benchmark first.</div>;
  }

  const { difficulty, consistency, costEfficiency, distributions, models } = data;
  const distribution = distributions[distModel] ?? distributions[''] ?? [];
  const diffSlice = difficulty.slice(0, 20);
  const hasCosts = costEfficiency.some(d => d.avgCost > 0);

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
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: 'var(--muted-color)' }} />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={46}
                  interval={0}
                  tick={{ fontSize: 11, fill: 'var(--muted-color)' }}
                />
                <Tooltip content={<DifficultyTooltip />} />
                <Bar
                  dataKey="avgMatch"
                  fill="#2f5fb8"
                  radius={[0, 3, 3, 0]}
                  maxBarSize={18}
                  onClick={d => onSelectTarget?.(d.targetObj ?? { id: d.rawId }, d.targetType)}
                  style={{ cursor: onSelectTarget ? 'pointer' : undefined }}
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
                    <Cell key={entry.range} fill={entry.range === '100' ? '#23897d' : '#2f5fb8'} />
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
            <ResponsiveContainer width="100%" height={Math.max(180, consistency.length * 36)}>
              <BarChart data={consistency} layout="vertical" margin={{ left: 8, right: 48, top: 0, bottom: 0 }}>
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
                  {costEfficiency.map((row, i) => (
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
