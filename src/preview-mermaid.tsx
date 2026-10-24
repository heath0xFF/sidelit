// This component is bundled only into the opaque-origin preview frame.
import { isValidElement, useEffect, useRef, useState, type ComponentProps } from 'react';
import { mount, type RenderOptions } from 'pele';

// shortcut: size bounds do not limit CPU time; use a worker if diagrams stall the preview.
export const mermaidOptions: RenderOptions = {
  links: false, images: false, limit: 20_000, outputLimit: 1_000_000, maxEdges: 500,
};

function Diagram({ source, limited }: { source: string; limited: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (limited) return;
    const options = () => ({
      ...mermaidOptions, fontSize: parseFloat(getComputedStyle(document.body).fontSize) || 16,
      onRender: () => setError(''), onError: (error: unknown) => setError(String(error).slice(0, 1000)),
    });
    let diagram: ReturnType<typeof mount>;
    try { diagram = mount(container.current!, source, options()); }
    catch (error) { setError(String(error).slice(0, 1000)); return; }
    // Font-size changes do not always change the container width.
    const appearance = new MutationObserver(() => diagram.update(source, options()));
    appearance.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    return () => { appearance.disconnect(); diagram.destroy(); };
  }, [source, limited]);
  const failure = limited ? 'Only the first 32 diagrams are rendered.' : error;
  return <figure className="sidelit-diagram">
    <div ref={container} hidden={!!failure} />
    {failure && <p role="status">Diagram unavailable. Use Source to edit it. {failure}</p>}
    <details open={failure ? true : undefined}>
      <summary>Diagram source</summary>
      <pre><code>{source}</code></pre>
    </details>
  </figure>;
}

export function PreviewCodeBlock({ children, ...props }: ComponentProps<'pre'>) {
  if (isValidElement<{ children?: unknown; 'data-mermaid'?: string }>(children) &&
      typeof children.props.children === 'string' && children.props['data-mermaid']) {
    return <Diagram source={children.props.children} limited={children.props['data-mermaid'] === 'limit'} />;
  }
  return <pre {...props}>{children}</pre>;
}
