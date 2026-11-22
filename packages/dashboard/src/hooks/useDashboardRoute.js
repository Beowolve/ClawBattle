import { useEffect, useState } from 'react';

const TAB_STORAGE_KEY = 'clawbattle.tab';
const DEFAULT_TAB = 'leaderboard';

function readRoute(tabs, fallbackTab = DEFAULT_TAB) {
  const params = new URLSearchParams(window.location.search);
  const requestedTab = params.get('tab') ?? fallbackTab;
  const tab = tabs.includes(requestedTab) ? requestedTab : DEFAULT_TAB;
  return {
    tab,
    targetId: tab === 'targets' ? params.get('target') : null,
    targetView: params.get('view') === 'grid' ? 'grid' : 'table',
    modelFilter: params.get('model'),
    reasoningFilter: params.get('reasoning'),
  };
}

function routeUrl({ tab, targetId, targetView, modelFilter, reasoningFilter }) {
  const url = new URL(window.location.href);
  url.searchParams.set('tab', tab);
  for (const [key, value] of Object.entries({
    target: targetId,
    view: targetView === 'grid' ? targetView : null,
    model: modelFilter,
    reasoning: reasoningFilter,
  })) {
    if (value == null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  }
  return url;
}

export function useDashboardRoute(tabs) {
  const [route, setRoute] = useState(() => readRoute(tabs, localStorage.getItem(TAB_STORAGE_KEY)));

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('tab')) {
      const initialRoute = readRoute(tabs, localStorage.getItem(TAB_STORAGE_KEY));
      window.history.replaceState(window.history.state, '', routeUrl(initialRoute));
    }

    function restoreRoute() {
      const restored = readRoute(tabs);
      setRoute(restored);
      localStorage.setItem(TAB_STORAGE_KEY, restored.tab);
    }

    window.addEventListener('popstate', restoreRoute);
    return () => window.removeEventListener('popstate', restoreRoute);
  }, [tabs]);

  function navigate(changes, { replace = false } = {}) {
    const next = { ...route, ...changes };
    const url = routeUrl(next);
    if (url.href === window.location.href) return;
    if (replace) window.history.replaceState(window.history.state, '', url);
    else window.history.pushState(null, '', url);
    setRoute(next);
    localStorage.setItem(TAB_STORAGE_KEY, next.tab);
  }

  return [route, navigate];
}
