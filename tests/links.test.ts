// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { addsUnsafeLink, documentLinks, linkProblems, localLink } from '../src/links';

type Mark = { type: { name: string }; attrs: Record<string, unknown> };
const tree = (...hrefs: string[]) => ({
  descendants(visit: (node: { marks: Mark[] }) => void) {
    visit({ marks: [] });
    for (const href of hrefs) visit({ marks: [{ type: { name: 'link' }, attrs: { href } }, { type: { name: 'strong' }, attrs: {} }] });
  },
});

describe('unsafe links in the rich editor', () => {
  it('still allows edits to a document that already holds one', () => {
    const existing = tree('javascript:alert(1)', 'https://example.com');
    expect(addsUnsafeLink(existing, tree('javascript:alert(1)', 'https://example.com', 'javascript:alert(1)'))).toBe(false);
    expect(addsUnsafeLink(existing, tree('https://example.com'))).toBe(false);
  });
  it('refuses an edit that adds a new unsafe destination', () => {
    expect(addsUnsafeLink(tree('https://example.com'), tree(' JavaScript:void(0)'))).toBe(true);
    expect(addsUnsafeLink(tree('javascript:a'), tree('javascript:a', 'data:text/html,x'))).toBe(true);
    expect(addsUnsafeLink(tree(), tree('vbscript:x'))).toBe(true);
  });
});

describe('link checking', () => {
  const text = '---\ntitle: x\n---\n# Intro\n\nSee [setup](docs/guide.md#setup), [missing](gone.md), [top](#intro), [bad](#nope).\n\n[site](https://example.com) [mail](mailto:a@b.c)\n\n[ref]: ./docs/guide.md#missing-heading\n';
  it('finds Markdown links and definitions with their lines', () => {
    expect(documentLinks(text, 'markdown').map(link => [link.reference, link.line])).toEqual([
      ['docs/guide.md#setup', 6], ['gone.md', 6], ['#intro', 6], ['#nope', 6],
      ['https://example.com', 8], ['mailto:a@b.c', 8], ['./docs/guide.md#missing-heading', 10],
    ]);
    expect(documentLinks('<a href="a.html#x">A</a>\n<a href="#y">Y</a>', 'html').map(link => link.reference)).toEqual(['a.html#x', '#y']);
  });
  it('checks only local links', () => {
    expect(['#x', 'a.md', './a.md', 'file:///a.md', 'a b.md'].every(localLink)).toBe(true);
    expect(['https://x', 'mailto:a', '//cdn.example', '', 'tel:1'].some(localLink)).toBe(false);
  });
  it('reports missing files, missing headings, and links outside the grants', () => {
    const links = documentLinks(text, 'markdown');
    const problems = linkProblems(links, { text, format: 'markdown' }, [
      { reference: 'docs/guide.md#setup', status: 'document', text: '# Setup\n' },
      { reference: 'gone.md', status: 'missing' },
      { reference: './docs/guide.md#missing-heading', status: 'document', text: '# Setup\n' },
    ]);
    expect(problems.map(p => [p.reference, p.problem])).toEqual([
      ['gone.md', 'File not found'],
      ['#nope', 'No heading for #nope in this document'],
      ['./docs/guide.md#missing-heading', 'No heading for #missing-heading in the linked document'],
    ]);
    expect(linkProblems([{ reference: '../x.md', label: 'x', line: 1 }], { text: '', format: 'markdown' }, [{ reference: '../x.md', status: 'outside' }])[0].problem).toContain('Outside');
  });
});
