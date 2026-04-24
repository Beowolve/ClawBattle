function formatGroupLabel(row) {
  const parts = [];
  if (row.reasoningEffort) parts.push(`reasoning=${row.reasoningEffort}`);
  if (row.promptVersions?.length === 1) parts.push(`prompt=${row.promptVersions[0]}`);
  return parts.length > 0 ? `${row.model} (${parts.join(', ')})` : row.model;
}

export default function DeleteLeaderboardRunsDialog({
  row,
  selectedPrompts,
  deleting = false,
  onTogglePrompt,
  onSelectAll,
  onClear,
  onCancel,
  onConfirm,
}) {
  if (!row) return null;

  const promptVersions = row.promptVersions ?? [];
  const hasPromptSelection = promptVersions.length > 0;
  const hasMultiplePrompts = promptVersions.length > 1;
  const canConfirm = !hasPromptSelection || selectedPrompts.length > 0;

  return (
    <div className="dialogOverlay" role="presentation" onClick={onCancel}>
      <div
        className="dialogCard"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-dialog-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="dialogHeader">
          <h3 id="delete-dialog-title">Delete leaderboard entry</h3>
        </div>

        <div className="dialogBody">
          <p>
            This deletes all runs for <strong>{formatGroupLabel(row)}</strong>.
          </p>

          {hasMultiplePrompts ? (
            <>
              <p>Select which prompt versions should be removed for this entry.</p>
              <div className="dialogToolbar">
                <button type="button" className="dialogSecondaryButton" onClick={onSelectAll}>
                  Select all
                </button>
                <button type="button" className="dialogSecondaryButton" onClick={onClear}>
                  Clear
                </button>
              </div>
              <div className="dialogCheckboxList">
                {promptVersions.map(promptVersion => (
                  <label key={promptVersion} className="dialogCheckboxItem">
                    <input
                      type="checkbox"
                      checked={selectedPrompts.includes(promptVersion)}
                      onChange={() => onTogglePrompt(promptVersion)}
                    />
                    <span>{promptVersion}</span>
                  </label>
                ))}
              </div>
            </>
          ) : hasPromptSelection ? (
            <p>Prompt version <strong>{promptVersions[0]}</strong> will be removed for this entry.</p>
          ) : (
            <p>No stored prompt versions were found for this entry. The whole group will be deleted.</p>
          )}
        </div>

        <div className="dialogActions">
          <button type="button" className="dialogSecondaryButton" onClick={onCancel} disabled={deleting}>
            Cancel
          </button>
          <button type="button" className="deleteButton" onClick={onConfirm} disabled={deleting || !canConfirm}>
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
