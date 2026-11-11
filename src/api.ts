import { invoke } from "@tauri-apps/api/core";
import { feedbackSelection, type FeedbackMessage } from "./inspection";
import type { FeedbackBatch, ReviewRecord } from "./review";
import type { LinkTarget } from "./links";
export interface Snapshot {
  text: string;
  hash: string;
}
export interface OpenRequest {
  path: string;
  directory: boolean;
  source: boolean;
  stops: { find: string; note?: string | null }[];
  append: boolean;
  anchor?: string | null;
}
export interface RequestFile {
  path: string;
  status: "modified" | "added" | "removed";
}
export interface RequestReport {
  files: RequestFile[];
  incomplete: boolean;
}
export interface GitFile {
  path: string;
  status: "modified" | "added";
}
export interface GitStatus {
  files: GitFile[];
  incomplete: boolean;
}
export interface Opened {
  path: string;
  parent: string;
  snapshot: Snapshot;
}
export interface Entry {
  path: string;
  name: string;
  directory: boolean;
}
export interface SavedDocument {
  path: string;
  text: string;
  disk: Snapshot;
  mode: "rendered" | "source";
}
export interface Session {
  documents: SavedDocument[];
  workspace: string | null;
  active: string | null;
}
export interface RecoveryStatus {
  enabled: boolean;
  available: boolean;
  savedAt: number;
  count: number;
  dirty: number;
}
export interface SearchResults {
  paths: string[];
  incomplete: boolean;
}
export interface ContentMatch {
  path: string;
  line: number;
  snippet: string;
  text: string;
}
export interface ContentResults {
  matches: ContentMatch[];
  incomplete: boolean;
}
export interface AgentTarget {
  id: string;
  label: string;
  projectRoot: string;
  sessionId?: string;
  blockId?: string;
  process?: string;
  busy: boolean;
  connected: boolean;
}
export interface DeliveryAck {
  id: string;
  status: "received" | "accepted" | "duplicate" | "settled" | "failed";
  delivery: "submitted" | "queued" | "consumed" | "none";
}
export interface PreviewAsset {
  kind: "style" | "script" | "data";
  value: string;
  path: string;
  mime?: string;
}
export type SaveResult =
  | { kind: "saved"; snapshot: Snapshot }
  | { kind: "conflict"; snapshot: Snapshot | null; error: string | null };
export interface AvailableUpdate {
  version: string;
}
export const api = {
  checkUpdate: () => invoke<AvailableUpdate | null>("check_update"),
  installUpdate: (version: string) => invoke<void>("install_update", { version }),
  ready: () => invoke<OpenRequest[]>("ready"),
  choose: (folder: boolean) => invoke<void>("choose", { folder }),
  open: (path: string) => invoke<Opened>("open_document", { path }),
  read: (path: string) => invoke<Snapshot>("read_document", { path }),
  save: (path: string, expected: string, text: string) =>
    invoke<SaveResult>("save_document", { path, expected, text }),
  copy: (path: string | null, text: string, name?: string) =>
    invoke<Opened | null>("save_copy", { path, text, name: name ?? null }),
  close: (path: string) => invoke<void>("close_document", { path }),
  workspace: (path: string) => invoke<void>("set_workspace", { path }),
  list: (path: string) => invoke<Entry[]>("list_directory", { path }),
  collapse: (path: string) => invoke<void>("collapse_directory", { path }),
  image: (document: string, reference: string) =>
    invoke<string>("image_data", { document, reference }),
  link: (document: string, reference: string) =>
    invoke<void>("open_link", { document, reference }),
  previewAsset: (document: string, reference: string) =>
    invoke<PreviewAsset>("preview_asset", { document, reference }),
  publishPreview: (id: string, html: string) => invoke<string>('publish_preview', { id, html }),
  releasePreview: (id: string) => invoke<void>('release_preview', { id }),
  loadBaseline: (path: string) => invoke<Snapshot | null>("load_baseline", { path }),
  storeBaseline: (path: string, text: string | null) => invoke<void>("store_baseline", { path, text }),
  requestChanges: (id: string) => invoke<RequestReport | null>("request_changes", { id }),
  requestBaseline: (id: string, path: string) => invoke<Snapshot | null>("request_baseline", { id, path }),
  gitStatus: (path: string) => invoke<GitStatus>("git_status", { path }),
  gitCommitted: (path: string, revision?: string) => invoke<Snapshot | null>("git_committed", { path, revision: revision ?? null }),
  gitReferences: (path: string) => invoke<string[]>("git_references", { path }),
  search: (path: string, query: string) => invoke<SearchResults>("search_documents", { path, query }),
  searchContents: (path: string, query: string) => invoke<ContentResults>("search_contents", { path, query }),
  linkTargets: (document: string, references: string[]) => invoke<LinkTarget[]>("link_targets", { document, references }),
  agentTargets: (projectRoot?: string) =>
    invoke<AgentTarget[]>("agent_targets", { projectRoot: projectRoot ?? null }),
  sendFeedback: (targetId: string, message: FeedbackMessage) =>
    invoke<DeliveryAck>("send_feedback", { targetId, message: { ...message, selection: feedbackSelection(message.selection) } }),
  loadReview: () => invoke<ReviewRecord>('load_review'),
  storeReview: (record: ReviewRecord) => invoke<void>('store_review', { record }),
  sendReview: (targetId: string, message: FeedbackBatch) => invoke<DeliveryAck>('send_review', { targetId, message }),
  feedbackStatus: (targetId: string, id: string) => invoke<DeliveryAck>('feedback_status', { targetId, id }),
  focusAgent: (targetId: string) => invoke<void>('focus_agent', { targetId }),
  recoveryStatus: () => invoke<RecoveryStatus>("recovery_status"),
  setRecovery: (enabled: boolean) => invoke<RecoveryStatus>("set_recovery", { enabled }),
  storeSession: (session: Session) => invoke<void>("save_session", { session }),
  restoreSession: () => invoke<Session | null>("restore_session"),
  quit: () => invoke<void>("quit"),
};
