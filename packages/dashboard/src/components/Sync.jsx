import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export default function Sync() {
  const queryClient = useQueryClient();
  const [configured, setConfigured] = useState(null);
  const [uploadState, setUploadState] = useState(null);   // null | 'loading' | { result } | { error }
  const [downloadState, setDownloadState] = useState(null);

  useEffect(() => {
    fetch('/api/sync/config').then(r => r.json()).then(d => setConfigured(d.configured));
  }, []);

  async function handleUpload() {
    setUploadState('loading');
    try {
      const res = await fetch('/api/sync/upload', { method: 'POST' });
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
              : 'Not configured — add SUPABASE_RESULTS_URL + SUPABASE_RESULTS_KEY to .env'}
          </span>
        )}
      </div>

      <div className="syncBody">
        <div className="syncSection">
          <div className="syncSectionTitle">↑ Upload to Supabase</div>
          <div className="syncSectionDesc">
            Push all local runs to Supabase. Existing rows are updated (upsert).
          </div>
          <button
            className="runButton"
            onClick={handleUpload}
            disabled={!configured || uploadState === 'loading'}
          >
            {uploadState === 'loading' ? 'Uploading…' : 'Upload'}
          </button>
          {uploadState && uploadState !== 'loading' && (
            <div className={`syncResult syncResult--${uploadState.error ? 'error' : 'success'}`}>
              {uploadState.error
                ? `Error: ${uploadState.error}`
                : `✓ ${uploadState.result.uploadedRuns} run rows, ${uploadState.result.uploadedStates} run_state rows uploaded`}
            </div>
          )}
        </div>

        <div className="syncDivider" />

        <div className="syncSection">
          <div className="syncSectionTitle">↓ Download from Supabase</div>
          <div className="syncSectionDesc">
            Pull all runs from Supabase into the local DB. Already-present rows are skipped.
          </div>
          <button
            className="runButton"
            onClick={handleDownload}
            disabled={!configured || downloadState === 'loading'}
          >
            {downloadState === 'loading' ? 'Downloading…' : 'Download'}
          </button>
          {downloadState && downloadState !== 'loading' && (
            <div className={`syncResult syncResult--${downloadState.error ? 'error' : 'success'}`}>
              {downloadState.error
                ? `Error: ${downloadState.error}`
                : `✓ ${downloadState.result.insertedRuns} new run rows (${downloadState.result.fetchedRuns} fetched, ${downloadState.result.fetchedRuns - downloadState.result.insertedRuns} already present)`}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
