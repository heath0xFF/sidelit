import type { DeliveryAck } from './api';
import { feedbackSelection, type FeedbackMessage } from './inspection';

export const MAX_REVIEW_NOTES = 20;
export const MAX_BATCH_BYTES = 30 * 1024;
export const intentInstruction = (intent: FeedbackMessage['intent']) => intent === 'explain'
  ? 'Explain the selected material. Answer in Pi without editing files.'
  : intent === 'review' ? 'Review the selected material. Report findings and suggestions in Pi without editing files.'
  : 'Make the requested edit. Re-read the current source before changing it and keep the change scoped to this request.';
export interface FeedbackBatch { id: string; source: 'sidelit'; projectRoot?: string; notes: FeedbackMessage[] }
export interface ReviewRecord {
  version: 1;
  notes: FeedbackMessage[];
  attempt?: { target: string; message: FeedbackBatch; ack?: DeliveryAck };
}
export const emptyReview = (): ReviewRecord => ({ version: 1, notes: [] });
export function reviewScope(note: FeedbackMessage) {
  return note.projectRoot ? 'project:' + note.projectRoot : note.document.url ? 'page:' + new URL(note.document.url).origin : '';
}
export function batchMessage(notes: FeedbackMessage[], id: string): FeedbackBatch {
  if (!notes.length || notes.length > MAX_REVIEW_NOTES) throw Error('Select 1–20 notes.');
  if (new Set([id, ...notes.map(note => note.id)]).size !== notes.length + 1) throw Error('Review notes need unique IDs.');
  const scope = reviewScope(notes[0]);
  if (!scope || notes.some(note => reviewScope(note) !== scope)) throw Error('Select notes from one project or live-page origin. Send other projects separately.');
  const message: FeedbackBatch = { id, source: 'sidelit', projectRoot: notes[0].projectRoot, notes: notes.map(note => {
    if ((note.intent ?? 'edit') === 'edit' && !note.instruction.trim()) throw Error('Each Edit note needs a change instruction.');
    if (new TextEncoder().encode(note.instruction).length > 7400) throw Error('A note instruction is too long. Shorten it before sending.');
    return { ...note, selection: feedbackSelection(note.selection), instruction: `${intentInstruction(note.intent)}\n\n${note.instruction.trim()}`.trim() };
  }) };
  if (new TextEncoder().encode(JSON.stringify(message)).length > MAX_BATCH_BYTES) throw Error('This batch exceeds 30 KiB. Select fewer notes or shorten their instructions.');
  return message;
}
interface ReviewTransport {
  loadReview(): Promise<ReviewRecord>;
  storeReview(record: ReviewRecord): Promise<void>;
  sendReview(target: string, message: FeedbackBatch): Promise<DeliveryAck>;
  feedbackStatus(target: string, id: string): Promise<DeliveryAck>;
}

export class ReviewNotes {
  private state = { record: emptyReview(), ready: false, busy: false, error: '' };
  private listeners = new Set<() => void>();
  private restoredIds = new Set<string>();
  restored(id: string) { return this.restoredIds.has(id); }
  constructor(private io: ReviewTransport) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(change: Partial<typeof this.state>) { this.state = { ...this.state, ...change }; this.listeners.forEach(fn => fn()); }
  async load() {
    if (this.state.ready || this.state.busy) return;
    this.update({ busy: true, error: '' });
    try {
      const record = await this.io.loadReview();
      // In-memory revisions cannot prove identity across app restarts.
      this.restoredIds = new Set(record.notes.map(note => note.id));
      this.update({ record, ready: true });
    }
    catch (error) { this.update({ error: String(error) }); }
    finally { this.update({ busy: false }); }
  }
  private async commit(record: ReviewRecord) {
    await this.io.storeReview(record);
    this.update({ record });
  }
  private async run(action: () => Promise<void>) {
    if (!this.state.ready || this.state.busy) throw Error('Wait for review notes to finish loading or saving.');
    this.update({ busy: true, error: '' });
    try { await action(); }
    catch (error) { this.update({ error: String(error) }); throw error; }
    finally { this.update({ busy: false }); }
  }
  locked(id: string) { return !!this.state.record.attempt?.message.notes.some(note => note.id === id); }
  save(note: FeedbackMessage) {
    return this.run(async () => {
      if (this.locked(note.id)) throw Error('A delivery attempt cannot be edited.');
      const { record } = this.state, exists = record.notes.some(item => item.id === note.id);
      if (!exists && record.notes.length >= MAX_REVIEW_NOTES) throw Error('The review list is full (20 notes). Remove notes before adding more.');
      if (new TextEncoder().encode(note.instruction).length > 7400) throw Error('The instruction is too long. Shorten it before saving.');
      await this.commit({ ...record, notes: exists ? record.notes.map(item => item.id === note.id ? structuredClone(note) : item) : [...record.notes, structuredClone(note)] });
    });
  }
  remove(id: string) {
    return this.run(async () => {
      if (this.locked(id)) throw Error('Remove the delivery record to remove its notes.');
      await this.commit({ ...this.state.record, notes: this.state.record.notes.filter(note => note.id !== id) });
    });
  }
  send(target: string, message: FeedbackBatch, approve: () => boolean) {
    return this.run(async () => {
      if (!approve()) throw Error('The document changed. Review the captured version before sending.');
      if (!this.state.record.attempt) {
        const current = this.state.record.notes.filter(note => message.notes.some(sent => sent.id === note.id));
        if (JSON.stringify(batchMessage(current, message.id)) !== JSON.stringify(message)) throw Error('The notes changed. Review the payload again.');
        if (!target) throw Error('Choose a Pi session.');
        this.update({ record: { ...this.state.record, attempt: { target, message: structuredClone(message) } } });
      }
      const attempt = this.state.record.attempt!;
      if (attempt.ack) return;
      // Keep failed writes frozen too; retries must persist the same attempt before sending.
      await this.commit(this.state.record);
      if (!approve()) throw Error('The document changed. Review the captured version before retrying.');
      const ack = await this.io.sendReview(attempt.target, attempt.message);
      if (ack.id !== attempt.message.id) throw Error('Pi acknowledged a different batch.');
      await this.commit({ ...this.state.record, attempt: { ...attempt, ack } });
    });
  }
  checkStatus() {
    return this.run(async () => {
      const { attempt } = this.state.record;
      if (!attempt) return;
      const ack = await this.io.feedbackStatus(attempt.target, attempt.message.id);
      if (ack.id !== attempt.message.id) throw Error('Pi acknowledged a different batch.');
      if (attempt.ack?.status === ack.status && attempt.ack?.delivery === ack.delivery) return;
      await this.commit({ ...this.state.record, attempt: { ...attempt, ack } });
    });
  }
  clearAttempt() {
    return this.run(async () => {
      const { record } = this.state;
      const sent = new Set(record.attempt?.message.notes.map(note => note.id));
      await this.commit({ version: 1, notes: record.notes.filter(note => !sent.has(note.id)) });
    });
  }
  async clear() {
    if (this.state.busy) throw Error('Wait for review notes to finish saving.');
    this.update({ busy: true, error: '' });
    try { await this.commit(emptyReview()); this.update({ ready: true }); }
    catch (error) { this.update({ error: String(error) }); throw error; }
    finally { this.update({ busy: false }); }
  }
}
