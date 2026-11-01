// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/kit/core';
import { findInDocument, matchRanges, MAX_FIND_MATCHES } from '../src/find';

describe('find', () => {
  it('matches case-insensitively and literally', () => {
    expect(matchRanges('Cat cat CAT', 'cat')).toEqual([[0, 3], [4, 7], [8, 11]]);
    expect(matchRanges('a.b axb (c)', 'a.b')).toEqual([[0, 3]]);
    expect(matchRanges('(c) [d] $e', '(c)')).toEqual([[0, 3]]);
    expect(matchRanges('anything', '   ')).toEqual([]);
  });
  it('stops at its limit', () => {
    expect(matchRanges('a'.repeat(MAX_FIND_MATCHES * 2), 'a')).toHaveLength(MAX_FIND_MATCHES);
  });
  it('finds across marks and in code, at real document positions, leaving the document alone', async () => {
    const root = document.createElement('div'); document.body.append(root);
    const crepe = new Crepe({ root, defaultValue: 'One **needle** one.\n\nSplit nee**dle** here, then a\nbreak needle.\n\n```js\nneedle needle\n```\n', features: { [Crepe.Feature.Latex]: false, [Crepe.Feature.ImageBlock]: false } });
    await crepe.create();
    try {
      crepe.editor.action(ctx => {
        const { doc } = ctx.get(editorViewCtx).state;
        const before = doc.toJSON();
        const found = findInDocument(doc as never, 'NEEDLE');
        expect(found).toHaveLength(5);
        for (const match of found) expect(doc.textBetween(match.from, match.to).toLowerCase()).toBe('needle');
        expect(found.filter(match => match.code).map(match => match.code!.nth)).toEqual([0, 1]);
        const first = found[0];
        expect(findInDocument(doc as never, 'needle', [[first.from, first.to]])).toHaveLength(4);
        expect(doc.toJSON()).toEqual(before);
      });
    } finally { await crepe.destroy(); root.remove(); }
  });
});
