import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { preparePreview } from './preview-html';
import { lineForText, parseSelection, parseRect, type SelectionContext } from './inspection';
import { localServerUrl } from './preview-security';
import { parsePreviewPosition, previewPosition, rememberPreviewPosition } from './preview-position';
import runtime from '../public/preview-runtime/runtime.js?raw';

export default function Preview({ path, source = '', format, url, inspect, onText, onElement, onError, refresh = 0, onDismiss, onShortcut, dark = true, fontSize = 16, attachment, reveal = 0 }: {
  path?: string; source?: string; format: 'html' | 'mdx' | 'markdown' | 'url'; url?: string;
  inspect: boolean; onText: (value: SelectionContext | null) => void; onElement: (value: SelectionContext) => void;
  onError: (error: unknown) => void; refresh?: number; onDismiss?: () => void; onShortcut?: (key: string) => void;
  dark?: boolean; fontSize?: number;
  attachment?: SelectionContext; reveal?: number;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [id] = useState(() => crypto.randomUUID());
  const [trustedPath, setTrustedPath] = useState('');
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [reload, setReload] = useState(0);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [bridgeEnabled, setBridgeEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const revealed = useRef(0);
  const callbacks = useRef({ onText, onElement, onError, onDismiss, onShortcut });
  callbacks.current = { onText, onElement, onError, onDismiss, onShortcut };
  const remote = format === 'url';
  const positionKey = path || url || '';
  const allowScripts = !!path && trustedPath === path;
  const connect = () => {
    const enabled = !remote || bridgeEnabled;
    frame.current?.contentWindow?.postMessage({ source: 'sidelit-host', token: id, enabled, inspect: enabled && inspect, attachment: attachment ?? null, position: enabled ? previewPosition(positionKey) : undefined, appearance: format === 'mdx' || format === 'markdown' ? { dark, fontSize } : undefined }, remote && url ? new URL(url).origin : '*');
  };
  useEffect(() => {
    let alive = true; setReady(false); setError(''); setWarnings([]);
    const publication = crypto.randomUUID();
    if (remote) {
      try { setSrc(localServerUrl(url || '')); } catch (error) { setError(String(error)); }
    } else if (path) {
      void preparePreview(source, path, format, allowScripts, runtime, api.previewAsset)
        .then(async result => {
          if (!alive) return;
          const address = await api.publishPreview(publication, result.html);
          if (alive) { setWarnings(result.warnings); setSrc(address + '?revision=' + crypto.randomUUID()); }
          else void api.releasePreview(publication).catch(() => {});
        }).catch(error => { if (alive) setError(String(error)); });
    }
    return () => { alive = false; void api.releasePreview(publication).catch(() => {}); };
  }, [path, source, format, url, allowScripts, reload, refresh, id, remote]);
  useEffect(() => { connect(); }, [inspect, src, bridgeEnabled, dark, fontSize, attachment]);
  useEffect(() => {
    if (ready && reveal > revealed.current && attachment && (!remote || bridgeEnabled)) {
      revealed.current = reveal;
      frame.current?.contentWindow?.postMessage({ source: 'sidelit-host', token: id, reveal: true }, remote && url ? new URL(url).origin : '*');
    }
  }, [reveal, ready, attachment, remote, bridgeEnabled, url, id]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== 'sidelit-preview' || event.data.token !== id) return;
      if (remote && (!bridgeEnabled || event.origin !== new URL(url!).origin)) return;
      if (!remote && event.origin !== 'null') return;
      if (event.data.type === 'position') {
        const position = parsePreviewPosition(event.data.context);
        if (position) rememberPreviewPosition(positionKey, position);
        return;
      }
      if (event.data.type === 'ready') { setReady(true); return; }
      if (event.data.type === 'clear-selection') { callbacks.current.onText(null); return; }
      if (event.data.type === 'dismiss') { callbacks.current.onDismiss?.(); return; }
      if (event.data.type === 'shortcut' && ['i', 'f', 'r', 'e'].includes(event.data.context)) { callbacks.current.onShortcut?.(event.data.context); return; }
      if (event.data.type === 'error' && typeof event.data.context === 'string') { setWarnings(old => [...old.slice(-4), event.data.context.slice(0, 1000)]); return; }
      const selection = parseSelection(event.data.context);
      if (!selection || !['text', 'element'].includes(event.data.type) || selection.type !== event.data.type) return;
      const line = !remote && path ? lineForText(source, selection.text) : null;
      const rect = parseRect(event.data.context?.rect), bounds = frame.current!.getBoundingClientRect();
      let pageUrl: string | undefined;
      if (remote && typeof event.data.context?.url === 'string' && event.data.context.url.length <= 4096) {
        try { const current = new URL(event.data.context.url); if (current.origin === new URL(url!).origin) pageUrl = current.href; } catch { /* Page URLs are untrusted. */ }
      }
      const context = { ...selection, sourceLine: line, locatorConfidence: line ? 'inferred' as const : undefined,
        pageUrl,
        rect: rect ? { x: bounds.x + Math.max(0, Math.min(bounds.width, rect.x)), y: bounds.y + Math.max(0, Math.min(bounds.height, rect.y)), width: Math.min(bounds.width, rect.width), height: Math.min(bounds.height, rect.height) } : undefined };
      (event.data.type === 'text' ? callbacks.current.onText : callbacks.current.onElement)(context);
    };
    window.addEventListener('message', receive); return () => window.removeEventListener('message', receive);
  }, [id, path, source, remote, url, bridgeEnabled, positionKey]);
  return <section className="preview-shell">
    <div className="preview-toolbar"><span title={url}>{remote ? url : format.toUpperCase() + ' preview'}</span>
      <div className="preview-actions">
        {format === 'html' && <label><input type="checkbox" checked={allowScripts} onChange={event => setTrustedPath(event.target.checked ? path! : '')} />Trust page scripts</label>}
        {remote && <label><input type="checkbox" checked={bridgeEnabled} onChange={event => setBridgeEnabled(event.target.checked)} />Enable inspection bridge</label>}
        <label>Width <input aria-label="Preview width" type="number" min={240} max={3840} placeholder="Fluid" value={width || ''} onChange={event => setWidth(Math.min(3840, Math.max(0, Number(event.target.value))))} /></label>
        <label>Height <input aria-label="Preview height" type="number" min={240} max={2160} placeholder="Auto" value={height || ''} onChange={event => setHeight(Math.min(2160, Math.max(0, Number(event.target.value))))} /></label>
        <button onClick={() => setReload(value => value + 1)}>Refresh</button>
      </div>
    </div>
    {remote && bridgeEnabled && !ready && <div className="fidelity-note">Waiting for the page’s inspection bridge. Include extensions/preview-bridge/sidelit.js in your development app. If the page is blank, check that the server is running and allows embedding.</div>}
    {warnings.length > 0 && <details className="preview-warnings"><summary>{warnings.length} preview warning{warnings.length === 1 ? '' : 's'}</summary>{warnings.map((warning, i) => <p key={i}>{warning}</p>)}</details>}
    {error ? <div className="preview-error" role="alert"><strong>Preview unavailable</strong><span>{error}</span><small>Use Source to correct the document, or Dev Server for project imports and runtime dependencies.</small></div>
      : src ? <div className={'preview-viewport' + (!width ? ' viewport-fluid' : '')}>
        <iframe key={remote ? src + ':' + reload + ':' + refresh : src} ref={frame} className="preview-frame" title="Sidelit preview" sandbox={remote ? 'allow-scripts allow-same-origin allow-forms' : 'allow-scripts'} src={src}
          style={{ width: width ? Math.max(240, width) : '100%', height: height ? Math.max(240, height) : '100%', minHeight: height ? Math.max(240, height) : '100%' }} onLoad={connect} />
      </div> : <div className="loading">Preparing preview…</div>}
  </section>;
}
