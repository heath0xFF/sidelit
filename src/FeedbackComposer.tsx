import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, type AgentTarget } from './api';
import { selectionSummary, type FeedbackMessage, type SelectionRect } from './inspection';

import { intentInstruction } from './review';
import { Requests } from './requests';
import { MAX_DRAFT_BYTES } from './changes';
import RequestChanges from './RequestChanges';

export default function FeedbackComposer({ context, open, targets, targetId, onTarget, onChange, requests, onClose, onDiscard, loading, targetError, onRefreshTargets, stale, candidate, onReplace, onReveal, anchor, onCollect, savedNote = false, collectionBusy = false, draft, onOpenChange }: {
  context: FeedbackMessage; open: boolean; targets: AgentTarget[]; targetId: string;
  onTarget: (id: string) => void; onChange: (change: Partial<FeedbackMessage>) => void;
  requests: Requests; onClose: () => void; onDiscard: () => void;
  loading: boolean; targetError: string; onRefreshTargets: () => void; stale: boolean;
  candidate: FeedbackMessage | null; onReplace: () => void; onReveal: () => void; anchor?: SelectionRect;
  onCollect?: (includeDraft: boolean) => Promise<void>; savedNote?: boolean; collectionBusy?: boolean;
  draft?: { text: string; bytes: number }; onOpenChange?: (id: string, path: string) => void;
}) {
  const history = useSyncExternalStore(requests.subscribe, requests.snapshot);
  const attempt = history.find(item => item.context.id === context.id);
  const sending = !!attempt?.sending;
  const ack = attempt?.ack;
  const [collecting, setCollecting] = useState(false);
  const [error, setError] = useState('');
  const [acknowledgedStale, setAcknowledgedStale] = useState(false);
  const [includeDraft, setIncludeDraft] = useState(true);
  const draftFits = !!draft && draft.bytes <= MAX_DRAFT_BYTES;
  const input = useRef<HTMLTextAreaElement>(null);
  const targetSelect = useRef<HTMLSelectElement>(null);
  const panel = useRef<HTMLElement>(null);
  const intent = context.intent ?? 'edit';
  const target = attempt?.target ?? targets.find(t => t.id === targetId);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement;
    input.current?.focus();
    return () => { if (previous?.isConnected) previous.focus?.(); };
  }, [open]);
  useEffect(() => { setAcknowledgedStale(false); }, [stale, context.document.revision]);
  useEffect(() => {
    if (!open || !panel.current) return;
    const place = () => {
      const el = panel.current!;
      el.style.removeProperty('top'); el.style.removeProperty('bottom'); el.style.removeProperty('left');
      if (innerWidth < 1000 || !anchor) return;
      const h = el.offsetHeight, below = anchor.y + anchor.height + 12;
      const top = below + h < innerHeight - 38 ? below : anchor.y - h - 12;
      if (top < 110) return;
      el.style.top = top + 'px'; el.style.bottom = 'auto';
      el.style.left = Math.max(12, Math.min(innerWidth - el.offsetWidth - 16, anchor.x)) + 'px';
    };
    place(); addEventListener('resize', place);
    const observer = new ResizeObserver(place); observer.observe(panel.current);
    return () => { observer.disconnect(); removeEventListener('resize', place); };
  }, [open, anchor]);
  const send = async () => {
    if (savedNote || collecting || sending || attempt?.checking || ack || !target?.connected || (intent === 'edit' && !context.instruction.trim()) || (!attempt && stale && !acknowledgedStale)) return;
    if (new TextEncoder().encode(context.instruction).length > 7400) { setError('The instruction is too long. Shorten it before sending.'); return; }
    setError('');
    try {
      await requests.send(context, target, { ...context, document: { ...context.document, unsavedChanges: includeDraft && draftFits ? draft!.text : undefined }, instruction: `${intentInstruction(intent)}\n\n${context.instruction.trim()}`.trim() });
    } catch (error) { setError(String(error)); }
  };
  const collect = async () => {
    if (!onCollect || collecting || collectionBusy || sending || attempt) return;
    setCollecting(true); setError('');
    try { await onCollect(includeDraft && draftFits); } catch (error) { setError(String(error)); }
    finally { setCollecting(false); }
  };
  return <section ref={panel} className="feedback-panel" hidden={!open} aria-label="Sidelit feedback" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 't') { event.preventDefault(); targetSelect.current?.focus(); }
  }}>
    <div className="feedback-heading"><div role="group" aria-label="Request intent">
      {(['explain', 'review', 'edit'] as const).map(value => <button key={value} aria-pressed={intent === value} disabled={!!attempt || collecting} onClick={() => onChange({ intent: value })}>{value[0].toUpperCase() + value.slice(1)}</button>)}
    </div><button aria-label="Dismiss feedback, keep draft" onClick={onClose}>Hide</button></div>
    <div className="feedback-body"><div className="feedback-context">
      <strong>{context.selection.type === 'element' ? `${context.selection.tag ?? 'Element'}${context.selection.id ? '#' + context.selection.id : ''}` : selectionSummary(context.selection)}</strong>
      <span className="feedback-document" title={context.document.path ?? context.document.url}>{context.document.path?.split('/').pop() ?? context.document.url}</span>
      <details><summary>Attached context{context.selection.truncated ? ' · excerpt shortened' : ''}</summary>
        <p className="feedback-excerpt">{context.selection.text || 'The current document'}</p>
        <p>{context.document.path ?? context.document.url}</p>
        {context.selection.selector && <code>{context.selection.selector}</code>}
        {context.selection.sourceLine && <p>Possible source line {context.selection.sourceLine} · inferred text match</p>}
        {context.document.capturedAt && <p>Captured {new Date(context.document.capturedAt).toLocaleTimeString()}</p>}
        {context.selection.styles && <pre>{JSON.stringify(context.selection.styles, null, 2)}</pre>}
      </details>
      {context.selection.type !== 'document' && <button className="reveal-selection" onClick={onReveal}>Reveal selection</button>}
    </div>
    {context.document.unsaved && !draft && <p className="feedback-notice">Captured from an unsaved draft that has since been saved or discarded.</p>}
    {draft && !attempt && (draftFits
      ? <label className="feedback-notice feedback-draft"><input type="checkbox" checked={includeDraft} disabled={collecting} onChange={event => setIncludeDraft(event.target.checked)} />Include my unsaved changes, so Pi can see them. They are not on disk, so an edit from Pi can conflict with your draft.</label>
      : <p className="feedback-notice">Your unsaved changes are over 12 KiB, too large to attach. Pi will only see the file on disk. Save first if Pi needs them.</p>)}
    {attempt?.message.document.unsavedChanges && <p className="feedback-notice">Your unsaved changes were sent with this request.</p>}
    {context.document.url && <p className="feedback-notice">Captured from a live page. Its content may have changed since selection.</p>}
    {stale && <div className="feedback-notice" role="status">This capture may no longer match the open document. This request keeps the earlier context.
      {!attempt && !savedNote && <label><input type="checkbox" checked={acknowledgedStale} onChange={e => setAcknowledgedStale(e.target.checked)} />Send the captured version</label>}
    </div>}
    {candidate && !attempt && !collecting && <div className="feedback-notice">New selection: {selectionSummary(candidate.selection)} <button onClick={onReplace}>Use new selection</button></div>}
    {onCollect && !attempt && <p className="feedback-status">{savedNote ? 'Save note keeps these changes locally. Send it from Review notes.' : 'Add to review saves this note on this computer until you remove it. It does not send to Pi.'}</p>}
    <textarea ref={input} value={context.instruction} readOnly={!!attempt || collecting} maxLength={6500} onChange={event => onChange({ instruction: event.target.value })} placeholder={intent === 'edit' ? 'What should change?' : intent === 'explain' ? 'What would you like to understand? (optional)' : 'What should Pi look for? (optional)'} aria-label="Feedback instruction" rows={3} />
    </div><div className="feedback-delivery">{!savedNote && <div className="feedback-target-row"><label className="feedback-target"><span>Pi</span><select ref={targetSelect} value={attempt?.target.id ?? targetId} disabled={loading || !!attempt} onChange={event => onTarget(event.target.value)}>
      <option value="">{loading ? 'Finding sessions…' : 'Choose a session…'}</option>
      {attempt && !targets.some(item => item.id === attempt.target.id) && <option value={attempt.target.id}>{attempt.target.label}</option>}
      {targets.map(target => <option key={target.id} value={target.id} title={target.projectRoot} disabled={!target.connected}>{target.label}{target.blockId ? ' · Rex ' + target.blockId.slice(-8) : ''}{target.connected ? target.busy ? ' · busy' : '' : ' · setup needed'}</option>)}
    </select></label><button disabled={loading || !!attempt} onClick={onRefreshTargets} aria-label="Refresh Pi sessions">Refresh</button></div>}
    <div className="feedback-footer"><button disabled={sending || collecting} onClick={onDiscard}>{savedNote ? 'Cancel changes' : attempt ? 'New request' : 'Discard request'}</button><span className="toolbar-space" />
      {onCollect && !attempt && <button className={savedNote ? 'primary' : ''} disabled={sending || collecting || collectionBusy} onClick={() => void collect()}>{collecting ? 'Saving…' : savedNote ? 'Save note' : 'Add to review'}</button>}
      {!savedNote && <button className="primary" disabled={(intent === 'edit' && !context.instruction.trim()) || !target?.connected || sending || !!attempt?.checking || collecting || !!ack || (!attempt && stale && !acknowledgedStale)} onClick={() => void send()}>{sending ? 'Sending…' : ack ? 'Sent' : attempt ? 'Retry delivery' : 'Send to Pi'}</button>}
    </div>
    {ack && <div className="feedback-status" role="status">{ack.status === 'settled'
      ? 'Pi finished its turn, which does not mean the request succeeded. Answers are in Pi.'
      : `${ack.status === 'received' ? (ack.delivery === 'queued' ? 'Queued for Pi’s next turn' : 'Received · awaiting Pi acceptance') : 'Pi is working on the request'}. Answers appear in Pi.`}
      {ack.status === 'settled' && <RequestChanges id={context.id} root={context.projectRoot} report={attempt?.report} onOpen={path => onOpenChange?.(context.id, path)} />}
      {target?.blockId && <button onClick={() => void api.focusAgent(target.id).catch(error => setError(String(error)))}>Show in Rex</button>}
    </div>}
    {attempt && !ack && <button disabled={sending || attempt.checking} onClick={() => void requests.check(context.id)}>{attempt.checking ? 'Checking…' : 'Check receipt'}</button>}
    {(error || attempt?.error || targetError) && <div className="feedback-status error" role="alert">{error || attempt?.error || targetError}</div>}
    {!savedNote && !loading && !targets.some(t => t.connected) && !targetError && <div className="feedback-status">No connected Pi session. Run <code>sidelit doctor --project .</code> in Rex for setup steps.</div>}
    {!savedNote && !loading && targets.filter(t => t.connected).length > 1 && !targetId && <div className="feedback-status">Choose the intended session; several targets match.</div>}
    </div>
  </section>;
}
