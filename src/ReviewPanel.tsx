import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api, type AgentTarget } from './api';
import { selectionSummary, type FeedbackMessage } from './inspection';
import { batchMessage, type ReviewNotes } from './review';

export default function ReviewPanel({ store, open, onClose, onEdit, onReveal, isStale, confirm }: {
  store: ReviewNotes; open: boolean; onClose: () => void;
  onEdit: (note: FeedbackMessage) => void; onReveal: (note: FeedbackMessage) => void;
  isStale: (note: FeedbackMessage) => boolean;
  confirm: (title: string, detail: string) => Promise<boolean>;
}) {
  const { record, ready, busy, error } = useSyncExternalStore(store.subscribe, store.snapshot);
  const [selected, setSelected] = useState<string[]>([]);
  const [targetId, setTargetId] = useState('');
  const [targets, setTargets] = useState<AgentTarget[]>([]);
  const [loading, setLoading] = useState(false);
  const [targetError, setTargetError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [acknowledged, setAcknowledged] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const { attempt } = record;
  const chosen = useMemo(() => record.notes.filter(note => (attempt ? attempt.message.notes.map(n => n.id) : selected).includes(note.id)), [record.notes, attempt, selected]);
  const prepared = useMemo(() => {
    if (attempt) return { message: attempt.message, error: '' };
    try { return { message: batchMessage(chosen, crypto.randomUUID()), error: '' }; }
    catch (error) { return { message: undefined, error: chosen.length ? String(error) : '' }; }
  }, [chosen, attempt]);
  const staleKey = chosen.map(note => note.id + ':' + isStale(note)).join(',');
  const stale = chosen.some(isStale);
  const project = chosen[0]?.projectRoot;
  const target = targets.find(t => t.id === (attempt?.target ?? targetId));
  useEffect(() => { setAcknowledged(false); }, [staleKey]);
  useEffect(() => { setTargetId(''); }, [project]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement;
    heading.current?.focus();
    return () => { if (previous?.isConnected) previous.focus?.(); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true); setTargetError(''); setTargets([]);
    void api.agentTargets(project).then(list => { if (alive) setTargets(list); })
      .catch(error => { if (alive) setTargetError(String(error)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, project, refresh]);
  useEffect(() => {
    if (!open || busy || attempt?.ack?.status !== 'received') return;
    const timer = setTimeout(() => { void store.checkStatus().catch(() => {}); }, 1500);
    return () => clearTimeout(timer);
  }, [open, busy, attempt, store]);
  const send = () => {
    if (!prepared.message || !target?.connected || busy || (stale && !acknowledged)) return;
    void store.send(attempt?.target ?? targetId, prepared.message, () => acknowledged || !chosen.some(isStale)).catch(() => {});
  };
  const clearAttempt = async () => {
    if (await confirm('Remove attempted notes?', 'This removes these notes and their local delivery record. It does not cancel work already received by Pi. An uncertain delivery may already be queued.')) {
      await store.clearAttempt(); setSelected([]);
    }
  };
  const clear = async () => {
    if (await confirm('Delete all saved review notes?', 'This deletes the local notes and delivery record. It does not change documents or cancel work in Pi.')) {
      await store.clear(); setSelected([]);
    }
  };
  return <section className="review-panel" hidden={!open} aria-label="Review notes" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
  }}>
    <div className="feedback-heading"><h2 ref={heading} tabIndex={-1}>Review notes <span>{record.notes.length}/20</span></h2><button onClick={onClose}>Hide</button></div>
    <div className="feedback-body">
      <p className="review-help">Saved on this computer until removed. Private OS permissions, not encryption. Nothing sends automatically.</p>
      {!ready && !error && <p role="status">Loading saved notes…</p>}
      {ready && !record.notes.length && <p>Select text or inspect an element, then choose <strong>Add to review</strong> in the request. You can also add a note for the whole document.</p>}
      <ol className="review-list">
        {record.notes.map((note, i) => {
          const status = !store.locked(note.id) ? 'Unsent' : !attempt?.ack ? 'Delivery unconfirmed' : attempt.ack.status === 'received' ? 'Received' : 'Accepted';
          return <li key={note.id}>
          <label className="review-note-choice"><input type="checkbox" aria-label={`Select note ${i + 1}`} checked={chosen.some(item => item.id === note.id)} disabled={busy || !!attempt} onChange={e => setSelected(ids => e.target.checked ? [...ids, note.id] : ids.filter(id => id !== note.id))} />
            <span><strong>{i + 1}. {{ explain: 'Explain', review: 'Review', edit: 'Edit' }[note.intent ?? 'edit']} · {note.document.path?.split('/').pop() ?? note.document.url}<span className="review-location"> · {status}</span></strong><span>{selectionSummary(note.selection)}</span></span>
          </label>
          <p className="review-instruction">{note.instruction || (note.intent === 'edit' ? 'Needs a change instruction' : 'No additional instruction')}</p>
          <p className="review-location">{note.projectRoot ?? note.document.url}</p>
          {(isStale(note) || note.document.unsaved || note.document.url) && <p className="feedback-notice">{isStale(note) ? 'Captured version needs review. ' : ''}{note.document.unsaved ? 'Captured from an unsaved draft. ' : ''}{note.document.url ? 'Live-page content may have changed.' : ''}</p>}
          <div className="review-note-actions">
            <button disabled={busy || store.locked(note.id)} onClick={() => onEdit(note)}>Edit note</button>
            <button onClick={() => onReveal(note)}>{note.selection.type === 'document' ? 'Show document' : 'Reveal selection'}</button>
            <button disabled={busy || store.locked(note.id)} onClick={() => void store.remove(note.id).catch(() => {})}>Remove</button>
          </div>
        </li>; })}
      </ol>
      {prepared.error && <p className="feedback-notice" role="status">{prepared.error}</p>}
      {prepared.message && <details className="review-payload"><summary>Exact payload · {prepared.message.notes.length} notes</summary><pre>{JSON.stringify(prepared.message, null, 2)}</pre></details>}
      {stale && !attempt?.ack && <label className="feedback-notice review-stale"><input type="checkbox" disabled={busy} checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />Send the captured versions (restored, changed, or closed documents)</label>}
    </div>
    <div className="feedback-delivery">
      <div className="feedback-target-row"><label className="feedback-target"><span>Pi</span><select aria-label="Review target" value={attempt?.target ?? targetId} disabled={busy || loading || !!attempt} onChange={e => setTargetId(e.target.value)}>
        <option value="">{loading ? 'Finding sessions…' : 'Choose a session…'}</option>
        {attempt && !target && <option value={attempt.target}>{attempt.target} · disconnected</option>}
        {targets.map(target => <option key={target.id} value={target.id} disabled={!target.connected}>{target.label} · {target.projectRoot}{target.connected ? target.busy ? ' · busy' : '' : ' · setup needed'}</option>)}
      </select></label><button disabled={loading || busy} onClick={() => setRefresh(n => n + 1)} aria-label="Refresh review targets">Refresh</button></div>
      <div className="feedback-footer">
        {attempt ? <button disabled={busy} onClick={() => void clearAttempt().catch(() => {})}>Remove attempted notes</button> : <span>{chosen.length} selected</span>}
        <span className="toolbar-space" />
        <button className="primary" disabled={!ready || busy || !prepared.message || !target?.connected || !!attempt?.ack || (stale && !acknowledged)} onClick={send}>{busy ? 'Working…' : attempt?.ack ? 'Sent' : attempt ? 'Retry batch' : 'Send selected to Pi'}</button>
      </div>
      {attempt && <div className="feedback-status" role="status">{!attempt.ack ? 'Delivery unconfirmed. Check the receipt or retry the same fixed batch.' : attempt.ack.status === 'received' ? 'Pi received the batch; waiting for acceptance.' : 'Pi accepted the batch. Acceptance does not mean the work is finished.'} Answers appear in Pi.
        {!attempt.ack && <button disabled={busy} onClick={() => void store.checkStatus().catch(() => {})}>Check receipt</button>}
        {target?.blockId && <button onClick={() => void api.focusAgent(target.id).catch(e => setTargetError(String(e)))}>Show in Rex</button>}
      </div>}
      {(error || targetError) && <p className="feedback-status error" role="alert">{error || targetError}</p>}
      {!loading && ready && !targets.some(target => target.connected) && <p className="feedback-status">No connected Pi session. Run <code>sidelit doctor --project .</code> for setup steps. Batch delivery needs the updated Sidelit Pi extension.</p>}
      {(!ready || record.notes.length > 0) && <button className="review-clear" disabled={busy} onClick={() => void clear().catch(() => {})}>Delete all saved notes</button>}
    </div>
  </section>;
}
