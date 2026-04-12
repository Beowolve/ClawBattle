import { useQuery } from '@tanstack/react-query';

// ─── Local API (default) ──────────────────────────────────────────────────────

const API = '/api';

async function fetchJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// ─── Public mode (Supabase REST, read-only) ───────────────────────────────────

export const IS_PUBLIC = import.meta.env.VITE_PUBLIC_MODE === 'true';
const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const PAGE_SIZE = 1000;

async function fetchAllFromSupabase(table, order = '') {
  const rows = [];
  let offset = 0;
  while (true) {
    const url = `${SB_URL}/rest/v1/${table}?select=*&limit=${PAGE_SIZE}&offset=${offset}${order ? `&order=${order}` : ''}`;
    const res = await fetch(url, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!res.ok) throw new Error(`Supabase/${table}: ${res.status}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useResults() {
  return useQuery({
    queryKey: ['results'],
    queryFn: IS_PUBLIC
      ? () => fetchAllFromSupabase('runs', 'created_at.asc')
      : () => fetchJson('/results'),
  });
}

export function useRuns() {
  return useQuery({
    queryKey: ['runs'],
    queryFn: IS_PUBLIC
      ? () => fetchAllFromSupabase('run_state', 'started_at.desc')
      : () => fetchJson('/runs'),
  });
}

export function useBattleTargets() {
  return useQuery({
    queryKey: ['targets', 'battle'],
    queryFn: IS_PUBLIC
      ? () => fetchAllFromSupabase('battle_targets', 'battle_number.asc')
      : () => fetchJson('/targets/battle'),
  });
}

export function useDailyTargets() {
  return useQuery({
    queryKey: ['targets', 'daily'],
    queryFn: IS_PUBLIC
      ? () => fetchAllFromSupabase('daily_targets', 'date.desc')
      : () => fetchJson('/targets/daily'),
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    // Config (available prompt versions etc.) is local-only — not needed in public mode
    queryFn: IS_PUBLIC
      ? () => Promise.resolve({ promptVersion: '', availablePromptVersions: [] })
      : () => fetchJson('/config'),
  });
}
