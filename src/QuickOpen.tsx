import { useEffect, useId, useState } from "react";
import { api, type ContentMatch } from "./api";
import Dialog from "./Dialog";

interface Result { path: string; match?: ContentMatch }

export default function QuickOpen({ workspace, open, find, close, initialContents = false }: {
  workspace: string;
  open: (path: string) => Promise<void>;
  // Opens the document and points at the matched text.
  find: (path: string, text: string) => Promise<void>;
  close: () => void;
  initialContents?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [contents, setContents] = useState(initialContents);
  const [results, setResults] = useState<{ items: Result[]; incomplete: boolean }>({ items: [], incomplete: false });
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(!!workspace);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const id = useId();
  const waiting = contents && !query.trim();
  useEffect(() => {
    if (!workspace) return;
    let valid = true;
    if (waiting) { setResults({ items: [], incomplete: false }); setLoading(false); setError(""); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      const search = contents
        ? api.searchContents(workspace, query).then(found => ({ items: found.matches.map(match => ({ path: match.path, match })), incomplete: found.incomplete }))
        : api.search(workspace, query).then(found => ({ items: found.paths.map(path => ({ path })), incomplete: found.incomplete }));
      void search.then((found) => {
        if (valid) { setResults(found); setSelected(0); setError(""); }
      }).catch((e) => { if (valid) { setError(String(e)); setResults({ items: [], incomplete: false }); } })
        .finally(() => { if (valid) setLoading(false); });
    }, contents ? 250 : 150);
    return () => { valid = false; clearTimeout(timer); };
  }, [workspace, query, contents, waiting]);
  useEffect(() => {
    document.getElementById(`${id}-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [id, selected]);
  const choose = async (result: Result) => {
    if (opening || loading) return;
    setOpening(true);
    try {
      if (result.match) await find(result.path, result.match.text);
      else await open(result.path);
      close();
    } catch (e) { setError(String(e)); }
    finally { setOpening(false); }
  };
  const count = results.items.length;
  const noun = contents ? (count === 1 ? "matching line" : "matching lines") : (count === 1 ? "match" : "matches");
  return <Dialog title={contents ? "Search in Files" : "Quick Open"} onClose={() => { if (!opening) close(); }} className="quick-open">
    {workspace ? <>
      <div className="quick-mode" role="group" aria-label="Search for">
        <button aria-pressed={!contents} disabled={opening} onClick={() => setContents(false)}>File names</button>
        <button aria-pressed={contents} disabled={opening} onClick={() => setContents(true)}>Contents</button>
      </div>
      <label className="field-label" htmlFor={`${id}-input`}>{contents ? "Text in documents" : "File name or path"}</label>
      <input id={`${id}-input`} autoFocus value={query} maxLength={128} disabled={opening}
        placeholder={contents ? "Search inside Markdown, HTML, and MDX…" : "Search Markdown, HTML, and MDX…"} role="combobox" aria-expanded="true"
        aria-controls={`${id}-results`} aria-autocomplete="list"
        aria-activedescendant={!loading && results.items[selected] ? `${id}-${selected}` : undefined}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setSelected((n) => Math.max(0, Math.min(count - 1, n + (e.key === "ArrowDown" ? 1 : -1))));
          }
          if (e.key === "Enter" && results.items[selected]) { e.preventDefault(); void choose(results.items[selected]); }
        }} />
      <p className="search-status" role="status">{waiting ? "Type text to find in this folder’s documents." : loading ? "Searching…" : error || (count ? `${count} ${noun}${results.incomplete ? " · Results limited; refine the search. Some files or folders were skipped." : ""}` : "No matching documents.")}</p>
      <ul id={`${id}-results`} className="quick-results" role="listbox" aria-label={contents ? "Matching lines" : "Matching files"} aria-busy={loading}>
        {results.items.map((result, index) => <li key={result.match ? `${result.path}:${result.match.line}` : result.path} role="none">
          <button id={`${id}-${index}`} role="option" aria-selected={selected === index} tabIndex={-1}
            disabled={loading || opening} onClick={() => void choose(result)} title={result.path}>
            <strong>{result.path.split("/").pop()}{result.match ? `:${result.match.line}` : ""}</strong>
            <span>{result.match ? result.match.snippet : result.path.slice(workspace.length + 1)}</span>
          </button>
        </li>)}
      </ul>
    </> : <p>Open a folder first. {contents ? "Search in Files" : "Quick Open"} searches only that authorized workspace.</p>}
    <div className="dialog-actions"><button disabled={opening} onClick={close}>Close</button></div>
  </Dialog>;
}
