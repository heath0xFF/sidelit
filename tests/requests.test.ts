import { describe, expect, it, vi } from 'vitest';
import type { AgentTarget, DeliveryAck } from '../src/api';
import type { FeedbackMessage } from '../src/inspection';
import { MAX_REQUEST_HISTORY, Requests, requestStatus, selectRequest } from '../src/requests';

const target: AgentTarget = { id: 'pi-1', label: 'Pi', projectRoot: '/repo', connected: true, busy: false };
const context = (id = 'one'): FeedbackMessage => ({ id, source: 'sidelit', intent: 'edit', document: { path: '/repo/doc.md', format: 'markdown' }, selection: { type: 'text', text: id }, instruction: 'Make it clearer.' });
const receipt = (id: string, status: DeliveryAck['status'] = 'accepted'): DeliveryAck => ({ id, status, delivery: status === 'received' ? 'queued' : status === 'failed' ? 'none' : 'consumed' });
function fixture() {
  const io = {
    sendFeedback: vi.fn(async (_target: string, message: FeedbackMessage) => receipt(message.id)),
    feedbackStatus: vi.fn(async (_target: string, id: string) => receipt(id, 'settled')),
    requestChanges: vi.fn(async (_id: string) => ({ files: [{ path: '/repo/doc.md', status: 'modified' as const }], incomplete: false })),
  };
  return { io, store: new Requests(io) };
}

describe('session request history', () => {
  it('starts fresh for every intent after sending, but protects unsent drafts and saved note edits', () => {
    const old = context();
    for (const intent of ['edit', 'explain', 'review'] as const) {
      const next = { ...context('two'), intent, instruction: '' };
      expect(selectRequest(old, next, true)).toEqual({ feedback: next, candidate: null });
      expect(selectRequest(old, next, false)).toEqual({ feedback: old, candidate: next });
      expect(selectRequest(null, next, false)).toEqual({ feedback: next, candidate: null });
    }
    expect(selectRequest(old, { ...old, id: 'two' }, false)).toEqual({ feedback: old, candidate: null });
    expect(selectRequest(old, { ...old, document: { ...old.document, path: '/other.md' } }, false).candidate).not.toBeNull();
  });
  it('keeps tracking an earlier request while another request is composed and sent', async () => {
    const { io, store } = fixture();
    await store.send(context(), target, context());
    const next = selectRequest(context(), context('two'), true).feedback;
    await store.send(next, target, next);
    await store.check('one');
    expect(store.snapshot().map(item => [item.context.id, item.ack?.status])).toEqual([['two', 'accepted'], ['one', 'settled']]);
    expect(io.requestChanges).toHaveBeenCalledWith('one');
    expect(store.snapshot()[1].report?.files[0].path).toBe('/repo/doc.md');
    store.poll();
    await vi.waitFor(() => expect(store.snapshot()[0].ack?.status).toBe('settled'));
    expect(io.feedbackStatus).toHaveBeenCalledTimes(2);
    expect(new Requests(io).snapshot()).toEqual([]);
  });
  it('freezes the ID, target, and payload before awaiting delivery and never duplicates a concurrent send', async () => {
    const { io, store } = fixture();
    let finish!: (ack: DeliveryAck) => void;
    io.sendFeedback.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const original = context(), message = { ...context(), instruction: 'Wire instructions' };
    const sent = store.send(original, target, message);
    expect(store.snapshot()[0].sending).toBe(true);
    original.instruction = 'Changed'; message.instruction = 'Changed';
    await store.send(context(), { ...target, id: 'another-pi' }, context());
    expect(io.sendFeedback).toHaveBeenCalledOnce();
    finish(receipt('one')); await sent;
    expect(store.snapshot()[0].context.instruction).toBe('Make it clearer.');
    expect(store.snapshot()[0].message.instruction).toBe('Wire instructions');
    expect(store.snapshot()[0].target.id).toBe('pi-1');
  });
  it('keeps uncertain deliveries and retries the exact same payload and target', async () => {
    const { io, store } = fixture();
    io.sendFeedback.mockRejectedValueOnce(Error('Lost connection'));
    await store.send(context(), target, { ...context(), instruction: 'Original wire payload' });
    expect(store.snapshot()[0].ack).toBeUndefined();
    expect(requestStatus(store.snapshot()[0])).toBe('Needs attention');
    await store.send(context(), { ...target, id: 'wrong-pi' }, { ...context(), instruction: 'Wrong payload' });
    expect(io.sendFeedback.mock.calls[1]).toEqual(io.sendFeedback.mock.calls[0]);
  });
  it('checks a lost receipt without resending, and stops retries after acceptance', async () => {
    const { io, store } = fixture();
    io.sendFeedback.mockRejectedValueOnce(Error('Lost receipt'));
    await store.send(context(), target, context());
    await store.check('one');
    await store.send(context(), target, context());
    expect(io.sendFeedback).toHaveBeenCalledOnce();
    expect(store.snapshot()[0].ack?.status).toBe('settled');
  });
  it('allows a frozen retry when Pi reports that the request never started', async () => {
    const { io, store } = fixture();
    io.feedbackStatus.mockResolvedValueOnce(receipt('one', 'failed'));
    await store.send(context(), target, context());
    await store.check('one');
    expect(store.snapshot()[0].error).toContain('Pi did not start');
    expect(store.snapshot()[0].ack).toBeUndefined();
    store.poll();
    expect(io.feedbackStatus).toHaveBeenCalledOnce();
    await store.send(context(), target, context());
    expect(io.sendFeedback.mock.calls[1]).toEqual(io.sendFeedback.mock.calls[0]);
  });
  it('preserves acceptance through status errors and rejects acknowledgments for other requests', async () => {
    const { io, store } = fixture();
    await store.send(context(), target, context());
    io.feedbackStatus.mockRejectedValueOnce(Error('Pi closed'));
    await store.check('one');
    expect(store.snapshot()[0].ack?.status).toBe('accepted');
    io.feedbackStatus.mockResolvedValueOnce(receipt('wrong', 'settled'));
    await store.check('one');
    expect(store.snapshot()[0].error).toContain('different request');
    expect(io.requestChanges).not.toHaveBeenCalled();
  });
  it('does not lose delivery status when an older change comparison is unavailable', async () => {
    const { io, store } = fixture();
    io.requestChanges.mockRejectedValueOnce(Error('Snapshot expired'));
    await store.send(context(), target, context());
    await store.check('one');
    expect(store.snapshot()[0]).toMatchObject({ ack: { status: 'settled' }, report: null, error: '' });
  });
  it('bounds history without evicting pending or uncertain deliveries', async () => {
    const { store } = fixture();
    for (let i = 0; i < MAX_REQUEST_HISTORY; i++) await store.send(context(String(i)), target, context(String(i)));
    await expect(store.send(context('overflow'), target, context('overflow'))).rejects.toThrow('pending deliveries');
    await store.check('1');
    await store.send(context('overflow'), target, context('overflow'));
    expect(store.snapshot()).toHaveLength(MAX_REQUEST_HISTORY);
    expect(store.snapshot().some(item => item.context.id === '0')).toBe(true);
    expect(store.snapshot().some(item => item.context.id === '1')).toBe(false);
  });
});
