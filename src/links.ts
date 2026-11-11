import { frontmatter, parser } from "./fidelity";
import type { DocumentFormat } from "./formats";
import { headingForAnchor, headings } from "./headings";

const UNSAFE = /^\s*(?:javascript|data|vbscript):/i;
export const unsafeHref = (href: unknown) => typeof href === "string" && UNSAFE.test(href);

interface Marked { marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[] }
interface Tree { descendants(visit: (node: Marked) => void): void }

function unsafeTargets(doc: Tree) {
  const found = new Set<string>();
  doc.descendants((node) => {
    for (const mark of node.marks)
      if (mark.type.name === "link" && unsafeHref(mark.attrs.href)) found.add(mark.attrs.href as string);
  });
  return found;
}

// A file may already hold such a link; only an edit that adds a new destination is refused,
// so the rest of the document stays editable.
export function addsUnsafeLink(before: Tree, after: Tree) {
  const existing = unsafeTargets(before);
  for (const href of unsafeTargets(after)) if (!existing.has(href)) return true;
  return false;
}

export interface DocumentLink {
  reference: string;
  label: string;
  line: number;
}
export type LinkProblem = DocumentLink & { problem: string };
export interface LinkTarget {
  reference: string;
  status: "document" | "file" | "missing" | "outside";
  text?: string | null;
}

const MAX_LINKS = 500;
interface Node {
  type: string;
  url?: string;
  value?: string;
  alt?: string;
  children?: Node[];
  position?: { start: { line: number } };
}
const plain = (node: Node): string => node.value ?? node.alt ?? (node.children ?? []).map(plain).join("");

export function documentLinks(text: string, format: DocumentFormat): DocumentLink[] {
  const found: DocumentLink[] = [];
  if (format === "html") {
    const page = new DOMParser().parseFromString(text, "text/html");
    for (const el of page.querySelectorAll("a[href]")) {
      const reference = el.getAttribute("href") ?? "";
      const label = (el.textContent ?? "").trim();
      const at = text.indexOf(reference);
      found.push({ reference, label, line: at < 0 ? 1 : text.slice(0, at).split("\n").length });
    }
  } else {
    const { prefix, body } = frontmatter(text);
    const offset = prefix ? prefix.split("\n").length - 1 : 0;
    const visit = (node: Node) => {
      if ((node.type === "link" || node.type === "definition") && node.url !== undefined)
        found.push({ reference: node.url, label: plain(node).trim(), line: (node.position?.start.line ?? 1) + offset });
      node.children?.forEach(visit);
    };
    visit(parser.parse(body) as Node);
  }
  return found.slice(0, MAX_LINKS);
}

// Links Sidelit can check: same-document anchors and relative or file: paths.
export function localLink(reference: string) {
  const value = reference.trim();
  if (!value) return false;
  if (value.startsWith("#")) return true;
  if (value.startsWith("//")) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  return !scheme || scheme === "file";
}

function fragment(reference: string) {
  const at = reference.indexOf("#");
  return at < 0 ? "" : reference.slice(at + 1);
}

export function linkProblems(
  links: DocumentLink[],
  own: { text: string; format: DocumentFormat },
  targets: LinkTarget[],
): LinkProblem[] {
  const byReference = new Map(targets.map((target) => [target.reference, target]));
  const ownHeadings = headings(own.text, own.format);
  const problems: LinkProblem[] = [];
  for (const link of links) {
    if (!localLink(link.reference)) continue;
    const anchor = fragment(link.reference);
    if (link.reference.trim().startsWith("#")) {
      if (anchor && !headingForAnchor(ownHeadings, anchor))
        problems.push({ ...link, problem: `No heading for #${anchor} in this document` });
      continue;
    }
    const target = byReference.get(link.reference);
    if (!target) continue;
    if (target.status === "missing") problems.push({ ...link, problem: "File not found" });
    else if (target.status === "outside") problems.push({ ...link, problem: "Outside the authorized folders; not checked" });
    else if (anchor && target.status === "document" && typeof target.text === "string") {
      const format: DocumentFormat = /\.html?$/i.test(link.reference.split("#")[0]) ? "html" : /\.mdx$/i.test(link.reference.split("#")[0]) ? "mdx" : "markdown";
      if (!headingForAnchor(headings(target.text, format), anchor))
        problems.push({ ...link, problem: `No heading for #${anchor} in the linked document` });
    }
  }
  return problems;
}
