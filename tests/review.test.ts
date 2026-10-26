import { describe, expect, it, vi } from 'vitest';
import { batchMessage, emptyReview, ReviewNotes, type ReviewRecord } from '../src/review';
import type { FeedbackMessage } from '../src/inspection';

const note = (id = 'note-1'): FeedbackMessage => ({ id, source: 'sidelit', projectRoot: '/repo', intent: 'edit', document: { path: '/repo/doc.md', format: 'markdown', revision: 1, diskHash: 'hash', unsaved: true }, selection: { type: 'text', text: 'Keep the spacing', anchorText: 'Keep the spacing', prefix: 'Before ' }, instruction: 'Make this clearer.' });
function setup(saved = emptyReview()) {
  let disk = structuredClone(saved);
  const io = {
    loadReview: vi.fn(async () => structuredClone(disk)),
    storeReview: vi.fn(async (record: ReviewRecord) => { disk = structuredClone(record); }),
    sendReview: vi.fn(async (_target: string, message: { id: string }) => ({ id: message.id, status: 'received' as const, delivery: 'queued' as const })),
    feedbackStatus: vi.fn(async (_target: string, id: string) => ({ id, status: 'accepted' as const, delivery: 'consumed' as const })),
  };
  return { io, store: new ReviewNotes(io), disk: () => disk };
}

describe('review notes', () => {
  it('saves notes only on request, restores capture context without sending, and deletes explicitly', async () => {
    const { io, store, disk } = setup(); await store.load();
    await store.save(note());
    expect(disk().notes[0]).toEqual(note());
    expect(store.restored('note-1')).toBe(false);
    const restarted = new ReviewNotes(io); await restarted.load();
    expect(restarted.snapshot().record.notes[0]).toEqual(note());
    expect(restarted.restored('note-1')).toBe(true);
    expect(io.sendReview).not.toHaveBeenCalled();
    await restarted.clear(); expect(disk().notes).toEqual([]);
  });
  it('keeps previous notes on a failed write and refuses to overwrite unreadable data', async () => {
    const { io, store } = setup(); await store.load(); await store.save(note());
    io.storeReview.mockRejectedValueOnce(Error('disk full'));
    await expect(store.save({ ...note(), instruction: 'new' })).rejects.toThrow('disk full');
    expect(store.snapshot().record.notes[0].instruction).toBe('Make this clearer.');
    const broken = new ReviewNotes({ ...io, loadReview: async () => { throw Error('invalid saved data'); } });
    await broken.load();
    expect(broken.snapshot()).toMatchObject({ ready: false, error: 'Error: invalid saved data' });
    await expect(broken.save(note())).rejects.toThrow('loading');
    await broken.clear(); expect(broken.snapshot().ready).toBe(true);
  });
  it('bounds notes, instructions, and aggregate UTF-8 payloads', async () => {
    const { store } = setup(); await store.load();
    for (let i = 0; i < 20; i++) await store.save(note(String(i)));
    await expect(store.save(note('extra'))).rejects.toThrow('full');
    await store.save({ ...note('0'), instruction: 'Updated' });
    expect(store.snapshot().record.notes).toHaveLength(20);
    expect(() => batchMessage([], 'batch')).toThrow('Select');
    expect(() => batchMessage([note(), note()], 'batch')).toThrow('unique');
    expect(() => batchMessage([{ ...note(), instruction: '語'.repeat(2500) }], 'batch')).toThrow('too long');
    const large = Array.from({ length: 8 }, (_, i) => ({ ...note(String(i)), instruction: '語'.repeat(2000) }));
    expect(() => batchMessage(large, 'batch')).toThrow('30 KiB');
  });
  it('preserves individual intents, blocks mixed projects, and strips UI-only anchors', () => {
    const message = batchMessage([note(), { ...note('two'), intent: 'explain', instruction: '' }], 'batch');
    expect(message.notes[0].instruction).toContain('requested edit');
    expect(message.notes[1].instruction).toContain('without editing files');
    expect(message.notes[0].selection.anchorText).toBeUndefined();
    expect(note().selection.anchorText).toBe('Keep the spacing');
    expect(() => batchMessage([note(), { ...note('two'), projectRoot: '/other' }], 'batch')).toThrow('one project');
    expect(() => batchMessage([{ ...note(), instruction: ' ' }], 'batch')).toThrow('change instruction');
    const page = { ...note(), projectRoot: undefined, document: { format: 'url' as const, url: 'http://localhost:3000/a' } };
    expect(batchMessage([page, { ...page, id: 'two', document: { ...page.document, url: 'http://localhost:3000/b' } }], 'batch').notes).toHaveLength(2);
    expect(() => batchMessage([page, { ...page, id: 'two', document: { ...page.document, url: 'http://localhost:4000' } }], 'batch')).toThrow('one project');
  });
  it('persists before sending and retries the identical batch and target across restarts', async () => {
    const { io, store, disk } = setup(); await store.load(); await store.save(note()); await store.save(note('two'));
    const message = batchMessage(store.snapshot().record.notes, 'batch');
    io.sendReview.mockImplementationOnce(async () => { expect(disk().attempt?.message).toEqual(message); throw Error('lost acknowledgment'); });
    await expect(store.send('pi-1', message, () => true)).rejects.toThrow('lost acknowledgment');
    await expect(store.save({ ...note(), instruction: 'changed' })).rejects.toThrow('cannot be edited');
    await expect(store.remove('note-1')).rejects.toThrow('delivery record');
    const restarted = new ReviewNotes(io); await restarted.load();
    await restarted.send('pi-2', { ...message, id: 'changed' }, () => true);
    expect(io.sendReview).toHaveBeenLastCalledWith('pi-1', message);
    expect(disk().attempt?.ack?.status).toBe('received');
    await restarted.checkStatus(); expect(disk().attempt?.ack?.status).toBe('accepted');
    const writes = io.storeReview.mock.calls.length;
    await restarted.checkStatus(); expect(io.storeReview).toHaveBeenCalledTimes(writes);
    await restarted.save(note('later'));
    await restarted.clearAttempt(); expect(disk().notes.map(note => note.id)).toEqual(['later']);
    expect(disk().attempt).toBeUndefined();
  });
  it('never sends after a failed checkpoint or a stale capture and freezes failed checkpoints for retry', async () => {
    const { io, store } = setup(); await store.load(); await store.save(note());
    const message = batchMessage(store.snapshot().record.notes, 'batch');
    await expect(store.send('pi', message, () => false)).rejects.toThrow('changed');
    expect(store.snapshot().record.attempt).toBeUndefined();
    io.storeReview.mockRejectedValueOnce(Error('disk full'));
    await expect(store.send('pi', message, () => true)).rejects.toThrow('disk full');
    expect(io.sendReview).not.toHaveBeenCalled();
    let checks = 0;
    await expect(store.send('other', message, () => ++checks === 1)).rejects.toThrow('changed');
    expect(io.sendReview).not.toHaveBeenCalled();
    await store.send('other', message, () => true);
    expect(io.sendReview).toHaveBeenCalledWith('pi', message);
  });
  it('blocks concurrent operations and refuses payloads made before a note changed', async () => {
    const { io, store } = setup(); await store.load(); await store.save(note());
    const old = batchMessage(store.snapshot().record.notes, 'batch');
    await store.save({ ...note(), instruction: 'new' });
    await expect(store.send('pi', old, () => true)).rejects.toThrow('notes changed');
    let release!: () => void;
    io.storeReview.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const saving = store.save(note('two'));
    await expect(store.remove('note-1')).rejects.toThrow('Wait');
    await expect(store.clear()).rejects.toThrow('Wait');
    release(); await saving;
    expect(store.snapshot().record.notes).toHaveLength(2);
  });
});
