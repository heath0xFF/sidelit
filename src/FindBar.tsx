import { useEffect, useRef } from "react";
import { MAX_FIND_MATCHES } from "./find";

export default function FindBar({ query, count, index, focus, onQuery, onStep, onClose }: {
  query: string; count: number; index: number; focus: number;
  onQuery: (query: string) => void; onStep: (delta: number) => void; onClose: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focus]);
  return <section className="changes-banner find-bar" role="search" aria-label="Find in document">
    <input ref={input} type="text" value={query} placeholder="Find" aria-label="Find in document" spellCheck={false}
      onChange={event => onQuery(event.target.value)}
      onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); onStep(event.shiftKey ? -1 : 1); }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      }} />
    <span className="find-count" role="status">{query.trim() ? count ? `${Math.min(index, count - 1) + 1} of ${count}${count >= MAX_FIND_MATCHES ? "+" : ""}` : "No matches" : ""}</span>
    <button disabled={count < 2} title="Previous match (⇧⌘G)" onClick={() => onStep(-1)}>Previous</button>
    <button disabled={count < 2} title="Next match (⌘G)" onClick={() => onStep(1)}>Next</button>
    <button title="Close (Esc)" onClick={onClose}>Close</button>
  </section>;
}
