// Bidirectional sync between local SQLite and Supabase.
// Used by both the CLI scripts and the API server.

const BATCH_SIZE = 500;
const PAGE_SIZE = 1000;
const OPTIONAL_RUN_UPLOAD_FIELDS = new Set(['canonical_model']);

class SupabaseRestError extends Error {
  constructor({ table, operation, status, body }) {
    super(`Supabase ${operation} (${table}) failed: HTTP ${status} - ${body}`);
    this.name = 'SupabaseRestError';
    this.table = table;
    this.operation = operation;
    this.status = status;
    this.body = body;
  }
}

async function sbPost(url, key, table, rows, { onConflict = [] } = {}) {
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  if (onConflict.length) endpoint.searchParams.set('on_conflict', onConflict.join(','));
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new SupabaseRestError({ table, operation: 'upsert', status: res.status, body: await res.text() });
  }
}

async function sbDeleteAll(url, key, table) {
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  endpoint.searchParams.set('id', 'not.is.null');
  const res = await fetch(endpoint, {
    method: 'DELETE',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'return=minimal',
    },
  });
  if (!res.ok) {
    throw new SupabaseRestError({ table, operation: 'delete', status: res.status, body: await res.text() });
  }
}

async function sbFetchPage(url, key, table, offset) {
  const res = await fetch(
    `${url}/rest/v1/${table}?select=*&limit=${PAGE_SIZE}&offset=${offset}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) {
    throw new SupabaseRestError({ table, operation: 'fetch', status: res.status, body: await res.text() });
  }
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
    await sbPost(url, key, 'battle_targets', battleTargets.slice(i, i + BATCH_SIZE), { onConflict: ['id'] });
  }
  for (let i = 0; i < dailyTargets.length; i += BATCH_SIZE) {
    await sbPost(url, key, 'daily_targets', dailyTargets.slice(i, i + BATCH_SIZE), { onConflict: ['key'] });
  }
  return { uploadedBattle: battleTargets.length, uploadedDaily: dailyTargets.length };
}

// Sync only completed attempts. Queue-state columns (status, claim_token,
// enqueued_at, claimed_at, paused_from, error_message) are intentionally
// stripped before upload. Queue state is local to a single process and must
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

function withoutFields(rows, fields) {
  if (fields.size === 0) return rows;
  return rows.map((row) => {
    const out = { ...row };
    for (const field of fields) delete out[field];
    return out;
  });
}

function missingSchemaColumn(error) {
  if (!(error instanceof SupabaseRestError) || error.status !== 400) return null;
  try {
    const body = JSON.parse(error.body);
    if (body.code !== 'PGRST204' || typeof body.message !== 'string') return null;
    return body.message.match(/'([^']+)' column/)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function sbPostRuns(url, key, rows, omittedColumns) {
  while (true) {
    try {
      await sbPost(url, key, 'runs', withoutFields(rows, omittedColumns), {
        onConflict: ['run_id', 'target_id', 'attempt'],
      });
      return;
    } catch (error) {
      const column = missingSchemaColumn(error);
      if (!column || !OPTIONAL_RUN_UPLOAD_FIELDS.has(column) || omittedColumns.has(column)) {
        throw error;
      }
      omittedColumns.add(column);
    }
  }
}

export async function uploadToSupabase({ url, key, runs, replaceAll = false }) {
  // Callers should already filter to done rows via getResults / attempt_results,
  // but guard defensively so an accidental raw-runs feed still stays safe.
  const doneRuns = runs.filter(r => r.status === undefined || r.status === 'done');
  const clean = doneRuns.map(stripQueueFields);
  const omittedColumns = new Set();
  if (replaceAll) {
    await sbDeleteAll(url, key, 'runs');
  }
  for (let i = 0; i < clean.length; i += BATCH_SIZE) {
    await sbPostRuns(url, key, clean.slice(i, i + BATCH_SIZE), omittedColumns);
  }
  return { uploadedRuns: clean.length, omittedColumns: [...omittedColumns], replacedRuns: Boolean(replaceAll) };
}

export async function downloadFromSupabase({ url, key, upsertRuns }) {
  const runs = await sbFetchAll(url, key, 'runs');
  const insertedRuns = runs.length ? upsertRuns(runs) : 0;
  return { fetchedRuns: runs.length, insertedRuns };
}
