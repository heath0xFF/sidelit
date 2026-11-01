import { describe, expect, it } from 'vitest';
import { computeChanges, draftChanges, revertChange } from '../src/changes';

const undoAll = (before: string, after: string, format: 'markdown' | 'lines') => {
  let text = after;
  for (let { changes } = computeChanges(before, text, format); changes.length; { changes } = computeChanges(before, text, format)) text = revertChange(text, changes[0]);
  return text;
};

describe('changes', () => {
  it('finds changed, added, and removed passages as whole blocks', () => {
    const before = '# Title\n\nFirst.\n\nSecond.\n\nThird.\n';
    const after = '# Title\n\nFirst, edited.\n\nThird.\n\nFourth.\n';
    const { changes, richCount } = computeChanges(before, after, 'markdown');
    expect(richCount).toBe(4);
    expect(changes.map(c => [c.kind, c.richFrom, c.richTo])).toEqual([['changed', 1, 2], ['added', 3, 4]]);
    expect(changes[0].oldText).toBe('First.\n\nSecond.');
    expect(changes[1].line).toBe(7);
  });
  it('reports a removal where the passage would return', () => {
    const { changes } = computeChanges('One.\n\nTwo.\n\nThree.\n', 'One.\n\nThree.\n', 'markdown');
    expect(changes).toMatchObject([{ kind: 'removed', richFrom: 1, richTo: 1, oldText: 'Two.', line: 3 }]);
  });
  it('does not count reference definitions or frontmatter as rich editor blocks', () => {
    const { changes, richCount } = computeChanges('---\na: 1\n---\n\nSee [x][d].\n\n[d]: https://a.b\n', '---\na: 2\n---\n\nSee [x][d].\n\n[d]: https://a.b\n\nNew.\n', 'markdown');
    expect(richCount).toBe(2);
    expect(changes.map(c => c.kind)).toEqual(['changed', 'added']);
    expect(changes[1].richFrom).toBe(1);
  });
  it('treats a line ending change alone as no change', () => {
    expect(computeChanges('One.\n\nTwo.\n', 'One.\r\n\r\nTwo.\r\n', 'markdown').changes).toEqual([]);
    expect(computeChanges('a\nb\n', 'a\r\nb\r\n', 'lines').changes).toEqual([]);
  });
  it.each([
    ['changed middle', 'One.\n\nTwo.\n\nThree.\n', 'One.\n\nDos.\n\nThree.\n'],
    ['added at the end', 'One.\n', 'One.\n\nTwo.\n'],
    ['added at the start', 'Two.\n', 'One.\n\nTwo.\n'],
    ['removed at the end', 'One.\n\nTwo.\n', 'One.\n'],
    ['removed at the start', 'One.\n\nTwo.\n', 'Two.\n'],
    ['several at once', '# A\n\nB\n\n- c\n- d\n\nE\n', '# A!\n\n- c\n- d\n- x\n\nE\n\nF\n'],
    ['frontmatter', '---\na: 1\n---\n\nBody.\n', '---\na: 2\n---\n\nBody.\n'],
  ])('reverting every change restores the text: %s', (_name, before, after) => {
    expect(undoAll(before, after, 'markdown')).toBe(before);
  });
  it.each([
    ['middle', 'a\nb\nc\n', 'a\nx\nc\n'],
    ['added', 'a\nc\n', 'a\nb\nc\n'],
    ['removed', 'a\nb\nc\n', 'a\nc\n'],
    ['last line without newline', 'a\nb', 'a\nb\nc'],
    ['CRLF', 'a\r\nb\r\nc\r\n', 'a\r\nx\r\nc\r\ny\r\n'],
  ])('reverting every line change restores the text: %s', (_name, before, after) => {
    expect(undoAll(before, after, 'lines')).toBe(before);
  });
  it('reverting one change leaves the others', () => {
    const before = 'One.\n\nTwo.\n\nThree.\n', after = 'Uno.\n\nTwo.\n\nTres.\n';
    const first = computeChanges(before, after, 'markdown').changes[0];
    const next = revertChange(after, first);
    expect(next).toBe('One.\n\nTwo.\n\nTres.\n');
    expect(computeChanges(before, next, 'markdown').changes).toHaveLength(1);
  });
  it.each([
    ['bullets', '- a\n- b\n', '* a\n* b\n'],
    ['emphasis', 'Some _word_ and __bold__.\n', 'Some *word* and **bold**.\n'],
    ['headings', 'Title\n=====\n', '# Title\n'],
    ['rules', '***\n', '---\n'],
    ['tight and loose lists', '- a\n- b\n', '- a\n\n- b\n'],
    ['escapes', 'a\\_b\n', 'a_b\n'],
    ['table padding', '| a | b |\n|---|---|\n| 1 | 2 |\n', '|a|b|\n|-|-|\n|1|2|\n'],
    ['fences', '~~~js\nx\n~~~\n', '```js\nx\n```\n'],
    ['reference links', 'See [x][d].\n\n[d]: https://a.b\n', 'See [x](https://a.b).\n'],
    ['reference images', '![x][d]\n\n[d]: a.png\n', '![x](a.png)\n'],
  ])('does not count a rewrite that reads the same: %s', (_name, before, after) => {
    expect(computeChanges(before, after, 'markdown').changes).toEqual([]);
  });
  it.each([
    ['text', 'One two.\n', 'One three.\n'],
    ['list type', '- a\n', '1. a\n'],
    ['heading level', '# T\n', '## T\n'],
    ['code', '```js\nx\n```\n', '```js\ny\n```\n'],
    ['code language', '```js\nx\n```\n', '```ts\nx\n```\n'],
    ['link target', 'See [x](https://a.b).\n', 'See [x](https://a.c).\n'],
    ['task state', '- [ ] a\n', '- [x] a\n'],
    ['reference target', 'See [x][d].\n\n[d]: https://a.b\n', 'See [x][d].\n\n[d]: https://a.c\n'],
    ['HTML', '<div>a</div>\n', '<div>b</div>\n'],
  ])('still counts a real change: %s', (_name, before, after) => {
    expect(computeChanges(before, after, 'markdown').changes.length).toBeGreaterThan(0);
  });
  it('shows a changed reference target on the passage that links to it', () => {
    const { changes } = computeChanges('See [x][d].\n\nMore.\n\n[d]: https://a.b\n', 'See [x][d].\n\nMore.\n\n[d]: https://a.c\n', 'markdown');
    expect(changes).toMatchObject([{ kind: 'changed', oldText: 'See [x][d].', richFrom: 0, richTo: 1 }]);
  });
  it('reverting a passage brings back a definition its links lost', () => {
    const before = 'See [x][d] now.\n\nMore.\n\n[d]: https://a.b\n', after = 'See [y](https://a.b) now.\n\nMore.\n';
    const [change] = computeChanges(before, after, 'markdown').changes;
    const next = revertChange(after, change);
    expect(next).toBe('See [x][d] now.\n\n[d]: https://a.b\n\nMore.\n');
    expect(computeChanges(before, next, 'markdown').changes).toEqual([]);
  });
  it('treats a very large document by lines rather than parsing it on each key', () => {
    const before = 'line\n'.repeat(500_000), after = before + 'more\n';
    const { changes, richCount } = computeChanges(before, after, 'markdown');
    expect(richCount).toBe(0);
    expect(changes).toHaveLength(1);
  });
  it('stays one change instead of doing unbounded work on a huge difference', () => {
    const before = Array.from({ length: 3000 }, (_, i) => 'old ' + i).join('\n');
    const after = Array.from({ length: 3000 }, (_, i) => 'new ' + i).join('\n');
    expect(computeChanges(before, after, 'lines').changes).toHaveLength(1);
  });
  it('describes unsaved changes for an agent reading the file on disk', () => {
    expect(draftChanges('a\nb\nc\n', 'a\nB\nc\nd\n')?.text).toBe('@@ line 2 @@\n- b\n+ B\n@@ line 4 @@\n+ d');
    expect(draftChanges('same', 'same')).toBeUndefined();
    expect(draftChanges('a\n', 'é\n')?.bytes).toBeGreaterThan('@@ line 1 @@\n- a\n+ é'.length);
  });
  it('leaves rewritten syntax out of an attached draft, unless that is the only difference', () => {
    expect(draftChanges('- a\n- b\n\nOld.\n', '* a\n* b\n\nNew.\n', 'markdown')?.text).toBe('@@ line 4 @@\n- Old.\n+ New.');
    expect(draftChanges('- a\n', '* a\n', 'markdown')?.text).toBe('@@ line 1 @@\n- - a\n+ * a');
  });
});
