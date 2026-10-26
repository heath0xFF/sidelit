// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReviewPanel from '../src/ReviewPanel';
import { api } from '../src/api';
import { emptyReview, ReviewNotes } from '../src/review';
import type { FeedbackMessage } from '../src/inspection';

vi.mock('../src/api', () => ({ api: { agentTargets: vi.fn(), focusAgent: vi.fn() } }));
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); root = undefined; });
const note = (id: string): FeedbackMessage => ({ id, source: 'sidelit', intent: 'explain', projectRoot: '/repo', document: { path: `/repo/${id}.md`, format: 'markdown', revision: 0 }, selection: { type: 'text', text: `Quote ${id}` }, instruction: '' });
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.review-panel button')].find(b => b.textContent === text)!;
async function fixture(stale = false) {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(api.agentTargets).mockResolvedValue([{ id: 'pi', label: 'Pi', projectRoot: '/repo', connected: true, busy: false }]);
  const send = vi.fn(async (_target: string, message: { id: string }) => ({ id: message.id, status: 'accepted' as const, delivery: 'consumed' as const }));
  const store = new ReviewNotes({ loadReview: async () => emptyReview(), storeReview: async () => {}, sendReview: send, feedbackStatus: async () => { throw Error('unused'); } });
  await store.load(); await store.save(note('one')); await store.save(note('two'));
  const onEdit = vi.fn(), onReveal = vi.fn(), onClose = vi.fn();
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const render = (open: boolean) => act(async () => root!.render(<ReviewPanel store={store} open={open} onClose={onClose} onEdit={onEdit} onReveal={onReveal} isStale={() => stale} confirm={async () => true} />));
  await render(true);
  return { store, send, onEdit, onReveal, onClose, render };
}
async function selectNote() { await act(async () => document.querySelector<HTMLInputElement>('input[aria-label="Select note 1"]')!.click()); }
async function selectTarget() { await act(async () => { const select = document.querySelector<HTMLSelectElement>('select[aria-label="Review target"]')!; select.value = 'pi'; select.dispatchEvent(new Event('change', { bubbles: true })); }); }
describe('review list controls', () => {
  it('requires an explicit target, shows the exact payload, and sends only selected notes', async () => {
    const { send } = await fixture();
    expect(document.activeElement?.tagName).toBe('H2');
    expect(button('Send selected to Pi').disabled).toBe(true);
    await selectNote(); expect(button('Send selected to Pi').disabled).toBe(true);
    expect(document.querySelector('.review-payload pre')?.textContent).toContain('Quote one');
    expect(document.querySelector('.review-payload pre')?.textContent).not.toContain('Quote two');
    await selectTarget(); await act(async () => button('Send selected to Pi').click());
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe('pi');
    expect((send.mock.calls[0][1] as any).notes.map((n: FeedbackMessage) => n.id)).toEqual(['one']);
    expect(document.body.textContent).toContain('Acceptance does not mean the work is finished');
    expect(button('Edit note').disabled).toBe(true);
    const rows = document.querySelectorAll('.review-list li');
    expect(rows[0].textContent).toContain('Accepted');
    expect(rows[1].textContent).toContain('Unsent');
  });
  it('retains the list on Hide, reveals captures, and requires stale-context consent', async () => {
    const { send, onReveal, render } = await fixture(true);
    await act(async () => button('Reveal selection').click()); expect(onReveal).toHaveBeenCalledWith(note('one'));
    await selectNote(); await selectTarget(); expect(button('Send selected to Pi').disabled).toBe(true);
    await act(async () => document.querySelector<HTMLInputElement>('.review-stale input')!.click());
    expect(button('Send selected to Pi').disabled).toBe(false);
    await render(false); expect(document.querySelector<HTMLElement>('.review-panel')!.hidden).toBe(true);
    await render(true); expect(document.querySelector<HTMLInputElement>('input[aria-label="Select note 1"]')!.checked).toBe(true);
    expect(send).not.toHaveBeenCalled();
    await selectTarget(); await act(async () => button('Send selected to Pi').click()); expect(send).toHaveBeenCalledTimes(1);
  });
  it('supports edit and removal without changing document content', async () => {
    const { store, onEdit } = await fixture();
    await act(async () => button('Edit note').click()); expect(onEdit).toHaveBeenCalledWith(note('one'));
    await act(async () => button('Remove').click());
    expect(store.snapshot().record.notes.map(n => n.id)).toEqual(['two']);
    await act(async () => button('Delete all saved notes').click()); expect(store.snapshot().record.notes).toEqual([]);
    expect(document.body.textContent).toContain('Add to review');
  });
});
