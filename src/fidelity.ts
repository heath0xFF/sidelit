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
  // Crepe keeps these unchanged; tests/crepe-roundtrip.test.ts holds it to that.
  "html",
  "footnoteReference",
  "footnoteDefinition",
  // Rewritten as inline links and images on the first edit, with the same targets.
  "linkReference",
  "imageReference",
  "definition",
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

export function sourceReason(text: string): string | undefined {
  // Bound rich-editor work before parsing; Source can handle much larger files.
  if (text.length > 256 * 1024)
    return "Large documents use Source for responsive editing.";
  if (text.startsWith("\uFEFF"))
    return "A byte-order mark is preserved in Source mode.";
  const parts = frontmatter(text);
  if (parts.unclosed)
    return "Unclosed frontmatter is preserved in Source mode.";
  let reason: string | undefined;
  const visit = (node: {
    type: string;
    children?: unknown[];
    url?: string;
    meta?: string | null;
  }) => {
    if (!supported.has(node.type))
      reason = "This syntax is preserved in Source mode.";
    // Crepe drops fence metadata when it writes the document back.
    if (node.type === "code" && node.meta)
      reason = "Code metadata is preserved in Source mode.";
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
  visit(parser.parse(parts.body));
  return reason;
}
export function lineEndings(text: string, original: string) {
  return original.includes("\r\n") &&
    !original.replaceAll("\r\n", "").includes("\n")
    ? text.replace(/\r?\n/g, "\r\n")
    : text;
}
