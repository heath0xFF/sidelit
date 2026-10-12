import { useState } from "react";
import type { RecoveryStatus } from "./api";
import Dialog from "./Dialog";

export default function SessionDialog({ status, startup, restore, change, close, quit }: {
  status: RecoveryStatus;
  startup: boolean;
  restore: () => Promise<void>;
  change: (enabled: boolean) => Promise<void>;
  close: () => void;
  quit: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <Dialog title={startup ? "Restore your last session?" : "Session & Recovery"}
    onClose={() => { if (!busy) { if (startup) void run(quit); else close(); } }} className="session-dialog">
    {startup && <p>{status.count} open {status.count === 1 ? "tab" : "tabs"}, including {status.dirty} unsaved {status.dirty === 1 ? "draft" : "drafts"}. Saved {new Date(status.savedAt * 1000).toLocaleString()}.</p>}
    <p>Recovery is <strong>{status.enabled ? "on" : "off"}</strong>. When on, Sidelit keeps your tabs, workspace, and drafts on this computer. Original files still need an explicit Save.</p>
    <p>Only the latest session is kept, for 7 days after its last checkpoint. Limits: 100 tabs and 64 MiB. Recovery files use private OS permissions but are not encrypted. Edits after the last successful checkpoint can be lost in a crash. Checkpoints start every 500 ms; disk writes can delay them.</p>
    {error && <p className="dialog-error" role="alert">{error}</p>}
    <div className="session-actions">
      {startup && <button className="primary" disabled={busy} onClick={() => void run(restore)}>Restore session</button>}
      <button disabled={busy} onClick={() => void run(() => change(!status.enabled))}>
        {status.enabled ? "Turn off and delete saved session" : "Turn on recovery"}
      </button>
      {!status.enabled && <button disabled={busy} onClick={() => void run(() => change(false))}>Delete saved recovery data</button>}
    </div>
    <div className="dialog-actions"><button autoFocus disabled={busy} onClick={() => { if (startup) void run(quit); else close(); }}>
      {startup ? "Quit without changes" : "Close"}
    </button></div>
  </Dialog>;
}
