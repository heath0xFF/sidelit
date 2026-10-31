import DOMPurify from "dompurify";
import katex from "katex";
import "katex/dist/katex.min.css";

// Document content in the privileged window: no links or images, and sanitized output.
export function renderMath(source: string, displayMode: boolean) {
  return DOMPurify.sanitize(katex.renderToString(source, {
    displayMode,
    throwOnError: false,
    trust: false,
    strict: "ignore",
    maxExpand: 500,
    maxSize: 50,
    output: "html",
  }));
}
