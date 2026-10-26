import { describe, expect, it, vi } from "vitest";
import { Documents } from "../src/documents";
import { approveClose, approvalsCurrent, approveFeedbackClose, feedbackApprovalCurrent, type CloseApproval, type FeedbackCloseState } from "../src/closing";
import { ReviewNotes, emptyReview } from "../src/review";
import type { FeedbackMessage } from "../src/inspection";

function setup() {
  const store = new Documents({ read: async () => ({ text: "base", hash: "base" }), save: async () => { throw new Error("Not used"); } });
  for (const path of ["/a.md", "/b.md"]) store.open({ path, parent: "/", snapshot: { text: "base", hash: "base" } });
  return store;
}

it("checks live tab state after an earlier confirmation", async () => {
  const store = setup();
  store.edit("/a.md", "draft a");
  const asked: string[] = [];
  const approvals: CloseApproval[] = [];
  for (const old of [...store.docs]) {
    const approved = await approveClose(store, old.path, async (current) => {
      asked.push(current.path);
      if (current.path === "/a.md") store.edit("/b.md", "new draft b");
      return current.path === "/a.md" ? "Discard" : "Cancel";
    });
    if (!approved) break;
    approvals.push(approved);
  }
  expect(asked).toEqual(["/a.md", "/b.md"]);
  expect(approvalsCurrent(store, approvals, true)).toBe(false);
  expect(store.get("/b.md")!.text).toBe("new draft b");
});

it("rejects edits and new tabs after approval, including during a final checkpoint", async () => {
  const store = setup();
  const approvals = (await Promise.all(store.docs.map((d) => approveClose(store, d.path, async () => "Cancel")))) as CloseApproval[];
  expect(approvalsCurrent(store, approvals, true)).toBe(true);
  store.edit("/a.md", "late draft");
  expect(approvalsCurrent(store, approvals, true)).toBe(false);
  const other = setup();
  other.open({ path: "/c.md", parent: "/", snapshot: { text: "base", hash: "base" } });
  expect(approvalsCurrent(other, approvals, true)).toBe(false);
});

it("does not discard edits newer than the displayed prompt", async () => {
  const store = setup();
  store.edit("/a.md", "first draft");
  await expect(approveClose(store, "/a.md", async () => {
    store.edit("/a.md", "newer draft");
    return "Discard";
  })).rejects.toThrow("changed during confirmation");
  expect(store.get("/a.md")!.text).toBe("newer draft");
});

it("does not close a document with a save in progress", async () => {
  const store = setup();
  store.update("/a.md", { saving: true });
  await expect(approveClose(store, "/a.md", async () => "Discard")).rejects.toThrow("save to finish");
});

async function feedbackSetup() {
  const message: FeedbackMessage = { id: 'draft', source: 'sidelit', intent: 'explain', projectRoot: '/repo', document: { path: '/repo/notes.md', format: 'markdown', revision: 1 }, selection: { type: 'text', text: 'Keep this capture' }, instruction: '' };
  const io = { loadReview: async () => emptyReview(), storeReview: vi.fn(async () => {}), sendReview: vi.fn(), feedbackStatus: vi.fn() };
  const reviews = new ReviewNotes(io); await reviews.load();
  const live = { state: { message, attempted: false } as FeedbackCloseState };
  return { message, io, reviews, live, current: () => live.state };
}

describe('feedback exit approvals', () => {
  it('cancels safely and stages discard without deleting the draft', async () => {
    const { current, reviews, message, io } = await feedbackSetup();
    expect(await approveFeedbackClose(current, reviews, async () => 'Cancel')).toBeUndefined();
    expect(await approveFeedbackClose(current, reviews, async () => 'unknown')).toBeUndefined();
    const approval = await approveFeedbackClose(current, reviews, async () => 'Discard');
    expect(feedbackApprovalCurrent(current(), approval!, reviews)).toBe(true);
    expect(current().message).toBe(message);
    expect(io.storeReview).not.toHaveBeenCalled();
  });
  it('waits for durable storage without sending, including an Explain request with no instruction', async () => {
    const { current, reviews, message, io } = await feedbackSetup();
    let finish!: () => void;
    io.storeReview.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    let done = false;
    const pending = approveFeedbackClose(current, reviews, async () => 'Save to Notes').then(value => { done = true; return value; });
    await vi.waitFor(() => expect(io.storeReview).toHaveBeenCalledOnce());
    expect(done).toBe(false); expect(reviews.snapshot().record.notes).toEqual([]);
    finish();
    const approval = await pending;
    expect(approval?.savedNote).toEqual(message);
    expect(feedbackApprovalCurrent(current(), approval!, reviews)).toBe(true);
    expect(io.sendReview).not.toHaveBeenCalled();
  });
  it('skips an unchanged saved note and updates changed captures under the original note ID', async () => {
    const { current, live, reviews, message } = await feedbackSetup();
    await reviews.save(message);
    live.state = { ...live.state, message: structuredClone(message), editingId: message.id };
    const choose = vi.fn(async () => 'Save to Notes');
    await approveFeedbackClose(current, reviews, choose);
    expect(choose).not.toHaveBeenCalled();
    live.state = { ...live.state, message: { ...message, id: 'replacement-capture', instruction: 'Explain more', selection: { type: 'text', text: 'New selection' } } };
    const approval = await approveFeedbackClose(current, reviews, choose);
    expect(choose).toHaveBeenCalledWith(expect.objectContaining({ id: 'draft' }), true);
    expect(reviews.snapshot().record.notes).toEqual([{ ...live.state.message, id: 'draft' }]);
    expect(feedbackApprovalCurrent(current(), approval!, reviews)).toBe(true);
  });
  it('does not save attempted deliveries as a new unsent note', async () => {
    const { current, live, reviews, io } = await feedbackSetup();
    live.state = { ...live.state, attempted: true };
    const choose = vi.fn(async () => 'Save to Notes');
    const approval = await approveFeedbackClose(current, reviews, choose);
    expect(approval?.savedNote).toBeUndefined(); expect(choose).not.toHaveBeenCalled();
    expect(io.storeReview).not.toHaveBeenCalled();
    live.state = { message: null, attempted: false };
    expect(await approveFeedbackClose(current, reviews, choose)).toBeDefined();
    expect(choose).not.toHaveBeenCalled();
  });
  it('rejects changes during confirmation, during save, and after approval', async () => {
    const { current, live, reviews, message, io } = await feedbackSetup();
    const edit = () => { live.state = { ...live.state, message: { ...message, instruction: 'Later edit' } }; };
    await expect(approveFeedbackClose(current, reviews, async () => { edit(); return 'Discard'; })).rejects.toThrow('changed during confirmation');
    live.state = { message, attempted: false };
    io.storeReview.mockImplementation(async () => { edit(); });
    await expect(approveFeedbackClose(current, reviews, async () => 'Save to Notes')).rejects.toThrow('changed while saving');
    expect(current().message?.instruction).toBe('Later edit');
    io.storeReview.mockImplementation(async () => {});
    const approval = await approveFeedbackClose(current, reviews, async () => 'Discard');
    live.state = { ...live.state, attempted: true };
    expect(feedbackApprovalCurrent(current(), approval!, reviews)).toBe(false);
    live.state = { message, attempted: false };
    const saved = await approveFeedbackClose(current, reviews, async () => 'Save to Notes');
    await reviews.remove(message.id);
    expect(feedbackApprovalCurrent(current(), saved!, reviews)).toBe(false);
  });
  it('retains the draft on storage failure, a full list, or unavailable storage', async () => {
    const { current, reviews, message, io } = await feedbackSetup();
    io.storeReview.mockRejectedValueOnce(Error('disk full'));
    await expect(approveFeedbackClose(current, reviews, async () => 'Save to Notes')).rejects.toThrow('disk full');
    expect(current().message).toBe(message); expect(reviews.snapshot().record.notes).toEqual([]);
    for (let i = 0; i < 20; i++) await reviews.save({ ...message, id: 'saved-' + i });
    await expect(approveFeedbackClose(current, reviews, async () => 'Save to Notes')).rejects.toThrow('list is full');
    const unavailable = new ReviewNotes({ ...io, loadReview: async () => { throw Error('unreadable'); } });
    await unavailable.load();
    await expect(approveFeedbackClose(current, unavailable, async () => 'Save to Notes')).rejects.toThrow('finish loading');
    expect(current().message).toBe(message);
    expect(io.sendReview).not.toHaveBeenCalled();
  });
});
