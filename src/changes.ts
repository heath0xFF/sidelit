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
}
const LCS_CELLS = 1_000_000;
const key = (text: string) => text.replaceAll("\r\n", "\n");

function markdownBlocks(text: string): Block[] {
  const { prefix, body } = frontmatter(text);
  const blocks: Block[] = [];
  const block = (from: number, to: number, rich: boolean) =>
    blocks.push({ from, to, rich, key: key(text.slice(from, to)) });
  if (prefix) block(0, prefix.trimEnd().length, false);
  for (const node of parser.parse(body).children) {
    const start = node.position?.start.offset, end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    // Crepe inlines reference links, so definitions have no block in the rich editor.
    block(prefix.length + start, prefix.length + end, node.type !== "definition");
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
  const blocks = format === "markdown" ? markdownBlocks : lineBlocks;
  const a = blocks(before), b = blocks(after);
  const richBefore: number[] = [];
  let richCount = 0;
  for (const block of b) { richBefore.push(richCount); if (block.rich) richCount++; }
  const eol = after.includes("\r\n") ? "\r\n" : "\n";
  const gap = format === "markdown" ? eol + eol : eol;
  const changes: Change[] = [];
  let i = 0, j = 0;
  for (const [nextA, nextB] of [...matches(a, b), [a.length, b.length] as [number, number]]) {
    if (nextA > i || nextB > j) {
      const oldText = nextA > i ? before.slice(a[i].from, a[nextA - 1].to) : "";
      const added = nextB > j, removed = nextA > i;
      const from = added ? b[j].from : b[j]?.from ?? after.length;
      const to = added ? b[nextB - 1].to : from;
      const newText = after.slice(from, to);
      const previousEnd = j > 0 ? b[j - 1].to : undefined;
      const following = b[nextB]?.from;
      const revert = removed && added
        ? { from, to, text: oldText }
        : added
          ? following !== undefined
            ? { from, to: following, text: "" }
            : { from: previousEnd ?? from, to, text: "" }
          : following !== undefined || j < b.length
            ? { from, to: from, text: oldText + gap }
            : { from: previousEnd ?? after.length, to: previousEnd ?? after.length, text: (previousEnd === undefined ? "" : gap) + oldText };
      const line = lineAt(after, from);
      changes.push({
        kind: added && removed ? "changed" : added ? "added" : "removed",
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
export function draftChanges(disk: string, draft: string): { text: string; bytes: number } | undefined {
  const { changes } = computeChanges(disk, draft, "lines");
  if (!changes.length) return undefined;
  const lines = (prefix: string, text: string) => text ? text.split(/\r?\n/).map((line) => prefix + line) : [];
  const text = changes.map((change) => [`@@ line ${change.line} @@`, ...lines("- ", change.oldText), ...lines("+ ", change.newText)].join("\n")).join("\n");
  return { text, bytes: new TextEncoder().encode(text).length };
}
