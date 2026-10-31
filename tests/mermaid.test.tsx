// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import * as runtime from 'react/jsx-runtime';
import { describe, expect, it } from 'vitest';
import { render } from 'pele';
import { PreviewCodeBlock } from '../src/preview-mermaid';
import { compileStandaloneMdx } from '../src/mdx';
import { renderMermaidBlock } from '../src/mermaid-block';
import { mermaidOptions } from '../src/mermaid-options';
import readme from '../README.md?raw';

async function content(source: string) {
  const code = await compileStandaloneMdx(source);
  return new Function(code)(runtime).default;
}

describe('Mermaid preview', () => {
  it('renders the README review workflow within the shipped limits', () => {
    const diagrams = [...readme.matchAll(/^```mermaid\r?\n([\s\S]*?)^```/gm)];
    expect(diagrams).toHaveLength(1);
    const result = render(diagrams[0][1], mermaidOptions);
    expect(result.type).toBe('sequence');
    expect(result.svg).toContain('Pi in Rex');
  });
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
  it('keeps other code blocks unchanged in MDX', async () => {
    const Content = await content('# Plan\n\n```js\nconst x = 1;\n```\n\n```mermaid\nflowchart LR\n A-->B\n```');
    const html = renderToStaticMarkup(createElement(Content, { components: { pre: PreviewCodeBlock } }));
    expect(html).toContain('tok-keyword');
    expect(html).toContain('Diagram source');
    expect(html).toContain('A--&gt;B');
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
  it('draws Mermaid blocks in the rich editor and leaves other languages alone', async () => {
    expect(renderMermaidBlock('js', 'const x = 1', () => { throw Error('unexpected'); })).toBeNull();
    const draw = (source: string) => new Promise<string | null>(resolve => { expect(renderMermaidBlock('mermaid', source, resolve)).toBeUndefined(); });
    const [first, second] = await Promise.all([draw('flowchart LR\n A --> B'), draw('flowchart LR\n A --> B')]);
    const ids = (svg: string | null) => [...new DOMParser().parseFromString(svg!, 'image/svg+xml').querySelectorAll('[id]')].map(node => node.id);
    expect(first).toContain('<svg');
    expect(ids(first).filter(id => ids(second).includes(id))).toEqual([]);
    const failed = await draw('<script>bad()</script>');
    expect(failed).toContain('Diagram unavailable');
    expect(failed).not.toContain('bad()');
  });
});
