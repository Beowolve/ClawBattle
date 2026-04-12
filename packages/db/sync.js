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

export async function uploadToSupabase({ url, key, runs, runState }) {
  for (let i = 0; i < runs.length; i += BATCH_SIZE) {
    await sbPost(url, key, 'runs', runs.slice(i, i + BATCH_SIZE));
  }
  for (let i = 0; i < runState.length; i += BATCH_SIZE) {
    await sbPost(url, key, 'run_state', runState.slice(i, i + BATCH_SIZE));
  }
  return { uploadedRuns: runs.length, uploadedStates: runState.length };
}

export async function downloadFromSupabase({ url, key, upsertRuns, upsertRunStates }) {
  const runs = await sbFetchAll(url, key, 'runs');
  const runState = await sbFetchAll(url, key, 'run_state');
  const insertedRuns = runs.length ? upsertRuns(runs) : 0;
  const insertedStates = runState.length ? upsertRunStates(runState) : 0;
  return { fetchedRuns: runs.length, insertedRuns, fetchedStates: runState.length, insertedStates };
}
