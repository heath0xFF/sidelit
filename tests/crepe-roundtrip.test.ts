// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import { sourceReason } from '../src/fidelity';

// Whether documents may enter the rich editor rests on what Crepe writes back, so test the real editor.
async function roundTrip(markdown: string, edit = false) {
  const root = document.createElement('div'); document.body.append(root);
  const crepe = new Crepe({ root, defaultValue: markdown, features: { [Crepe.Feature.Latex]: false, [Crepe.Feature.ImageBlock]: false } });
  await crepe.create();
  try {
    return crepe.editor.action(ctx => {
      const view = ctx.get(editorViewCtx);
      if (edit) view.dispatch(view.state.tr.insertText('Edited ', 1));
      return ctx.get(serializerCtx)(view.state.doc);
    });
  } finally { await crepe.destroy(); root.remove(); }
}

describe('Crepe round trip', () => {
  const opening = 'Opening paragraph.\n\n';
  it.each([
    ['dollars', 'Budget is $500 and $HOME, from $5 to $10.\n'],
    ['math', 'Energy $$E=mc^2$$ here.\n'],
    ['line break HTML', 'one<br>two\n'],
    ['block HTML', '<details><summary>More</summary>\n\nHidden **text**\n\n</details>\n'],
    ['HTML attributes', '<aside data-x="1">Raw</aside>\n'],
    ['comments', '# T\n\n<!-- keep me -->\n\nRead <!-- inline -->this.\n'],
    ['script text', '<script>inert()</script>\n'],
    ['footnotes', 'Claim[^1]\n\n[^1]: Source note\n'],
    ['extension blocks', ':::note\nHi\n:::\n'],
    ['Mermaid', '```mermaid\ngraph LR\n A --> B\n```\n'],
  ])('keeps %s exactly, including after a real edit elsewhere', async (_name, markdown) => {
    expect(sourceReason(markdown)).toBeUndefined();
    expect(await roundTrip(markdown)).toBe(markdown);
    expect(await roundTrip(opening + markdown, true)).toBe('Edited ' + opening + markdown);
  });
  it('keeps link targets when it inlines reference links', async () => {
    expect(await roundTrip('See [docs][d].\n\n[d]: https://a.b\n')).toBe('See [docs](https://a.b).\n');
  });
  it('still drops fence metadata, which is why the gate holds those documents in Source', async () => {
    const markdown = '```js title="a"\nx\n```\n';
    expect(await roundTrip(markdown)).not.toContain('title');
    expect(sourceReason(markdown)).toContain('metadata');
  });
});
