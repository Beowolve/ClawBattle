import { useEffect, useRef, useState } from 'react';

export default function AttemptRequestDialog({ attempt, onClose }) {
  const dialogRef = useRef(null);
  const [request, setRequest] = useState({ loading: true });
  const [view, setView] = useState('prompt');
  const [capturedIndex, setCapturedIndex] = useState(0);
  const { data, loading, error } = request;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadRequest() {
      try {
        const res = await fetch(`/api/runs/attempts/${attempt.id}/request`, { signal: controller.signal });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `Request fetch failed: ${res.status}`);
        }
        const body = await res.json();
        if (!controller.signal.aborted) setRequest({ data: body });
      } catch (error) {
        if (!controller.signal.aborted) setRequest({ error: error.message });
      }
    }

    loadRequest();
    return () => controller.abort();
  }, [attempt.id]);

  function closeDialog() {
    dialogRef.current.close();
    onClose();
  }

  const targetLabel = attempt.target_type === 'battle'
    ? parseInt(attempt.target_id, 10)
    : attempt.target_id;
  const capturedRequests = data?.capturedRequests ?? [];
  const views = {
    prompt: 'Prompt',
    request: 'Computed request',
    captured: `Captured requests (${capturedRequests.length})`,
  };
  const text = view === 'prompt'
    ? data?.computedPrompt ?? ''
    : JSON.stringify(view === 'request' ? data?.computedRequestBody ?? {} : capturedRequests[capturedIndex], null, 2);

  return (
    <dialog
      ref={dialogRef}
      className="dialogCard promptDialogCard"
      aria-labelledby="attempt-request-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        closeDialog();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) closeDialog();
      }}
    >
      <div className="dialogHeader">
        <div>
          <h3 id="attempt-request-dialog-title">Attempt request</h3>
          <p className="promptDialogMeta">Target {targetLabel} · Attempt {attempt.attempt}</p>
        </div>
        <button type="button" className="dialogSecondaryButton" onClick={closeDialog}>Close</button>
      </div>

      {data && (
        <div className="promptDialogControls">
          <div className="promptDialogTabs" role="group" aria-label="Request views">
            {Object.entries(views).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={view === value}
                className={`promptDialogTab${view === value ? ' promptDialogTab--active' : ''}`}
                onClick={() => setView(value)}
              >
                {label}
              </button>
            ))}
          </div>
          {view === 'prompt' && (
            <p className="promptDialogMeta">
              {data.promptVersion ?? '—'} · Chrome {data.chromeVersion ?? '—'}
              {data.isFollowup ? ' · follow-up' : ''}
            </p>
          )}
          {view === 'captured' && capturedRequests.length > 1 && (
            <select
              className="filterSelect"
              aria-label="Captured request"
              value={capturedIndex}
              onChange={(event) => setCapturedIndex(Number(event.target.value))}
            >
              {capturedRequests.map((item, index) => (
                <option key={index} value={index}>Request {item.requestAttempt ?? index + 1}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div
        key={view === 'captured' ? capturedIndex : view}
        className="dialogBody promptDialogBody"
        role="region"
        aria-label={views[view]}
        tabIndex={0}
      >
        {loading && <p role="status" className="muted">Loading request trace...</p>}
        {error && <p role="alert" className="queueActionError">{error}</p>}
        {!loading && !error && !data && <p className="muted">No preview available.</p>}
        {data && view === 'captured' && !capturedRequests.length && (
          <p className="muted">No captured requests.</p>
        )}
        {data && text !== undefined && <pre className="promptDialogText">{text}</pre>}
      </div>
    </dialog>
  );
}
