import { Documents, dirty, type Document } from "./documents";
import type { FeedbackMessage } from "./inspection";
import type { ReviewNotes } from "./review";

export interface FeedbackCloseState {
  message: FeedbackMessage | null;
  editingId?: string;
  attempted: boolean;
}
export interface FeedbackCloseApproval {
  state: FeedbackCloseState;
  savedNote?: FeedbackMessage;
}

function noteIsSaved(reviews: ReviewNotes, note: FeedbackMessage) {
  return JSON.stringify(reviews.snapshot().record.notes.find(saved => saved.id === note.id)) === JSON.stringify(note);
}

export function feedbackApprovalCurrent(current: FeedbackCloseState, approval: FeedbackCloseApproval, reviews: ReviewNotes) {
  return current.message === approval.state.message && current.editingId === approval.state.editingId
    && current.attempted === approval.state.attempted && (!approval.savedNote || noteIsSaved(reviews, approval.savedNote));
}

export async function approveFeedbackClose(
  current: () => FeedbackCloseState,
  reviews: ReviewNotes,
  choose: (note: FeedbackMessage, editing: boolean) => Promise<string>,
): Promise<FeedbackCloseApproval | undefined> {
  const before = current(), approval: FeedbackCloseApproval = { state: before };
  if (!before.message || before.attempted) return approval;
  const note = { ...before.message, id: before.editingId ?? before.message.id };
  if (noteIsSaved(reviews, note)) return { ...approval, savedNote: note };
  const choice = await choose(note, !!before.editingId);
  if (choice !== 'Save to Notes' && choice !== 'Discard') return;
  if (!feedbackApprovalCurrent(current(), approval, reviews)) throw Error('The request changed during confirmation. Try again.');
  if (choice === 'Discard') return approval;
  await reviews.save(note);
  if (!feedbackApprovalCurrent(current(), approval, reviews)) throw Error('The request changed while saving. Try again.');
  return { ...approval, savedNote: note };
}

export interface CloseApproval {
  path: string;
  revision: number;
  discard: boolean;
}

export async function approveClose(
  documents: Documents,
  path: string,
  choose: (doc: Document) => Promise<string>,
): Promise<CloseApproval | undefined> {
  const before = documents.get(path);
  if (!before) return;
  if (before.saving) throw new Error("Wait for the save to finish.");
  let discard = false;
  if (dirty(before)) {
    const choice = await choose(before);
    if (choice === "Cancel") return;
    discard = choice === "Discard";
    if (discard && documents.get(path)?.revision !== before.revision)
      throw new Error("The draft changed during confirmation. Try again.");
    if (!discard && !(await documents.save(path))) return;
  }
  const current = documents.get(path);
  if (!current || current.saving || (!discard && dirty(current))) return;
  return { path, revision: current.revision, discard };
}

export function approvalsCurrent(documents: Documents, approvals: CloseApproval[], all = false) {
  return (!all || documents.docs.length === approvals.length) && approvals.every(
    (approval) => {
      const doc = documents.get(approval.path);
      return doc && doc.revision === approval.revision && !doc.saving;
    },
  );
}
