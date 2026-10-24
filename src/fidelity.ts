import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

const parser = unified().use(remarkParse).use(remarkGfm);
const supported = new Set([
  "root",
  "paragraph",
  "text",
  "heading",
  "strong",
  "emphasis",
  "delete",
  "list",
  "listItem",
  "blockquote",
  "link",
  "image",
  "inlineCode",
  "code",
  "table",
  "tableRow",
  "tableCell",
  "thematicBreak",
  "break",
]);
export function frontmatter(text: string) {
  const opening = /^(---|\+\+\+)[ \t]*\r?\n/.exec(text);
  if (!opening) return { prefix: "", body: text, unclosed: false };
  const closing = opening[1] === "---"
    ? /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/gm
    : /^\+\+\+[ \t]*(?:\r?\n|$)/gm;
  closing.lastIndex = opening[0].length;
  const end = closing.exec(text);
  if (!end) return { prefix: "", body: text, unclosed: true };
  let at = end.index + end[0].length;
  at += /^(?:[ \t]*\r?\n)*/.exec(text.slice(at))![0].length;
  return { prefix: text.slice(0, at), body: text.slice(at), unclosed: false };
}

export function replaceBody(original: string, body: string) {
  const { prefix } = frontmatter(original);
  const separator = prefix && !prefix.endsWith("\n") && body
    ? original.includes("\r\n") ? "\r\n" : "\n"
    : "";
  return prefix + separator + lineEndings(body, original);
}

export function sourceReason(text: string, allowDiagrams = false): string | undefined {
  // Bound rich-editor work before parsing; Source can handle much larger files.
  if (text.length > 256 * 1024)
    return "Large documents use Source for responsive editing.";
  if (text.startsWith("\uFEFF"))
    return "A byte-order mark is preserved in Source mode.";
  const parts = frontmatter(text);
  if (parts.unclosed)
    return "Unclosed frontmatter is preserved in Source mode.";
  text = parts.body;
  let reason: string | undefined;
  const prose: string[] = [];
  let end = 0;
  const visit = (node: {
    type: string;
    children?: unknown[];
    url?: string;
    lang?: string;
    meta?: string | null;
    position?: { start: { offset?: number }; end: { offset?: number } };
  }) => {
    if (node.type === "code" || node.type === "inlineCode") {
      const from = node.position?.start.offset;
      const to = node.position?.end.offset;
      if (from !== undefined && to !== undefined) {
        // Keep code opaque without making adjacent inline text look like a new block.
        prose.push(text.slice(end, from), "`code`");
        end = to;
      }
    }
    if (!supported.has(node.type))
      reason =
        "HTML, references, or extension syntax is preserved in Source mode.";
    if (node.type === "code" && ((!allowDiagrams && node.lang === "mermaid") || node.meta))
      reason = "Diagram or code metadata is preserved in Source mode.";
    if (
      node.url &&
      /^[a-z][a-z\d+.-]*:/i.test(node.url) &&
      !/^(https?:|mailto:)/i.test(node.url)
    )
      reason = "This URL scheme cannot be used in rendered mode.";
    node.children?.forEach((child) =>
      visit(child as Parameters<typeof visit>[0]),
    );
  };
  visit(parser.parse(text));
  if (/\$|\\[([]|^\s*(?:::|\[\^)/m.test(prose.join("") + text.slice(end)))
    return "Math or extension syntax is preserved in Source mode.";
  return reason;
}
export function lineEndings(text: string, original: string) {
  return original.includes("\r\n") &&
    !original.replaceAll("\r\n", "").includes("\n")
    ? text.replace(/\r?\n/g, "\r\n")
    : text;
}
