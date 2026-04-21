import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uploadToSupabase } from './sync.js';

// Captures outgoing upserts so we can assert on what sync.js sends
// without actually hitting Supabase.
function mockSupabase() {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, table: url.split('/').pop(), body: JSON.parse(opts.body) });
    return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  };
  return {
    calls,
    restore: () => { global.fetch = originalFetch; },
  };
}

test('uploadToSupabase skips rows with status != done', async () => {
  const sb = mockSupabase();
  try {
    const runs = [
      { run_id: 'a', target_id: '1', attempt: 1, status: 'done',    match: 100 },
      { run_id: 'a', target_id: '1', attempt: 2, status: 'pending', match: null },
      { run_id: 'a', target_id: '2', attempt: 1, status: 'error',   match: null },
      { run_id: 'a', target_id: '3', attempt: 1, status: 'paused',  match: null },
    ];
    const result = await uploadToSupabase({ url: 'https://sb.test', key: 'k', runs });
    assert.equal(result.uploadedRuns, 1);
    assert.equal(sb.calls.length, 1);
    const payload = sb.calls[0].body;
    assert.equal(payload.length, 1);
    assert.equal(payload[0].run_id, 'a');
    assert.equal(payload[0].target_id, '1');
    assert.equal(payload[0].attempt, 1);
  } finally {
    sb.restore();
  }
});

test('uploadToSupabase strips queue-only columns before upload', async () => {
  const sb = mockSupabase();
  try {
    const runs = [{
      run_id: 'a', target_id: '1', attempt: 1, status: 'done',
      claim_token: 'tok-123', enqueued_at: '2026-04-20T10:00:00Z',
      claimed_at: '2026-04-20T10:01:00Z', paused_from: null,
      error_message: null, match: 100, score: 900,
    }];
    await uploadToSupabase({ url: 'https://sb.test', key: 'k', runs });
    const sent = sb.calls[0].body[0];
    assert.equal('status'        in sent, false);
    assert.equal('claim_token'   in sent, false);
    assert.equal('enqueued_at'   in sent, false);
    assert.equal('claimed_at'    in sent, false);
    assert.equal('paused_from'   in sent, false);
    assert.equal('error_message' in sent, false);
    // But normal result columns stay.
    assert.equal(sent.run_id, 'a');
    assert.equal(sent.match, 100);
    assert.equal(sent.score, 900);
  } finally {
    sb.restore();
  }
});

test('uploadToSupabase treats rows without status as done (legacy / supabase payloads)', async () => {
  const sb = mockSupabase();
  try {
    // Rows coming from Supabase don't carry `status` — treat as done-by-default.
    const runs = [{ run_id: 'legacy', target_id: '1', attempt: 1, match: 95 }];
    const { uploadedRuns } = await uploadToSupabase({ url: 'https://sb.test', key: 'k', runs });
    assert.equal(uploadedRuns, 1);
  } finally {
    sb.restore();
  }
});

test('uploadToSupabase sends nothing when every row is in-flight', async () => {
  const sb = mockSupabase();
  try {
    const runs = [
      { run_id: 'a', target_id: '1', attempt: 1, status: 'pending' },
      { run_id: 'a', target_id: '2', attempt: 1, status: 'running' },
    ];
    const { uploadedRuns } = await uploadToSupabase({ url: 'https://sb.test', key: 'k', runs });
    assert.equal(uploadedRuns, 0);
    assert.equal(sb.calls.length, 0);
  } finally {
    sb.restore();
  }
});
