import { useEffect, useId, useState } from "react";
import { api, type SearchResults } from "./api";
import Dialog from "./Dialog";

export default function QuickOpen({ workspace, open, close }: {
  workspace: string;
  open: (path: string) => Promise<void>;
  close: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({ paths: [], incomplete: false });
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(!!workspace);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  useEffect(() => {
    if (!workspace) return;
    let valid = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void api.search(workspace, query).then((matches) => {
        if (valid) { setResults(matches); setSelected(0); setError(""); }
      }).catch((e) => { if (valid) { setError(String(e)); setResults({ paths: [], incomplete: false }); } })
        .finally(() => { if (valid) setLoading(false); });
    }, 150);
    return () => { valid = false; clearTimeout(timer); };
  }, [workspace, query]);
  useEffect(() => {
    document.getElementById(`${id}-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [id, selected]);
  const choose = async (path: string) => {
    if (opening || loading) return;
    setOpening(true);
    try { await open(path); close(); } catch (e) { setError(String(e)); }
    finally { setOpening(false); }
  };
  return <Dialog title="Quick Open" onClose={() => { if (!opening) close(); }} className="quick-open">
    {workspace ? <>
      <label className="field-label" htmlFor={`${id}-input`}>File name or path</label>
      <input id={`${id}-input`} autoFocus value={query} maxLength={128} disabled={opening}
        placeholder="Search Markdown files…" role="combobox" aria-expanded="true"
        aria-controls={`${id}-results`} aria-autocomplete="list"
        aria-activedescendant={!loading && results.paths[selected] ? `${id}-${selected}` : undefined}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setSelected((n) => Math.max(0, Math.min(results.paths.length - 1, n + (e.key === "ArrowDown" ? 1 : -1))));
          }
          if (e.key === "Enter" && results.paths[selected]) { e.preventDefault(); void choose(results.paths[selected]); }
        }} />
      <p className="search-status" role="status">{loading ? "Searching…" : error || (results.paths.length ? `${results.paths.length} ${results.paths.length === 1 ? "match" : "matches"}${results.incomplete ? " · Results limited; refine the search. Some folders may be unavailable." : ""}` : "No matching Markdown files.")}</p>
      <ul id={`${id}-results`} className="quick-results" role="listbox" aria-label="Matching files" aria-busy={loading}>
        {results.paths.map((path, index) => <li key={path} role="none">
          <button id={`${id}-${index}`} role="option" aria-selected={selected === index} tabIndex={-1}
            disabled={loading || opening} onClick={() => void choose(path)} title={path}>
            <strong>{path.split("/").pop()}</strong>
            <span>{path.slice(workspace.length + 1)}</span>
          </button>
        </li>)}
      </ul>
    </> : <p>Open a folder first. Quick Open searches only that authorized workspace.</p>}
    <div className="dialog-actions"><button disabled={opening} onClick={close}>Close</button></div>
  </Dialog>;
}
