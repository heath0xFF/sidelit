import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type Entry, type Snapshot, type RecoveryStatus, type AvailableUpdate } from "./api";
import {
  DEFAULT_FONT_SIZE,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  fontSize,
  savedFontSize,
  themePreference,
  resolvedTheme,
} from "./appearance";
import { Documents, dirty, type Document } from "./documents";
import { approveClose, approvalsCurrent, type CloseApproval } from "./closing";
import { RecoveryWriter, sessionSnapshot } from "./recovery";
import Dialog from "./Dialog";
import QuickOpen from "./QuickOpen";
import SessionDialog from "./SessionDialog";
import Rich, { disposeRich } from "./Rich";
import type { EditorHistory } from "./history";

let sourceModule: typeof import("./Source") | undefined;
const Source = lazy(async () => (sourceModule = await import("./Source")));
const documents = new Documents(api);
const name = (path: string) => path.split("/").pop() ?? path;

function Icon({
  type,
}: {
  type:
    | "folder"
    | "file"
    | "sidebar"
    | "chevron"
    | "close"
    | "sun"
    | "moon"
    | "system";
}) {
  const paths = {
    folder: "M3 6h6l2 2h10v11H3z",
    file: "M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6",
    sidebar: "M3 4h18v16H3z M9 4v16",
    chevron: "m9 5 7 7-7 7",
    close: "m6 6 12 12 M18 6 6 18",
    sun: "M12 2v2 M12 20v2 M2 12h2 M20 12h2 M4.93 4.93l1.42 1.42 M17.65 17.65l1.42 1.42 M4.93 19.07l1.42-1.42 M17.65 6.35l1.42-1.42",
    moon: "M20.9 13.1A9 9 0 0 1 10.9 3.1a7 7 0 1 0 10 10Z",
    system: "M3 4h18v12H3z M8 21h8 M12 16v5",
  };
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {type === "sun" && <circle cx="12" cy="12" r="4" />}
      <path d={paths[type]} />
    </svg>
  );
}

function Folder({
  path,
  level = 0,
  refresh,
  active,
  open,
}: {
  path: string;
  level?: number;
  refresh: number;
  active: string;
  open: (path: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    let valid = true;
    void api
      .list(path)
      .then((list) => {
        if (valid) {
          setEntries(list);
          setError("");
        }
      })
      .catch((e) => {
        if (valid) setError(String(e));
      });
    return () => {
      valid = false;
    };
  }, [path, refresh]);
  const toggle = (p: string) => {
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(p)) {
        next.delete(p);
        void api.collapse(p).catch(setError);
      } else next.add(p);
      return next;
    });
  };
  return (
    <ul className="tree-list">
      {entries.map((entry) => (
        <li key={entry.path}>
          <button
            className={`tree-row ${active === entry.path ? "selected" : ""}`}
            style={{ paddingLeft: 12 + level * 16 }}
            title={entry.path}
            aria-current={active === entry.path ? "page" : undefined}
            aria-expanded={
              entry.directory ? expanded.has(entry.path) : undefined
            }
            onClick={() =>
              entry.directory ? toggle(entry.path) : open(entry.path)
            }
          >
            {entry.directory ? (
              <span
                className={
                  expanded.has(entry.path) ? "chevron expanded" : "chevron"
                }
              >
                <Icon type="chevron" />
              </span>
            ) : (
              <span className="tree-indent" />
            )}
            <Icon type={entry.directory ? "folder" : "file"} />
            <span>{entry.name}</span>
          </button>
          {entry.directory && expanded.has(entry.path) && (
            <Folder
              path={entry.path}
              level={level + 1}
              refresh={refresh}
              active={active}
              open={open}
            />
          )}
        </li>
      ))}
      {error && (
        <li className="tree-error" role="status">
          Cannot read folder: {error}
        </li>
      )}
      {!entries.length && !error && (
        <li className="tree-empty">No Markdown files</li>
      )}
    </ul>
  );
}

type Prompt = {
  title: string;
  detail: string;
  choices: string[];
  resolve: (choice: string) => void;
};
function PromptDialog({
  prompt,
  done,
}: {
  prompt: Prompt;
  done: (choice: string) => void;
}) {
  return (
    <Dialog title={prompt.title} onClose={() => done("Cancel")}>
      <p>{prompt.detail}</p>
      <div className="dialog-actions">
        {prompt.choices.map((choice) => (
          <button
            key={choice}
            autoFocus={choice === "Cancel"}
            className={choice === "Save" ? "primary" : ""}
            onClick={() => done(choice)}
          >
            {choice}
          </button>
        ))}
      </div>
    </Dialog>
  );
}

export default function App() {
  const docs = useSyncExternalStore(documents.subscribe, documents.snapshot);
  const [active, setActive] = useState("");
  const [workspace, setWorkspace] = useState("");
  const [sidebar, setSidebar] = useState(true);
  const [width, setWidth] = useState(240);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<Prompt>();
  const [compare, setCompare] = useState<{ path: string; kind: "conflict" | "review"; disk: Snapshot } | null>(null);
  const [quick, setQuick] = useState(false);
  const [sessionDialog, setSessionDialog] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const initializedRef = useRef(false);
  const drainRef = useRef(() => {});
  const [locked, setLocked] = useState(false);
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [updateNotice, setUpdateNotice] = useState("");
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const checkingUpdateRef = useRef(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryStatus>({ enabled: false, available: false, savedAt: 0, count: 0, dirty: 0 });
  // The old theme key stored the resolved OS color, not an explicit preference.
  const [theme, setTheme] = useState(() =>
    themePreference(localStorage.getItem("themePreference")),
  );
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [size, setSize] = useState(() =>
    savedFontSize(localStorage.getItem("fontSize")),
  );
  const dark = resolvedTheme(theme, systemDark) === "dark";
  const changeSize = (delta: number) =>
    setSize((current) => fontSize(current + delta));
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const quitting = useRef(false);
  const modalBusy = useRef(false);
  const history = useRef<EditorHistory | null>(null);
  const report = useCallback((e: unknown) => setError(String(e)), []);
  const journal = useMemo(() => new RecoveryWriter(api.storeSession, report), [report]);
  const checkUpdates = useCallback(async (manual = false) => {
    if (checkingUpdateRef.current || quitting.current || !initializedRef.current) return;
    checkingUpdateRef.current = true;
    setCheckingUpdate(true);
    if (manual) setUpdateNotice("Checking for updates…");
    try {
      const available = await api.checkUpdate();
      setUpdate(available);
      if (available) setUpdateNotice(`Sidelit ${available.version} is available.`);
      else setUpdateNotice(manual ? "Sidelit is up to date." : "");
    } catch (e) {
      if (manual) setUpdateNotice(`Could not check for updates: ${String(e)}`);
    } finally {
      checkingUpdateRef.current = false;
      setCheckingUpdate(false);
    }
  }, []);
  useEffect(() => {
    if (!initialized) return;
    void checkUpdates();
    const timer = setInterval(() => void checkUpdates(), 24 * 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [initialized, checkUpdates]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const doc = docs.find((d) => d.path === active);
  const reason = doc?.reason;
  const mode = doc?.mode;
  const comparison = compare?.path === active ? compare : null;
  const ask = (title: string, detail: string, choices: string[]) =>
    new Promise<string>((resolve) =>
      setPrompt({ title, detail, choices, resolve }),
    );
  const root = async (path: string) => {
    await api.workspace(path);
    workspaceRef.current = path;
    setWorkspace(path);
    setSidebar(true);
  };
  const open = useCallback(async (path: string, source = false) => {
    const file = await api.open(path);
    documents.open(file, source ? "source" : "rendered");
    if (source) documents.setMode(file.path, "source");
    setActive(file.path);
    setCompare(null);
    if (!workspaceRef.current) await root(file.parent);
  }, []);
  const finishStartup = (enabled: boolean) => {
    if (enabled) journal.start();
    initializedRef.current = true;
    setInitialized(true);
    setSessionDialog(false);
    drainRef.current();
  };
  useEffect(() => {
    let valid = true;
    void api.recoveryStatus().then((status) => {
      if (!valid) return;
      setRecovery(status);
      if (status.available) setSessionDialog(true);
      else finishStartup(status.enabled);
    }).catch((e) => { if (valid) { report(e); finishStartup(false); } });
    return () => { valid = false; void journal.stop(); };
  }, [journal, report]);
  useEffect(() => {
    if (initialized && !quitting.current) journal.queue(sessionSnapshot(documents, workspace, active));
  }, [docs, workspace, active, initialized, journal]);
  const changeRecovery = async (enabled: boolean) => {
    await journal.stop();
    try {
      const status = await api.setRecovery(enabled);
      setRecovery(status);
      if (enabled) {
        journal.start();
        await journal.flush(sessionSnapshot(documents, workspaceRef.current, activeRef.current));
      }
      if (!initializedRef.current) finishStartup(enabled);
    } catch (e) {
      if (recovery.enabled && initializedRef.current) journal.start();
      throw e;
    }
  };
  const restore = async () => {
    const session = await api.restoreSession();
    if (!session) return;
    for (const saved of session.documents) documents.restore(saved);
    if (session.workspace) await root(session.workspace).catch(report);
    setActive(session.active ?? documents.docs.at(-1)?.path ?? "");
    await Promise.all(documents.docs.map((d) => documents.refresh(d.path)));
    finishStartup(recovery.enabled);
  };
  useEffect(() => {
    let stopped = false;
    const off: (() => void)[] = [];
    let requests = Promise.resolve();
    const drain = () => {
      if (!initializedRef.current) return;
      requests = requests
        .then(async () => {
          for (const request of await api.ready()) {
            if (stopped) return;
            try {
              if (request.directory) await root(request.path);
              else await open(request.path, request.source);
            } catch (e) {
              report(e);
            }
          }
        })
        .catch(report);
    };
    void (async () => {
      off.push(await listen("open-requests", drain));
      off.push(
        await listen("disk-changed", () => {
          setRefresh((n) => n + 1);
          for (const d of documents.docs) void documents.refresh(d.path);
        }),
      );
      off.push(
        await listen<string>("service-error", (event) => report(event.payload)),
      );
      if (stopped) off.forEach((fn) => fn());
      else { drainRef.current = drain; drain(); }
    })().catch(report);
    return () => {
      stopped = true;
      drainRef.current = () => {};
      off.forEach((fn) => fn());
    };
  }, [open, report]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.style.setProperty(
      "--document-font-size",
      `${size}px`,
    );
  }, [dark, size]);
  useEffect(() => {
    localStorage.setItem("themePreference", theme);
  }, [theme]);
  useEffect(() => {
    localStorage.setItem("fontSize", String(size));
  }, [size]);
  const save = async (d = doc) => {
    if (!d) return false;
    try {
      const reviewed = comparison?.kind === "conflict" && comparison.path === d.path ? comparison.disk : undefined;
      const saved = await documents.save(d.path, reviewed);
      if (saved && reviewed) setCompare(null);
      return saved;
    } catch (e) {
      report(e);
      return false;
    }
  };
  const chooseClose = (d: Document) => {
    setActive(d.path);
    setCompare(null);
    return ask(`Save changes to ${name(d.path)}?`,
      "Your unsaved changes will be lost if you discard this draft.", ["Discard", "Cancel", "Save"]);
  };
  const close = async (d: Document) => {
    if (modalBusy.current || quitting.current) return;
    modalBusy.current = true;
    setLocked(true);
    try {
      const approval = await approveClose(documents, d.path, chooseClose);
      if (!approval) return;
      if (!approvalsCurrent(documents, [approval])) throw new Error("The draft changed. Try closing again.");
      documents.remove(d.path);
      sourceModule?.disposeSource(d.path);
      requestAnimationFrame(() => { if (!documents.get(d.path)) disposeRich(d.path); });
      setActive((current) => current === d.path ? documents.docs.at(-1)?.path ?? "" : current);
      setCompare(null);
      await api.close(d.path);
      await journal.flush(sessionSnapshot(documents, workspaceRef.current, activeRef.current));
    } catch (e) { report(e); }
    finally { modalBusy.current = false; setLocked(false); }
  };
  const quit = async (updateVersion?: string) => {
    if (!initializedRef.current) { await api.quit(); return; }
    if (quitting.current || modalBusy.current) return;
    quitting.current = true;
    setLocked(true);
    setQuick(false);
    setSessionDialog(false);
    let exiting = false;
    try {
      const approvals: CloseApproval[] = [];
      for (const path of documents.docs.map((d) => d.path)) {
        const approval = await approveClose(documents, path, chooseClose);
        if (!approval) return;
        approvals.push(approval);
      }
      if (!approvalsCurrent(documents, approvals, true)) throw new Error("The session changed during Quit. Try again.");
      await journal.flush(sessionSnapshot(documents, workspaceRef.current, activeRef.current, approvals));
      if (!approvalsCurrent(documents, approvals, true)) throw new Error("The session changed during Quit. Try again.");
      if (updateVersion) {
        setInstallingUpdate(true);
        await api.installUpdate(updateVersion);
      } else await api.quit();
      exiting = true;
    } catch (e) { report(e); }
    finally {
      if (!exiting) {
        quitting.current = false;
        setLocked(false);
        setInstallingUpdate(false);
        journal.queue(sessionSnapshot(documents, workspaceRef.current, activeRef.current));
      }
    }
  };
  const quitRef = useRef(quit);
  quitRef.current = quit;
  const actionRef = useRef((action: string) => {});
  actionRef.current = (action) => {
    if (action === "quit") { void quit(); return; }
    if (action === "undo" || action === "redo") {
      if (locked || !initialized) return;
      const focused = document.activeElement;
      if (focused?.matches("input, textarea") && !focused.matches(".monaco-editor .inputarea")) {
        // WebKit history is document-wide; a field must not undo another editor.
        const fieldOnly = (event: Event) => { if (event.target !== focused) event.preventDefault(); };
        document.addEventListener("beforeinput", fieldOnly, true);
        try { document.execCommand(action); }
        finally { document.removeEventListener("beforeinput", fieldOnly, true); }
      } else if (!prompt && !quick && !sessionDialog) history.current?.(action);
      return;
    }
    if (prompt || quick || sessionDialog || locked || !initialized) return;
    if (action === "new") void newFile();
    if (action === "save-as") void copy(false);
    if (action === "quick") setQuick(true);
    if (action === "session") setSessionDialog(true);
    if (action === "updates") void checkUpdates(true);
    if (action === "close" && doc) void close(doc);
    if (action === "save") void save();
    if (action === "open" || action === "folder")
      void api.choose(action === "folder").catch(report);
  };
  useEffect(() => {
    const quitEvent = listen("request-quit", () => void quitRef.current());
    const menuEvent = listen<string>("menu-action", (event) =>
      actionRef.current(event.payload),
    );
    return () => {
      void quitEvent.then((fn) => fn());
      void menuEvent.then((fn) => fn());
    };
  }, []);
  const reload = async () => {
    if (!doc || modalBusy.current || quitting.current) return;
    modalBusy.current = true;
    try {
      if (
        dirty(doc) &&
        (await ask(
          "Discard this draft and reload?",
          "Reload replaces your unsaved draft with the current disk version. Use Save Copy to keep it first.",
          ["Cancel", "Discard and Reload"],
        )) !== "Discard and Reload"
      )
        return;
      await documents.refresh(doc.path, true);
      setCompare(null);
    } catch (e) {
      report(e);
    } finally {
      modalBusy.current = false;
    }
  };
  const newFile = async () => {
    if (modalBusy.current || quitting.current) return;
    modalBusy.current = true;
    try {
      const file = await api.copy(null, "");
      if (!file) return;
      documents.open(file);
      setActive(file.path);
      setCompare(null);
      if (!workspaceRef.current) await root(file.parent);
    } catch (e) { report(e); }
    finally { modalBusy.current = false; }
  };
  const copy = async (resolveConflict: boolean) => {
    if (!doc || modalBusy.current || quitting.current) return;
    modalBusy.current = true;
    try {
      const file = await api.copy(doc.path, doc.text);
      if (!file) return;
      documents.open(file, doc.mode);
      setActive(file.path);
      setCompare(null);
      if (resolveConflict) {
        if (documents.get(doc.path)?.revision === doc.revision)
          await documents.refresh(doc.path, true);
        else report("Copy saved. The original draft has newer edits and was kept.");
      }
    } catch (e) {
      report(e);
    } finally {
      modalBusy.current = false;
    }
  };
  const toggleMode = () => {
    if (doc) {
      documents.setMode(doc.path, mode === "source" ? "rendered" : "source");
      setCompare(null);
    }
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        actionRef.current(e.shiftKey ? "redo" : "undo");
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || prompt || quick || sessionDialog || locked || !initialized) return;
      const k = e.key.toLowerCase();
      if (!e.altKey && ["+", "=", "-", "0"].includes(k)) {
        e.preventDefault();
        e.stopPropagation();
        if (k === "0") setSize(DEFAULT_FONT_SIZE);
        else changeSize(k === "-" ? -1 : 1);
        return;
      }
      if (["s", "o", "w", "q", "n", "p", "\\"].includes(k)) e.preventDefault();
      else return;
      if (k === "n") void newFile();
      if (k === "p") setQuick(true);
      if (k === "s") { if (e.shiftKey) void copy(false); else void save(); }
      if (k === "o") void api.choose(e.shiftKey).catch(report);
      if (k === "w" && doc) void close(doc);
      if (k === "q") void quit();
      if (k === "\\") toggleMode();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  });
  const resize = (e: React.PointerEvent) => {
    const start = e.clientX;
    const initial = width;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (event: PointerEvent) =>
      setWidth(Math.max(170, Math.min(440, initial + event.clientX - start)));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  return (
    <div className="app" inert={locked || !initialized}>
      <header className="toolbar">
        <button
          className="icon-button"
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          aria-expanded={sidebar}
          onClick={() => setSidebar(!sidebar)}
        >
          <Icon type="sidebar" />
        </button>
        <div className="brand">
          Sidelit
          <span className="brand-dot" />
        </div>
        <div className="toolbar-divider" />
        <button onClick={() => void api.choose(false).catch(report)} title="⌘O">
          Open File
        </button>
        <button className="open-folder" onClick={() => void api.choose(true).catch(report)} title="⇧⌘O">
          Open Folder
        </button>
        <details className="app-menu">
          <summary>Actions</summary>
          <div className="app-menu-items" onClick={(event) => event.currentTarget.closest("details")?.removeAttribute("open")}>
            <button onClick={() => void newFile()}>New File… <kbd>⌘N</kbd></button>
            <button disabled={!doc} onClick={() => void copy(false)}>Save As… <kbd>⇧⌘S</kbd></button>
            <button onClick={() => setQuick(true)}>Quick Open… <kbd>⌘P</kbd></button>
            <button onClick={() => void api.choose(true).catch(report)}>Open Folder…</button>
            <button onClick={() => setSessionDialog(true)}>Session & Recovery…</button>
            <button disabled={checkingUpdate} onClick={() => void checkUpdates(true)}>Check for Updates…</button>
          </div>
        </details>
        <div className="toolbar-title" title={doc?.path}>
          {doc ? name(doc.path) : "Markdown, beside your work."}
        </div>
        {doc && (
          <div className="mode-switch" aria-label="Editing mode">
            <button
              aria-pressed={mode === "rendered"}
              disabled={!!reason}
              title={reason ?? "Rendered editing (⌘\\)"}
              onClick={() => {
                documents.setMode(doc.path, "rendered");
                setCompare(null);
              }}
            >
              Rendered
            </button>
            <button
              aria-pressed={mode === "source"}
              onClick={() => {
                documents.setMode(doc.path, "source");
                setCompare(null);
              }}
            >
              Source
            </button>
          </div>
        )}
        {doc && (
          <button
            className="save-button"
            disabled={doc.saving}
            onClick={() => void save()}
            title="⌘S"
          >
            {doc.saving ? "Saving…" : comparison?.kind === "conflict" ? "Save Merged" : "Save"}
          </button>
        )}
        <div
          className="font-controls"
          role="group"
          aria-label="Document font size"
        >
          <button
            aria-label="Decrease font size"
            title="Decrease font size (⌘− / Ctrl+−)"
            disabled={size === MIN_FONT_SIZE}
            onClick={() => changeSize(-1)}
          >
            A−
          </button>
          <button
            className="font-size-value"
            aria-label={`Font size ${size} pixels. Reset to ${DEFAULT_FONT_SIZE}`}
            title="Reset font size (⌘0 / Ctrl+0)"
            onClick={() => setSize(DEFAULT_FONT_SIZE)}
          >
            {size}px
          </button>
          <button
            aria-label="Increase font size"
            title="Increase font size (⌘+ / Ctrl++)"
            disabled={size === MAX_FONT_SIZE}
            onClick={() => changeSize(1)}
          >
            A+
          </button>
        </div>
        <label className="theme-control" title="Color theme">
          <Icon type={theme === "system" ? "system" : dark ? "moon" : "sun"} />
          <select
            aria-label="Theme"
            value={theme}
            onChange={(event) => setTheme(themePreference(event.target.value))}
          >
            <option value="system">System</option>
            <option value="light">One Light</option>
            <option value="dark">One Dark</option>
          </select>
        </label>
      </header>
      <div className="layout">
        {sidebar && (
          <>
            <aside
              className="sidebar"
              style={{ width }}
              aria-label="Folder browser"
            >
              <div className="workspace-heading">
                <Icon type="folder" />
                <span title={workspace}>
                  {workspace ? name(workspace) : "No folder open"}
                </span>
              </div>
              {workspace ? (
                <Folder
                  key={workspace}
                  path={workspace}
                  refresh={refresh}
                  active={active}
                  open={(p) => void open(p).catch(report)}
                />
              ) : (
                <div className="sidebar-empty">
                  <p>Keep your documents in view.</p>
                  <button onClick={() => void api.choose(true).catch(report)}>
                    Open a folder
                  </button>
                </div>
              )}
              <div className="sidebar-footer">Local files. Yours to keep.</div>
            </aside>
            <div
              className="resize-handle"
              role="separator"
              aria-label="Sidebar width"
              aria-orientation="vertical"
              aria-valuemin={170}
              aria-valuemax={440}
              aria-valuenow={width}
              tabIndex={0}
              onPointerDown={resize}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  setWidth(
                    Math.max(
                      170,
                      Math.min(
                        440,
                        width + (e.key === "ArrowRight" ? 10 : -10),
                      ),
                    ),
                  );
                }
              }}
            />
          </>
        )}
        <main className="main">
          {docs.length > 0 && (
            <nav className="tabs" aria-label="Open documents">
              {docs.map((d) => (
                <div
                  className={`tab ${d.path === active ? "active" : ""}`}
                  key={d.path}
                >
                  <button
                    title={d.path}
                    aria-current={d.path === active ? "page" : undefined}
                    onClick={() => {
                      setActive(d.path);
                      setCompare(null);
                    }}
                  >
                    <Icon type="file" />
                    <span>{name(d.path)}</span>
                    {dirty(d) && (
                      <span
                        className="dirty-dot"
                        aria-label="Unsaved changes"
                      />
                    )}
                  </button>
                  <button
                    className="tab-close"
                    aria-label={`Close ${name(d.path)}`}
                    onClick={() => void close(d)}
                  >
                    <Icon type="close" />
                  </button>
                </div>
              ))}
            </nav>
          )}
          {updateNotice && <section className="changes-banner" role="status">
            <span>{updateNotice}</span>
            {update && <button disabled={checkingUpdate} onClick={() => void quit(update.version)}>Install & Restart</button>}
            <button onClick={() => setUpdateNotice("")}>Dismiss</button>
          </section>}
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <Icon type="close" />
              </button>
            </div>
          )}
          {doc ? (
            <>
              {doc.pending && (
                <section className="conflict" role="status">
                  <div>
                    <strong>
                      {doc.pending.error
                        ? "File unavailable"
                        : "The file changed on disk"}
                    </strong>
                    <p>
                      {doc.pending.error ??
                        "Your draft is safe. Compare the versions or save a copy before reloading."}
                    </p>
                  </div>
                  <div className="conflict-actions">
                    <button
                      disabled={!doc.pending.snapshot}
                      onClick={() => setCompare(comparison ? null : doc.pending?.snapshot ? { path: doc.path, kind: "conflict", disk: doc.pending.snapshot } : null)}
                    >
                      {comparison ? "Back to draft" : "Compare"}
                    </button>
                    <button onClick={() => void reload()}>
                      Reload from Disk
                    </button>
                    <button onClick={() => void copy(true)}>Save Copy</button>
                  </div>
                </section>
              )}
              {doc.review && !doc.pending && !comparison && <section className="changes-banner">
                <span>Updated from disk. Review the latest external change.</span>
                <button onClick={() => setCompare({ path: doc.path, kind: "review", disk: doc.review! })}>Review changes</button>
                <button onClick={() => documents.update(doc.path, { review: undefined })}>Dismiss</button>
              </section>}
              {mode === "rendered" && /^(---|\+\+\+)[ \t]*\r?\n/.test(doc.text) && !comparison && <div className="fidelity-note">Frontmatter is kept unchanged. Use Source to edit metadata.</div>}
              {reason && !comparison && (
                <div className="fidelity-note">
                  {reason} No content has been removed.
                </div>
              )}
              {comparison ? (
                <>
                  <div className="comparison-help">
                    <span>{comparison.kind === "conflict" ? "Edit your draft or use a change arrow to take disk text. Save Merged checks the disk again before writing." : "The previous disk version and your current text. Both panes are read only."}</span>
                    {comparison.kind === "conflict" && doc.pending?.snapshot && doc.pending.snapshot.hash !== comparison.disk.hash && <button onClick={() => setCompare({ ...comparison, disk: doc.pending!.snapshot! })}>Refresh disk pane</button>}
                    {(!doc.pending || comparison.kind === "review") && <button onClick={() => setCompare(null)}>Back to draft</button>}
                  </div>
                  <div className="compare-labels">
                    <span>{comparison.kind === "review" ? "Previous disk version" : doc.pending?.error ? "Last available disk version" : "Reviewed disk version"} · read only</span>
                    <span>{comparison.kind === "review" ? "Current text · read only" : "Your draft · editable"}</span>
                  </div>
                  <Suspense
                    fallback={
                      <div className="loading">Loading comparison…</div>
                    }
                  >
                    <Source
                      key={`${doc.path}:${comparison.kind}`}
                      path={doc.path}
                      text={doc.text}
                      original={comparison.disk.text}
                      dark={dark}
                      fontSize={size}
                      readOnly={comparison.kind === "review"}
                      history={history}
                      onChange={(text) => documents.edit(doc.path, text)}
                    />
                  </Suspense>
                </>
              ) : mode === "source" ? (
                <Suspense
                  fallback={
                    <div className="loading">Loading source editor…</div>
                  }
                >
                  <Source
                    key={doc.path}
                    path={doc.path}
                    text={doc.text}
                    dark={dark}
                    fontSize={size}
                    history={history}
                    onChange={(text) => documents.edit(doc.path, text)}
                  />
                </Suspense>
              ) : (
                <Rich
                  key={doc.path}
                  path={doc.path}
                  text={doc.text}
                  onChange={(text) => documents.edit(doc.path, text)}
                  onError={report}
                  history={history}
                />
              )}
              <footer className="statusbar">
                <span title={doc.path}>{doc.path}</span>
                <span role="status">
                  {doc.pending
                    ? "Disk conflict"
                    : dirty(doc)
                      ? "Unsaved changes"
                      : doc.notice || "All changes saved"}
                </span>
                <span>{doc.text.includes("\r\n") ? "CRLF" : "LF"} · UTF-8</span>
              </footer>
            </>
          ) : (
            <section className="empty">
              <div className="empty-mark" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <h1>
                A little space
                <br />
                for your next thought.
              </h1>
              <p>
                Read what your agent wrote.
                <br />
                Make it your own, right on the page.
              </p>
              <div className="empty-actions">
                <button onClick={() => void newFile()}>New Markdown file</button>
                <button
                  className="primary"
                  onClick={() => void api.choose(false).catch(report)}
                >
                  Open a Markdown file
                </button>
                <button onClick={() => void api.choose(true).catch(report)}>
                  Browse a folder
                </button>
              </div>
              <div className="cli-hint">
                Or, from your terminal<code>sidelit path/to/notes.md</code>
              </div>
              <p className="empty-note">
                Rendered editing. Source when you need it.
                <br />
                External changes, without losing your draft.
              </p>
            </section>
          )}
        </main>
      </div>
      {installingUpdate && <Dialog title="Installing update" onClose={() => {}}>
        <p role="status">Downloading, checking the signature, and installing. Sidelit will restart when finished.</p>
        <p>Keep Sidelit open. The download can take up to two minutes. macOS may ask for permission to replace the app.</p>
      </Dialog>}
      {quick && <QuickOpen workspace={workspace} open={open} close={() => setQuick(false)} />}
      {sessionDialog && <SessionDialog status={recovery} startup={!initialized} restore={restore}
        change={changeRecovery} close={() => setSessionDialog(false)} quit={api.quit} />}
      {prompt && (
        <PromptDialog
          prompt={prompt}
          done={(choice) => {
            const resolve = prompt.resolve;
            setPrompt(undefined);
            resolve(choice);
          }}
        />
      )}
    </div>
  );
}
