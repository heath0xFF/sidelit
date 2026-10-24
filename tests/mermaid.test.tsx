// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import * as runtime from 'react/jsx-runtime';
import { describe, expect, it } from 'vitest';
import { render } from 'pele';
import { mermaidOptions, PreviewCodeBlock } from '../src/preview-mermaid';
import { compileStandaloneMdx } from '../src/mdx';
import { preparePreview } from '../src/preview-html';

async function content(source: string) {
  const code = await compileStandaloneMdx(source, undefined, 'md');
  return new Function(code)(runtime).default;
}

describe('Mermaid preview', () => {
  it('renders flowcharts and sequence diagrams with no active links, images, or HTML', () => {
    for (const source of [
      'flowchart LR\n A[Read] --> B[Review]\n click A "https://example.com"',
      'sequenceDiagram\n Alice->>Bob: Review the draft',
      'flowchart LR\n A["<img src=x onerror=alert(1)>"] --> B',
      'flowchart LR\n A@{ img: "https://example.com/image.png", label: "Image" }',
      '%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\n A --> B\n click A "javascript:alert(1)"',
    ]) {
      const result = render(source, { ...mermaidOptions, idPrefix: 'test-diagram' });
      const svg = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
      expect(svg.querySelector('svg')).not.toBeNull();
      expect(svg.querySelector('a,image,script,foreignObject')).toBeNull();
      expect([...svg.querySelectorAll('*')].flatMap(node => [...node.attributes]).some(attr => /^on/i.test(attr.name))).toBe(false);
      expect(result.links).toEqual([]);
    }
  });
  it('bounds source, output, and graph edges', () => {
    expect(() => render('flowchart LR\n' + ' '.repeat(20_000), mermaidOptions)).toThrow(/limit/i);
    expect(() => render('flowchart LR\n' + Array.from({ length: 501 }, (_, i) => `A${i} --> A${i + 1}`).join('\n'), mermaidOptions)).toThrow(/limit|edges/i);
    expect(() => render('flowchart LR\n A --> B', { ...mermaidOptions, outputLimit: 1 })).toThrow(/limit/i);
  });
  it('treats Markdown expressions as text and keeps other code blocks unchanged', async () => {
    const Content = await content('# Plan\n\n{globalThis.__diagramExecuted = true}\n\n```js\nconst x = 1;\n```\n\n```mermaid\nflowchart LR\n A-->B\n```');
    const html = renderToStaticMarkup(createElement(Content, { components: { pre: PreviewCodeBlock } }));
    expect(html).toContain('{globalThis.__diagramExecuted = true}');
    expect(html).toContain('tok-keyword');
    expect(html).toContain('Diagram source');
    expect(html).toContain('A--&gt;B');
    expect((globalThis as any).__diagramExecuted).toBeUndefined();
  });
  it('keeps excess diagrams as visible source', async () => {
    const Content = await content(Array(33).fill('```mermaid\nflowchart LR\n A-->B\n```').join('\n\n'));
    const html = renderToStaticMarkup(createElement(Content, { components: { pre: PreviewCodeBlock } }));
    expect(html.match(/Only the first 32 diagrams/g)).toHaveLength(1);
    expect(html.match(/A--&gt;B/g)).toHaveLength(33);
  });
  it('shows invalid source without losing the surrounding prose or creating markup from the error', async () => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div'); document.body.append(container);
    const root = createRoot(container);
    try {
      const Content = await content('# Before\n\n```mermaid\n<script>bad()</script>\n```\n\nAfter');
      await act(async () => root.render(createElement(Content, { components: { pre: PreviewCodeBlock } })));
      expect(container.textContent).toContain('Diagram unavailable');
      expect(container.textContent).toContain('<script>bad()</script>');
      expect(container.querySelector('script')).toBeNull();
      expect(container.querySelector('details')?.open).toBe(true);
      expect(container.textContent).toContain('Before');
      expect(container.textContent).toContain('After');
    } finally { await act(async () => root.unmount()); container.remove(); }
  });
  it('uses the isolated preview pipeline, strips frontmatter, and keeps the fidelity gate', async () => {
    const source = '---\ntitle: Private metadata\n---\n\n# Plan\n\n```mermaid\nflowchart LR\n A-->B\n```';
    const result = await preparePreview(source, '/project/plan.md', 'markdown', false, '/* runtime */', async () => { throw Error('unexpected asset'); });
    const page = new DOMParser().parseFromString(result.html, 'text/html');
    const csp = page.querySelector('meta[http-equiv]')!.getAttribute('content')!;
    expect(csp).toContain("script-src 'nonce-");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    const config = JSON.parse(page.getElementById('sidelit-mdx')!.textContent!);
    expect(config.code).not.toContain('Private metadata');
    expect(config.code).toContain('data-mermaid');
    await expect(preparePreview(source + '\n<script>bad()</script>', '/project/plan.md', 'markdown', false, '', async () => { throw Error('unexpected'); })).rejects.toThrow(/preserved in Source/);
  });
});
