import { compile } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import { languages } from '@codemirror/language-data';
import { classHighlighter, highlightTree } from '@lezer/highlight';

function visit(value: unknown, fn: (node: any) => void) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(child => visit(child, fn)); return; }
  const node = value as Record<string, unknown>;
  if (typeof node.type === 'string') fn(node);
  for (const [key, child] of Object.entries(node)) if (!['position', 'loc'].includes(key)) visit(child, fn);
}

export async function compileStandaloneMdx(source: string, asset: (reference: string) => Promise<string> = async ref => ref, format: 'md' | 'mdx' = 'mdx') {
  const result = await compile(source, {
    format, outputFormat: 'function-body', development: false, remarkPlugins: [remarkGfm, () => async (tree: unknown) => {
      const jobs: Promise<void>[] = [];
      visit(tree, node => {
        if (node.type === 'ImportDeclaration' || node.type === 'ImportExpression' || node.type === 'ExportAllDeclaration' || (node.type === 'ExportNamedDeclaration' && node.source)) {
          throw new Error('MDX imports require a project development server. Standalone components can be declared in this document.');
        }
        if (node.type === 'image' && node.url) jobs.push(asset(node.url).then(url => { node.url = url; }));
        if (node.type === 'mdxJsxAttribute' && ['src', 'poster'].includes(node.name) && typeof node.value === 'string') jobs.push(asset(node.value).then(url => { node.value = url; }));
      });
      await Promise.all(jobs);
    }], rehypePlugins: [() => async (tree: any) => {
      const jobs: Promise<void>[] = [];
      let diagrams = 0;
      visit(tree, node => {
        if (node.type !== 'element' || node.tagName !== 'code') return;
        const language = node.properties?.className?.find((v: string) => v.startsWith('language-'))?.slice(9);
        if (language === 'mermaid') {
          node.properties['data-mermaid'] = ++diagrams <= 32 ? 'render' : 'limit';
          return;
        }
        const description = languages.find(l => l.name.toLowerCase() === language?.toLowerCase() || l.alias.includes(language));
        if (!description) return;
        jobs.push(description.load().then(support => {
          const text = node.children.map((n: any) => n.value || '').join('');
          const children: any[] = []; let cursor = 0;
          highlightTree(support.language.parser.parse(text), classHighlighter, (from, to, classes) => {
            if (from > cursor) children.push({ type: 'text', value: text.slice(cursor, from) });
            children.push({ type: 'element', tagName: 'span', properties: { className: classes.split(' ') }, children: [{ type: 'text', value: text.slice(from, to) }] });
            cursor = to;
          });
          if (cursor < text.length) children.push({ type: 'text', value: text.slice(cursor) });
          node.children = children;
        }));
      });
      await Promise.all(jobs);
    }],
  });
  return String(result);
}
