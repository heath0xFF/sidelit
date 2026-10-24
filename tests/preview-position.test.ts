import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Window } from 'happy-dom';
import bridge from '../extensions/preview-bridge/sidelit.js?raw';
import { forgetPreviewPosition, parsePreviewPosition, previewPosition, rememberPreviewPosition } from '../src/preview-position';

describe('bounded preview view state', () => {
  it('rejects non-finite or oversized payloads and strips unknown properties', () => {
    expect(parsePreviewPosition({ x: NaN, y: 0, url: '', containers: [] })).toBeUndefined();
    expect(parsePreviewPosition({ x: 0, y: 1e20, url: '', containers: [] })).toBeUndefined();
    expect(parsePreviewPosition({ x: 0, y: 0, url: '', containers: Array(9).fill({}) })).toBeUndefined();
    expect(parsePreviewPosition({ x: 1, y: 2, url: '', containers: [], command: 'invoke', anchor: { selector: 'x'.repeat(9000) } })).toEqual({ x: 1, y: 2, url: '', containers: [] });
  });
  it('remembers separate documents, caps the cache, and forgets closed documents', () => {
    const state = { x: 0, y: 200, url: '', containers: [] };
    rememberPreviewPosition('/one', state);
    rememberPreviewPosition('/two', { ...state, y: 500 });
    expect(previewPosition('/one')?.y).toBe(200);
    forgetPreviewPosition('/one'); expect(previewPosition('/one')).toBeUndefined();
    for (let i = 0; i < 32; i++) rememberPreviewPosition('/doc/' + i, state);
    expect(previewPosition('/two')).toBeUndefined();
  });
});

describe('isolated scroll bridge', () => {
  let frame: Window;
  let post: ReturnType<typeof vi.fn>;
  let parent: { postMessage: typeof post };
  let heading: any;
  let headingTop = 600;
  const host = (data: object = {}, origin = 'tauri://localhost') => frame.dispatchEvent(new frame.MessageEvent('message', {
    source: parent as any, origin, data: { source: 'sidelit-host', token: 'test-token', ...data },
  }));
  const scroll = () => { frame.document.dispatchEvent(new frame.Event('scroll', { bubbles: true })); vi.advanceTimersByTime(20); };
  const state = () => post.mock.calls.filter(([data]) => data.type === 'position').at(-1)?.[0].context;
  beforeEach(() => {
    vi.useFakeTimers();
    frame = new Window({ url: 'sidelit-preview://localhost/test' });
    post = vi.fn(); parent = { postMessage: post };
    Object.defineProperty(frame, 'parent', { value: parent });
    Object.defineProperty(frame, 'scrollY', { writable: true, value: 0 });
    Object.defineProperty(frame, 'scrollX', { writable: true, value: 0 });
    frame.scrollTo = ((p: ScrollToOptions) => { Object.assign(frame, { scrollY: p.top || 0, scrollX: p.left || 0 }); }) as any;
    frame.Date = Date;
    frame.setTimeout = setTimeout as any; frame.clearTimeout = clearTimeout as any;
    frame.requestAnimationFrame = ((cb: () => void) => setTimeout(cb, 16)) as any;
    frame.document.body.innerHTML = '<section><h2 id="reading">Current passage</h2><p>Other text</p></section><div id="scrollable"><p>Inside</p></div>';
    heading = frame.document.querySelector('h2')!;
    headingTop = 600;
    heading.getBoundingClientRect = () => ({ top: headingTop - frame.scrollY, left: 0, right: 600, bottom: headingTop + 30 - frame.scrollY });
    frame.document.elementFromPoint = () => heading;
    frame.eval(bridge);
  });
  afterEach(async () => { vi.clearAllTimers(); vi.useRealTimers(); await frame.happyDOM.close(); });
  it('captures a visible anchor, pixels and nested scroll areas only after a trusted handshake', () => {
    host({}, 'https://evil.example'); scroll(); expect(state()).toBeUndefined();
    Object.assign(frame, { scrollY: 560 }); host(); scroll();
    expect(state()).toMatchObject({ x: 0, y: 560, anchor: { selector: 'h2#reading', top: 40, text: 'Current passage' } });
    const inner = frame.document.querySelector('#scrollable')!;
    inner.scrollTop = 70;
    inner.dispatchEvent(new frame.Event('scroll')); vi.advanceTimersByTime(20);
    expect(state().containers[0]).toMatchObject({ selector: 'div#scrollable', y: 70 });
    const count = post.mock.calls.length;
    host({ enabled: false }); scroll();
    expect(post).toHaveBeenCalledTimes(count);
  });
  it('restores the same passage after content moves and waits for late layout', () => {
    host({ position: { x: 0, y: 560, anchor: { selector: 'h2#reading', text: 'Current passage', tag: 'h2', top: 40 }, containers: [] } });
    expect(frame.scrollY).toBe(560);
    headingTop += 300;
    vi.advanceTimersByTime(100);
    expect(frame.scrollY).toBe(860);
    vi.advanceTimersByTime(2100);
    expect(state()?.y).toBe(860);
    Object.assign(frame, { scrollY: 100 });
    host({ inspect: true, position: { x: 0, y: 560 } });
    expect(frame.scrollY).toBe(100); // Theme/inspection handshakes are not refreshes.
  });
  it('falls back to unique text when a sibling changes the selector, and to pixels when missing', () => {
    host({ position: { x: 0, y: 200, anchor: { selector: 'section > p', tag: 'h2', text: 'Current passage', top: 25 } } });
    expect(frame.scrollY).toBe(575);
    frame.document.querySelector('h2')!.remove();
    vi.advanceTimersByTime(100);
    expect(frame.scrollY).toBe(200);
  });
  it('yields to user scrolling instead of repeatedly snapping back', () => {
    host({ position: { x: 0, y: 560 } });
    frame.document.dispatchEvent(new frame.Event('wheel'));
    Object.assign(frame, { scrollY: 900 });
    vi.advanceTimersByTime(2200);
    expect(frame.scrollY).toBe(900);
  });
  it('does not restore a different development-server route', () => {
    frame.location.href = 'http://localhost:3000/new';
    host({ position: { x: 0, y: 560, url: 'http://localhost:3000/old' } });
    expect(frame.scrollY).toBe(0);
  });
  it('leaves browser shortcuts alone while the bridge is disabled', () => {
    const shortcut = () => {
      const event = new frame.KeyboardEvent('keydown', { key: 'r', metaKey: true, shiftKey: true, cancelable: true });
      frame.document.dispatchEvent(event); return event.defaultPrevented;
    };
    expect(shortcut()).toBe(false);
    host(); expect(shortcut()).toBe(true);
    host({ enabled: false }); expect(shortcut()).toBe(false);
  });
  it('reattaches bounded DOM quotes and refuses changed text or positional elements', () => {
    frame.Range.prototype.getClientRects = (() => []) as any;
    heading.getClientRects = () => [];
    const marked = () => frame.document.querySelectorAll('[data-sidelit-overlay]').length;
    host({ attachment: { type: 'text', text: 'Current passage\nOther text', anchorText: 'Current passageOther text', suffix: 'Inside' } });
    expect(marked()).toBe(1);
    host({ attachment: { type: 'text', text: 'Other text', prefix: 'A different passage' } });
    expect(marked()).toBe(0);
    const element = { type: 'element', selector: 'h2#reading', tag: 'h2', id: 'reading', text: 'Current passage', classes: [] };
    host({ attachment: element }); expect(marked()).toBe(1);
    heading.textContent = 'A replacement passage';
    host({ attachment: element }); expect(marked()).toBe(0);
  });
});
