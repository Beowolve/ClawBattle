import { useQuery } from '@tanstack/react-query';

const API = '/api';

async function fetchJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export function useResults() {
  return useQuery({ queryKey: ['results'], queryFn: () => fetchJson('/results') });
}

export function useRuns() {
  return useQuery({ queryKey: ['runs'], queryFn: () => fetchJson('/runs') });
}

export function useBattleTargets() {
  return useQuery({ queryKey: ['targets', 'battle'], queryFn: () => fetchJson('/targets/battle') });
}

export function useDailyTargets() {
  return useQuery({ queryKey: ['targets', 'daily'], queryFn: () => fetchJson('/targets/daily') });
}

export function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: () => fetchJson('/config') });
}
