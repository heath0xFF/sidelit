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
import { api, type AgentTarget, type Entry, type GitFile, type Snapshot, type RecoveryStatus, type AvailableUpdate } from "./api";
import ChangesBar from "./ChangesBar";
import { computeChanges, draftChanges, revertChange } from "./changes";
import { Baselines } from "./baselines";
import FindBar from "./FindBar";
import WalkBar from "./WalkBar";
import { extendWalk, isWalk, stepWalk, type Walk, type WalkStop } from "./walk";
import Outline from "./Outline";
import { headingForAnchor, headings, type Heading } from "./headings";
import type { Jump } from "./jump";
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
import { approveClose, approvalsCurrent, approveFeedbackClose, feedbackApprovalCurrent, type CloseApproval, type FeedbackCloseState } from "./closing";
import { RecoveryWriter, sessionSnapshot } from "./recovery";
import Dialog from "./Dialog";
import QuickOpen from "./QuickOpen";
import { CompareDialog, LinkCheckDialog } from "./ToolDialogs";
import SessionDialog from "./SessionDialog";
import Rich, { disposeRich } from "./Rich";
import type { EditorHistory } from "./history";
import { feedbackSelection, type FeedbackMessage, type SelectionContext, type FeedbackIntent, type SelectionRect } from "./inspection";
import SelectionActions from './SelectionActions';
import Preview from "./Preview";
import FeedbackComposer from "./FeedbackComposer";
import RequestsPanel from './RequestsPanel';
import { Requests, selectRequest } from './requests';
import ReviewPanel from './ReviewPanel';
import { notesMarkdown, ReviewNotes } from './review';
import DevServerDialog from "./DevServerDialog";
import { chooseTarget } from './agent-targets';
import { forgetPreviewPosition } from './preview-position';
import lightIcon from "../scripts/icon.svg";
import darkIcon from "../scripts/icon-dark.svg";

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
    | "system"
    | "open"
    | "server"
    | "inspect"
    | "feedback"
    | "notes";
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
    open: "M3 7h6l2 2h9l-3 11H3z M3 7V4h7l2 2h8v3",
    server: "M3 4h18v16H3z M3 9h18 M7 6.5h.01 M10 6.5h.01 M9 12l-3 2.5 3 2.5 M15 12l3 2.5-3 2.5",
    inspect: "M8 3H3v5 M16 3h5v5 M3 16v5h5 M8 8l5 13 2-6 6-2z",
    feedback: "M4 4h16v12H9l-5 4z M8 8h8 M8 12h5",
    notes: "M4 5h2v2H4z M10 6h10 M4 11h2v2H4z M10 12h10 M4 17h2v2H4z M10 18h10",
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

function GitMark({ status }: { status?: GitFile["status"] | "folder" }) {
  if (!status) return null;
  const label = status === "added" ? "Git: new, not committed" : status === "modified" ? "Git: changed since the last commit" : "Git: contains changed documents";
  return <span className={`git-mark ${status}`} title={label} aria-label={label}>{status === "added" ? "A" : status === "modified" ? "M" : ""}</span>;
}

function Folder({
  path,
  level = 0,
  refresh,
  active,
  open,
  git,
}: {
  path: string;
  level?: number;
  refresh: number;
  active: string;
  open: (path: string) => void;
  git: Map<string, GitFile["status"] | "folder">;
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
            <span className="tree-name">{entry.name}</span>
            <GitMark status={git.get(entry.path)} />
          </button>
          {entry.directory && expanded.has(entry.path) && (
            <Folder
              path={entry.path}
              level={level + 1}
              refresh={refresh}
              active={active}
              open={open}
              git={git}
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
        <li className="tree-empty">No previewable documents</li>
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
  const cancel = useRef<HTMLButtonElement>(null);
  // Focus after showModal; mount-time autofocus runs while the app is inert.
  useEffect(() => { cancel.current?.focus(); }, [prompt]);
  return (
    <Dialog title={prompt.title} onClose={() => done("Cancel")}>
      <p>{prompt.detail}</p>
      <div className="dialog-actions">
        {prompt.choices.map((choice) => (
          <button
            key={choice}
            ref={choice === "Cancel" ? cancel : undefined}
            className={choice === "Save" || choice === "Save to Notes" ? "primary" : ""}
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
  const actionsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) {
        actionsRef.current?.removeAttribute("open");
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  const [width, setWidth] = useState(240);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState<Prompt>();
  const [compare, setCompare] = useState<{ path: string; kind: "conflict" | "review"; disk: Snapshot } | null>(null);
  const [quick, setQuick] = useState<false | "names" | "contents">(false);
  const [tool, setTool] = useState<"compare" | "links">();
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
  const [inspect, setInspect] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const requests = useMemo(() => new Requests(api), []);
  const requestHistory = useSyncExternalStore(requests.subscribe, requests.snapshot);
  const feedbackAttempt = requestHistory.find(item => item.context.id === feedback?.id);
  const feedbackAck = feedbackAttempt?.ack;
  const unsentFeedback = !!feedback && !feedbackAttempt;
  const settledRequests = requestHistory.filter(item => item.ack?.status === 'settled').map(item => item.context.id).join(',');
  useEffect(() => {
    const timer = setInterval(requests.poll, 1500);
    return () => clearInterval(timer);
  }, [requests]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewEditingId, setReviewEditingId] = useState<string>();
  const feedbackRef = useRef<FeedbackCloseState>({ message: null, attempted: false });
  feedbackRef.current = { message: feedback, editingId: reviewEditingId, attempted: !!feedback && !unsentFeedback };
  const [reviewAttachmentId, setReviewAttachmentId] = useState<string>();
  const reviews = useMemo(() => new ReviewNotes(api), []);
  const reviewState = useSyncExternalStore(reviews.subscribe, reviews.snapshot);
  useEffect(() => { void reviews.load(); }, [reviews]);
  const [candidate, setCandidate] = useState<FeedbackMessage | null>(null);
  const [feedbackAnchor, setFeedbackAnchor] = useState<SelectionRect>();
  const [reveal, setReveal] = useState(0);
  const [jump, setJump] = useState<Jump>();
  const jumps = useRef(0);
  const [sidebarView, setSidebarView] = useState<"files" | "outline" | "changed" | "requests">("files");
  const [gitFiles, setGitFiles] = useState<GitFile[]>([]);
  const [changeNav, setChangeNav] = useState({ index: 0, nonce: 0 });
  const [changesUnmapped, setChangesUnmapped] = useState(false);
  const [reverted, setReverted] = useState<{ path: string; before: string; after: string }>();
  // Narrows the marks to one request; the document's own baseline stays underneath.
  const [requestScope, setRequestScope] = useState<{ path: string; before: Snapshot }>();
  const [find, setFind] = useState({ open: false, query: "", index: 0, nonce: 0, focus: 0 });
  const [findCount, setFindCount] = useState(0);
  const [walk, setWalk] = useState<Walk>();
  const walkRef = useRef(walk);
  walkRef.current = walk;
  const [editing, setEditing] = useState(false);
  const [selection, setSelection] = useState<SelectionContext | null>(null);
  const selectionSnapshot = useRef<FeedbackMessage | null>(null);
  const [previewRefresh, setPreviewRefresh] = useState(0);
  const [targetRefresh, setTargetRefresh] = useState(0);
  const [targetsLoading, setTargetsLoading] = useState(false);
  const [targetError, setTargetError] = useState('');
  const [targets, setTargets] = useState<AgentTarget[]>([]);
  const [targetId, setTargetId] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const [serverDialog, setServerDialog] = useState(false);
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
  const resolved = resolvedTheme(theme, systemDark);
  const dark = resolved !== "light";
  const changeSize = (delta: number) =>
    setSize((current) => fontSize(current + delta));
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const quitting = useRef(false);
  const modalBusy = useRef(false);
  const history = useRef<EditorHistory | null>(null);
  const report = useCallback((e: unknown) => setError(String(e)), []);
  const journal = useMemo(() => new RecoveryWriter(api.storeSession, report), [report]);
  const baselines = useMemo(() => new Baselines(documents, api, report), [report]);
  useEffect(() => { baselines.sync(); }, [baselines, docs]);
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
  const scope = requestScope?.path === doc?.path ? requestScope : undefined;
  const reviewBase = scope?.before ?? doc?.review;
  const changeSet = useMemo(() => reviewBase ? computeChanges(reviewBase.text, doc!.text, doc!.format) : undefined, [reviewBase?.text, doc?.text, doc?.format]);
  const findable = doc?.format === "markdown" && mode === "rendered" && !comparison && !serverUrl;
  const outline = useMemo(() => doc && !serverUrl && sidebarView === "outline" ? headings(doc.text, doc.format) : [], [doc?.text, doc?.format, serverUrl, sidebarView]);
  const gitMarks = useMemo(() => {
    const marks = new Map<string, GitFile["status"] | "folder">();
    for (const file of gitFiles) {
      marks.set(file.path, file.status);
      for (let at = file.path.lastIndexOf("/"); at > workspace.length; at = file.path.lastIndexOf("/", at - 1)) marks.set(file.path.slice(0, at), "folder");
    }
    return marks;
  }, [gitFiles, workspace]);
  const feedbackDoc = feedback?.document.path ? docs.find(d => d.path === feedback.document.path) : undefined;
  const feedbackDraft = useMemo(() => feedbackDoc && dirty(feedbackDoc) ? draftChanges(feedbackDoc.disk.text, feedbackDoc.text, feedbackDoc.format) : undefined, [feedbackDoc?.disk.text, feedbackDoc?.text, feedbackDoc?.format]);
  const projectRoot = (!doc || !workspace || doc.path.startsWith(workspace + '/') ? workspace : '') || doc?.path.split("/").slice(0, -1).join("/") || undefined;
  const captureFeedback = (selection: SelectionContext, intent: FeedbackIntent): FeedbackMessage => {
    const document = serverUrl
      ? { url: selection.pageUrl ?? serverUrl, format: "url" as const }
      : doc
        ? { path: doc.path, format: doc.format, revision: doc.revision, diskHash: doc.disk.hash, unsaved: dirty(doc) }
        : { format: "url" as const, url: serverUrl };
    return {
      id: globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + "-" + String(Math.random()),
      source: "sidelit",
      projectRoot,
      document: { ...document, capturedAt: new Date().toISOString() },
      selection: { ...feedbackSelection(selection), anchorText: selection.anchorText },
      instruction: "",
      intent,
    };
  };
  const captureSelection = (selected: SelectionContext | null) => {
    selectionSnapshot.current = selected ? captureFeedback(selected, 'edit') : null;
    if (selected && feedbackAttempt) setFeedbackOpen(false);
    setSelection(selected);
  };
  const openFeedback = (selected: SelectionContext, intent: FeedbackIntent = 'edit') => {
    const next = selected === selection && selectionSnapshot.current
      ? { ...selectionSnapshot.current, intent } : captureFeedback(selected, intent);
    const opened = selectRequest(feedback, next, !!feedbackAttempt);
    if (opened.feedback !== feedback) { setFeedback(opened.feedback); setFeedbackAnchor(selected.rect); setReviewEditingId(undefined); }
    setCandidate(opened.candidate);
    setFeedbackOpen(true);
    setReviewOpen(false);
    setReviewAttachmentId(undefined);
    setInspect(false);
    setSelection(null);
  };
  const resumeFeedback = () => {
    if (!feedback) { openFeedback(selection ?? { type: 'document', text: '' }); return; }
    setFeedbackOpen(true); setReviewOpen(false); setReviewAttachmentId(undefined); setInspect(false); setSelection(null);
  };
  const dismissFeedback = () => { setFeedbackOpen(false); setReviewAttachmentId(undefined); setSelection(null); setInspect(false); window.getSelection()?.removeAllRanges(); };
  const clearFeedback = () => {
    feedbackRef.current = { message: null, attempted: false };
    setFeedback(null); setCandidate(null); setReviewEditingId(undefined); dismissFeedback();
  };
  const previewShortcut = (key: string) => {
    if (key === 'i') setInspect(value => !value);
    if (key === 'f') resumeFeedback();
    if (key === 'r') { setPreviewRefresh(value => value + 1); if (doc) void documents.refresh(doc.path); }
    if (key === 'e') setSidebar(value => !value);
  };
  useEffect(() => { setSelection(null); setInspect(false); setEditing(false); setFeedbackAnchor(undefined); }, [active, serverUrl, mode]);
  useEffect(() => {
    if (!feedback) return;
    let valid = true;
    setTargets([]); setTargetId(''); setTargetsLoading(true); setTargetError('');
    void api.agentTargets(feedback.projectRoot).then((list) => {
      if (!valid) return;
      setTargets(list);
      const remembered = localStorage.getItem("sidelit.target:" + (feedback.projectRoot || feedback.document.url || 'default')) ?? "";
      setTargetId(chooseTarget(list, remembered));
    }).catch(error => { if (valid) setTargetError(String(error)); }).finally(() => { if (valid) setTargetsLoading(false); });
    return () => { valid = false; };
  }, [feedback?.id, targetRefresh]);
  const attachedFeedback = reviewState.record.notes.find(note => note.id === reviewAttachmentId)
    ?? requestHistory.find(item => item.context.id === reviewAttachmentId)?.context
    ?? (feedbackOpen || feedback?.id === reviewAttachmentId ? feedback : null);
  const attachedHere = attachedFeedback && (serverUrl ? !!attachedFeedback.document.url && new URL(attachedFeedback.document.url).origin === new URL(serverUrl).origin : attachedFeedback.document.path === doc?.path);
  const attachment = useMemo(() => attachedHere && attachedFeedback ? { ...attachedFeedback.selection, pageUrl: attachedFeedback.document.url } : undefined, [attachedHere, attachedFeedback?.selection, attachedFeedback?.document.url]);
  const isFeedbackStale = (message: FeedbackMessage) => {
    const current = message.document.path ? documents.get(message.document.path) : undefined;
    return reviews.restored(message.id) || (!!message.document.path && (!current || message.document.revision !== current.revision || message.document.diskHash !== current.disk.hash));
  };
  const feedbackStale = !!feedback && isFeedbackStale(feedback);
  const revealFeedback = (message: FeedbackMessage) => {
    if (message.document.url) setServerUrl(message.document.url);
    else if (message.document.path && documents.get(message.document.path)) { setServerUrl(''); setActive(message.document.path); documents.setMode(message.document.path, 'rendered'); }
    else { report('The document is closed. Reopen it to reveal the selection.'); return; }
    setCompare(null); setReviewAttachmentId(message.id);
    setReveal(value => value + 1); setFeedbackOpen(false); setReviewOpen(false);
  };
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
    setServerUrl('');
    setCompare(null);
    if (!workspaceRef.current) await root(file.parent);
  }, []);
  const pointTo = useCallback((path: string, target: Pick<Jump, "text" | "heading">) => {
    setJump({ nonce: ++jumps.current, path, ...target });
  }, []);
  const pickHeading = (heading: Heading) => { if (doc) pointTo(doc.path, { heading: { index: heading.index, line: heading.line } }); };
  const jumpMissed = useCallback((missed: Jump) => { if (missed.text) setError(`Could not find “${missed.text}” in ${name(missed.path)}.`); }, []);
  const goToChange = useCallback((index: number) => {
    setChangeNav(old => ({ index, nonce: old.nonce + 1 }));
  }, []);
  useEffect(() => { setChangeNav({ index: 0, nonce: 0 }); setReverted(undefined); }, [active, reviewBase?.hash]);
  useEffect(() => { setFind(old => ({ ...old, index: 0 })); setFindCount(0); }, [active]);
  useEffect(() => {
    const count = changeSet?.changes.length ?? 0;
    if (changeNav.index >= count && count) setChangeNav(old => ({ ...old, index: count - 1 }));
    // Nothing left to review, such as after reverting the only change or an agent undoing its edit.
    if (doc && changeSet && !count && !reverted) {
      if (scope) setRequestScope(undefined);
      else if (doc.review) documents.update(doc.path, { review: undefined, reviewFrom: undefined, reviewLabel: undefined });
    }
  }, [changeSet]);
  const stepChange = (delta: number) => {
    const count = changeSet?.changes.length;
    if (!count || !doc) return;
    // An HTML page has no marks to step through, so changes are shown in its source.
    if (doc.format === "html" && doc.mode === "rendered") documents.setMode(doc.path, "source");
    goToChange((changeNav.index + delta + count) % count);
  };
  const revertCurrent = () => {
    const change = changeSet?.changes[changeNav.index];
    if (!doc || !change) return;
    const after = revertChange(doc.text, change);
    setReverted({ path: doc.path, before: doc.text, after });
    documents.edit(doc.path, after);
  };
  const openFromRequest = async (id: string, path: string) => {
    await open(path);
    const before = await api.requestBaseline(id, path);
    const opened = documents.get(path);
    setRequestScope(undefined);
    if (!before) report('No before-version is available for this document in this request. Showing all unreviewed changes.');
    if (before && opened && before.text !== opened.text) {
      if (!opened.review) documents.update(path, { review: before, reviewFrom: "disk" });
      setRequestScope({ path, before });
    }
    setFeedbackOpen(false); setReviewOpen(false);
    goToChange(0);
  };
  const stepFind = (delta: number) => {
    if (findCount) setFind(old => ({ ...old, index: (old.index + delta + findCount) % findCount, nonce: old.nonce + 1 }));
  };
  const closeFind = () => { setFind(old => ({ ...old, open: false })); (document.querySelector(".ProseMirror") as HTMLElement | null)?.focus(); };
  const goToStop = useCallback(async (stop: WalkStop) => {
    await open(stop.path, stop.source);
    // An agent often writes a file and points at it at once; look at what it wrote.
    await documents.refresh(stop.path);
    pointTo(stop.path, { text: stop.find });
  }, [open, pointTo]);
  const stepThroughWalk = (delta: number) => {
    if (!walk) return;
    const next = stepWalk(walk, delta);
    if (next.index === walk.index) return;
    setWalk(next);
    void goToStop(next.stops[next.index]).catch(report);
  };
  const refreshGit = useCallback(() => {
    const path = workspaceRef.current;
    if (!path) { setGitFiles([]); return; }
    void api.gitStatus(path).then(status => { if (workspaceRef.current === path) setGitFiles(status.files); }).catch(() => setGitFiles([]));
  }, []);
  useEffect(() => {
    const timer = setTimeout(refreshGit, 250);
    return () => clearTimeout(timer);
  }, [workspace, refresh, refreshGit, settledRequests]);
  useEffect(() => {
    // Commits and folders not on screen raise no watcher events.
    const timer = setInterval(refreshGit, 15_000);
    window.addEventListener("focus", refreshGit);
    return () => { clearInterval(timer); window.removeEventListener("focus", refreshGit); };
  }, [refreshGit]);
  const openChanged = async (path: string) => {
    await open(path);
    if (documents.get(path)?.review) return;
    const committed = await api.gitCommitted(path);
    if (committed) documents.compareWithCommit(path, committed);
  };
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
              else {
                if (isWalk(request)) {
                  const next = extendWalk(walkRef.current, request);
                  walkRef.current = next.walk;
                  setWalk(next.walk);
                  if (next.go) await goToStop(next.walk.stops[next.walk.index]);
                  continue;
                }
                await open(request.path, request.source);
                if (request.stops.length || request.anchor) await documents.refresh(request.path);
                if (request.stops[0]) pointTo(request.path, { text: request.stops[0].find });
                if (request.anchor) {
                  const opened = documents.get(request.path);
                  const heading = opened && headingForAnchor(headings(opened.text, opened.format), request.anchor);
                  if (heading) pointTo(request.path, { heading: { index: heading.index, line: heading.line } });
                  else report(`There is no heading for #${request.anchor} in ${name(request.path)}.`);
                }
              }
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
  }, [open, report, pointTo, goToStop]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.setProperty(
      "--document-font-size",
      `${size}px`,
    );
  }, [resolved, size]);
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
      forgetPreviewPosition(d.path);
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
      if (reviews.snapshot().busy) throw new Error('Wait for review notes to finish saving or sending before quitting.');
      let requestApproval = await approveFeedbackClose(() => feedbackRef.current, reviews, (note, editing) => ask(
        `${editing ? 'Save note changes' : 'Save this unsent request'} before ${updateVersion ? 'restarting' : 'quitting'}?`,
        `${name(note.document.path ?? note.document.url ?? 'Document')}: ${editing ? 'your unsaved note changes' : 'this request'} will be lost if you discard. Save to Notes keeps it on this computer without sending to Pi.`,
        ['Discard', 'Cancel', 'Save to Notes'],
      ));
      if (!requestApproval) return;
      if (!feedbackApprovalCurrent(feedbackRef.current, requestApproval, reviews)) throw new Error('The request changed during Quit. Try again.');
      if (requestApproval.savedNote) {
        clearFeedback();
        requestApproval = { ...requestApproval, state: feedbackRef.current };
      }
      const approvals: CloseApproval[] = [];
      for (const path of documents.docs.map((d) => d.path)) {
        const approval = await approveClose(documents, path, chooseClose);
        if (!approval) return;
        approvals.push(approval);
      }
      if (!approvalsCurrent(documents, approvals, true)) throw new Error("The session changed during Quit. Try again.");
      await journal.flush(sessionSnapshot(documents, workspaceRef.current, activeRef.current, approvals));
      if (!approvalsCurrent(documents, approvals, true)) throw new Error("The session changed during Quit. Try again.");
      await baselines.flush();
      if (reviews.snapshot().busy) throw new Error('Review notes changed during Quit. Try again.');
      if (!feedbackApprovalCurrent(feedbackRef.current, requestApproval, reviews)) throw new Error('The request changed during Quit. Try again.');
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
      } else if (!prompt && !quick && !tool && !sessionDialog && !reviewOpen) history.current?.(action);
      return;
    }
    if (prompt || quick || tool || sessionDialog || locked || !initialized) return;
    if (action === "new") void newFile();
    if (action === "save-as") void copy(false);
    if (action === "quick") setQuick("names");
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
  const exportNotes = async (notes: FeedbackMessage[]) => {
    if (modalBusy.current || quitting.current || !notes.length) return;
    modalBusy.current = true;
    try {
      const file = await api.copy(null, notesMarkdown(notes), "Review notes.md");
      if (!file) return;
      documents.open(file);
      setActive(file.path);
      setCompare(null);
      setReviewOpen(false);
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
      if (e.key === "F9" && walk && !prompt && !quick && !tool && !sessionDialog && !serverDialog && !feedbackOpen && !reviewOpen && !locked) {
        e.preventDefault();
        e.stopPropagation();
        stepThroughWalk(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === "F8" && !prompt && !quick && !tool && !sessionDialog && !serverDialog && !feedbackOpen && !reviewOpen && !locked && changeSet?.changes.length && !comparison && !serverUrl) {
        e.preventDefault();
        e.stopPropagation();
        stepChange(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.key === "Escape" && !prompt && !quick && !tool && !sessionDialog && !serverDialog) {
        if (reviewOpen) { e.preventDefault(); setReviewOpen(false); return; }
        if (feedbackOpen || reviewAttachmentId || inspect || selection) { e.preventDefault(); dismissFeedback(); return; }
        if (find.open && findable) { e.preventDefault(); closeFind(); return; }
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && ['i', 'f', 'r', 'e'].includes(e.key.toLowerCase()) && !prompt && !quick && !tool && !sessionDialog && !serverDialog && !locked && initialized) {
        e.preventDefault();
        previewShortcut(e.key.toLowerCase());
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        e.stopPropagation();
        actionRef.current(e.shiftKey ? "redo" : "undo");
        return;
      }
      if (!(e.metaKey || e.ctrlKey) || prompt || quick || tool || sessionDialog || serverDialog || feedbackOpen || reviewOpen || locked || !initialized) return;
      const k = e.key.toLowerCase();
      // Source has Monaco's own Find; a preview's frame handles its own keys.
      if (k === "f" && !e.shiftKey && !e.altKey && findable) {
        e.preventDefault();
        e.stopPropagation();
        const picked = selection?.type === "text" && selection.text.length <= 200 && !selection.text.includes("\n") ? selection.text.trim() : "";
        setFind(old => ({ ...old, open: true, query: picked || old.query, index: 0, nonce: old.nonce + 1, focus: old.focus + 1 }));
        return;
      }
      if (k === "g" && !e.altKey && find.open && findable) {
        e.preventDefault();
        stepFind(e.shiftKey ? -1 : 1);
        return;
      }
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
      if (k === "p") setQuick("names");
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
          className={'icon-button sidebar-toggle' + (sidebar ? ' is-open' : '')}
          title="Toggle sidebar"
          aria-label="Toggle sidebar"
          aria-expanded={sidebar}
          onClick={() => setSidebar(!sidebar)}
        >
          <Icon type="sidebar" />
        </button>
        <button className="toolbar-action" aria-label="Open File" onClick={() => void api.choose(false).catch(report)} title="Open File (⌘O)">
          <Icon type="open" /><span>Open File</span>
        </button>
        <button className="toolbar-action" aria-label="Dev Server" onClick={() => setServerDialog(true)} title="Connect to a running local development server">
          <Icon type="server" /><span>Dev Server</span>
        </button>
        {(doc || serverUrl || feedback) && (
          <>
            <button className={'toolbar-action' + (inspect ? ' tool-active' : '')} aria-label={inspect ? 'Inspecting…' : 'Inspect'} aria-pressed={inspect} onClick={() => { setFeedbackOpen(false); setReviewOpen(false); setInspect((value) => !value); }} title="Inspect an element (⌘⇧I)">
              <Icon type="inspect" /><span>{inspect ? "Inspecting…" : "Inspect"}</span>
            </button>
            <button className={'toolbar-action feedback-button' + (feedback ? ' has-request' : '') + (selection || feedback ? ' tool-active' : '')} aria-label={unsentFeedback ? 'Resume unsent draft' : feedbackAck?.status === 'settled' ? 'Pi finished. View request' : feedback ? 'View request' : 'Feedback'} aria-expanded={feedbackOpen} onClick={resumeFeedback} title={unsentFeedback ? 'Resume unsent draft (⌘⇧F). Kept until app exit.' : feedback ? 'View request and delivery status (⌘⇧F)' : selection ? 'Feedback on selection (⌘⇧F)' : 'Document feedback (⌘⇧F)'}>
              <Icon type="feedback" /><span>{unsentFeedback ? 'Unsent draft' : feedbackAck?.status === 'settled' ? 'Pi finished' : feedback ? 'View request' : 'Feedback'}</span>
            </button>
          </>
        )}
        <button className="toolbar-action" aria-label={`Review notes (${reviewState.record.notes.length})`} aria-expanded={reviewOpen} title="Saved review notes" onClick={() => { dismissFeedback(); setReviewOpen(value => !value); }}>
          <Icon type="notes" /><span>Notes{reviewState.record.notes.length ? ` (${reviewState.record.notes.length})` : ''}{reviewState.error ? ' · error' : ''}</span>
        </button>
        <details
          className="app-menu"
          ref={actionsRef}
          onKeyDown={(event) => {
            if (event.key === "Escape" && event.currentTarget.open) {
              event.preventDefault();
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
          onBlur={(event) => {
            if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
              event.currentTarget.open = false;
            }
          }}
        >
          <summary title="File and appearance actions">
            Actions <Icon type="chevron" />
          </summary>
          <div id="app-actions" className="app-menu-items" role="group" aria-label="File and appearance actions">
            <div className="file-actions" onClick={() => actionsRef.current?.removeAttribute("open")}>
              <button onClick={() => void newFile()}>New File… <kbd>⌘N</kbd></button>
              <button disabled={!doc} onClick={() => void copy(false)}>Save As… <kbd>⇧⌘S</kbd></button>
              <button onClick={() => setQuick("names")}>Quick Open… <kbd>⌘P</kbd></button>
              <button onClick={() => setQuick("contents")}>Search in Files…</button>
              <button disabled={!doc || !!serverUrl} onClick={() => setTool("compare")}>Compare with Commit…</button>
              <button disabled={!doc || !!serverUrl} onClick={() => setTool("links")}>Check Links…</button>
              <button onClick={() => void api.choose(true).catch(report)}>Open Folder… <kbd>⇧⌘O</kbd></button>
              <button onClick={() => setSessionDialog(true)}>Session & Recovery…</button>
              <button disabled={checkingUpdate} onClick={() => void checkUpdates(true)}>Check for Updates…</button>
            </div>
            <div className="appearance-actions" role="group" aria-label="Appearance">
              <label className="theme-control" title="Color theme">
                <span>Theme</span>
                <Icon type={theme === "system" ? "system" : dark ? "moon" : "sun"} />
                <select
                  aria-label="Theme"
                  value={theme}
                  onChange={(event) => setTheme(themePreference(event.target.value))}
                >
                  <option value="system">System</option>
                  <option value="light">Light</option>
                  <option value="dark">Dark</option>
                  <option value="stillwater">Stillwater</option>
                </select>
              </label>
              <div className="font-controls" role="group" aria-label="Document font size">
                <span>Text size</span>
                <button
                  aria-label="Decrease font size"
                  title="Decrease font size (⌘− / Ctrl+−)"
                  disabled={size === MIN_FONT_SIZE}
                  onClick={() => changeSize(-1)}
                >A−</button>
                <button
                  className="font-size-value"
                  aria-label={`Font size ${size} pixels. Reset to ${DEFAULT_FONT_SIZE}`}
                  title="Reset font size (⌘0 / Ctrl+0)"
                  onClick={() => setSize(DEFAULT_FONT_SIZE)}
                >{size}px</button>
                <button
                  aria-label="Increase font size"
                  title="Increase font size (⌘+ / Ctrl++)"
                  disabled={size === MAX_FONT_SIZE}
                  onClick={() => changeSize(1)}
                >A+</button>
              </div>
            </div>
          </div>
        </details>
        <div className="toolbar-space" />
        {doc?.format === 'markdown' && mode === 'rendered' && !serverUrl && <button aria-label="Edit rendered Markdown" aria-pressed={editing} onClick={() => setEditing(value => !value)}>{editing ? 'Done editing' : 'Edit'}</button>}
        {doc && !serverUrl && (
          <div className="mode-switch" aria-label="Editing mode">
            <button
              aria-pressed={mode === "rendered"}
              disabled={!!reason}
              title={reason ?? "Rendered (⌘\\)"}
              onClick={() => {
                documents.setMode(doc.path, "rendered");
                setCompare(null);
              }}
            >
              Rendered
            </button>
            <button
              aria-pressed={mode === "source"}
              title="Source editing (⌘\\)"
              onClick={() => {
                documents.setMode(doc.path, "source");
                setCompare(null);
              }}
            >
              Source
            </button>
          </div>
        )}
        {serverUrl && <button className="server-close" onClick={() => setServerUrl("")}>Close server preview</button>}
        {doc && !serverUrl && (
          <button
            className="save-button"
            disabled={doc.saving}
            onClick={() => void save()}
            title="⌘S"
          >
            {doc.saving ? "Saving…" : comparison?.kind === "conflict" ? "Save Merged" : "Save"}
          </button>
        )}
      </header>
      <div className="layout">
        {sidebar && (
          <>
            <aside
              className="sidebar"
              style={{ width }}
              aria-label="Document sidebar"
            >
              <div className="workspace-heading">
                <Icon type="folder" />
                <span title={workspace}>
                  {workspace ? name(workspace) : "No folder open"}
                </span>
              </div>
              <div className="sidebar-views" role="group" aria-label="Sidebar view">
                <button aria-pressed={sidebarView === "files"} onClick={() => setSidebarView("files")}>Files</button>
                <button aria-pressed={sidebarView === "outline"} onClick={() => setSidebarView("outline")}>Outline</button>
                <button aria-pressed={sidebarView === "changed"} onClick={() => setSidebarView("changed")}>Changed{gitFiles.length ? ` ${gitFiles.length}` : ""}</button>
                <button aria-pressed={sidebarView === "requests"} onClick={() => setSidebarView("requests")}>Requests</button>
              </div>
              {sidebarView === "requests" ? (
                <RequestsPanel store={requests} path={doc?.path} url={serverUrl || undefined}
                  onInspect={() => { setFeedbackOpen(false); setReviewOpen(false); }} onError={report}
                  onReveal={revealFeedback} onOpenChange={(id, path) => void openFromRequest(id, path).catch(report)} />
              ) : sidebarView === "outline" ? (
                doc && !serverUrl ? <Outline items={outline} onPick={pickHeading} /> : <div className="tree-empty">Open a document to see its headings</div>
              ) : sidebarView === "changed" ? (
                gitFiles.length ? <ul className="tree-list">
                  {gitFiles.map((file) => <li key={file.path}>
                    <button className={`tree-row ${active === file.path ? "selected" : ""}`} title={file.path} onClick={() => void openChanged(file.path).catch(report)}>
                      <Icon type="file" />
                      <span className="tree-name">{workspace && file.path.startsWith(workspace + "/") ? file.path.slice(workspace.length + 1) : name(file.path)}</span>
                      <GitMark status={file.status} />
                    </button>
                  </li>)}
                </ul> : <div className="tree-empty">No documents changed since the last commit</div>
              ) : workspace ? (
                <Folder
                  key={workspace}
                  path={workspace}
                  refresh={refresh}
                  active={active}
                  open={(p) => void open(p).catch(report)}
                  git={gitMarks}
                />
              ) : (
                <div className="sidebar-empty">
                  <button onClick={() => void api.choose(true).catch(report)}>
                    Open a folder
                  </button>
                </div>
              )}
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
                      setServerUrl('');
                      setCompare(null);
                    }}
                  >
                    <Icon type="file" />
                    <span>{name(d.path)}</span>
                    {dirty(d) && (
                      <span
                        className="dirty-dot"
                        title="Unsaved changes"
                        aria-label="Unsaved changes"
                      />
                    )}
                  </button>
                  <button
                    className="tab-close"
                    title={`Close ${name(d.path)}`}
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
          {walk && <WalkBar walk={walk} onStep={stepThroughWalk} onDone={() => setWalk(undefined)} />}
          {doc ? (
            <>
              {doc.pending && !serverUrl && (
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
              {reviewBase && changeSet && !doc.pending && !comparison && !serverUrl && <ChangesBar
                changes={changeSet.changes}
                index={changeNav.index}
                source={scope ? "request" : doc.reviewFrom}
                label={doc.reviewLabel}
                onShowAll={scope && doc.review && doc.review.text !== scope.before.text ? () => setRequestScope(undefined) : undefined}
                unmapped={changesUnmapped && doc.format === "markdown" && mode === "rendered"}
                canUndo={reverted?.path === doc.path && reverted.after === doc.text}
                onGo={(index) => { if (doc.format === "html" && mode === "rendered") documents.setMode(doc.path, "source"); goToChange(index); }}
                onRevert={revertCurrent}
                onUndo={() => { if (reverted) { documents.edit(doc.path, reverted.before); setReverted(undefined); } }}
                onCompare={() => setCompare({ path: doc.path, kind: "review", disk: reviewBase })}
                onDone={() => { setReverted(undefined); setRequestScope(undefined); documents.update(doc.path, { review: undefined, reviewFrom: undefined, reviewLabel: undefined }); }}
              />}
              {find.open && findable && <FindBar query={find.query} count={findCount} index={find.index} focus={find.focus}
                onQuery={query => setFind(old => ({ ...old, query, index: 0, nonce: old.nonce + 1 }))}
                onStep={stepFind} onClose={closeFind} />}
              {mode === "rendered" && /^(---|\+\+\+)[ \t]*\r?\n/.test(doc.text) && !comparison && !serverUrl && <div className="fidelity-note">Frontmatter is kept unchanged. Use Source to edit metadata.</div>}
              {reason && !comparison && !serverUrl && (
                <div className="fidelity-note">
                  {reason} No content has been removed.
                </div>
              )}
              {comparison ? (
                <>
                  <div className="comparison-help">
                    <span>{comparison.kind === "conflict" ? "Edit your draft or use a change arrow to take disk text. Save Merged checks the disk again before writing." : `${scope ? "The version when you sent this request" : doc.reviewFrom === "commit" ? doc.reviewLabel ?? "The last commit" : "The version you last reviewed"} and your current text. Both panes are read only.`}</span>
                    {comparison.kind === "conflict" && doc.pending?.snapshot && doc.pending.snapshot.hash !== comparison.disk.hash && <button onClick={() => setCompare({ ...comparison, disk: doc.pending!.snapshot! })}>Refresh disk pane</button>}
                    {(!doc.pending || comparison.kind === "review") && <button onClick={() => setCompare(null)}>Back to draft</button>}
                  </div>
                  <div className="compare-labels">
                    <span>{comparison.kind === "review" ? (scope ? "When the request was sent" : doc.reviewFrom === "commit" ? doc.reviewLabel ?? "Last commit" : "Last reviewed version") : doc.pending?.error ? "Last available disk version" : "Reviewed disk version"} · read only</span>
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
                      theme={resolved}
                      fontSize={size}
                      readOnly={comparison.kind === "review"}
                      history={history}
                      onChange={(text) => documents.edit(doc.path, text)}
                    />
                  </Suspense>
                </>
              ) : serverUrl ? (
                <Preview
                  key={serverUrl}
                  format="url"
                  url={serverUrl}
                  refresh={previewRefresh}
                  onDismiss={dismissFeedback}
                  onShortcut={previewShortcut}
                  inspect={inspect}
                  onText={captureSelection}
                  onElement={openFeedback}
                  attachment={attachment}
                  reveal={reveal}
                  onError={report}
                />
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
                    theme={resolved}
                    fontSize={size}
                    history={history}
                    onChange={(text) => documents.edit(doc.path, text)}
                    onTextSelection={captureSelection}
                    changes={changeSet}
                    changeNav={changeNav}
                    jump={jump?.path === doc.path ? jump : undefined}
                    onJumpMissed={jumpMissed}
                  />
                </Suspense>
              ) : doc.format === "mdx" ? (
                <div className="mdx-split">
                  <Suspense fallback={<div className="loading">Loading source editor…</div>}>
                    <Source
                      key={doc.path}
                      path={doc.path}
                      text={doc.text}
                      theme={resolved}
                      fontSize={size}
                      history={history}
                      onChange={(text) => documents.edit(doc.path, text)}
                      onTextSelection={captureSelection}
                      changes={changeSet}
                      changeNav={changeNav}
                      jump={jump?.path === doc.path ? jump : undefined}
                    />
                  </Suspense>
                  <Preview
                    key={doc.path}
                    path={doc.path}
                    source={doc.text}
                    format="mdx"
                    jump={jump?.path === doc.path ? jump : undefined}
                    onJumpMissed={jumpMissed}
                    theme={resolved}
                    fontSize={size}
                    refresh={refresh + previewRefresh}
                    onDismiss={dismissFeedback}
                    onShortcut={previewShortcut}
                    inspect={inspect}
                    onText={captureSelection}
                    onElement={openFeedback}
                    attachment={attachment}
                    reveal={reveal}
                    onError={report}
                  />
                </div>
              ) : doc.format === "markdown" ? (
                <Rich
                  key={doc.path}
                  path={doc.path}
                  text={doc.text}
                  refresh={refresh + previewRefresh}
                  onChange={(text) => documents.edit(doc.path, text)}
                  onError={report}
                  history={history}
                  inspect={inspect}
                  onTextSelection={captureSelection}
                  onElementInspect={openFeedback}
                  editable={editing}
                  attachment={attachment}
                  reveal={reveal}
                  changes={changeSet}
                  changeNav={changeNav}
                  jump={jump?.path === doc.path ? jump : undefined}
                  onJumpMissed={jumpMissed}
                  onChangesUnmapped={setChangesUnmapped}
                  search={find.open ? find : undefined}
                  onSearchCount={setFindCount}
                />
              ) : (
                <Preview
                  key={doc.path}
                  path={doc.path}
                  source={doc.text}
                  format="html"
                  jump={jump?.path === doc.path ? jump : undefined}
                  onJumpMissed={jumpMissed}
                  theme={resolved}
                  fontSize={size}
                  refresh={refresh + previewRefresh}
                  onDismiss={dismissFeedback}
                  onShortcut={previewShortcut}
                  inspect={inspect}
                  onText={captureSelection}
                  onElement={openFeedback}
                  attachment={attachment}
                  reveal={reveal}
                  onError={report}
                />
              )}
              <footer className="statusbar">
                <span title={serverUrl || doc.path}>{serverUrl || doc.path}</span>
                <span role="status">
                  {serverUrl ? 'Development server' : doc.pending
                    ? "Disk conflict"
                    : dirty(doc)
                      ? "Unsaved changes"
                      : doc.notice || "All changes saved"}
                </span>
                {!serverUrl && <span>{doc.text.includes("\r\n") ? "CRLF" : "LF"} · UTF-8</span>}
              </footer>
            </>
          ) : serverUrl ? (
            <Preview
              key={serverUrl}
              format="url"
              url={serverUrl}
              refresh={previewRefresh}
              onDismiss={dismissFeedback}
              onShortcut={previewShortcut}
              inspect={inspect}
              onText={captureSelection}
              onElement={openFeedback}
              attachment={attachment}
              reveal={reveal}
              onError={report}
            />
          ) : (
            <section className="empty">
              <picture className="empty-mark" aria-hidden="true">
                <source srcSet={darkIcon} media="(prefers-color-scheme: dark)" />
                <img src={lightIcon} width="48" height="48" alt="" />
              </picture>
              <h1>
                See the result.
                <br />
                Stay in your terminal.
              </h1>
              <p>
                Open Markdown, HTML, or MDX.
                <br />
                Select a detail and send your instruction to Pi.
              </p>
              <div className="empty-actions">
                <button onClick={() => void newFile()}>New Markdown file</button>
                <button
                  className="primary"
                  onClick={() => void api.choose(false).catch(report)}
                >
                  Open a document
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
      {serverDialog && <DevServerDialog value={serverUrl} onOpen={(url) => { setCompare(null); setServerUrl(url); setServerDialog(false); }} onClose={() => setServerDialog(false)} />}
      {feedback && <FeedbackComposer
        key={feedback.id}
        context={feedback}
        open={feedbackOpen}
        anchor={attachedHere ? feedbackAnchor : undefined}
        stale={feedbackStale}
        candidate={candidate}
        onReplace={() => { if (candidate) { setFeedback({ ...candidate, intent: feedback.intent, instruction: feedback.instruction }); setCandidate(null); setFeedbackAnchor(undefined); } }}
        onChange={change => setFeedback(value => value ? { ...value, ...change } : value)}
        onReveal={() => revealFeedback(feedback)}
        savedNote={!!reviewEditingId}
        collectionBusy={!reviewState.ready || reviewState.busy}
        draft={feedbackDraft}
        onOpenChange={(id, path) => void openFromRequest(id, path).catch(report)}
        onCollect={async (includeDraft) => {
          await reviews.save({ ...feedback, id: reviewEditingId ?? feedback.id, document: { ...feedback.document, unsavedChanges: includeDraft ? feedbackDraft?.text : undefined } });
          const edited = !!reviewEditingId;
          clearFeedback();
          if (edited) setReviewOpen(true);
        }}
        onDiscard={() => { const edited = !!reviewEditingId; clearFeedback(); if (edited) setReviewOpen(true); }}
        targets={targets}
        targetId={targetId}
        loading={targetsLoading}
        targetError={targetError}
        onRefreshTargets={() => setTargetRefresh(value => value + 1)}
        onTarget={id => { setTargetId(id); localStorage.setItem('sidelit.target:' + (feedback.projectRoot || feedback.document.url || 'default'), id); }}
        requests={requests}
        onClose={dismissFeedback}
      />}
      <ReviewPanel store={reviews} open={reviewOpen && !locked} onClose={() => setReviewOpen(false)} isStale={isFeedbackStale}
        onExport={(notes) => void exportNotes(notes)}
        onOpenChange={(id, path) => void openFromRequest(id, path).catch(report)}
        confirm={async (title, detail) => (await ask(title, detail, ['Cancel', 'Remove'])) === 'Remove'}
        onReveal={revealFeedback} onEdit={note => {
          if (feedback && reviewEditingId === note.id) { setReviewOpen(false); setFeedbackOpen(true); return; }
          if (feedback) { report('Finish or discard the current request before editing a saved note.'); return; }
          setFeedback(structuredClone(note)); setReviewEditingId(note.id); setCandidate(null); setReviewAttachmentId(undefined);
          setFeedbackAnchor(undefined); setReviewOpen(false); setFeedbackOpen(true);
        }} />
      {selection && !feedbackOpen && !reviewOpen && !prompt && <SelectionActions selection={selection} onAction={intent => openFeedback(selection, intent)} />}
      {quick && <QuickOpen workspace={workspace} open={open} initialContents={quick === "contents"} close={() => setQuick(false)}
        find={async (path, text) => { await open(path); pointTo(path, { text }); }} />}
      {tool === "compare" && doc && <CompareDialog doc={doc} close={() => setTool(undefined)} compare={async (revision) => {
        const committed = await api.gitCommitted(doc.path, revision);
        if (!committed) throw new Error(`${name(doc.path)} is not in ${revision}.`);
        if (committed.text === documents.get(doc.path)?.text) throw new Error(`No changes since ${revision}.`);
        if (!documents.compareWithCommit(doc.path, committed, revision)) throw new Error("This document changed. Try again.");
        setCompare(null);
        goToChange(0);
      }} />}
      {tool === "links" && doc && <LinkCheckDialog doc={doc} close={() => setTool(undefined)}
        go={(problem) => pointTo(doc.path, { text: doc.mode === "source" ? problem.reference : problem.label || problem.reference })} />}
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
