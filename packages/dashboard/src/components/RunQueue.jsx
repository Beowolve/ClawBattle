// DB-backed queue view: every run that isn't fully `done` yet, with its
// attempts inlined. Refreshes every 2s via useRunQueue. Retry/reset/resume
// controls land here in slices 3.3 / 3.4.

import { useState } from 'react';
import { useRunQueue } from '../hooks/useData.js';

function StatusBadge({ status }) {
  const label = status === 'waiting' ? 'waiting for prev. result' : status;
  return (
    <span className={`queueBadge queueBadge--${status}`}>
      {label}
      {status === 'running' && <span className="runDot runDot--inline" />}
    </span>
  );
}

function formatTs(ts) {
  if (!ts) return '';
  return ts.replace('T', ' ').slice(0, 16);
}

function AttemptsTable({ attempts }) {
  return (
    <table className="queueAttemptsTable">
      <thead>
        <tr>
          <th>Target</th>
          <th>Attempt</th>
          <th>Status</th>
          <th className="numeric">Match</th>
          <th className="numeric">Score</th>
          <th>Error</th>
        </tr>
      </thead>
      <tbody>
        {attempts.map(a => (
          <tr key={a.id} className={`queueAttemptRow queueAttemptRow--${a.status}`}>
            <td className="numeric">
              {a.target_type === 'battle' ? parseInt(a.target_id) : a.target_id}
            </td>
            <td className="numeric muted">{a.attempt}</td>
            <td><StatusBadge status={a.status} /></td>
            <td className="numeric">{a.match != null ? a.match.toFixed(1) + '%' : '–'}</td>
            <td className="numeric">{a.score != null ? a.score.toFixed(2) : '–'}</td>
            <td className="muted errorCell" title={a.error_message ?? ''}>
              {a.error_message ? a.error_message.slice(0, 60) : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QueueRunCard({ run, expanded, onToggle }) {
  const stats = [
    run.running_count ? `${run.running_count} running` : null,
    run.pending_count ? `${run.pending_count} pending` : null,
    run.waiting_count ? `${run.waiting_count} waiting` : null,
    run.paused_count  ? `${run.paused_count} paused`   : null,
    run.error_count   ? `${run.error_count} error`     : null,
    `${run.done_count}/${run.total} done`,
  ].filter(Boolean).join(' · ');

  return (
    <div className={`queueRunCard queueRunCard--${run.status}`}>
      <div className="queueRunHeader" onClick={onToggle}>
        <span className="queueRunToggle">{expanded ? '▾' : '▸'}</span>
        <StatusBadge status={run.status} />
        <span className="queueRunModel" title={run.run_id}>
          {run.model}
          {run.reasoning_effort ? ` [${run.reasoning_effort}]` : ''}
        </span>
        <span className="muted queueRunPrompt">{run.prompt_version ?? '—'}</span>
        <span className="muted queueRunStarted">{formatTs(run.started_at)}</span>
        <span className="muted queueRunStats">{stats}</span>
      </div>
      {expanded && (
        <div className="queueAttemptsWrap">
          <AttemptsTable attempts={run.attempts ?? []} />
        </div>
      )}
    </div>
  );
}

export default function RunQueue() {
  const { data: runs = [], isLoading, error } = useRunQueue();
  const [expanded, setExpanded] = useState(new Set());

  function toggle(runId) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  if (isLoading) return null; // silent during first load — don't flicker
  if (error) {
    return <div className="stateBox">Queue unavailable: {error.message}</div>;
  }
  if (runs.length === 0) return null;

  return (
    <div className="queuePanel">
      <div className="queuePanelHeader">
        <h3>Queue ({runs.length} open {runs.length === 1 ? 'run' : 'runs'})</h3>
      </div>
      <div className="queueRunList">
        {runs.map(run => (
          <QueueRunCard
            key={run.run_id}
            run={run}
            expanded={expanded.has(run.run_id)}
            onToggle={() => toggle(run.run_id)}
          />
        ))}
      </div>
    </div>
  );
}
