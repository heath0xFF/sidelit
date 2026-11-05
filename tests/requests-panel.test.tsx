// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RequestsPanel from '../src/RequestsPanel';
import { Requests } from '../src/requests';
import type { AgentTarget, DeliveryAck } from '../src/api';
import type { FeedbackMessage } from '../src/inspection';

vi.mock('../src/api', () => ({ api: { focusAgent: vi.fn(), requestChanges: vi.fn() } }));
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); root = undefined; });
const target: AgentTarget = { id: 'pi', label: 'Original Pi', projectRoot: '/repo', connected: true, busy: false };
const context = (id: string, path = '/repo/one.md'): FeedbackMessage => ({ id, source: 'sidelit', intent: 'explain', document: { path, format: 'markdown' }, selection: { type: 'text', text: 'Captured ' + id }, instruction: 'Explain ' + id });
function fixture() {
  const io = {
    sendFeedback: vi.fn(async (_: string, message: FeedbackMessage): Promise<DeliveryAck> => ({ id: message.id, status: 'received', delivery: 'queued' })),
    feedbackStatus: vi.fn(async (_: string, id: string): Promise<DeliveryAck> => ({ id, status: 'settled', delivery: 'consumed' })),
    requestChanges: vi.fn(async () => ({ files: [{ path: '/repo/one.md', status: 'modified' as const }], incomplete: false })),
  };
  const store = new Requests(io), reveal = vi.fn(), open = vi.fn(), inspect = vi.fn();
  async function render(path?: string, url?: string) {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    if (!root) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); }
    await act(async () => root!.render(<RequestsPanel store={store} path={path} url={url} onReveal={reveal} onOpenChange={open} onInspect={inspect} onError={vi.fn()} />));
  }
  return { io, store, reveal, open, inspect, render };
}
describe('document Requests sidebar', () => {
  it('filters by exact file or page, newest first, with useful empty states', async () => {
    const { store, render } = fixture();
    for (const item of [context('first'), context('other', '/repo/two.md'), context('latest')]) await store.send(item, target, item);
    const page = { ...context('page'), document: { format: 'url' as const, url: 'http://localhost/page' } };
    await store.send(page, target, page);
    await render('/repo/one.md');
    expect([...document.querySelectorAll('summary strong')].map(node => node.textContent)).toEqual(['Explain', 'Explain']);
    expect([...document.querySelectorAll('.request-history-excerpt')].map(node => node.textContent)).toEqual(['Explain latest', 'Explain first']);
    await render('/repo/one.md', 'http://localhost/page');
    expect(document.querySelectorAll('li')).toHaveLength(1);
    expect(document.body.textContent).toContain('Explain page');
    await render('/repo/one.md', 'http://localhost/different-page');
    expect(document.body.textContent).toContain('No requests sent');
    await render();
    expect(document.body.textContent).toContain('Open a document');
  });
  it('reveals the original capture, keeps cached changes, and never calls a finished turn success', async () => {
    const { store, render, reveal, open, io } = fixture();
    const item = context('first');
    await store.send(item, target, item); await store.check(item.id);
    await render('/repo/one.md');
    expect(document.body.textContent).toContain('This does not mean the request succeeded');
    expect(document.body.textContent).toContain('by Pi or anything else');
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Reveal selection')!.click());
    expect(reveal).toHaveBeenCalledWith(item);
    await act(async () => document.querySelector<HTMLButtonElement>('.request-file')!.click());
    expect(open).toHaveBeenCalledWith('first', '/repo/one.md');
    await render('/repo/two.md'); await render('/repo/one.md');
    expect(io.requestChanges).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain('Retry delivery');
  });
  it('retains uncertain deliveries and checks receipts without sending again', async () => {
    const { store, io, render } = fixture();
    io.sendFeedback.mockRejectedValueOnce(Error('Receipt lost'));
    await store.send(context('lost'), target, context('lost'));
    await render('/repo/one.md');
    expect(document.body.textContent).toContain('Needs attention');
    expect(document.body.textContent).toContain('Retry delivery');
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Check receipt')!.click());
    expect(io.sendFeedback).toHaveBeenCalledOnce();
    expect(document.body.textContent).toContain('Pi finished its turn');
    expect(document.body.textContent).not.toContain('Retry delivery');
  });
});
