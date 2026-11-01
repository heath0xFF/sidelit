import { frontmatter, parser } from "./fidelity";
import type { DocumentFormat } from "./formats";

export type ChangeKind = "added" | "removed" | "changed";
export interface Change {
  kind: ChangeKind;
  // Range in the current text. Empty for a removed passage, which sits where it would return.
  from: number;
  to: number;
  oldText: string;
  newText: string;
  line: number;
  endLine: number;
  // Top-level rich editor blocks this covers, or the block a removal sits before.
  richFrom: number;
  richTo: number;
  label: string;
  revert: { from: number; to: number; text: string };
}
export interface ChangeSet {
  changes: Change[];
  richCount: number;
}
interface Block {
  from: number;
  to: number;
  key: string;
  rich: boolean;
  definition?: string;
  references?: string[];
}
const LCS_CELLS = 1_000_000;
// Parsing on every keystroke is too slow past this; such documents are in Source, so lines do.
const MAX_PARSED_CHARS = 2 * 1024 * 1024;
const key = (text: string) => text.replaceAll("\r\n", "\n");

type Syntax = Record<string, unknown> & { type?: string };
// What a passage means, not how it is spelled: `-` and `*` bullets, `_` and `*` emphasis, setext
// headings, table padding, and reference links all read the same, and Crepe rewrites them.
function meaning(node: Syntax, definitions: Map<string, Syntax>, references: Set<string>): unknown {
  if (node.type === "linkReference" || node.type === "imageReference") {
    const identifier = String(node.identifier), target = definitions.get(identifier);
    references.add(identifier);
    if (target) return meaning(node.type === "linkReference"
      ? { type: "link", url: target.url, title: target.title ?? null, children: node.children }
      : { type: "image", url: target.url, title: target.title ?? null, alt: node.alt }, definitions, references);
  }
  const shape: Record<string, unknown> = {};
  for (const name of Object.keys(node).sort()) {
    if (name === "position" || name === "spread") continue;
    const value = node[name];
    shape[name] = Array.isArray(value) ? value.map((child) => child && typeof child === "object" ? meaning(child, definitions, references) : child)
      : typeof value === "string" ? key(value) : value;
  }
  return shape;
}

function markdownBlocks(text: string): Block[] {
  const { prefix, body } = frontmatter(text);
  const blocks: Block[] = [];
  if (prefix) blocks.push({ from: 0, to: prefix.trimEnd().length, rich: false, key: key(prefix.trimEnd()) });
  const nodes = parser.parse(body).children as unknown as Syntax[];
  const definitions = new Map(nodes.filter((node) => node.type === "definition").map((node) => [String(node.identifier), node]));
  for (const node of nodes) {
    const position = node.position as { start: { offset?: number }; end: { offset?: number } } | undefined;
    const start = position?.start.offset, end = position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const references = new Set<string>();
    const definition = node.type === "definition" ? String(node.identifier) : undefined;
    blocks.push({
      from: prefix.length + start,
      to: prefix.length + end,
      // Crepe inlines reference links, so definitions have no block in the rich editor.
      rich: !definition,
      key: definition ? `definition:${definition}:${node.url}:${node.title ?? ""}` : JSON.stringify(meaning(node, definitions, references)),
      definition,
      references: [...references],
    });
  }
  return blocks;
}

function lineBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let from = 0;
  for (;;) {
    const next = text.indexOf("\n", from);
    const end = next < 0 ? text.length : next;
    const to = end > from && text[end - 1] === "\r" ? end - 1 : end;
    blocks.push({ from, to, rich: false, key: text.slice(from, to) });
    if (next < 0) return blocks;
    from = next + 1;
  }
}

// Longest common subsequence of the differing middle; an oversized middle stays one change.
function matches(a: Block[], b: Block[]) {
  const pairs: [number, number][] = [];
  let start = 0;
  while (start < a.length && start < b.length && a[start].key === b[start].key) {
    pairs.push([start, start]);
    start++;
  }
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1].key === b[endB - 1].key) { endA--; endB--; }
  const n = endA - start, m = endB - start;
  if (n && m && n * m <= LCS_CELLS) {
    const width = m + 1, table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        table[i * width + j] = a[start + i].key === b[start + j].key
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    for (let i = 0, j = 0; i < n && j < m;) {
      if (a[start + i].key === b[start + j].key) pairs.push([start + i++, start + j++]);
      else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i++;
      else j++;
    }
  }
  for (let i = endA, j = endB; i < a.length; i++, j++) pairs.push([i, j]);
  return pairs;
}

const excerpt = (text: string) => {
  const line = text.split("\n").find((value) => value.trim()) ?? "";
  const clean = line.trim();
  return clean.length > 80 ? clean.slice(0, 79) + "…" : clean;
};
const lineAt = (text: string, offset: number) => {
  let line = 1;
  for (let at = text.indexOf("\n"); at >= 0 && at < offset; at = text.indexOf("\n", at + 1)) line++;
  return line;
};

export function computeChanges(before: string, after: string, format: DocumentFormat | "lines"): ChangeSet {
  const parsed = format === "markdown" && before.length + after.length <= MAX_PARSED_CHARS;
  const blocks = parsed ? markdownBlocks : lineBlocks;
  const a = blocks(before), b = blocks(after);
  const defined = new Set(b.flatMap((block) => block.definition ?? []));
  const richBefore: number[] = [];
  let richCount = 0;
  for (const block of b) { richBefore.push(richCount); if (block.rich) richCount++; }
  const eol = after.includes("\r\n") ? "\r\n" : "\n";
  const gap = parsed ? eol + eol : eol;
  const changes: Change[] = [];
  let i = 0, j = 0;
  // Where a definition sits changes nothing on the page, so only passages are lined up.
  const passagesA = a.flatMap((block, at) => block.definition ? [] : [at]), passagesB = b.flatMap((block, at) => block.definition ? [] : [at]);
  const lined = matches(passagesA.map((at) => a[at]), passagesB.map((at) => b[at])).map(([x, y]) => [passagesA[x], passagesB[y]] as [number, number]);
  for (const [nextA, nextB] of [...lined, [a.length, b.length] as [number, number]]) {
    const oldBlocks = a.slice(i, nextA), newBlocks = b.slice(j, nextB);
    // Links show any change to what they point at, so a definition alone changes nothing visible.
    if ((nextA > i || nextB > j) && ![...oldBlocks, ...newBlocks].every((block) => block.definition)) {
      const oldText = nextA > i ? before.slice(a[i].from, a[nextA - 1].to) : "";
      // Reverting a passage must bring back any definition its links lost, such as to a rich edit.
      const inHunk = new Set(oldBlocks.flatMap((block) => block.definition ?? []));
      const restored = oldText + [...new Set(oldBlocks.flatMap((block) => block.references ?? []))]
        .filter((name) => !defined.has(name) && !inHunk.has(name))
        .flatMap((name) => { const lost = a.find((block) => block.definition === name); return lost ? [gap + before.slice(lost.from, lost.to)] : []; })
        .join("");
      const added = nextB > j, removed = nextA > i;
      const from = added ? b[j].from : b[j]?.from ?? after.length;
      const to = added ? b[nextB - 1].to : from;
      const newText = after.slice(from, to);
      const previousEnd = j > 0 ? b[j - 1].to : undefined;
      const following = b[nextB]?.from;
      const revert = removed && added
        ? { from, to, text: restored }
        : added
          ? following !== undefined
            ? { from, to: following, text: "" }
            : { from: previousEnd ?? from, to, text: "" }
          : following !== undefined || j < b.length
            ? { from, to: from, text: restored + gap }
            : { from: previousEnd ?? after.length, to: previousEnd ?? after.length, text: (previousEnd === undefined ? "" : gap) + restored };
      const line = lineAt(after, from);
      changes.push({
        kind: newBlocks.some((block) => !block.definition) ? (oldBlocks.some((block) => !block.definition) ? "changed" : "added") : "removed",
        from, to, oldText, newText, line,
        endLine: line + (newText.match(/\n/g)?.length ?? 0),
        richFrom: richBefore[j] ?? richCount,
        richTo: richBefore[nextB] ?? richCount,
        label: excerpt(newText || oldText),
        revert,
      });
    }
    i = nextA + 1; j = nextB + 1;
  }
  return { changes, richCount };
}

// Crepe keeps an empty paragraph after a final code block or table, which the source does not have.
export function blocksFit(richCount: number, doc: { childCount: number; lastChild: { type: { name: string }; content: { size: number } } | null }) {
  if (doc.childCount === richCount) return true;
  return doc.childCount === richCount + 1 && doc.lastChild?.type.name === "paragraph" && doc.lastChild.content.size === 0;
}

export const revertChange = (text: string, change: Change) =>
  text.slice(0, change.revert.from) + change.revert.text + text.slice(change.revert.to);

export const MAX_DRAFT_BYTES = 12 * 1024;
// What the file on disk lacks, in a form an agent can read beside that file.
export function draftChanges(disk: string, draft: string, format: DocumentFormat | "lines" = "lines"): { text: string; bytes: number } | undefined {
  // By passage, so a rich edit's rewritten bullets do not bury what the person changed.
  const passages = format === "markdown" ? computeChanges(disk, draft, "markdown").changes : [];
  const changes = passages.length ? passages : computeChanges(disk, draft, "lines").changes;
  if (!changes.length) return undefined;
  const lines = (prefix: string, text: string) => text ? text.split(/\r?\n/).map((line) => prefix + line) : [];
  const text = changes.map((change) => [`@@ line ${change.line} @@`, ...lines("- ", change.oldText), ...lines("+ ", change.newText)].join("\n")).join("\n");
  return { text, bytes: new TextEncoder().encode(text).length };
}
