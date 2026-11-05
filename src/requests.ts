import type { AgentTarget, DeliveryAck, RequestReport } from './api';
import type { FeedbackMessage } from './inspection';
import { NOT_STARTED } from './review';

export const MAX_REQUEST_HISTORY = 100;
export interface SentRequest {
  context: FeedbackMessage;
  message: FeedbackMessage;
  target: AgentTarget;
  sentAt: number;
  sending: boolean;
  checking: boolean;
  ack?: DeliveryAck;
  error: string;
  report?: RequestReport | null;
}
interface RequestTransport {
  sendFeedback(target: string, message: FeedbackMessage): Promise<DeliveryAck>;
  feedbackStatus(target: string, id: string): Promise<DeliveryAck>;
  requestChanges(id: string): Promise<RequestReport | null>;
}

export const requestStatus = (request: SentRequest) => request.sending ? 'Sending…'
  : request.error ? 'Needs attention'
  : request.ack?.status === 'settled' ? 'Pi finished · not verified'
  : request.ack?.delivery === 'consumed' ? 'Pi accepted'
  : request.ack?.delivery === 'queued' ? 'Queued'
  : request.ack ? 'Received · awaiting acceptance' : 'Delivery uncertain';

export function selectRequest(current: FeedbackMessage | null, next: FeedbackMessage, attempted: boolean) {
  if (!current || attempted) return { feedback: next, candidate: null };
  const changed = next.document.path !== current.document.path || next.document.url !== current.document.url
    || JSON.stringify(next.selection) !== JSON.stringify(current.selection);
  return { feedback: current, candidate: changed && next.selection.type !== 'document' ? next : null };
}

// Delivery outlives the composer, so a new selection cannot lose an earlier receipt.
export class Requests {
  private state: SentRequest[] = [];
  private listeners = new Set<() => void>();
  constructor(private io: RequestTransport) {}
  snapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish() { this.listeners.forEach(fn => fn()); }
  private update(id: string, change: Partial<SentRequest>) {
    this.state = this.state.map(item => item.context.id === id ? { ...item, ...change } : item);
    this.publish();
  }
  private async acknowledge(id: string, ack: DeliveryAck) {
    if (ack.id !== id) throw Error('Pi acknowledged a different request.');
    if (ack.status === 'failed') { this.update(id, { ack: undefined, error: NOT_STARTED }); return; }
    // Capture the first comparison when Pi settles, not when history is opened later.
    const report = ack.status === 'settled' ? await this.io.requestChanges(id).catch(() => null) : undefined;
    this.update(id, { ack, error: '', report });
  }
  async send(context: FeedbackMessage, target: AgentTarget, message: FeedbackMessage) {
    let request = this.state.find(item => item.context.id === context.id);
    if (request?.sending || request?.checking || request?.ack) return;
    if (!request) {
      if (this.state.length >= MAX_REQUEST_HISTORY) {
        const oldest = this.state.reduce((found, item, index) => item.ack?.status === 'settled' && !item.checking && !item.sending ? index : found, -1);
        if (oldest < 0) throw Error('Request history is full of pending deliveries. Wait for Pi to finish before sending more.');
        this.state = this.state.filter((_, index) => index !== oldest);
      }
      request = { context: structuredClone(context), message: structuredClone(message), target: { ...target }, sentAt: Date.now(), sending: false, checking: false, error: '' };
      this.state = [request, ...this.state];
    }
    const id = request.context.id;
    this.update(id, { sending: true, error: '' });
    try { await this.acknowledge(id, await this.io.sendFeedback(request.target.id, request.message)); }
    catch (error) {
      this.update(id, { error: String(error) + (String(error).includes('Invalid feedback') ? ' Run /reload in Pi, in case it has an older Sidelit extension.' : '') + ' Delivery may be uncertain. Check receipt or retry with the same message ID.' });
    }
    finally { this.update(id, { sending: false }); }
  }
  async check(id: string) {
    const request = this.state.find(item => item.context.id === id);
    if (!request || request.sending || request.checking || request.ack?.status === 'settled') return;
    this.update(id, { checking: true });
    try { await this.acknowledge(id, await this.io.feedbackStatus(request.target.id, id)); }
    catch (error) { this.update(id, { error: String(error) + ' Receipt could not be checked; the request may already be in Pi.' }); }
    finally { this.update(id, { checking: false }); }
  }
  poll = () => {
    for (const request of this.state) {
      if (request.ack && request.ack.status !== 'settled') void this.check(request.context.id);
    }
  };
}
