import { useEffect, useState } from "react";
import { api, type RequestReport } from "./api";

const letters = { modified: "M", added: "A", removed: "D" };
const labels = { modified: "Changed", added: "New", removed: "Deleted" };
// Sidelit only knows the files differ from when the request was sent, not who changed them.
export default function RequestChanges({ id, root, onOpen, report: supplied }: { id: string; root?: string; onOpen: (path: string) => void; report?: RequestReport | null }) {
  const [loaded, setReport] = useState<RequestReport | null>();
  const report = supplied === undefined ? loaded : supplied;
  useEffect(() => {
    if (supplied !== undefined) return;
    let live = true;
    setReport(undefined);
    void api.requestChanges(id).then((next) => { if (live) setReport(next); }).catch(() => { if (live) setReport(null); });
    return () => { live = false; };
  }, [id, supplied]);
  if (report === undefined) return null;
  if (report === null) return <p className="request-changes">The change comparison is no longer available for this request. Document review marks are unchanged.</p>;
  const shown = (path: string) => root && path.startsWith(root + "/") ? path.slice(root.length + 1) : path.split("/").pop();
  const partial = report.incomplete ? " This folder was too large to check completely." : "";
  if (!report.files.length) return <p className="request-changes">No documents changed during this request.{partial}</p>;
  return <div className="request-changes">
    <p>Changed during this request, by Pi or anything else:{partial}</p>
    <ul>{report.files.map((file) => <li key={file.path}>
      {file.status === "removed"
        ? <span className="request-file" title={file.path}><span className="tree-name">{shown(file.path)}</span></span>
        : <button className="request-file" title={file.path} onClick={() => onOpen(file.path)}><span className="tree-name">{shown(file.path)}</span></button>}
      <span className={`git-mark ${file.status}`} title={labels[file.status]} aria-label={labels[file.status]}>{letters[file.status]}</span>
    </li>)}</ul>
  </div>;
}
