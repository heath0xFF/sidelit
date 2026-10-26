// @vitest-environment happy-dom
import { act, useState, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FeedbackComposer from '../src/FeedbackComposer';
import { elementContext, feedbackSelection, textContext, type FeedbackMessage } from '../src/inspection';
import { locateSelection } from '../src/selection-dom';

vi.mock('../src/api', () => ({ api: { feedbackStatus: vi.fn(), focusAgent: vi.fn() } }));
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); root = undefined; });
const context = (): FeedbackMessage => ({ id: 'request-1', source: 'sidelit', intent: 'explain', document: { path: '/repo/doc.md', format: 'markdown', revision: 0 }, selection: { type: 'text', text: 'Selected words' }, instruction: 'Explain this carefully.' });
async function mount(send = vi.fn().mockResolvedValue({ id: 'request-1', status: 'accepted', delivery: 'consumed' }), extra: Partial<ComponentProps<typeof FeedbackComposer>> = {}) {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  function Fixture() {
    const [draft, setDraft] = useState(context), [open, setOpen] = useState(true);
    return <><button id="reopen" onClick={() => setOpen(true)}>Reopen</button><FeedbackComposer context={draft} open={open} targets={[{ id: 'pi', label: 'Pi', projectRoot: '/repo', connected: true, busy: false }]} targetId="pi" onTarget={() => {}} onChange={change => setDraft(value => ({ ...value, ...change }))} onSend={send} onClose={() => setOpen(false)} onDiscard={() => {}} loading={false} targetError="" onRefreshTargets={() => {}} stale={false} candidate={null} onReplace={() => {}} onReveal={() => {}} {...extra} /></>;
  }
  await act(async () => root!.render(<Fixture />)); return send;
}
describe('request continuity', () => {
  it('keeps quick delivery independent of review storage and saves notes without sending', async () => {
    const collect = vi.fn().mockRejectedValue(Error('disk full'));
    const send = await mount(undefined, { onCollect: collect, collectionBusy: false });
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Add to review')!.click());
    expect(collect).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled();
    expect(document.querySelector('textarea')!.value).toBe('Explain this carefully.');
    expect(document.body.textContent).toContain('disk full');
  });
  it('allows quick sending when review storage is unavailable', async () => {
    const send = await mount(undefined, { collectionBusy: true, onCollect: async () => {} });
    expect([...document.querySelectorAll('button')].find(b => b.textContent === 'Add to review')!.disabled).toBe(true);
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Send to Pi')!.click());
    expect(send).toHaveBeenCalledOnce();
  });
  it('edits a saved note without exposing a second delivery path', async () => {
    const collect = vi.fn();
    const send = await mount(undefined, { savedNote: true, onCollect: collect });
    expect([...document.querySelectorAll('button')].some(b => b.textContent === 'Send to Pi')).toBe(false);
    await act(async () => document.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })));
    expect(send).not.toHaveBeenCalled();
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Save note')!.click());
    expect(collect).toHaveBeenCalledOnce();
  });
  it('preserves a request while hidden, on repeated opening, and after Escape', async () => {
    await mount();
    const input = document.querySelector('textarea')!;
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector<HTMLElement>('.feedback-panel')!.hidden).toBe(true);
    await act(async () => document.querySelector<HTMLButtonElement>('#reopen')!.click());
    await act(async () => document.querySelector<HTMLButtonElement>('#reopen')!.click());
    expect(document.querySelector('textarea')!.value).toBe('Explain this carefully.');
    expect(document.activeElement).toBe(input);
  });
  it('sends answer-only intent with captured context and keeps delivery immutable', async () => {
    const send = await mount();
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Send to Pi')!;
    await act(async () => button.click());
    expect(send).toHaveBeenCalledWith('pi', expect.objectContaining({ id: 'request-1', intent: 'explain', instruction: expect.stringContaining('without editing files') }));
    expect(document.querySelector('textarea')!.readOnly).toBe(true);
    expect(document.body.textContent).toContain('Answers appear in Pi');
  });
  it('preserves whitespace, discloses truncation and strips geometry from wire context', () => {
    document.body.innerHTML = '<p>prefix <b>alpha\n  beta</b> suffix</p>';
    const root = document.querySelector('p')!, range = document.createRange(); range.selectNodeContents(root.querySelector('b')!);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    const captured = textContext(selection, undefined, root)!;
    expect(captured.text).toBe('alpha\n  beta'); expect(captured.prefix).toBe('prefix ');
    expect(locateSelection(root, captured)?.toString()).toBe(captured.text);
    expect(feedbackSelection({ ...captured, rect: { x: 1, y: 1, width: 2, height: 2 } }).rect).toBeUndefined();
    expect(feedbackSelection(captured).anchorText).toBeUndefined();
    expect(feedbackSelection({ type: 'text', text: 'x'.repeat(1400) }).truncated).toBe(true);
  });
  it('does not reattach repeated or deleted text to an arbitrary location', () => {
    document.body.innerHTML = '<article><p>A repeat Z</p><p>B repeat Y</p></article>';
    const root = document.querySelector('article')!;
    expect(locateSelection(root, { type: 'text', text: 'repeat' })).toBeNull();
    expect(locateSelection(root, { type: 'text', text: 'repeat', prefix: 'B ', suffix: ' Y' })?.toString()).toBe('repeat');
    expect(locateSelection(root, { type: 'text', text: 'missing' })).toBeNull();
    root.innerHTML = '<p>B repeat Y</p>';
    expect(locateSelection(root, { type: 'text', text: 'repeat', prefix: 'A ', suffix: ' Z' })).toBeNull();
  });
  it('does not retarget a positional element after another sibling is inserted', () => {
    document.body.innerHTML = '<article><p>First</p><p>Selected</p></article>';
    const root = document.querySelector('article')!, selected = root.lastElementChild!;
    const captured = elementContext(selected);
    expect(locateSelection(root, captured)).toBe(selected);
    root.insertAdjacentHTML('afterbegin', '<p>Inserted</p>');
    expect(locateSelection(root, captured)).toBeNull();
  });
  it('reattaches selections spanning rendered paragraph separators', () => {
    document.body.innerHTML = '<article><p>First paragraph</p><p>Second paragraph</p></article>';
    const root = document.querySelector('article')!, range = document.createRange();
    range.selectNodeContents(root);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    const stringify = vi.spyOn(selection, 'toString').mockReturnValue('First paragraph\n\nSecond paragraph');
    const captured = textContext(selection, undefined, root)!;
    expect(captured.text).toContain('\n\n');
    expect(locateSelection(root, captured)?.toString()).toBe('First paragraphSecond paragraph');
    stringify.mockRestore();
  });
});
