import { useState, useEffect } from 'react';

const STORAGE_KEY = 'clawbattle.theme';

function resolveTheme(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [mode, setMode] = useState(() => localStorage.getItem(STORAGE_KEY) ?? 'system');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolveTheme(mode));
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  return [mode, setMode];
}
