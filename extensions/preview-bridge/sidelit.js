// Include only in a local development build. No native APIs are exposed.
(() => {
  if (window.parent === window) return;
  let token = '', hostOrigin = '', inspect = false, overlay, selected;
  const pendingErrors = [];
  const bound = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const send = (type, context) => {
    if ((type === 'text' || type === 'element') && context) context.url = location.href.slice(0, 4096);
    if (token) parent.postMessage({ source: 'sidelit-preview', token, type, context }, hostOrigin);
    else if (type === 'error' && pendingErrors.length < 8) pendingErrors.push(context);
  };
  const clear = () => { overlay?.remove(); overlay = undefined; };
  const highlight = element => {
    if (!element || element === overlay) return;
    const rect = element.getBoundingClientRect();
    if (!overlay) { overlay = document.createElement('div'); overlay.dataset.sidelitOverlay = ''; document.documentElement.append(overlay); }
    overlay.style.cssText = `position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #ffc477;outline:1px solid #30261a;box-sizing:border-box;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;`;
  };
  const selector = element => {
    const parts = [];
    for (let el = element; el && parts.length < 5; el = el.parentElement) {
      let part = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(part + '#' + CSS.escape(el.id)); break; }
      part += [...el.classList].slice(0, 2).map(name => '.' + CSS.escape(name)).join('');
      const siblings = [...(el.parentElement?.children || [])].filter(s => s.tagName === el.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(el) + 1})`;
      parts.unshift(part);
    }
    return bound(parts.join(' > '), 500);
  };
  let attachment, attachmentOverlay, attachmentTimer;
  const rectData = rect => ({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
  const attachedTarget = () => {
    if (!attachment) return;
    if (attachment.pageUrl && attachment.pageUrl !== location.href) return;
    if (attachment.type === 'element' && typeof attachment.selector === 'string') {
      const el = query(attachment.selector);
      return el && el.tagName.toLowerCase() === attachment.tag
        && (el.id || undefined) === (attachment.id || undefined)
        && bound(el.textContent, 800) === attachment.text
        && (attachment.classes || []).every(name => el.classList.contains(name)) ? el : undefined;
    }
    if (attachment.type !== 'text' || typeof attachment.text !== 'string' || !attachment.text || attachment.text.length > 1200) return;
    const quote = attachment.anchorText ?? attachment.text;
    if (typeof quote !== 'string' || !quote || quote.length > 1200 || !document.body) return;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), nodes = [];
    let text = '', node;
    while ((node = walker.nextNode()) && nodes.length < 20000 && text.length < 2000000) {
      if (node.parentElement?.closest('[data-sidelit-overlay]')) continue;
      nodes.push(node); text += node.textContent;
    }
    const matches = [];
    for (let from = 0, at; (at = text.indexOf(quote, from)) >= 0; from = at + 1) {
      if ((!attachment.prefix || text.slice(Math.max(0, at - attachment.prefix.length), at) === attachment.prefix)
        && (!attachment.suffix || text.slice(at + quote.length, at + quote.length + attachment.suffix.length) === attachment.suffix)) matches.push(at);
      if (matches.length > 1) return;
    }
    const start = matches[0] ?? -1;
    if (start < 0) return;
    const range = document.createRange(); let offset = 0, started = false;
    for (const node of nodes) {
      const end = offset + node.length;
      if (!started && start < end) { range.setStart(node, start - offset); started = true; }
      if (started && start + quote.length <= end) { range.setEnd(node, start + quote.length - offset); return range; }
      offset = end;
    }
  };
  const drawAttachment = (reveal = false) => {
    attachmentOverlay?.remove(); attachmentOverlay = undefined;
    const target = attachedTarget(); if (!target) { if (reveal) send('error', 'The captured selection could not be located. Select the current content again.'); return; }
    if (reveal) (target instanceof Element ? target : target.startContainer.parentElement)?.scrollIntoView({ block: 'center' });
    attachmentOverlay = document.createElement('div'); attachmentOverlay.dataset.sidelitOverlay = '';
    for (const rect of Array.from(target.getClientRects()).slice(0, 100)) {
      const part = document.createElement('div');
      part.style.cssText = `position:fixed;pointer-events:none;z-index:2147483646;background:rgba(255,196,119,.18);border:1px solid #ffc477;outline:1px solid #30261a;box-sizing:border-box;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
      attachmentOverlay.append(part);
    }
    document.documentElement.append(attachmentOverlay);
  };
  const scheduleAttachment = () => { if (!attachment) return; clearTimeout(attachmentTimer); attachmentTimer = setTimeout(() => drawAttachment(), 50); };
  const watchAttachments = () => new MutationObserver(scheduleAttachment).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  if (document.body) watchAttachments(); else document.addEventListener('DOMContentLoaded', watchAttachments, { once: true });
  addEventListener('resize', scheduleAttachment);
  const scrollers = new Set();
  let scrollFrame = 0, restoreTimer = 0, restoring = false;
  const query = value => { try { return document.querySelector(value); } catch { return null; } };
  const anchorAt = root => {
    const rect = root?.getBoundingClientRect();
    const left = Math.max(0, rect?.left || 0), top = Math.max(0, rect?.top || 0);
    const right = Math.min(innerWidth, rect?.right ?? innerWidth), bottom = Math.min(innerHeight, rect?.bottom ?? innerHeight);
    if (right <= left || bottom <= top) return;
    let el = document.elementFromPoint((left + right) / 2, top + Math.min(64, (bottom - top) / 3));
    if (!el || (root && !root.contains(el))) return;
    el = el.closest('h1,h2,h3,h4,h5,h6,p,li,pre,blockquote,tr,img,[id]') || el;
    if (el === root || el === document.body || el === document.documentElement || el === overlay) return;
    for (let parent = el; parent && parent !== root; parent = parent.parentElement) {
      if (['fixed', 'sticky'].includes(getComputedStyle(parent).position)) return;
    }
    return { selector: selector(el), tag: el.tagName.toLowerCase(), text: bound(el.textContent, 160), top: el.getBoundingClientRect().top - top };
  };
  const position = root => ({ x: root ? root.scrollLeft : scrollX, y: root ? root.scrollTop : scrollY, anchor: anchorAt(root) });
  const capturePosition = () => {
    scrollFrame = 0;
    if (!token || restoring) return;
    const containers = [];
    for (const root of scrollers) {
      if (!root.isConnected) { scrollers.delete(root); continue; }
      containers.push({ selector: selector(root), ...position(root) });
    }
    send('position', { ...position(), url: location.href.slice(0, 4096), containers });
  };
  const scheduleCapture = () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(capturePosition); };
  const findAnchor = anchor => {
    if (!anchor || typeof anchor.selector !== 'string' || anchor.selector.length > 500 || !/^[a-z][a-z0-9-]{0,31}$/.test(anchor.tag) || typeof anchor.text !== 'string' || anchor.text.length > 160) return;
    const match = query(anchor.selector);
    if (match && (match.id || bound(match.textContent, 160) === anchor.text)) return match;
    // A new sibling can invalidate nth-of-type. Use unique bounded text as a fallback.
    if (!anchor.text) return;
    let found;
    const candidates = document.getElementsByTagName(anchor.tag);
    for (let i = 0; i < Math.min(candidates.length, 2000); i++) {
      if (bound(candidates[i].textContent, 160) !== anchor.text) continue;
      if (found) return;
      found = candidates[i];
    }
    return found;
  };
  const finite = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 10000000;
  const restorePosition = state => {
    if (!state || !finite(state.x) || !finite(state.y)) return;
    // Do not restore another route after an in-app navigation or redirect.
    if (/^https?:$/.test(location.protocol) && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && state.url !== location.href) return;
    restoring = true;
    const deadline = Date.now() + 2000;
    const restore = (value, root) => {
      if (!finite(value.x) || !finite(value.y)) return;
      const el = findAnchor(value.anchor);
      const top = root ? Math.max(0, root.getBoundingClientRect().top) : 0;
      const y = el && (!root || root.contains(el)) && finite(value.anchor.top)
        ? (root ? root.scrollTop : scrollY) + el.getBoundingClientRect().top - top - value.anchor.top : value.y;
      (root || window).scrollTo({ left: value.x, top: y, behavior: 'instant' });
    };
    const apply = () => {
      if (!restoring) return;
      restore(state);
      for (const item of Array.isArray(state.containers) ? state.containers.slice(0, 8) : []) {
        if (typeof item.selector !== 'string' || item.selector.length > 500) continue;
        const root = query(item.selector);
        if (root) { restore(item, root); scrollers.add(root); }
      }
      // Allow MDX mount, fonts and local images to settle; never fight user input.
      if (Date.now() < deadline) restoreTimer = setTimeout(apply, 100);
      else { restoring = false; scheduleCapture(); }
    };
    apply();
  };
  const stopRestoring = () => { clearTimeout(restoreTimer); restoring = false; scheduleCapture(); };
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) document.addEventListener(event, stopRestoring, { capture: true, passive: true });
  document.addEventListener('scroll', event => {
    send('clear-selection'); scheduleAttachment();
    const root = event.target;
    if (root instanceof Element && root !== document.scrollingElement) {
      scrollers.add(root);
      if (scrollers.size > 8) scrollers.delete(scrollers.values().next().value);
    }
    scheduleCapture();
  }, true);
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.source !== 'sidelit-host') return;
    if (!['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost', 'http://127.0.0.1:1420'].includes(event.origin)) return;
    if (typeof event.data.token !== 'string' || event.data.token.length > 80) return;
    if (event.data.enabled === false) { token = ''; inspect = false; selected = undefined; attachment = undefined; drawAttachment(); clear(); stopRestoring(); return; }
    if (event.data.reveal === true && token === event.data.token) { drawAttachment(true); return; }
    const firstConnection = !token;
    token = event.data.token; hostOrigin = event.origin; inspect = !!event.data.inspect;
    if (document.getElementById('sidelit-mdx') && event.data.appearance) {
      document.documentElement.dataset.theme = event.data.appearance.dark === false ? 'light' : 'dark';
      const size = Number(event.data.appearance.fontSize);
      if (Number.isFinite(size)) document.body.style.fontSize = Math.max(12, Math.min(28, size)) + 'px';
    }
    if (!inspect) { clear(); selected = undefined; }
    if (attachment && !event.data.attachment) getSelection()?.removeAllRanges();
    attachment = event.data.attachment; drawAttachment();
    if (firstConnection) { restorePosition(event.data.position); if (!restoring) scheduleCapture(); }
    send('ready');
    pendingErrors.splice(0).forEach(error => send('error', error));
  });
  document.addEventListener('mousemove', event => { if (inspect && event.target instanceof Element) highlight(event.target); });
  document.addEventListener('mouseleave', () => { if (!selected) clear(); });
  document.addEventListener('click', event => {
    if (!inspect || !(event.target instanceof Element)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    selected = event.target; highlight(selected);
    const style = getComputedStyle(selected), styles = {};
    for (const name of ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'font-size', 'font-weight']) styles[name] = bound(style.getPropertyValue(name), 100);
    send('element', { type: 'element', text: bound(selected.textContent, 800), selector: selector(selected), tag: selected.tagName.toLowerCase(), id: bound(selected.id, 120), classes: [...selected.classList].slice(0, 8).map(c => bound(c, 80)), styles, surrounding: bound(selected.parentElement?.textContent, 1600), rect: rectData(selected.getBoundingClientRect()) });
  }, true);
  const textSelection = () => {
    if (!token || inspect) return;
    const selection = getSelection();
    if (!selection?.toString().trim() || !selection.rangeCount) { send('clear-selection'); return; }
    const range = selection.getRangeAt(0), before = range.cloneRange(); before.selectNodeContents(document.body); before.setEnd(range.startContainer, range.startOffset);
    const offset = before.toString().length, all = document.body.textContent, raw = selection.toString(), text = raw.slice(0, 1200), anchorText = range.toString().slice(0, 1200);
    send('text', { type: 'text', text, anchorText, truncated: raw.length > 1200, prefix: all.slice(Math.max(0, offset - 48), offset), suffix: all.slice(offset + anchorText.length, offset + anchorText.length + 48), surrounding: bound(selection.anchorNode?.parentElement?.textContent, 1600), rect: rectData(range.getBoundingClientRect()) });
  };
  document.addEventListener('mouseup', textSelection);
  document.addEventListener('keyup', event => { if (event.key.startsWith('Arrow') && event.shiftKey) textSelection(); });
  document.addEventListener('keydown', event => {
    if (!token) return;
    if (event.key === 'Escape') { inspect = false; selected = undefined; clear(); getSelection()?.removeAllRanges(); send('dismiss'); }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && ['i', 'f', 'r', 'e'].includes(event.key.toLowerCase())) { event.preventDefault(); send('shortcut', event.key.toLowerCase()); }
  }, true);
  addEventListener('error', event => send('error', bound(event.message === 'Script error.' ? 'A page script failed. WebKit withheld details for this isolated frame; use a development-server preview to debug it.' : event.message, 1000)));
  addEventListener('unhandledrejection', event => send('error', bound(event.reason, 1000)));
})();
