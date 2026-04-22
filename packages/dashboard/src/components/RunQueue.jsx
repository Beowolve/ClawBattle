// DB-backed queue view: every run that isn't fully `done` yet, with its
// attempts inlined. Refreshes every 2s via useRunQueue. Retry/reset/resume
// controls land here in slices 3.3 / 3.4.

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRunQueue } from '../hooks/useData.js';

async function postJson(path) {
  const res = await fetch(path, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${path}: ${res.status}`);
  }
  return res.json();
}

async function deleteJson(path) {
  const res = await fetch(path, { method: 'DELETE' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${path}: ${res.status}`);
  }
  return res.json();
}

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

function AttemptsTable({ attempts, onRetry, onDeleteAttempt, busyIds, deletingIds }) {
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
          <th />
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
            <td className="queueActionCell">
              {a.status === 'error' && (
                <button
                  className="queueRetryBtn"
                  disabled={busyIds.has(a.id)}
                  onClick={() => onRetry(a.id)}
                  title="Retry this attempt"
                >
                  {busyIds.has(a.id) ? '…' : 'Retry'}
                </button>
              )}
              <button
                className="queueRetryBtn queueRetryBtn--iconDanger"
                disabled={deletingIds.has(a.id)}
                onClick={() => onDeleteAttempt(a)}
                title="Delete this attempt row"
              >
                {deletingIds.has(a.id) ? '…' : '×'}
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function QueueRunCard({ run, expanded, onToggle, onRetry, onResetErrors, onResume, onCancel, onDeleteRun, onDeleteAttempt, busyIds, deletingIds, resetting, resuming, cancelling, deleting }) {
  const stats = [
    run.running_count ? `${run.running_count} running` : null,
    run.pending_count ? `${run.pending_count} pending` : null,
    run.waiting_count ? `${run.waiting_count} waiting` : null,
    run.paused_count  ? `${run.paused_count} paused`   : null,
    run.error_count   ? `${run.error_count} error`     : null,
    `${run.done_count}/${run.total} done`,
  ].filter(Boolean).join(' · ');

  const hasErrors = (run.error_count ?? 0) > 0;
  const outstanding = (run.pending_count ?? 0) + (run.waiting_count ?? 0)
    + (run.paused_count ?? 0) + (run.running_count ?? 0);
  // Worker activity is authoritative: the API reports whether an in-memory
  // worker pool is actually processing this run. DB status alone can lie
  // after a crash or credits-out abort (rows stuck 'running' with no worker).
  const workerActive = Boolean(run.worker_active);
  // Resume when no worker is live but there's outstanding work to do.
  const canResume = !workerActive && outstanding > 0;
  // Cancel only makes sense while a worker pool is actually running.
  const canCancel = workerActive;

  return (
    <div className={`queueRunCard queueRunCard--${run.status}`}>
      <div className="queueRunHeader">
        <span className="queueRunHeaderMain" onClick={onToggle}>
          <span className="queueRunToggle">{expanded ? '▾' : '▸'}</span>
          <StatusBadge status={run.status} />
          <span className="queueRunModel" title={run.run_id}>
            {run.model}
            {run.reasoning_effort ? ` [${run.reasoning_effort}]` : ''}
          </span>
          <span className="muted queueRunPrompt">{run.prompt_version ?? '—'}</span>
          <span className="muted queueRunStarted">{formatTs(run.started_at)}</span>
          <span className="muted queueRunStats">{stats}</span>
        </span>
        <span className="queueRunActions">
          {canResume && (
            <button
              className="queueRetryBtn queueRetryBtn--primary"
              disabled={resuming}
              onClick={(e) => { e.stopPropagation(); onResume(run.run_id); }}
              title={run.status === 'paused' ? 'Resume this paused run' : 'Start workers on this run'}
            >
              {resuming ? '…' : 'Resume'}
            </button>
          )}
          {canCancel && (
            <button
              className="queueRetryBtn queueRetryBtn--danger"
              disabled={cancelling}
              onClick={(e) => { e.stopPropagation(); onCancel(run.run_id); }}
              title="Cancel this run and pause remaining work"
            >
              {cancelling ? '…' : 'Cancel'}
            </button>
          )}
          {hasErrors && (
            <button
              className="queueRetryBtn"
              disabled={resetting}
              onClick={(e) => { e.stopPropagation(); onResetErrors(run.run_id); }}
              title={`Reset all ${run.error_count} error${run.error_count > 1 ? 's' : ''} to pending`}
            >
              {resetting ? '…' : `Reset ${run.error_count} error${run.error_count > 1 ? 's' : ''}`}
            </button>
          )}
          <button
            className="queueRetryBtn queueRetryBtn--danger"
            disabled={deleting}
            onClick={(e) => { e.stopPropagation(); onDeleteRun(run); }}
            title="Delete this run and all its attempts"
          >
            {deleting ? '…' : 'Delete'}
          </button>
        </span>
      </div>
      {expanded && (
        <div className="queueAttemptsWrap">
          <AttemptsTable
            attempts={run.attempts ?? []}
            onRetry={onRetry}
            onDeleteAttempt={onDeleteAttempt}
            busyIds={busyIds}
            deletingIds={deletingIds}
          />
        </div>
      )}
    </div>
  );
}

export default function RunQueue() {
  const queryClient = useQueryClient();
  const { data: runs = [], isLoading, error } = useRunQueue();
  const [expanded, setExpanded] = useState(new Set());
  const [busyIds, setBusyIds] = useState(new Set());
  const [resettingRuns, setResettingRuns] = useState(new Set());
  const [resumingRuns, setResumingRuns] = useState(new Set());
  const [cancellingRuns, setCancellingRuns] = useState(new Set());
  const [deletingRuns, setDeletingRuns] = useState(new Set());
  const [deletingAttemptIds, setDeletingAttemptIds] = useState(new Set());
  const [actionError, setActionError] = useState(null);

  function toggle(runId) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  function refreshQueue() {
    queryClient.invalidateQueries({ queryKey: ['runs', 'queue'] });
  }

  async function handleRetry(attemptId) {
    setActionError(null);
    setBusyIds(prev => new Set(prev).add(attemptId));
    try {
      await postJson(`/api/runs/attempts/${attemptId}/retry`);
      refreshQueue();
    } catch (err) {
      setActionError(`Retry failed: ${err.message}`);
    } finally {
      setBusyIds(prev => {
        const next = new Set(prev);
        next.delete(attemptId);
        return next;
      });
    }
  }

  async function handleResume(runId) {
    setActionError(null);
    setResumingRuns(prev => new Set(prev).add(runId));
    try {
      await postJson(`/api/runs/${runId}/resume`);
      refreshQueue();
    } catch (err) {
      setActionError(`Resume failed: ${err.message}`);
    } finally {
      setResumingRuns(prev => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  }

  async function handleCancel(runId) {
    setActionError(null);
    setCancellingRuns(prev => new Set(prev).add(runId));
    try {
      await postJson(`/api/runs/${runId}/cancel`);
      refreshQueue();
    } catch (err) {
      setActionError(`Cancel failed: ${err.message}`);
    } finally {
      setCancellingRuns(prev => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  }

  async function handleDeleteRun(run) {
    const stats = `${run.done_count}/${run.total} done, ${run.total - run.done_count} outstanding`;
    if (!window.confirm(`Delete run ${run.model}${run.reasoning_effort ? ` [${run.reasoning_effort}]` : ''}?\n${stats}\n\nThis removes all attempt rows (including completed ones) and cannot be undone.`)) return;
    setActionError(null);
    setDeletingRuns(prev => new Set(prev).add(run.run_id));
    try {
      await deleteJson(`/api/runs/${run.run_id}`);
      refreshQueue();
      queryClient.invalidateQueries({ queryKey: ['results'] });
    } catch (err) {
      setActionError(`Delete failed: ${err.message}`);
    } finally {
      setDeletingRuns(prev => {
        const next = new Set(prev);
        next.delete(run.run_id);
        return next;
      });
    }
  }

  async function handleDeleteAttempt(attempt) {
    if (!window.confirm(`Delete attempt ${attempt.attempt} for target ${attempt.target_id}?`)) return;
    setActionError(null);
    setDeletingAttemptIds(prev => new Set(prev).add(attempt.id));
    try {
      await deleteJson(`/api/runs/attempts/${attempt.id}`);
      refreshQueue();
    } catch (err) {
      setActionError(`Delete failed: ${err.message}`);
    } finally {
      setDeletingAttemptIds(prev => {
        const next = new Set(prev);
        next.delete(attempt.id);
        return next;
      });
    }
  }

  async function handleResetErrors(runId) {
    setActionError(null);
    setResettingRuns(prev => new Set(prev).add(runId));
    try {
      await postJson(`/api/runs/${runId}/reset-errors`);
      refreshQueue();
    } catch (err) {
      setActionError(`Reset failed: ${err.message}`);
    } finally {
      setResettingRuns(prev => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
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
        {actionError && <span className="queueActionError">{actionError}</span>}
      </div>
      <div className="queueRunList">
        {runs.map(run => (
          <QueueRunCard
            key={run.run_id}
            run={run}
            expanded={expanded.has(run.run_id)}
            onToggle={() => toggle(run.run_id)}
            onRetry={handleRetry}
            onResetErrors={handleResetErrors}
            onResume={handleResume}
            onCancel={handleCancel}
            onDeleteRun={handleDeleteRun}
            onDeleteAttempt={handleDeleteAttempt}
            busyIds={busyIds}
            deletingIds={deletingAttemptIds}
            resetting={resettingRuns.has(run.run_id)}
            resuming={resumingRuns.has(run.run_id)}
            cancelling={cancellingRuns.has(run.run_id)}
            deleting={deletingRuns.has(run.run_id)}
          />
        ))}
      </div>
    </div>
  );
}
