import { parser } from "./fidelity";

export interface MathMatch {
  from: number;
  to: number;
  source: string;
}
export const MAX_MATH_SOURCE = 4000;
export const MAX_MATH_PER_DOCUMENT = 500;
// Pandoc's rule, plus no digit after the opening `$`, so money and shell variables stay text.
const inline = /(?<![\\$\w])\$\$(?=\S)([^$]{1,4000}?)\$\$(?!\$)|(?<![\\$\w])\$(?=[^\s\d$])([^$\n]{1,1000}?)(?<=[^\s\\])\$(?![\w$])/g;
const display = /^\s*\$\$([^$]{1,4000})\$\$\s*$/;

export function findInlineMath(text: string): MathMatch[] {
  if (!text.includes("$")) return [];
  return [...text.matchAll(inline)].map((match) => ({
    from: match.index,
    to: match.index + match[0].length,
    source: match[1] ?? match[2],
  }));
}
export function displayMath(text: string): string | undefined {
  return display.exec(text)?.[1].trim() || undefined;
}

interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
// How math reads once Markdown has removed escapes (`\{` is `{`, `\\` is `\`) and rejoined lines.
const rendered = (source: string) =>
  source.replace(/\\([!-/:-@[-`{-~])|\\(?=\r?\n)/g, "$1").replace(/\s+/g, " ").trim();

// The editor only holds rendered text, so `\{` arrives as `{` and `\$x\$` looks like math.
// Find the same math in the Markdown itself: its source is what KaTeX needs, and text with
// no counterpart there, such as escaped dollars, is not math at all. Call in document order.
export function mathSources(markdown: string) {
  const found = new Map<string, string[]>();
  const add = (source: string) => {
    const key = rendered(source);
    found.set(key, [...(found.get(key) ?? []), source]);
  };
  const raw = (node: MarkdownNode, quoted: boolean) => {
    const text = markdown.slice(node.position?.start.offset ?? 0, node.position?.end.offset ?? 0);
    return quoted ? text.replace(/\n[ \t]*(?:>[ \t]?)+/g, "\n") : text;
  };
  const walk = (node: MarkdownNode, quoted: boolean) => {
    if (node.type === "text") {
      for (const match of findInlineMath(raw(node, quoted))) add(match.source);
      return;
    }
    if (node.type === "paragraph" && node.children?.every((child) => child.type === "text" || child.type === "break")) {
      const source = displayMath(node.children.map((child) => child.type === "break" ? "\n" : raw(child, quoted)).join(""));
      if (source) { add(source); return; }
    }
    node.children?.forEach((child) => walk(child, quoted || node.type === "blockquote"));
  };
  walk(parser.parse(markdown) as MarkdownNode, false);
  const taken = new Map<string, number>();
  return (text: string): string | undefined => {
    const key = rendered(text), sources = found.get(key);
    if (!sources) return undefined;
    const at = taken.get(key) ?? 0;
    taken.set(key, at + 1);
    return sources[Math.min(at, sources.length - 1)];
  };
}
