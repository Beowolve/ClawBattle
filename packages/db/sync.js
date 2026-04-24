// Bidirectional sync between local SQLite and Supabase.
// Used by both the CLI scripts and the API server.

const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;

async function sbPost(url, key, table, rows) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase upsert (${table}) failed: HTTP ${res.status} – ${await res.text()}`);
}

async function sbFetchPage(url, key, table, offset) {
  const res = await fetch(
    `${url}/rest/v1/${table}?select=*&limit=${PAGE_SIZE}&offset=${offset}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`Supabase fetch (${table}) failed: HTTP ${res.status} – ${await res.text()}`);
  return res.json();
}

async function sbFetchAll(url, key, table) {
  const rows = [];
  let offset = 0;
  while (true) {
    const page = await sbFetchPage(url, key, table, offset);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

export async function uploadTargetsToSupabase({ url, key, battleTargets, dailyTargets }) {
  for (let i = 0; i < battleTargets.length; i += BATCH_SIZE) {
    await sbPost(url, key, 'battle_targets', battleTargets.slice(i, i + BATCH_SIZE));
  }
  for (let i = 0; i < dailyTargets.length; i += BATCH_SIZE) {
    await sbPost(url, key, 'daily_targets', dailyTargets.slice(i, i + BATCH_SIZE));
  }
  return { uploadedBattle: battleTargets.length, uploadedDaily: dailyTargets.length };
}

// Sync only completed attempts. Queue-state columns (status, claim_token,
// enqueued_at, claimed_at, paused_from, error_message) are intentionally
// stripped before upload — a queue is local to a single process and must
// not leak into Supabase.
const QUEUE_ONLY_FIELDS = new Set([
  'status', 'claim_token', 'enqueued_at', 'claimed_at',
  'paused_from', 'error_message',
  // Local debug field for queue inspection; not part of Supabase schema.
  'prompt_text',
  // Read aliases from SQLite views; uploads keep raw model in `model`.
  'raw_model', 'model_key',
]);

function stripQueueFields(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (!QUEUE_ONLY_FIELDS.has(k)) out[k] = v;
  }
  if (row.raw_model) out.model = row.raw_model;
  return out;
}

export async function uploadToSupabase({ url, key, runs }) {
  // Callers should already filter to done rows via getResults / attempt_results,
  // but guard defensively so an accidental raw-runs feed still stays safe.
  const doneRuns = runs.filter(r => r.status === undefined || r.status === 'done');
  const clean = doneRuns.map(stripQueueFields);
  for (let i = 0; i < clean.length; i += BATCH_SIZE) {
    await sbPost(url, key, 'runs', clean.slice(i, i + BATCH_SIZE));
  }
  return { uploadedRuns: clean.length };
}

export async function downloadFromSupabase({ url, key, upsertRuns }) {
  const runs = await sbFetchAll(url, key, 'runs');
  const insertedRuns = runs.length ? upsertRuns(runs) : 0;
  return { fetchedRuns: runs.length, insertedRuns };
}
