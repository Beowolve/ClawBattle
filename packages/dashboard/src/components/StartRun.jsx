import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConfig } from '../hooks/useData.js';

const PROVIDERS = ['openrouter', 'openai', 'ollama'];
const ATTEMPT_OPTIONS = [1, 2, 3, 5];
const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 8, 10];
const RETRY_OPTIONS = [0, 1, 2, 3];

function RunTargetCard({ card }) {
  const { status = 'pending', name, bestMatch, retryNum, currentAttempt, latestMatch } = card;

  // Score display: finalised cards show bestMatch, running cards show latestMatch or "Attempt N…"
  let scoreText = null;
  if (status === 'done' || status === 'error') {
    scoreText = bestMatch != null ? bestMatch.toFixed(1) + '%' : null;
  } else if (status === 'running') {
    if (latestMatch != null) scoreText = latestMatch.toFixed(1) + '%';
    else if (currentAttempt != null) scoreText = `Attempt ${currentAttempt}…`;
  }

  return (
    <div className={`runTargetCard runTargetCard--${status}`}>
      <div className="runTargetCardHeader">
        <span className="runTargetCardName" title={name}>{name ?? '…'}</span>
        {status === 'running' && <span className="runDot runDot--card" />}
      </div>
      {scoreText && <span className="runTargetCardScore">{scoreText}</span>}
      {status === 'running' && retryNum > 0 && (
        <span className="runTargetCardRetry">retry {retryNum}</span>
      )}
    </div>
  );
}

export default function StartRun({ onStatusChange, resumeTarget, onResumeConsumed }) {
  const queryClient = useQueryClient();
  const { data: config } = useConfig();
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('openrouter');
  const [promptVersion, setPromptVersion] = useState('');
  const [attempts, setAttempts] = useState(3);
  const [concurrency, setConcurrency] = useState(1);
  const [retries, setRetries] = useState(0);
  const [targetFrom, setTargetFrom] = useState('1');
  const [targetTo, setTargetTo] = useState('25');
  const [resumeRunId, setResumeRunId] = useState(null);
  const [runId, setRunId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | running | done | cancelled | error

  // Target-grid state
  const [targetCount, setTargetCount] = useState(0);
  const [targetCards, setTargetCards] = useState([]); // ordered list of targetIds
  const [targetMap, setTargetMap] = useState(new Map()); // targetId → card data
  const [logLines, setLogLines] = useState([]);

  const logRef = useRef(null);

  function updateStatus(s) {
    setStatus(s);
    onStatusChange?.(s);
  }

  // Set default promptVersion from server config once loaded
  useEffect(() => {
    if (config?.promptVersion && !promptVersion) setPromptVersion(config.promptVersion);
  }, [config]);

  // Pre-fill form when resume is triggered from RunHistory
  useEffect(() => {
    if (resumeTarget) {
      console.log('[StartRun] resumeTarget set:', resumeTarget);
      setModel(resumeTarget.model ?? '');
      setProvider(resumeTarget.provider ?? 'openrouter');
      setResumeRunId(resumeTarget.runId);
    } else {
      setResumeRunId(null);
    }
  }, [resumeTarget]);

  async function startRun() {
    setTargetCount(0);
    setTargetCards([]);
    setTargetMap(new Map());
    setLogLines([]);
    updateStatus('running');
    setRunId(null);
    try {
      const payload = {
        model: model.trim(), provider, attempts,
        promptVersion: promptVersion || undefined,
        concurrency, retries,
        targetFrom: targetFrom !== '' ? Number(targetFrom) : undefined,
        targetTo: targetTo !== '' ? Number(targetTo) : undefined,
        ...(resumeRunId ? { resumeRunId } : {}),
      };
      console.log('[StartRun] POST /api/runs/start', payload);
      const res = await fetch('/api/runs/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const { error } = await res.json();
        setLogLines([`Error: ${error}`]);
        updateStatus('error');
        return;
      }
      const { runId: id } = await res.json();
      onResumeConsumed?.();
      setResumeRunId(null);
      setRunId(id);
    } catch (err) {
      setLogLines([`Error: ${err.message}`]);
      updateStatus('error');
    }
  }

  useEffect(() => {
    if (!runId) return;
    const es = new EventSource(`/api/runs/${runId}/progress`);
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);

      switch (event.type) {
        case 'start': {
          setTargetCount(event.targetCount);
          // Pre-populate all cards as pending with their names
          const ids = (event.targets ?? []).map(t => t.id);
          const map = new Map((event.targets ?? []).map(t => [t.id, { status: 'pending', name: t.name }]));
          setTargetCards(ids);
          setTargetMap(map);
          addLog(`Run started — model: ${event.model}  targets: ${event.targetCount}`);
          break;
        }
        case 'target':
          updateCard(event.targetId, { status: 'running', name: event.targetName, retryNum: 0, currentAttempt: null, latestMatch: null });
          break;

        case 'target_skipped':
          updateCard(event.targetId, { status: 'skipped', name: event.targetName });
          addLog(`[${event.targetId}] skipped (already done)`);
          break;

        case 'target_retry':
          updateCard(event.targetId, { status: 'running', retryNum: event.retryNum, currentAttempt: null, latestMatch: null });
          addLog(`[${event.targetId}] retry ${event.retryNum}`);
          break;

        case 'target_done':
          updateCard(event.targetId, {
            status: event.skipped ? 'skipped' : event.allErrors ? 'error' : 'done',
            name: event.targetName,
            bestMatch: event.bestMatch,
          });
          break;

        case 'attempt':
          updateCard(event.targetId, { currentAttempt: event.attempt, latestMatch: event.matchPercent });
          addLog(`[${event.targetId}] attempt ${event.attempt}: ${event.matchPercent.toFixed(1)}%${event.perfect ? ' ✓' : ''}`);
          break;

        case 'attempt_error':
          updateCard(event.targetId, { currentAttempt: event.attempt });
          addLog(`[${event.targetId}] attempt ${event.attempt} failed: ${event.message}`);
          break;

        case 'done':
          addLog(`Done — avg: ${event.summary.avgScore.toFixed(1)}%  perfect rate: ${(event.summary.perfectRate * 100).toFixed(1)}%`);
          updateStatus('done');
          es.close();
          queryClient.invalidateQueries({ queryKey: ['results'] });
          queryClient.invalidateQueries({ queryKey: ['runs'] });
          break;

        case 'cancelled':
          addLog('Run cancelled.');
          updateStatus('cancelled');
          es.close();
          break;

        case 'fatal_error':
          addLog(`Error: ${event.message}`);
          updateStatus('error');
          es.close();
          break;

        default:
          break;
      }
    };
    es.onerror = () => {
      if (status === 'running') updateStatus('error');
      es.close();
    };
    return () => es.close();

    function updateCard(targetId, patch) {
      setTargetMap(prev => {
        const next = new Map(prev);
        next.set(targetId, { ...next.get(targetId), ...patch });
        return next;
      });
      // Ensure card appears in ordered list (for skipped / late arrivals)
      setTargetCards(prev => prev.includes(targetId) ? prev : [...prev, targetId]);
    }

    function addLog(line) {
      setLogLines(prev => [...prev.slice(-200), line]);
    }
  }, [runId, queryClient]);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logLines]);

  async function cancelRun() {
    if (!runId) return;
    await fetch(`/api/runs/${runId}`, { method: 'DELETE' });
  }

  const canStart = model.trim().length > 0 && status !== 'running';

  return (
    <div className="panel">
      <div className="panelHeader">
        <h2>Start Run</h2>
        {status !== 'idle' && (
          <span className={`runStatus runStatus--${status}`}>{status}</span>
        )}
      </div>
      <div className="startRunForm">
        <div className="startRunRow">
          <input
            className="modelInput"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canStart && startRun()}
            placeholder="Model (e.g. openai/gpt-4o)"
            disabled={status === 'running'}
          />
          <select
            className="filterSelect"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            disabled={status === 'running'}
          >
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            className="filterSelect"
            value={promptVersion}
            onChange={(e) => setPromptVersion(e.target.value)}
            disabled={status === 'running'}
            title="Prompt version"
          >
            {(config?.availablePromptVersions ?? [promptVersion]).filter(Boolean).map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <select
            className="filterSelect"
            value={attempts}
            onChange={(e) => setAttempts(Number(e.target.value))}
            disabled={status === 'running'}
          >
            {ATTEMPT_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} attempt{n > 1 ? 's' : ''}</option>
            ))}
          </select>
          <select
            className="filterSelect"
            value={concurrency}
            onChange={(e) => setConcurrency(Number(e.target.value))}
            disabled={status === 'running'}
            title="Parallel targets"
          >
            {CONCURRENCY_OPTIONS.map((n) => (
              <option key={n} value={n}>{n === 1 ? 'sequential' : `${n}× parallel`}</option>
            ))}
          </select>
          <select
            className="filterSelect"
            value={retries}
            onChange={(e) => setRetries(Number(e.target.value))}
            disabled={status === 'running'}
            title="Retries per target on full failure"
          >
            {RETRY_OPTIONS.map((n) => (
              <option key={n} value={n}>{n === 0 ? 'no retry' : `${n} retr${n > 1 ? 'ies' : 'y'}`}</option>
            ))}
          </select>
          <span className="targetRangeWrap">
            <input
              className="targetRangeInput"
              type="number"
              min="1"
              placeholder="from"
              value={targetFrom}
              onChange={(e) => setTargetFrom(e.target.value)}
              disabled={status === 'running'}
            />
            <span className="targetRangeSep">–</span>
            <input
              className="targetRangeInput"
              type="number"
              min="1"
              placeholder="to"
              value={targetTo}
              onChange={(e) => setTargetTo(e.target.value)}
              disabled={status === 'running'}
            />
          </span>
          <button className="runButton" onClick={startRun} disabled={!canStart}>
            {resumeRunId ? 'Resume' : status === 'running' ? 'Running...' : 'Run'}
          </button>
          {status === 'running' && (
            <button className="cancelButton" onClick={cancelRun}>Cancel</button>
          )}
        </div>

        {resumeRunId && status !== 'running' && (
          <div className="resumeBanner">
            Resuming run <code>{resumeRunId.slice(0, 8)}</code> — completed targets will be skipped.{' '}
            <button className="deleteButton" onClick={() => { setResumeRunId(null); onResumeConsumed?.(); }}>
              Clear
            </button>
          </div>
        )}

        {targetCards.length > 0 && (
          <div className="runProgressGrid">
            {targetCards.map(tid => (
              <RunTargetCard key={tid} card={targetMap.get(tid) ?? { status: 'pending' }} />
            ))}
            {Array.from({ length: Math.max(0, targetCount - targetCards.length) }, (_, i) => (
              <div key={`p-${i}`} className="runTargetCard runTargetCard--pending">…</div>
            ))}
          </div>
        )}

        {logLines.length > 0 && (
          <details className="runLogDetails">
            <summary>Log ({logLines.length} lines)</summary>
            <div className="runLog" ref={logRef}>
              {logLines.map((line, i) => (
                <div key={i} className="logLine">{line}</div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
