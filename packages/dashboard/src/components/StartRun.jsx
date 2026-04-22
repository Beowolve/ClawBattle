import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConfig } from '../hooks/useData.js';
import RunQueue from './RunQueue.jsx';

const PROVIDERS = ['openrouter', 'openai', 'ollama'];
const REASONING_OPTIONS = ['', 'low', 'medium', 'high', 'xhigh'];
const ATTEMPT_OPTIONS = [1, 2, 3, 5];
const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5, 8, 10];
const RETRY_OPTIONS = [0, 1, 2, 3];

export default function StartRun({ onStatusChange }) {
  const queryClient = useQueryClient();
  const { data: config } = useConfig();
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('openrouter');
  const [promptVersion, setPromptVersion] = useState('');
  const [attempts, setAttempts] = useState(3);
  const [concurrency, setConcurrency] = useState(5);
  const [retries, setRetries] = useState(1);
  const [reasoningEffort, setReasoningEffort] = useState('');
  const [reasoningMaxTokens, setReasoningMaxTokens] = useState('8000');
  const [targetFrom, setTargetFrom] = useState('1');
  const [targetTo, setTargetTo] = useState('25');
  const [fillMode, setFillMode] = useState(false);
  const [runId, setRunId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | running | done | cancelled | error

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

  // On mount: reconnect to an active run if one was in progress before page refresh
  useEffect(() => {
    const saved = localStorage.getItem('clawbattle.activeRunId');
    if (!saved) return;
    fetch('/api/runs/active')
      .then(r => r.json())
      .then(active => {
        const found = active.find(j => j.runId === saved);
        if (found) {
          setRunId(saved);
          setModel(found.model ?? '');
          setProvider(found.provider ?? 'openrouter');
          updateStatus('running');
        } else {
          localStorage.removeItem('clawbattle.activeRunId');
        }
      })
      .catch(() => localStorage.removeItem('clawbattle.activeRunId'));
  }, []);

  async function startRun() {
    setLogLines([]);
    updateStatus('running');
    setRunId(null);
    try {
      const payload = {
        model: model.trim(), provider, attempts,
        promptVersion: promptVersion || undefined,
        concurrency, retries,
        reasoningEffort: reasoningEffort || undefined,
        reasoningMaxTokens: reasoningMaxTokens !== '' ? Number(reasoningMaxTokens) : undefined,
        targetFrom: targetFrom !== '' ? Number(targetFrom) : undefined,
        targetTo: targetTo !== '' ? Number(targetTo) : undefined,
        ...(fillMode ? { fillMode: true } : {}),
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
      localStorage.setItem('clawbattle.activeRunId', id);
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
        case 'start':
          addLog(`Run started — model: ${event.model}  targets: ${event.targetCount}`);
          break;

        case 'target_skipped':
          addLog(`[${event.targetId}] skipped (already done)`);
          break;

        case 'target_retry':
          addLog(`[${event.targetId}] retry ${event.retryNum}`);
          break;

        case 'attempt':
          addLog(`[${event.targetId}] attempt ${event.attempt}: ${event.matchPercent.toFixed(1)}%${event.perfect ? ' ✓' : ''}`);
          break;

        case 'attempt_error':
          addLog(
            event.errorType === 'policy_violation'
              ? `[${event.targetId}] attempt ${event.attempt} rejected by policy: ${event.message}`
              : `[${event.targetId}] attempt ${event.attempt} failed: ${event.message}`,
          );
          break;

        case 'done':
          addLog(`Done — avg: ${event.summary.avgScore.toFixed(1)}%  perfect rate: ${(event.summary.perfectRate * 100).toFixed(1)}%`);
          localStorage.removeItem('clawbattle.activeRunId');
          updateStatus('done');
          es.close();
          queryClient.invalidateQueries({ queryKey: ['results'] });
          queryClient.invalidateQueries({ queryKey: ['runs'] });
          break;

        case 'cancelled':
          addLog('Run cancelled.');
          localStorage.removeItem('clawbattle.activeRunId');
          updateStatus('cancelled');
          es.close();
          break;

        case 'fatal_error':
          addLog(`Error: ${event.message}`);
          localStorage.removeItem('clawbattle.activeRunId');
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
    await fetch(`/api/runs/${runId}/cancel`, { method: 'POST' });
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
            value={reasoningEffort}
            onChange={(e) => setReasoningEffort(e.target.value)}
            disabled={status === 'running'}
            title="Reasoning effort (for o-series / reasoning models)"
          >
            {REASONING_OPTIONS.map(v => (
              <option key={v} value={v}>{v === '' ? 'default' : v}</option>
            ))}
          </select>
          <input
            className="targetRangeInput"
            type="number"
            min="0"
            step="1000"
            placeholder="reason. max tokens"
            value={reasoningMaxTokens}
            onChange={(e) => setReasoningMaxTokens(e.target.value)}
            disabled={status === 'running'}
            title="Cap on reasoning/thinking tokens (OpenRouter). Leave empty for model default."
            style={{ width: 130 }}
          />
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
          <label className="filterLabel" style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Fill missing attempts for existing (model, prompt, target) up to 'attempts' total">
            <input
              type="checkbox"
              checked={fillMode}
              onChange={(e) => setFillMode(e.target.checked)}
              disabled={status === 'running'}
            />
            Fill
          </label>
          <button className="runButton" onClick={startRun} disabled={!canStart}>
            {fillMode ? 'Fill' : status === 'running' ? 'Running...' : 'Run'}
          </button>
          {status === 'running' && (
            <button className="cancelButton" onClick={cancelRun}>Cancel</button>
          )}
        </div>

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

        <RunQueue />
      </div>
    </div>
  );
}
