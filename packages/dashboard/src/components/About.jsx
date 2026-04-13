import { useState } from 'react';
import promptV1 from '../../../../prompts/v1/prompt.md?raw';
import promptV2 from '../../../../prompts/v2/prompt.md?raw';
import followupPrompt from '../../../../prompts/followup.md?raw';

const PROMPTS = [
  { key: 'v2', label: 'v2 (current)', content: promptV2 },
  { key: 'v1', label: 'v1', content: promptV1 },
];

export default function About() {
  const [activePrompt, setActivePrompt] = useState('v2');
  const current = PROMPTS.find(p => p.key === activePrompt);

  return (
    <div className="aboutWrap">

      <div className="panel">
        <div className="panelHeader"><h2>What is ClawBattle?</h2></div>
        <div className="aboutSection">
          <p>
            ClawBattle is an open-source benchmark that measures how accurately LLMs can reproduce
            pixel-perfect CSS designs. Each model is given a target image and asked to write
            HTML/CSS that matches it as closely as possible while staying as short as possible.
          </p>
          <p>
            Targets are sourced from{' '}
            <a href="https://cssbattle.dev" target="_blank" rel="noreferrer">CSS Battle</a> — an
            online challenge platform with hundreds of targets of varying complexity.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panelHeader"><h2>How it works</h2></div>
        <div className="aboutSection">
          <ol className="aboutSteps">
            <li>
              The model receives the <strong>target image</strong> alongside canvas dimensions and
              the exact colors used.
            </li>
            <li>
              It generates an HTML/CSS solution. No JavaScript, SVG, or external resources allowed.
            </li>
            <li>
              The solution is rendered in a headless <strong>Chromium</strong> browser at the exact
              canvas size (Quirks Mode).
            </li>
            <li>
              The rendered PNG is pixel-diffed against the target using{' '}
              <strong>pixelmatch</strong> (perceptual threshold 0.01).
            </li>
            <li>
              A score is calculated from the pixel match rate and the character count of the
              solution.
            </li>
          </ol>
          <p>
            Each target gets <strong>3 attempts</strong> per run. The best attempt per target counts
            towards the leaderboard.
          </p>
          <p>
            For <strong>attempts 2 and 3</strong>, the model also receives the previously rendered
            image and its previously submitted code as extra follow-up context.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panelHeader"><h2>Scoring</h2></div>
        <div className="aboutSection">
          <p>Scoring follows the CSS Battle formula — rewarding both accuracy and code length:</p>
          <pre className="aboutFormula">score = 399.99725 × (0.9905144 ^ charCount) + 599.9987</pre>
          <p>
            For imperfect pixel matches the base score is multiplied by <code>match³</code>,
            making accuracy far more valuable than saving a few characters:
          </p>
          <div className="tableWrap aboutScoreTable">
            <table>
              <thead>
                <tr>
                  <th>Match</th>
                  <th className="numeric">Multiplier</th>
                  <th className="numeric">Score impact</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="perfect">100 %</td>
                  <td className="numeric perfect">1.000×</td>
                  <td className="numeric muted">full score</td>
                </tr>
                <tr>
                  <td>99 %</td>
                  <td className="numeric">0.970×</td>
                  <td className="numeric muted">−3 %</td>
                </tr>
                <tr>
                  <td>95 %</td>
                  <td className="numeric">0.857×</td>
                  <td className="numeric muted">−14 %</td>
                </tr>
                <tr>
                  <td>80 %</td>
                  <td className="numeric">0.512×</td>
                  <td className="numeric muted">−49 %</td>
                </tr>
                <tr>
                  <td>50 %</td>
                  <td className="numeric">0.125×</td>
                  <td className="numeric muted">−88 %</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="aboutNote">
            The theoretical maximum is 1000 (empty solution, 100 % match). Only solutions with
            100 % pixel match count as perfect.
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panelHeader">
          <h2>Prompt</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            {PROMPTS.map(p => (
              <button
                key={p.key}
                className={`tabButton ${activePrompt === p.key ? 'active' : ''}`}
                onClick={() => setActivePrompt(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="aboutPromptBlocks">
          <div className="aboutPromptBlock">
            <div className="aboutPromptTitle">Base prompt (attempt 1)</div>
            <pre className="aboutPrompt">{current.content}</pre>
          </div>
          <div className="aboutPromptBlock">
            <div className="aboutPromptTitle">Follow-up appendix (attempts 2-3)</div>
            <pre className="aboutPrompt">{followupPrompt}</pre>
          </div>
        </div>
      </div>

    </div>
  );
}
