import { test } from 'node:test';
import assert from 'node:assert/strict';
import { downloadFromSupabase, uploadTargetsToSupabase, uploadToSupabase } from './sync.js';

function parseTable(url) {
  return new URL(url).pathname.split('/').pop();
}

// Captures Supabase REST calls so we can assert on the sync contract without
// hitting the remote project.
function mockSupabase({ fetchPages = [], fail = null } = {}) {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const method = opts?.method ?? 'GET';
    const table = parseTable(url);
    const call = {
      url,
      method,
      table,
      headers: opts?.headers ?? {},
      body: opts?.body ? JSON.parse(opts.body) : null,
    };
    calls.push(call);
    if (fail?.(call)) {
      return { ok: false, status: 500, text: async () => 'boom', json: async () => ({}) };
    }
    if (method === 'GET') {
      const page = fetchPages.shift() ?? [];
      return { ok: true, status: 200, text: async () => '', json: async () => page };
    }
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
    assert.equal(new URL(sb.calls[0].url).searchParams.get('on_conflict'), 'run_id,target_id,attempt');
  } finally {
    sb.restore();
  }
});

test('uploadTargetsToSupabase uploads battle and daily targets in separate batches', async () => {
  const sb = mockSupabase();
  try {
    const battleTargets = Array.from({ length: 501 }, (_, i) => ({
      id: i + 1,
      name: `Battle ${i + 1}`,
      image_url: `https://img.test/battle/${i + 1}.png`,
      colors: [],
      battle_number: i + 1,
    }));
    const dailyTargets = Array.from({ length: 2 }, (_, i) => ({
      key: `daily-${i + 1}`,
      name: `Daily ${i + 1}`,
      image_url: `https://img.test/daily/${i + 1}.png`,
      colors: [],
      date: `2026-04-${20 + i}`,
    }));

    const result = await uploadTargetsToSupabase({
      url: 'https://sb.test',
      key: 'k',
      battleTargets,
      dailyTargets,
    });

    assert.deepEqual(result, { uploadedBattle: 501, uploadedDaily: 2 });
    assert.equal(sb.calls.length, 3);
    assert.deepEqual(sb.calls.map(c => c.table), ['battle_targets', 'battle_targets', 'daily_targets']);
    assert.deepEqual(sb.calls.map(c => c.body.length), [500, 1, 2]);
    assert.deepEqual(
      sb.calls.map(c => new URL(c.url).searchParams.get('on_conflict')),
      ['id', 'id', 'key'],
    );
    for (const call of sb.calls) {
      assert.equal(call.method, 'POST');
      assert.equal(call.headers.Prefer, 'resolution=merge-duplicates,return=minimal');
    }
  } finally {
    sb.restore();
  }
});

test('downloadFromSupabase fetches all pages and passes rows to local upsert', async () => {
  const page1 = Array.from({ length: 1000 }, (_, i) => ({
    run_id: 'remote',
    target_id: String(i + 1),
    attempt: 1,
  }));
  const page2 = [
    { run_id: 'remote', target_id: '1001', attempt: 1 },
    { run_id: 'remote', target_id: '1002', attempt: 1 },
  ];
  const sb = mockSupabase({ fetchPages: [page1, page2] });
  try {
    let upsertedRows = null;
    const result = await downloadFromSupabase({
      url: 'https://sb.test',
      key: 'k',
      upsertRuns: (rows) => {
        upsertedRows = rows;
        return 7;
      },
    });

    assert.deepEqual(result, { fetchedRuns: 1002, insertedRuns: 7 });
    assert.equal(upsertedRows.length, 1002);
    assert.equal(sb.calls.length, 2);
    assert.equal(new URL(sb.calls[0].url).searchParams.get('limit'), '1000');
    assert.equal(new URL(sb.calls[0].url).searchParams.get('offset'), '0');
    assert.equal(new URL(sb.calls[1].url).searchParams.get('offset'), '1000');
  } finally {
    sb.restore();
  }
});

test('downloadFromSupabase skips local upsert when remote has no runs', async () => {
  const sb = mockSupabase({ fetchPages: [[]] });
  try {
    const result = await downloadFromSupabase({
      url: 'https://sb.test',
      key: 'k',
      upsertRuns: () => assert.fail('upsert should not run for an empty download'),
    });

    assert.deepEqual(result, { fetchedRuns: 0, insertedRuns: 0 });
    assert.equal(sb.calls.length, 1);
  } finally {
    sb.restore();
  }
});

test('sync calls include Supabase error details', async () => {
  const sb = mockSupabase({ fail: call => call.method === 'POST' && call.table === 'runs' });
  try {
    await assert.rejects(
      uploadToSupabase({
        url: 'https://sb.test',
        key: 'k',
        runs: [{ run_id: 'a', target_id: '1', attempt: 1, status: 'done' }],
      }),
      /Supabase upsert \(runs\) failed: HTTP 500 .* boom/,
    );
  } finally {
    sb.restore();
  }
});

test('uploadToSupabase retries without optional columns missing from older Supabase schemas', async () => {
  let failedOnce = false;
  const sb = mockSupabase({
    fail: (call) => {
      if (failedOnce || call.table !== 'runs' || call.body?.[0]?.canonical_model == null) return false;
      failedOnce = true;
      return true;
    },
  });
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const call = {
      method: opts?.method ?? 'GET',
      table: parseTable(url),
      body: opts?.body ? JSON.parse(opts.body) : null,
    };
    if (!failedOnce && call.table === 'runs' && call.body?.[0]?.canonical_model != null) {
      failedOnce = true;
      sb.calls.push({ ...call, url, headers: opts?.headers ?? {} });
      return {
        ok: false,
        status: 400,
        text: async () => JSON.stringify({
          code: 'PGRST204',
          message: "Could not find the 'canonical_model' column of 'runs' in the schema cache",
        }),
        json: async () => ({}),
      };
    }
    return originalFetch(url, opts);
  };
  try {
    const result = await uploadToSupabase({
      url: 'https://sb.test',
      key: 'k',
      runs: [{
        run_id: 'a',
        target_id: '1',
        attempt: 1,
        status: 'done',
        canonical_model: 'openai/gpt-5.4-mini',
      }],
    });

    assert.deepEqual(result, { uploadedRuns: 1, omittedColumns: ['canonical_model'], replacedRuns: false });
    assert.equal(sb.calls.length, 2);
    assert.equal(sb.calls[0].body[0].canonical_model, 'openai/gpt-5.4-mini');
    assert.equal('canonical_model' in sb.calls[1].body[0], false);
  } finally {
    sb.restore();
  }
});

test('uploadToSupabase can replace all remote runs before uploading local done rows', async () => {
  const sb = mockSupabase();
  try {
    const result = await uploadToSupabase({
      url: 'https://sb.test',
      key: 'k',
      replaceAll: true,
      runs: [
        { run_id: 'a', target_id: '1', attempt: 1, status: 'done', match: 100 },
        { run_id: 'a', target_id: '2', attempt: 1, status: 'pending', match: null },
      ],
    });

    assert.deepEqual(result, { uploadedRuns: 1, omittedColumns: [], replacedRuns: true });
    assert.equal(sb.calls.length, 2);
    assert.equal(sb.calls[0].method, 'DELETE');
    assert.equal(sb.calls[0].table, 'runs');
    assert.equal(new URL(sb.calls[0].url).searchParams.get('id'), 'not.is.null');
    assert.equal(sb.calls[1].method, 'POST');
    assert.equal(sb.calls[1].body.length, 1);
    assert.equal(sb.calls[1].body[0].target_id, '1');
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
      error_message: null, prompt_text: 'prompt body', match: 100, score: 900,
      model: 'openai/gpt-5.4-mini', raw_model: 'gpt-5.4-mini-2026-03-17',
      model_key: 'openai/gpt-5.4-mini', canonical_model: 'openai/gpt-5.4-mini',
    }];
    await uploadToSupabase({ url: 'https://sb.test', key: 'k', runs });
    const sent = sb.calls[0].body[0];
    assert.equal('status'        in sent, false);
    assert.equal('claim_token'   in sent, false);
    assert.equal('enqueued_at'   in sent, false);
    assert.equal('claimed_at'    in sent, false);
    assert.equal('paused_from'   in sent, false);
    assert.equal('error_message' in sent, false);
    assert.equal('prompt_text'   in sent, false);
    assert.equal('raw_model'     in sent, false);
    assert.equal('model_key'     in sent, false);
    // But normal result columns stay.
    assert.equal(sent.run_id, 'a');
    assert.equal(sent.model, 'gpt-5.4-mini-2026-03-17');
    assert.equal(sent.canonical_model, 'openai/gpt-5.4-mini');
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
