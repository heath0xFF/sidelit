import { frontmatter, parser } from "./fidelity";
import type { DocumentFormat } from "./formats";

export interface Heading {
  level: number;
  text: string;
  line: number;
  index: number;
  slug: string;
}
interface Node {
  type: string;
  depth?: number;
  value?: string;
  alt?: string;
  children?: Node[];
  position?: { start: { line: number } };
}
const MAX_HEADINGS = 500;
const plain = (node: Node): string =>
  node.value ?? node.alt ?? (node.children ?? []).map(plain).join("");
// GitHub's rule, which is what links written for a repository's docs expect.
const slugify = (text: string) =>
  text.trim().toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "").replace(/ /g, "-");

export function headings(text: string, format: DocumentFormat): Heading[] {
  const found: Omit<Heading, "index" | "slug">[] = [];
  if (format === "html") {
    const page = new DOMParser().parseFromString(text, "text/html");
    let from = 0;
    for (const el of page.querySelectorAll("h1,h2,h3,h4,h5,h6")) {
      const content = (el.textContent ?? "").trim();
      const at = content ? text.indexOf(content, from) : -1;
      if (at >= 0) from = at + content.length;
      found.push({ level: Number(el.tagName[1]), text: content, line: at < 0 ? 1 : text.slice(0, at).split("\n").length });
    }
  } else {
    const { prefix, body } = frontmatter(text);
    const offset = prefix ? prefix.split("\n").length - 1 : 0;
    const visit = (node: Node) => {
      if (node.type === "heading") found.push({ level: node.depth ?? 1, text: plain(node).trim(), line: (node.position?.start.line ?? 1) + offset });
      else node.children?.forEach(visit);
    };
    visit(parser.parse(body) as Node);
  }
  const seen = new Map<string, number>();
  return found.slice(0, MAX_HEADINGS).map((heading, index) => {
    const base = slugify(heading.text), count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return { ...heading, index, slug: count ? `${base}-${count}` : base };
  });
}

export function headingForAnchor(list: Heading[], anchor: string) {
  let wanted = anchor;
  try { wanted = decodeURIComponent(anchor); } catch { /* Keep a fragment that is not valid encoding. */ }
  wanted = wanted.toLowerCase();
  return list.find((heading) => heading.slug === wanted);
}
