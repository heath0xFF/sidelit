import { useEffect, useRef, useState } from 'react';
import { api, type AgentTarget, type DeliveryAck } from './api';
import { selectionSummary, type FeedbackIntent, type FeedbackMessage, type SelectionRect } from './inspection';

export const intentInstruction = (intent: FeedbackIntent) => intent === 'explain'
  ? 'Explain the selected material. Answer in Pi without editing files.'
  : intent === 'review' ? 'Review the selected material. Report findings and suggestions in Pi without editing files.'
  : 'Make the requested edit. Re-read the current source before changing it and keep the change scoped to this request.';

export default function FeedbackComposer({ context, open, targets, targetId, onTarget, onChange, onSend, onClose, onDiscard, loading, targetError, onRefreshTargets, stale, candidate, onReplace, onReveal, anchor }: {
  context: FeedbackMessage; open: boolean; targets: AgentTarget[]; targetId: string;
  onTarget: (id: string) => void; onChange: (change: Partial<FeedbackMessage>) => void;
  onSend: (target: string, message: FeedbackMessage) => Promise<DeliveryAck>; onClose: () => void; onDiscard: () => void;
  loading: boolean; targetError: string; onRefreshTargets: () => void; stale: boolean;
  candidate: FeedbackMessage | null; onReplace: () => void; onReveal: () => void; anchor?: SelectionRect;
}) {
  const [sending, setSending] = useState(false);
  const [ack, setAck] = useState<DeliveryAck>();
  const [error, setError] = useState('');
  const [acknowledgedStale, setAcknowledgedStale] = useState(false);
  const attempt = useRef<{ target: string; message: FeedbackMessage } | undefined>(undefined);
  const input = useRef<HTMLTextAreaElement>(null);
  const targetSelect = useRef<HTMLSelectElement>(null);
  const panel = useRef<HTMLElement>(null);
  const intent = context.intent ?? 'edit';
  const target = targets.find(t => t.id === (attempt.current?.target ?? targetId));
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement;
    input.current?.focus();
    return () => { if (previous?.isConnected) previous.focus?.(); };
  }, [open]);
  useEffect(() => { setAcknowledgedStale(false); }, [stale, context.document.revision]);
  useEffect(() => {
    if (ack?.status !== 'received' || !attempt.current) return;
    let cancelled = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await api.feedbackStatus(attempt.current!.target, context.id); if (!cancelled) { setAck(next); setError(''); } }
      catch (error) { if (!cancelled) setError(String(error) + ' The instruction may already be queued.'); }
      if (!cancelled) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [ack?.status, context.id]);
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
    if (sending || ack || !target?.connected || (intent === 'edit' && !context.instruction.trim()) || (!attempt.current && stale && !acknowledgedStale)) return;
    if (new TextEncoder().encode(context.instruction).length > 7400) { setError('The instruction is too long. Shorten it before sending.'); return; }
    setSending(true); setError('');
    attempt.current ??= { target: targetId, message: { ...context, instruction: `${intentInstruction(intent)}\n\n${context.instruction.trim()}`.trim() } };
    try { setAck(await onSend(attempt.current.target, attempt.current.message)); }
    catch (error) { setError(String(error) + ' Retry uses the same message ID.'); }
    finally { setSending(false); }
  };
  return <section ref={panel} className="feedback-panel" hidden={!open} aria-label="Sidelit feedback" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 't') { event.preventDefault(); targetSelect.current?.focus(); }
  }}>
    <div className="feedback-heading"><div role="group" aria-label="Request intent">
      {(['explain', 'review', 'edit'] as const).map(value => <button key={value} aria-pressed={intent === value} disabled={!!attempt.current} onClick={() => onChange({ intent: value })}>{value[0].toUpperCase() + value.slice(1)}</button>)}
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
    {context.document.unsaved && <p className="feedback-notice">Captured from an unsaved draft. Pi can read the disk version; save or resolve it before requesting edits.</p>}
    {context.document.url && <p className="feedback-notice">Captured from a live page. Its content may have changed since selection.</p>}
    {stale && <div className="feedback-notice" role="status">The document changed after capture. This request keeps the earlier context.
      {!attempt.current && <label><input type="checkbox" checked={acknowledgedStale} onChange={e => setAcknowledgedStale(e.target.checked)} />Send the captured version</label>}
    </div>}
    {candidate && !attempt.current && <div className="feedback-notice">New selection: {selectionSummary(candidate.selection)} <button onClick={onReplace}>Use new selection</button></div>}
    <textarea ref={input} value={context.instruction} readOnly={!!attempt.current} maxLength={6500} onChange={event => onChange({ instruction: event.target.value })} placeholder={intent === 'edit' ? 'What should change?' : intent === 'explain' ? 'What would you like to understand? (optional)' : 'What should Pi look for? (optional)'} aria-label="Feedback instruction" rows={3} />
    </div><div className="feedback-delivery"><div className="feedback-target-row"><label className="feedback-target"><span>Pi</span><select ref={targetSelect} value={targetId} disabled={loading || !!attempt.current} onChange={event => onTarget(event.target.value)}>
      <option value="">{loading ? 'Finding sessions…' : 'Choose a session…'}</option>
      {targets.map(target => <option key={target.id} value={target.id} title={target.projectRoot} disabled={!target.connected}>{target.label}{target.blockId ? ' · Rex ' + target.blockId.slice(-8) : ''}{target.connected ? target.busy ? ' · busy' : '' : ' · setup needed'}</option>)}
    </select></label><button disabled={loading || !!attempt.current} onClick={onRefreshTargets} aria-label="Refresh Pi sessions">Refresh</button></div>
    <div className="feedback-footer"><button disabled={sending} onClick={onDiscard}>{ack ? 'New request' : 'Discard request'}</button><span className="toolbar-space" />
      <button className="primary" disabled={(intent === 'edit' && !context.instruction.trim()) || !target?.connected || sending || !!ack || (!attempt.current && stale && !acknowledgedStale)} onClick={() => void send()}>{sending ? 'Sending…' : ack ? 'Sent' : attempt.current ? 'Retry delivery' : 'Send to Pi'}</button>
    </div>
    {ack && <div className="feedback-status" role="status">{ack.status === 'received' ? (ack.delivery === 'queued' ? 'Queued for Pi’s next turn' : 'Received · awaiting Pi acceptance') : 'Pi accepted the request'}. Answers appear in Pi; acceptance does not mean the work is finished.
      {target?.blockId && <button onClick={() => void api.focusAgent(target.id).catch(error => setError(String(error)))}>Show in Rex</button>}
    </div>}
    {(error || targetError) && <div className="feedback-status error" role="alert">{error || targetError}</div>}
    {!loading && !targets.some(t => t.connected) && !targetError && <div className="feedback-status">No connected Pi session. Run <code>sidelit doctor --project .</code> in Rex for setup steps.</div>}
    {!loading && targets.filter(t => t.connected).length > 1 && !targetId && <div className="feedback-status">Choose the intended session; several targets match.</div>}
    </div>
  </section>;
}
