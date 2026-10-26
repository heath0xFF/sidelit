// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import * as runtime from 'react/jsx-runtime';
import { compileStandaloneMdx } from '../src/mdx';
import { formatForPath } from '../src/formats';
import { lineForText, parseSelection, elementContext, textContext, feedbackSelection } from '../src/inspection';
import { preparePreview } from '../src/preview-html';
import { localServerUrl } from '../src/preview-security';
import { chooseTarget } from '../src/agent-targets';
import type { AgentTarget, PreviewAsset } from '../src/api';

beforeAll(() => {
  const settings = (window as any).happyDOM.settings;
  Object.assign(settings, { disableCSSFileLoading: true, disableJavaScriptFileLoading: true, handleDisabledFileLoadingAsSuccess: true });
  settings.navigation.disableChildFrameNavigation = true;
});

describe('preview correctness', () => {
  it('hides Markdown comments without executing their contents or changing literal code', async () => {
    const source = '# Product\n\n<!-- impeccable:product-schema 1 -->\n<!-- $hidden$ <script>globalThis.__commentExecuted = true</script> -->\n\nRead <!-- inline -->this.\n\n`<!-- literal -->`\n\n```text\n<!-- fenced -->\n```';
    const result = await preparePreview(source, '/project/PRODUCT.md', 'markdown', false, '', async () => { throw Error('unexpected asset'); });
    const page = new DOMParser().parseFromString(result.html, 'text/html');
    const { code } = JSON.parse(page.getElementById('sidelit-mdx')!.textContent!);
    const Component = new Function(code)(runtime).default;
    const html = renderToStaticMarkup(createElement(Component));
    expect(html).toContain('<h1>Product</h1>');
    expect(html).toContain('<p>Read this.</p>');
    expect(html).toContain('&lt;!-- literal --&gt;');
    expect(html).toContain('&lt;!-- fenced --&gt;');
    expect(code).not.toMatch(/impeccable|hidden|inline|__commentExecuted/);
    expect((globalThis as any).__commentExecuted).toBeUndefined();
    expect(page.querySelector('meta[http-equiv]')!.getAttribute('content')).toContain("script-src 'nonce-");
    expect(result.warnings).toEqual([]);
  });
  it.each([
    '<!-- safe --><script>bad()</script><!-- safe -->',
    '<!-- safe -->\n<img src=x onerror=bad()>',
    '<!-- unclosed',
  ])('rejects raw HTML and incomplete comments in Markdown preview: %s', async source => {
    await expect(preparePreview(source, '/project/PRODUCT.md', 'markdown', false, '', async () => { throw Error('unexpected'); })).rejects.toThrow(/preserved in Source/);
  });
  it('serializes Unicode selection context within the native byte limit', () => {
    const selection = feedbackSelection({ type: 'element', text: '語'.repeat(1200), selector: '語'.repeat(500), classes: Array(8).fill('語'.repeat(80)), surrounding: '語'.repeat(1600), styles: Object.fromEntries(['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'font-size', 'font-weight'].map(key => [key, '語'.repeat(100)])) });
    expect(new TextEncoder().encode(JSON.stringify(selection)).length).toBeLessThan(8000);
    expect(selection.text).not.toBe('');
  });
  it('compiles real MDX components, expressions, tasks, tables, links, and highlighted code', async () => {
    const source = 'export const Count = ({n}) => <strong>{n + 1}</strong>\n\n# Hello <Count n={2} />\n\n- [x] Done\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = "hello";\n```\n\n![Alt](./image.png)';
    const code = await compileStandaloneMdx(source, async () => 'data:image/png;base64,abc');
    const Component = new Function(code)(runtime).default;
    const html = renderToStaticMarkup(createElement(Component));
    expect(html).toContain('<strong>3</strong>'); expect(html).toContain('type="checkbox"');
    expect(html).toContain('<table>'); expect(html).toContain('tok-keyword');
    expect(html).toContain('alt="Alt"'); expect(html).toContain('data:image/png');
  });
  it('rejects project imports and reports compilation positions without executing expressions', async () => {
    await expect(compileStandaloneMdx("import Button from './Button'\n\n<Button />")).rejects.toThrow('development server');
    await expect(compileStandaloneMdx('{import("./component")}')).rejects.toThrow('development server');
    await expect(compileStandaloneMdx('<Broken>')).rejects.toThrow();
    await compileStandaloneMdx('{globalThis.__mdxExecution = true}');
    expect((globalThis as any).__mdxExecution).toBeUndefined();
  });
  it('resolves nested CSS assets relative to their stylesheets, including fonts and imports', async () => {
    const requests: string[] = [];
    const assets: Record<string, PreviewAsset> = {
      'file:///project/css/site.css': { kind: 'style', path: '/project/css/site.css', value: '@import "./theme.css"; .a{background:url(../images/a.png)}' },
      'file:///project/css/theme.css': { kind: 'style', path: '/project/css/theme.css', value: '@font-face{src:url(../fonts/a.woff2)}' },
      'file:///project/images/a.png': { kind: 'data', path: '/project/images/a.png', value: 'data:image/png;base64,abc' },
      'file:///project/fonts/a.woff2': { kind: 'data', path: '/project/fonts/a.woff2', value: 'data:font/woff2;base64,abc' },
    };
    const result = await preparePreview('<link rel="stylesheet" href="css/site.css"><img src="images/a.png">', '/project/page.html', 'html', false, '', async (_doc, ref) => { requests.push(ref); if (!assets[ref]) throw Error(ref); return assets[ref]; });
    expect(result.warnings).toEqual([]); expect(requests).toContain('file:///project/fonts/a.woff2');
    expect(result.html).toContain('data:image/png;base64,abc'); expect(result.html).toContain('data:font/woff2');
  });
  it('removes untrusted scripts, handlers, frames and navigation; trusts scripts only on request', async () => {
    const html = '<base href="file:///"><iframe src="tauri://localhost"></iframe><meta http-equiv="refresh" content="0;url=x"><button onclick="evil()">Test</button><script>window.evil=true</script>';
    const result = await preparePreview(html, '/project/page.html', 'html', false, '', async () => { throw Error('unexpected'); });
    expect(result.html).not.toContain('window.evil'); expect(result.html).not.toContain('onclick='); expect(result.html).not.toContain('<iframe');
    expect(result.html).toContain("connect-src 'none'"); expect(result.html).toContain("script-src 'nonce-");
    const trusted = await preparePreview(html, '/project/page.html', 'html', true, '', async () => { throw Error('unexpected'); });
    expect(trusted.html).toContain('window.evil'); expect(trusted.html).toContain('onclick='); expect(trusted.html).not.toContain('<iframe');
  });
  it('reports failed local assets instead of silently removing them', async () => {
    const result = await preparePreview('<img src="missing.png">', '/project/page.html', 'html', false, '', async () => { throw Error('Not authorized'); });
    expect(result.warnings[0]).toContain('Not authorized');
  });
});

describe('selection and destinations', () => {
  it('does not invent source lines for repeated text', () => { expect(lineForText('one\ntwo', 'two')).toBe(2); expect(lineForText('same\nsame', 'same')).toBeNull(); });
  it('extracts selectors, computed styles and surrounding text', () => {
    document.body.innerHTML = '<nav class="header"><a>A</a><a style="padding:12px">Second</a></nav>';
    const el = document.querySelectorAll('a')[1];
    const context = elementContext(el, 'First\nSecond');
    expect(context.selector).toContain('a:nth-of-type(2)'); expect(context.styles?.padding).toBe('12px'); expect(context.locatorConfidence).toBe('inferred');
    const range = document.createRange(); range.selectNodeContents(el); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    expect(textContext(selection)?.text).toBe('Second');
    expect(parseSelection({ type: 'text', text: 42 })).toBeUndefined();
    expect(parseSelection({ type: 'element', text: 'x'.repeat(9000), selector: 'y'.repeat(9000), sourceLine: 42 })?.selector?.length).toBeLessThanOrEqual(500);
    expect(parseSelection({ type: 'text', text: 'x', sourceLine: 999 })?.sourceLine).toBeUndefined();
  });
  it('accepts only local dev servers and supported formats', () => {
    for (const url of ['http://localhost:3000', 'http://127.0.0.1:5173', 'http://[::1]:4321']) expect(localServerUrl(url)).toBeTruthy();
    for (const url of ['https://example.com', 'file:///etc/passwd', 'http://localhost.evil:3000', 'http://user@localhost', 'http://127.0.0.1:1420']) expect(() => localServerUrl(url)).toThrow();
    expect(formatForPath('PAGE.MDX')).toBe('mdx'); expect(formatForPath('index.htm')).toBe('html');
  });
  it('requires a choice for ambiguous targets and keeps a valid explicit choice', () => {
    const targets = [{ id: 'a', connected: true }, { id: 'b', connected: true }] as AgentTarget[];
    expect(chooseTarget(targets, '')).toBe(''); expect(chooseTarget(targets, 'b')).toBe('b');
    expect(chooseTarget(targets, 'gone')).toBe(''); expect(chooseTarget(targets.slice(0, 1), '')).toBe('a');
  });
});
