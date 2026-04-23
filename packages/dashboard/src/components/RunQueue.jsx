// DB-backed queue view: every run that isn't fully `done` yet, with its
// attempts inlined. Refreshes every 2s via useRunQueue. Retry/reset/resume
// controls land here in slices 3.3 / 3.4.

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRunQueue } from '../hooks/useData.js';

const RESUME_CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 8, 10];

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: body != null ? { 'Content-Type': 'application/json' } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  });
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

function AttemptRequestDialog({ attempt, data, loading, error, onClose }) {
  if (!attempt) return null;
  const targetLabel = attempt.target_type === 'battle'
    ? parseInt(attempt.target_id, 10)
    : attempt.target_id;
  const capturedRequests = data?.capturedRequests ?? [];
  const [activeTab, setActiveTab] = useState('prompt');

  useEffect(() => {
    setActiveTab('prompt');
  }, [attempt?.id]);

  return (
    <div className="dialogOverlay" role="presentation" onClick={onClose}>
      <div
        className="dialogCard promptDialogCard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="attempt-request-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialogHeader">
          <h3 id="attempt-request-dialog-title">Computed prompt + request</h3>
        </div>
        <div className="dialogBody promptDialogBody">
          <p className="promptDialogMeta">
            Target {targetLabel} · Attempt {attempt.attempt}
          </p>
          {loading && <p className="muted">Loading request trace...</p>}
          {!loading && error && <p className="queueActionError">{error}</p>}
          {!loading && !error && data && (
            <>
              <div className="promptDialogTabs" role="tablist" aria-label="Preview type">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'prompt'}
                  className={`promptDialogTab ${activeTab === 'prompt' ? 'promptDialogTab--active' : ''}`}
                  onClick={() => setActiveTab('prompt')}
                >
                  Prompt
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'request'}
                  className={`promptDialogTab ${activeTab === 'request' ? 'promptDialogTab--active' : ''}`}
                  onClick={() => setActiveTab('request')}
                >
                  Request
                </button>
              </div>

              {activeTab === 'prompt' && (
                <div className="promptDialogPanel">
                  <p className="promptDialogMeta">
                    Computed prompt · {data?.promptVersion ?? '—'} · Chrome {data?.chromeVersion ?? '—'}
                    {data?.isFollowup ? ' · follow-up' : ''}
                  </p>
                  <pre className="promptDialogText">{data?.computedPrompt ?? ''}</pre>
                </div>
              )}

              {activeTab === 'request' && (
                <div className="promptDialogPanel">
                  <p className="promptDialogMeta">Computed request body</p>
                  <pre className="promptDialogText">{JSON.stringify(data?.computedRequestBody ?? {}, null, 2)}</pre>
                  <p className="promptDialogMeta">Captured live requests: {capturedRequests.length}</p>
                  <pre className="promptDialogText">{JSON.stringify(capturedRequests, null, 2)}</pre>
                </div>
              )}
            </>
          )}
          {!loading && !error && !data && (
            <p className="muted">No preview available.</p>
          )}
        </div>
        <div className="dialogActions">
          <button type="button" className="dialogSecondaryButton" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AttemptsTable({ attempts, onRetry, onDeleteAttempt, onViewRequest, busyIds, deletingIds }) {
  return (
    <table className="queueAttemptsTable">
      <thead>
        <tr>
          <th className="compactCol">Target</th>
          <th className="compactCol">Attempt</th>
          <th className="statusCol">Status</th>
          <th className="numeric compactCol">Match</th>
          <th className="numeric compactCol">Score</th>
          <th className="errorCol">Error</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {attempts.map(a => (
          <tr key={a.id} className={`queueAttemptRow queueAttemptRow--${a.status}`}>
            <td className="numeric compactCol">
              {a.target_type === 'battle' ? parseInt(a.target_id) : a.target_id}
            </td>
            <td className="numeric muted compactCol">{a.attempt}</td>
            <td className="statusCol"><StatusBadge status={a.status} /></td>
            <td className={`numeric compactCol ${a.match >= 100 ? 'perfect' : ''}`}>
              {a.match != null ? a.match.toFixed(1) + '%' : '–'}
            </td>
            <td className={`numeric compactCol ${a.score >= 990 ? 'perfect' : ''}`}>
              {a.score != null ? a.score.toFixed(2) : '–'}
            </td>
            <td className="muted errorCell errorCol" title={a.error_message ?? ''}>
              {a.error_message ?? ''}
            </td>
            <td className="queueActionCell">
              <button
                className="queueRetryBtn"
                onClick={() => onViewRequest(a)}
                title="Show computed prompt + request"
              >
                Request
              </button>
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

function QueueRunCard({
  run,
  expanded,
  onToggle,
  onRetry,
  onResetErrors,
  onResume,
  onResumeConcurrencyChange,
  resumeConcurrency,
  onCancel,
  onDeleteRun,
  onDeleteAttempt,
  onViewRequest,
  busyIds,
  deletingIds,
  resetting,
  resuming,
  cancelling,
  deleting,
}) {
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
            <>
              <select
                className="queueResumeConcurrency"
                value={resumeConcurrency}
                disabled={resuming}
                title="Worker threads for resume"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onResumeConcurrencyChange(run.run_id, Number(e.target.value))}
              >
                {RESUME_CONCURRENCY_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n}t</option>
                ))}
              </select>
              <button
                className="queueRetryBtn queueRetryBtn--primary"
                disabled={resuming}
                onClick={(e) => { e.stopPropagation(); onResume(run.run_id, resumeConcurrency); }}
                title={run.status === 'paused' ? 'Resume this paused run' : 'Start workers on this run'}
              >
                {resuming ? '…' : 'Resume'}
              </button>
            </>
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
            onViewRequest={onViewRequest}
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
  const [resumeConcurrencyByRun, setResumeConcurrencyByRun] = useState({});
  const [requestAttempt, setRequestAttempt] = useState(null);
  const [requestData, setRequestData] = useState(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState(null);
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

  function closeRequestDialog() {
    setRequestAttempt(null);
    setRequestData(null);
    setRequestLoading(false);
    setRequestError(null);
  }

  async function handleViewRequest(attempt) {
    setRequestAttempt(attempt);
    setRequestData(null);
    setRequestError(null);
    setRequestLoading(true);
    try {
      const res = await fetch(`/api/runs/attempts/${attempt.id}/request`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? `request fetch failed: ${res.status}`);
      }
      setRequestData(body);
    } catch (err) {
      setRequestError(err.message);
    } finally {
      setRequestLoading(false);
    }
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

  function getResumeConcurrency(runId) {
    return resumeConcurrencyByRun[runId] ?? 5;
  }

  function handleResumeConcurrencyChange(runId, concurrency) {
    setResumeConcurrencyByRun(prev => ({ ...prev, [runId]: concurrency }));
  }

  async function handleResume(runId, concurrency) {
    setActionError(null);
    setResumingRuns(prev => new Set(prev).add(runId));
    try {
      await postJson(`/api/runs/${runId}/resume`, { concurrency });
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
      if (requestAttempt?.id === attempt.id) closeRequestDialog();
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
    <>
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
              onResumeConcurrencyChange={handleResumeConcurrencyChange}
              resumeConcurrency={getResumeConcurrency(run.run_id)}
              onCancel={handleCancel}
              onDeleteRun={handleDeleteRun}
              onDeleteAttempt={handleDeleteAttempt}
              onViewRequest={handleViewRequest}
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
      <AttemptRequestDialog
        attempt={requestAttempt}
        data={requestData}
        loading={requestLoading}
        error={requestError}
        onClose={closeRequestDialog}
      />
    </>
  );
}
