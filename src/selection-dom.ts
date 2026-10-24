import { bounded, type SelectionContext } from './inspection';

// Quote anchors deliberately refuse ambiguous matches rather than highlight the wrong passage.
export function locateSelection(root: Element, context: SelectionContext): Range | Element | null {
  if (context.type === 'element' && context.selector) {
    try {
      const el = root.ownerDocument.querySelector(context.selector);
      return el && root.contains(el) && el.tagName.toLowerCase() === context.tag
        && (el.id || undefined) === (context.id || undefined)
        && bounded(el.textContent ?? '', 800) === context.text
        && (context.classes ?? []).every(name => el.classList.contains(name)) ? el : null;
    } catch { return null; }
  }
  if (context.type !== 'text' || !context.text) return null;
  const quote = context.anchorText ?? context.text;
  if (!quote) return null;
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = []; let text = '', node: Node | null;
  while ((node = walker.nextNode()) && nodes.length < 20000 && text.length < 2000000) {
    if (node.parentElement?.closest('[data-sidelit-overlay]')) continue;
    nodes.push(node as Text); text += node.textContent;
  }
  const matches: number[] = [];
  for (let from = 0, at; (at = text.indexOf(quote, from)) >= 0; from = at + 1) {
    if ((!context.prefix || text.slice(Math.max(0, at - context.prefix.length), at) === context.prefix)
      && (!context.suffix || text.slice(at + quote.length, at + quote.length + context.suffix.length) === context.suffix)) matches.push(at);
    if (matches.length > 1) return null;
  }
  const start = matches[0] ?? -1;
  if (start < 0) return null;
  const range = root.ownerDocument.createRange(); let offset = 0, started = false;
  for (const node of nodes) {
    const end = offset + node.length;
    if (!started && start < end) { range.setStart(node, start - offset); started = true; }
    if (started && start + quote.length <= end) { range.setEnd(node, start + quote.length - offset); return range; }
    offset = end;
  }
  return null;
}

export function markSelection(root: Element, context: SelectionContext, reveal = false) {
  const target = locateSelection(root, context);
  if (!target) return () => {};
  const element = target instanceof Element ? target : target.startContainer.parentElement;
  if (reveal) element?.scrollIntoView({ block: 'center' });
  const overlay = document.createElement('div'); overlay.dataset.sidelitOverlay = '';
  overlay.className = 'selection-highlight'; document.body.append(overlay);
  const draw = () => {
    overlay.replaceChildren();
    const clip = (root.closest('.rich-editor') ?? root).getBoundingClientRect();
    for (const rect of Array.from(target.getClientRects()).slice(0, 100)) {
      const left = Math.max(rect.left, clip.left), top = Math.max(rect.top, clip.top);
      const right = Math.min(rect.right, clip.right), bottom = Math.min(rect.bottom, clip.bottom);
      if (right <= left || bottom <= top) continue;
      const part = document.createElement('i');
      Object.assign(part.style, { left: left + 'px', top: top + 'px', width: right - left + 'px', height: bottom - top + 'px' });
      overlay.append(part);
    }
  };
  draw(); document.addEventListener('scroll', draw, true); window.addEventListener('resize', draw);
  const resize = new ResizeObserver(draw); resize.observe(root);
  return () => { overlay.remove(); resize.disconnect(); document.removeEventListener('scroll', draw, true); window.removeEventListener('resize', draw); };
}
