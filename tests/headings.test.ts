// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { headingForAnchor, headings } from '../src/headings';

describe('headings', () => {
  it('lists Markdown headings with source lines past frontmatter', () => {
    const list = headings('---\na: 1\n---\n\n# Top\n\n> ## In a quote\n\n### `Code` & *more*\n', 'markdown');
    expect(list.map(h => [h.level, h.text, h.line, h.index])).toEqual([[1, 'Top', 5, 0], [2, 'In a quote', 7, 1], [3, 'Code & more', 9, 2]]);
  });
  it('ignores headings inside code fences', () => {
    expect(headings('```md\n# Not this\n```\n\n# This\n', 'markdown').map(h => h.text)).toEqual(['This']);
  });
  it('follows GitHub anchor rules, including repeats and non-Latin text', () => {
    const list = headings('# Getting Started!\n\n# Getting Started\n\n## 研究 notes\n\n## A & B\n', 'markdown');
    expect(list.map(h => h.slug)).toEqual(['getting-started', 'getting-started-1', '研究-notes', 'a--b']);
    expect(headingForAnchor(list, 'Getting-Started-1')?.index).toBe(1);
    expect(headingForAnchor(list, encodeURIComponent('研究-notes'))?.index).toBe(2);
    expect(headingForAnchor(list, 'missing')).toBeUndefined();
    expect(headingForAnchor(list, '%E0%A4%A')).toBeUndefined();
  });
  it('reads HTML headings without running the page', () => {
    const list = headings('<h1>One</h1>\n<p>x</p>\n<h3 onclick="bad()">Two</h3><script>document.title="ran"</script>', 'html');
    expect(list.map(h => [h.level, h.text, h.line])).toEqual([[1, 'One', 1], [3, 'Two', 3]]);
    expect(document.title).not.toBe('ran');
  });
  it('reads MDX headings beside JSX', () => {
    expect(headings('export const a = 1\n\n# Title\n\n<Box />\n\n## Next\n', 'mdx').map(h => h.text)).toEqual(['Title', 'Next']);
  });
});
