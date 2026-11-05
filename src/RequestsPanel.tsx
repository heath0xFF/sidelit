import { useSyncExternalStore } from 'react';
import { api } from './api';
import type { FeedbackMessage } from './inspection';
import RequestChanges from './RequestChanges';
import { Requests, requestStatus } from './requests';

export default function RequestsPanel({ store, path, url, onReveal, onOpenChange, onInspect, onError }: {
  store: Requests; path?: string; url?: string;
  onReveal: (message: FeedbackMessage) => void;
  onOpenChange: (id: string, path: string) => void;
  onInspect: () => void;
  onError: (error: unknown) => void;
}) {
  const history = useSyncExternalStore(store.subscribe, store.snapshot);
  const requests = history.filter(item => url ? item.context.document.url === url : path && item.context.document.path === path);
  return <section className="request-history" aria-label="Requests for current document">
    <p className="request-history-note">Current document · this app session only. Answers stay in Pi.</p>
    {!requests.length && <p className="tree-empty">{path || url ? 'No requests sent for this document yet.' : 'Open a document to see its requests.'}</p>}
    <ul>{requests.map(request => {
      const { context, target, ack } = request;
      const intent = context.intent ?? 'edit';
      return <li key={context.id}><details onToggle={event => { if (event.currentTarget.open) onInspect(); }}>
        <summary>
          <span className="request-history-heading"><strong>{intent[0].toUpperCase() + intent.slice(1)}</strong><time dateTime={new Date(request.sentAt).toISOString()} title={new Date(request.sentAt).toLocaleString()}>{new Date(request.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time></span>
          <span className="request-history-excerpt">{context.instruction || context.selection.text || 'Document request'}</span>
          <span className="request-history-status">{requestStatus(request)}</span>
        </summary>
        <div className="request-history-detail">
          <p className="request-history-note">{target.label}</p>
          <blockquote>{context.selection.text || 'The current document'}</blockquote>
          {context.instruction && <p className="request-history-instruction">{context.instruction}</p>}
          {context.document.unsaved && <p>Captured from an unsaved draft.</p>}
          {request.message.document.unsavedChanges && <p>Unsaved changes were included.</p>}
          {context.selection.type !== 'document' && <button onClick={() => onReveal(context)}>Reveal selection</button>}
          {request.error && <p className="error" role="status">{request.error}</p>}
          {ack?.status === 'settled'
            ? <><p>Pi finished its turn. This does not mean the request succeeded.</p><RequestChanges id={context.id} root={context.projectRoot} report={request.report} onOpen={path => onOpenChange(context.id, path)} /></>
            : <div className="request-history-actions">
              <button disabled={request.sending || request.checking} onClick={() => void store.check(context.id)}>{request.checking ? 'Checking…' : 'Check receipt'}</button>
              {!ack && <button disabled={request.sending || request.checking} onClick={() => void store.send(context, target, request.message).catch(onError)}>Retry delivery</button>}
            </div>}
          {target.blockId && <button onClick={() => void api.focusAgent(target.id).catch(onError)}>Show in Rex</button>}
        </div>
      </details></li>;
    })}</ul>
  </section>;
}
