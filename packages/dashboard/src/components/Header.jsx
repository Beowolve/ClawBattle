import { useTheme } from '../hooks/useTheme.js';

const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' };
const THEME_CYCLE = { system: 'light', light: 'dark', dark: 'system' };
const GITHUB_REPOSITORY_URL = 'https://github.com/Beowolve/ClawBattle';

export default function Header({ promptVersions, promptFilter, onPromptChange }) {
  const [mode, setMode] = useTheme();

  return (
    <header className="appHeader">
      <div className="brand">
        <img src="./clawbattle.svg" alt="ClawBattle Logo" className="brandLogo" />
        <div>
          <div className="brandText">ClawBattle</div>
          <div className="brandSub">Silicon vs stylesheet</div>
        </div>
      </div>
      <div className="headerControls">
        {promptVersions?.length > 1 && (
          <select className="filterSelect" value={promptFilter} onChange={e => onPromptChange(e.target.value)}>
            <option value="all">All prompts</option>
            {promptVersions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <button className="themeButton" onClick={() => setMode(THEME_CYCLE[mode])}>
          {THEME_LABELS[mode]}
        </button>
        <a
          className="githubLink"
          href={GITHUB_REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Open ClawBattle on GitHub"
          title="Open ClawBattle on GitHub"
        >
          <svg className="githubIcon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path
              fill="currentColor"
              d="M8 0C3.58 0 0 3.69 0 8.24c0 3.64 2.29 6.72 5.47 7.81.4.08.55-.18.55-.4 0-.2-.01-.84-.01-1.52-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.96-.82-1.15-.28-.16-.68-.56-.01-.57.63-.01 1.08.6 1.23.85.72 1.25 1.87.9 2.33.69.07-.54.28-.9.51-1.11-1.78-.21-3.64-.92-3.64-4.07 0-.9.31-1.64.82-2.22-.08-.21-.36-1.05.08-2.18 0 0 .67-.22 2.2.85A7.4 7.4 0 0 1 8 3.98c.68 0 1.36.09 2 .28 1.53-1.07 2.2-.85 2.2-.85.44 1.13.16 1.97.08 2.18.51.58.82 1.31.82 2.22 0 3.16-1.87 3.86-3.65 4.07.29.26.54.76.54 1.54 0 1.11-.01 2.01-.01 2.28 0 .22.15.48.55.4A8.13 8.13 0 0 0 16 8.24C16 3.69 12.42 0 8 0Z"
            />
          </svg>
        </a>
      </div>
    </header>
  );
}
