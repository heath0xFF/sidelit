import type { DocumentFormat } from "./formats";

export type SelectionType = "text" | "element" | "document";
export type FeedbackIntent = 'explain' | 'review' | 'edit';
export interface SelectionRect { x: number; y: number; width: number; height: number }

export interface SelectionContext {
  type: SelectionType;
  text: string;
  selector?: string;
  tag?: string;
  id?: string;
  classes?: string[];
  styles?: Record<string, string>;
  sourceLine?: number | null;
  surrounding?: string;
  locatorConfidence?: "exact" | "inferred";
  truncated?: boolean;
  prefix?: string;
  suffix?: string;
  // DOM text has no visual paragraph separators. Keep a separate, bounded quote for reattachment.
  anchorText?: string;
  rect?: SelectionRect;
  pageUrl?: string;
}

export interface FeedbackDocument {
  path?: string;
  url?: string;
  format: DocumentFormat | "url";
  revision?: number;
  diskHash?: string;
  unsaved?: boolean;
  capturedAt?: string;
}

export interface FeedbackMessage {
  id: string;
  source: "sidelit";
  projectRoot?: string;
  document: FeedbackDocument;
  selection: SelectionContext;
  instruction: string;
  intent?: FeedbackIntent;
}

export function parseRect(value: unknown): SelectionRect | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as SelectionRect;
  if (![v.x, v.y, v.width, v.height].every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 100000)) return;
  if (v.width < 0 || v.height < 0) return;
  return { x: v.x, y: v.y, width: v.width, height: v.height };
}

export function bounded(value: string, limit: number) {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

export function lineForText(source: string, selected: string): number | null {
  const needle = selected.trim();
  if (!needle) return null;
  const offset = source.indexOf(needle);
  return offset < 0 || source.indexOf(needle, offset + 1) >= 0 ? null : source.slice(0, offset).split("\n").length;
}

function escapeSelector(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

export function selectorFor(element: Element) {
  const parts: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  while (current && current.nodeType === Node.ELEMENT_NODE && depth < 5) {
    const tag = current.tagName.toLowerCase();
    if (current.id) {
      parts.unshift(`${tag}#${escapeSelector(current.id)}`);
      break;
    }
    const classes = [...current.classList].slice(0, 2).map(escapeSelector);
    let part = tag + classes.map((name) => `.${name}`).join("");
    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(
        (child) => child.tagName === current!.tagName,
      );
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parent;
    depth += 1;
  }
  return parts.join(" > ");
}

export function elementContext(element: Element, source?: string): SelectionContext {
  const styles = getComputedStyle(element);
  const relevant = [
    "display", "position", "width", "height", "margin", "padding",
    "color", "background-color", "font-size", "font-weight",
  ];
  const computed: Record<string, string> = {};
  for (const property of relevant) computed[property] = styles.getPropertyValue(property);
  const text = bounded(element.textContent ?? "", 800);
  const sourceLine = source ? lineForText(source, text) : null;
  return {
    type: "element",
    text,
    selector: selectorFor(element),
    tag: element.tagName.toLowerCase(),
    id: element.id || undefined,
    classes: [...element.classList].slice(0, 8),
    styles: computed,
    sourceLine,
    surrounding: bounded(element.parentElement?.outerHTML ?? "", 1200),
    locatorConfidence: sourceLine ? "inferred" : undefined,
    rect: parseRect(element.getBoundingClientRect()),
  };
}

export function textContext(
  selection: globalThis.Selection,
  source?: string,
  root?: Element,
): SelectionContext | undefined {
  if (!selection.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (root && !root.contains(range.commonAncestorContainer)) return;
  const raw = selection.toString();
  const text = raw.slice(0, 1200);
  if (!text.trim()) return undefined;
  const element = selection.anchorNode?.parentElement;
  const before = range.cloneRange(); before.selectNodeContents(root ?? element ?? range.commonAncestorContainer); before.setEnd(range.startContainer, range.startOffset);
  const offset = before.toString().length, all = (root ?? element)?.textContent ?? '';
  const anchorText = range.toString().slice(0, 1200);
  const sourceLine = source ? lineForText(source, text) : null;
  return {
    type: "text",
    text,
    sourceLine,
    surrounding: element ? bounded(element.textContent ?? "", 1600) : undefined,
    locatorConfidence: sourceLine ? "inferred" : undefined,
    truncated: raw.length > 1200,
    prefix: all.slice(Math.max(0, offset - 48), offset),
    suffix: all.slice(offset + anchorText.length, offset + anchorText.length + 48),
    anchorText,
    rect: parseRect(range.getBoundingClientRect()),
  };
}

export function selectionSummary(selection: SelectionContext) {
  if (selection.type === "element") return selection.selector ?? selection.tag ?? "element";
  if (selection.type === "document") return "current document";
  return `“${bounded(selection.text, 80)}”`;
}

export function feedbackSelection(value: SelectionContext): SelectionContext {
  const result = parseSelection(value) ?? { type: 'document', text: '' };
  delete result.anchorText;
  if (Number.isSafeInteger(value.sourceLine) && value.sourceLine! > 0) {
    result.sourceLine = value.sourceLine;
    result.locatorConfidence = 'inferred';
  }
  const bytes = () => new TextEncoder().encode(JSON.stringify(result)).length;
  if (bytes() > 7600) delete result.surrounding;
  if (bytes() > 7600) { result.text = result.text.slice(0, 600); result.truncated = true; }
  if (bytes() > 7600) delete result.styles;
  return result;
}
// Preview messages are untrusted, including messages from a trusted project's scripts.
export function parseSelection(value: unknown): SelectionContext | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (!['text', 'element', 'document'].includes(String(v.type)) || typeof v.text !== 'string') return;
  const result: SelectionContext = { type: v.type as SelectionType, text: v.text.slice(0, 1200), truncated: v.truncated === true || v.text.length > 1200 };
  if (typeof v.anchorText === 'string') result.anchorText = v.anchorText.slice(0, 1200);
  for (const key of ['prefix', 'suffix'] as const) if (typeof v[key] === 'string') result[key] = v[key].slice(0, 48);
  for (const [key, limit] of [['selector', 500], ['tag', 40], ['id', 120], ['surrounding', 1600]] as const) {
    if (typeof v[key] === 'string') result[key] = bounded(v[key] as string, limit);
  }
  if (Array.isArray(v.classes)) result.classes = v.classes.filter((s): s is string => typeof s === 'string').slice(0, 8).map(s => bounded(s, 80));
  if (v.styles && typeof v.styles === 'object') {
    result.styles = {};
    for (const name of ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'font-size', 'font-weight']) {
      const style = (v.styles as Record<string, unknown>)[name];
      if (typeof style === 'string') result.styles[name] = bounded(style, 100);
    }
  }
  return result;
}
