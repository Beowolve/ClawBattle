import { useTheme } from '../hooks/useTheme.js';

const THEME_LABELS = { system: 'System', light: 'Light', dark: 'Dark' };
const THEME_CYCLE = { system: 'light', light: 'dark', dark: 'system' };

export default function Header() {
  const [mode, setMode] = useTheme();

  return (
    <header className="appHeader">
      <div className="brand">
        <img src="/clawbattle.svg" alt="ClawBattle Logo" className="brandLogo" />
        <div>
          <div className="brandText">ClawBattle</div>
        </div>
      </div>
      <div className="headerControls">
        <button className="themeButton" onClick={() => setMode(THEME_CYCLE[mode])}>
          {THEME_LABELS[mode]}
        </button>
      </div>
    </header>
  );
}
