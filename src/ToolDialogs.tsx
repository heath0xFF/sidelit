import { useEffect, useId, useState } from "react";
import { api } from "./api";
import Dialog from "./Dialog";
import type { Document } from "./documents";
import { documentLinks, linkProblems, localLink, type LinkProblem } from "./links";

export function CompareDialog({ doc, compare, close }: {
  doc: Document;
  // Resolves once the comparison is shown; rejects with a message to show here.
  compare: (revision: string) => Promise<void>;
  close: () => void;
}) {
  const id = useId();
  const [revision, setRevision] = useState("HEAD~1");
  const [references, setReferences] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let valid = true;
    void api.gitReferences(doc.path).then(list => { if (valid) setReferences(list); }).catch(() => {});
    return () => { valid = false; };
  }, [doc.path]);
  const marked = !!doc.review;
  const submit = async () => {
    if (busy || marked || !revision.trim()) return;
    setBusy(true); setError("");
    try { await compare(revision.trim()); close(); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title="Compare with a Commit" onClose={() => { if (!busy) close(); }} className="tool-dialog">
    {marked
      ? <p>This document already has changes marked since {doc.reviewFrom === "commit" ? doc.reviewLabel ?? "the last commit" : "you last reviewed it"}. Choose <strong>Mark reviewed</strong> first, so those marks are not replaced.</p>
      : <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="field-label" htmlFor={`${id}-revision`}>Branch, tag, or commit</label>
        <input id={`${id}-revision`} autoFocus value={revision} maxLength={200} disabled={busy} list={`${id}-references`}
          spellCheck={false} autoCapitalize="off" onChange={(event) => setRevision(event.target.value)} />
        <datalist id={`${id}-references`}>{references.map(name => <option key={name} value={name} />)}</datalist>
        <p className="search-status">Marks what changed in this document since that version, read from Git without running any Git programs. Nothing is written.</p>
        {error && <p className="feedback-status error" role="alert">{error}</p>}
      </form>}
    <div className="dialog-actions">
      <button disabled={busy} onClick={close}>{marked ? "Close" : "Cancel"}</button>
      {!marked && <button className="primary" disabled={busy || !revision.trim()} onClick={() => void submit()}>{busy ? "Comparing…" : "Compare"}</button>}
    </div>
  </Dialog>;
}

export function LinkCheckDialog({ doc, go, close }: {
  doc: Document;
  go: (problem: LinkProblem) => void;
  close: () => void;
}) {
  const [state, setState] = useState<{ problems: LinkProblem[]; checked: number; error: string; loading: boolean }>({ problems: [], checked: 0, error: "", loading: true });
  useEffect(() => {
    let valid = true;
    const links = documentLinks(doc.text, doc.format).filter(link => localLink(link.reference));
    const files = [...new Set(links.map(link => link.reference).filter(reference => !reference.trim().startsWith("#")))];
    void (files.length ? api.linkTargets(doc.path, files) : Promise.resolve([]))
      .then(targets => { if (valid) setState({ problems: linkProblems(links, doc, targets), checked: links.length, error: "", loading: false }); })
      .catch(e => { if (valid) setState({ problems: [], checked: 0, error: String(e), loading: false }); });
    return () => { valid = false; };
  }, [doc.path, doc.text, doc.format]);
  const { problems, checked, error, loading } = state;
  return <Dialog title="Check Links" onClose={close} className="tool-dialog quick-open">
    <p className="search-status" role="status">{loading ? "Checking links…" : error || (checked
      ? problems.length ? `${problems.length} of ${checked} local ${checked === 1 ? "link needs" : "links need"} attention.` : `All ${checked} local ${checked === 1 ? "link works" : "links work"}.`
      : "This document has no local links. Web and email links are not checked.")}</p>
    {problems.length > 0 && <ul className="quick-results link-problems" aria-label="Links that need attention">
      {problems.map((problem, index) => <li key={index}>
        <button onClick={() => { go(problem); close(); }} title={problem.reference}>
          <strong>{problem.label || problem.reference} <span>· line {problem.line}</span></strong>
          <span>{problem.problem} · {problem.reference}</span>
        </button>
      </li>)}
    </ul>}
    <p className="search-status">Checks this document as it is now, including unsaved changes. Web links are not opened or checked.</p>
    <div className="dialog-actions"><button onClick={close}>Close</button></div>
  </Dialog>;
}
