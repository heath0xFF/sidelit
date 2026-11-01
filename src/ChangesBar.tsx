import type { Change } from "./changes";

export default function ChangesBar({ changes, index, source, unmapped, canUndo, onShowAll, onGo, onRevert, onUndo, onCompare, onDone }: {
  changes: Change[]; index: number; source: "disk" | "commit" | "request" | undefined; unmapped: boolean; canUndo: boolean; onShowAll?: () => void;
  onGo: (index: number) => void; onRevert: () => void; onUndo: () => void; onCompare: () => void; onDone: () => void;
}) {
  const current = changes[index];
  return <section className="changes-banner changes-bar" aria-label="Changes to review">
    <span className="changes-summary" role="status">
      <strong>{changes.length} {changes.length === 1 ? "change" : "changes"}</strong> {source === "request" ? "during this request" : `since ${source === "commit" ? "the last commit" : "you last reviewed"}`}
      {current && <span className="changes-current" title={current.label}> · {index + 1}: {current.kind === "removed" ? "removed " : ""}{current.label || "blank lines"}</span>}
      {unmapped && <span> · These can’t be marked in this view. Use Compare or Source.</span>}
    </span>
    <button disabled={changes.length < 2} title="Previous change (⇧F8)" aria-label="Previous change" onClick={() => onGo((index - 1 + changes.length) % changes.length)}>Previous</button>
    <button disabled={!changes.length} title="Next change (F8)" aria-label="Next change" onClick={() => onGo((index + 1) % changes.length)}>Next</button>
    {canUndo
      ? <button onClick={onUndo}>Undo revert</button>
      : <button disabled={!current} title="Put this passage back in your draft. Nothing is written until you save." onClick={onRevert}>Revert this</button>}
    <button onClick={onCompare}>Compare</button>
    {onShowAll && <button title="Also mark what changed before this request" onClick={onShowAll}>All unreviewed</button>}
    <button onClick={onDone}>Mark reviewed</button>
  </section>;
}
