import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export default function Sync() {
  const queryClient = useQueryClient();
  const [configured, setConfigured] = useState(null);
  const [uploadState, setUploadState] = useState(null);
  const [uploadTargetsState, setUploadTargetsState] = useState(null);
  const [downloadState, setDownloadState] = useState(null);
  const [replaceAllRuns, setReplaceAllRuns] = useState(false);

  useEffect(() => {
    fetch('/api/sync/config').then(r => r.json()).then(d => setConfigured(d.configured));
  }, []);

  async function handleUploadTargets() {
    setUploadTargetsState('loading');
    try {
      const res = await fetch('/api/sync/upload-targets', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUploadTargetsState({ result: data });
    } catch (err) {
      setUploadTargetsState({ error: err.message });
    }
  }

  async function handleUpload() {
    setUploadState('loading');
    try {
      const res = await fetch('/api/sync/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ replaceAll: replaceAllRuns }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUploadState({ result: data });
    } catch (err) {
      setUploadState({ error: err.message });
    }
  }

  async function handleDownload() {
    setDownloadState('loading');
    try {
      const res = await fetch('/api/sync/download', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setDownloadState({ result: data });
      queryClient.invalidateQueries({ queryKey: ['results'] });
      queryClient.invalidateQueries({ queryKey: ['runs'] });
    } catch (err) {
      setDownloadState({ error: err.message });
    }
  }

  return (
    <div className="panel">
      <div className="panelHeader">
        <h2>Supabase Sync</h2>
        {configured !== null && (
          <span className="syncStatus">
            <span className={`syncStatusDot syncStatusDot--${configured ? 'ok' : 'err'}`} />
            {configured
              ? 'Supabase configured'
              : 'Not configured - add SUPABASE_RESULTS_URL + SUPABASE_RESULTS_KEY to .env'}
          </span>
        )}
      </div>

      <div className="syncBody syncBody--single">
        <div className="syncSection">
          <div className="syncSectionTitle">Upload Targets to Supabase</div>
          <div className="syncSectionDesc">
            Push local battle_targets and daily_targets to Supabase. Run this once to seed the DB for others.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="runButton"
              onClick={handleUploadTargets}
              disabled={!configured || uploadTargetsState === 'loading'}
            >
              {uploadTargetsState === 'loading' ? 'Uploading...' : 'Upload Targets'}
            </button>
            {uploadTargetsState && uploadTargetsState !== 'loading' && (
              <div className={`syncResult syncResult--${uploadTargetsState.error ? 'error' : 'success'}`}>
                {uploadTargetsState.error
                  ? `Error: ${uploadTargetsState.error}`
                  : `${uploadTargetsState.result.uploadedBattle} battle, ${uploadTargetsState.result.uploadedDaily} daily targets uploaded`}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="syncBody">
        <div className="syncSection">
          <div className="syncSectionTitle">Upload to Supabase</div>
          <div className="syncSectionDesc">
            Push all local done runs to Supabase. Existing rows are updated by default.
          </div>
          <label className="syncDangerOption">
            <input
              type="checkbox"
              checked={replaceAllRuns}
              disabled={!configured || uploadState === 'loading'}
              onChange={e => setReplaceAllRuns(e.target.checked)}
            />
            <span>
              Replace Supabase runs with local done rows
              <small>Deletes all remote run rows before uploading. Use only after a local backup.</small>
            </span>
          </label>
          <button
            className={`runButton${replaceAllRuns ? ' runButton--danger' : ''}`}
            onClick={handleUpload}
            disabled={!configured || uploadState === 'loading'}
          >
            {uploadState === 'loading' ? 'Uploading...' : (replaceAllRuns ? 'Replace + Upload' : 'Upload')}
          </button>
          {uploadState && uploadState !== 'loading' && (
            <div className={`syncResult syncResult--${uploadState.error ? 'error' : 'success'}`}>
              {uploadState.error
                ? `Error: ${uploadState.error}`
                : `${uploadState.result.uploadedRuns} done run rows uploaded${uploadState.result.replacedRuns ? ' after replacing remote runs' : ''}`}
            </div>
          )}
        </div>

        <div className="syncDivider" />

        <div className="syncSection">
          <div className="syncSectionTitle">Download from Supabase</div>
          <div className="syncSectionDesc">
            Pull all runs from Supabase into the local DB. Already-present rows are skipped.
          </div>
          <button
            className="runButton"
            onClick={handleDownload}
            disabled={!configured || downloadState === 'loading'}
          >
            {downloadState === 'loading' ? 'Downloading...' : 'Download'}
          </button>
          {downloadState && downloadState !== 'loading' && (
            <div className={`syncResult syncResult--${downloadState.error ? 'error' : 'success'}`}>
              {downloadState.error
                ? `Error: ${downloadState.error}`
                : `${downloadState.result.insertedRuns} new run rows (${downloadState.result.fetchedRuns} fetched, ${downloadState.result.fetchedRuns - downloadState.result.insertedRuns} already present)`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
