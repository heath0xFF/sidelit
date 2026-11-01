export const MAX_FIND_MATCHES = 1000;
export interface FindMatch {
  from: number;
  to: number;
  // Crepe draws code blocks itself, so decorations can only mark the block, not the words.
  code?: { from: number; to: number; nth: number };
}
interface FindNode {
  isTextblock: boolean;
  nodeSize: number;
  type: { name: string };
  content: { size: number };
  textBetween(from: number, to: number, block?: string, leaf?: string): string;
  descendants(visit: (node: FindNode, pos: number) => boolean | void): void;
}
export function matchRanges(text: string, query: string): [number, number][] {
  const needle = query.trim();
  if (!needle) return [];
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&"), "giu");
  return [...text.matchAll(pattern)].slice(0, MAX_FIND_MATCHES).map((match) => [match.index, match.index + match[0].length]);
}
// Reads the document, not the page: Crepe only mounts code blocks near the viewport.
export function findInDocument(doc: FindNode, query: string, hidden: [number, number][] = []): FindMatch[] {
  const needle = query.trim(), matches: FindMatch[] = [];
  if (!needle) return matches;
  doc.descendants((node, pos) => {
    if (matches.length >= MAX_FIND_MATCHES) return false;
    if (!node.isTextblock) return;
    const isCode = node.type.name === "code_block";
    // One character per leaf node, so offsets in this text are offsets in the document.
    const text = node.textBetween(0, node.content.size, undefined, "￼");
    matchRanges(text, needle).forEach(([start, end], nth) => {
      const from = pos + 1 + start, to = pos + 1 + end;
      if (hidden.some(([first, last]) => from < last && to > first)) return;
      matches.push(isCode ? { from, to, code: { from: pos, to: pos + node.nodeSize, nth } } : { from, to });
    });
    return false;
  });
  return matches.slice(0, MAX_FIND_MATCHES);
}
