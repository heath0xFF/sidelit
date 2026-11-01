import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, parserCtx, serializerCtx } from "@milkdown/kit/core";
import { $prose, replaceAll } from "@milkdown/kit/utils";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { undo, redo } from "@milkdown/kit/prose/history";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { api } from "./api";
import { renderMermaidBlock } from "./mermaid-block";
import { frontmatter, replaceBody } from "./fidelity";
import type { EditorHistory } from "./history";
import { elementContext, textContext, type SelectionContext } from "./inspection";
import { findText, locateSelection, markSelection, markTarget } from './selection-dom';
import { blocksFit, type ChangeSet } from "./changes";
import { claimJump, type Jump } from "./jump";
import { displayMath, findInlineMath, mathSources, MAX_MATH_PER_DOCUMENT, MAX_MATH_SOURCE } from "./math";
import { findInDocument } from "./find";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";

const codeHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: "var(--syntax-keyword)" },
    { tag: [tags.string, tags.regexp], color: "var(--syntax-string)" },
    { tag: [tags.number, tags.bool, tags.null], color: "var(--syntax-number)" },
    { tag: tags.function(tags.variableName), color: "var(--syntax-function)" },
    { tag: [tags.typeName, tags.className], color: "var(--syntax-type)" },
    {
      tag: [tags.variableName, tags.propertyName],
      color: "var(--syntax-variable)",
    },
    { tag: tags.comment, color: "var(--muted)", fontStyle: "italic" },
  ]),
);
const positions = new Map<string, { selection: number; scroll: number }>();
let mathRenderer: Promise<typeof import("./math-render")> | undefined;
let renderMath: typeof import("./math-render").renderMath | undefined;
function mathWidget(source: string, display: boolean) {
  const dom = document.createElement(display ? "div" : "span");
  dom.className = display ? "math-drawn math-display" : "math-drawn";
  dom.dataset.sidelitOverlay = "";
  dom.contentEditable = "false";
  dom.innerHTML = renderMath!(source, display);
  return dom;
}
function removedWidget(text: string) {
  const dom = document.createElement("div");
  dom.className = "sidelit-removed";
  // An attribute, not a text node, so a removed passage cannot join a selection.
  const clean = text.replace(/\s+/g, " ").trim();
  dom.dataset.removed = clean.length > 240 ? clean.slice(0, 239) + "…" : clean;
  dom.contentEditable = "false";
  return dom;
}
export function disposeRich(path: string) {
  positions.delete(path);
}
export default function Rich({
  path,
  text,
  onChange,
  onError,
  history,
  inspect = false,
  onTextSelection,
  onElementInspect,
  refresh = 0,
  editable = false,
  attachment,
  reveal = 0,
  changes,
  changeNav,
  jump,
  onJumpMissed,
  onChangesUnmapped,
  search,
  onSearchCount,
}: {
  path: string;
  text: string;
  onChange: (text: string) => void;
  onError: (e: unknown) => void;
  history: Ref<EditorHistory>;
  inspect?: boolean;
  onTextSelection?: (selection: SelectionContext | null) => void;
  onElementInspect?: (selection: SelectionContext) => void;
  refresh?: number;
  editable?: boolean;
  attachment?: SelectionContext;
  reveal?: number;
  changes?: ChangeSet;
  changeNav?: { index: number; nonce: number };
  jump?: Jump;
  onJumpMissed?: (jump: Jump) => void;
  onChangesUnmapped?: (unmapped: boolean) => void;
  search?: { query: string; index: number; nonce: number };
  onSearchCount?: (count: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const canEdit = useRef(editable && !inspect); canEdit.current = editable && !inspect;
  const lastReveal = useRef(0);
  const highlight = useRef<(() => void) | undefined>(undefined);
  const instance = useRef<Crepe | null>(null);
  const marks = useRef({ changes, active: changeNav?.index ?? 0, version: 0, search });
  const searched = useRef(onSearchCount);
  searched.current = onSearchCount;
  const unmapped = useRef(onChangesUnmapped);
  unmapped.current = onChangesUnmapped;
  const redraw = () => {
    marks.current.version++;
    // Carries no steps, so it cannot change the document or its history.
    instance.current?.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      view.dispatch(view.state.tr.setMeta("sidelit-redraw", true));
    });
  };
  const images = useRef(new Set<() => void>());
  useEffect(() => { images.current.forEach(reload => reload()); }, [refresh]);
  const callback = useRef(onChange);
  callback.current = onChange;
  const errors = useRef(onError);
  errors.current = onError;
  const inspection = useRef(inspect);
  inspection.current = inspect;
  const textSelection = useRef(onTextSelection);
  textSelection.current = onTextSelection;
  const elementInspection = useRef(onElementInspect);
  elementInspection.current = onElementInspect;
  const applied = useRef(text);
  const current = useRef(text);
  current.current = text;
  const changing = useRef(false);
  useEffect(() => {
    if (!inspect) root.current?.querySelectorAll('[data-sidelit-inspect-hover]').forEach(node => node.removeAttribute('data-sidelit-inspect-hover'));
  }, [inspect]);
  const captureText = () => {
    if (inspection.current) return;
    const selection = window.getSelection();
    const context = selection && textContext(selection, current.current, root.current?.querySelector('.ProseMirror') ?? undefined);
    textSelection.current?.(context ?? null);
  };
  useEffect(() => { instance.current?.setReadonly(!editable || inspect); }, [editable, inspect]);
  useEffect(() => {
    if (!attachment) return;
    let cleanup: (() => void) | undefined;
    const frame = requestAnimationFrame(() => {
      const node = root.current?.querySelector('.ProseMirror'); if (!node) return;
      const shouldReveal = reveal !== lastReveal.current; lastReveal.current = reveal;
      if (shouldReveal && !locateSelection(node, attachment)) { errors.current('The captured selection could not be located. Select the current content again.'); return; }
      cleanup = markSelection(node, attachment, shouldReveal);
    });
    return () => { cancelAnimationFrame(frame); cleanup?.(); };
  }, [attachment, reveal, text, ready]);
  useImperativeHandle(history, () => (action) => {
    if (!canEdit.current) return;
    instance.current?.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      (action === "undo" ? undo : redo)(view.state, view.dispatch);
      view.focus();
    });
  }, []);
  useEffect(() => {
    let stopped = false;
    let drawn: { doc: unknown; version: number; editing: boolean; set: DecorationSet } | undefined;
    const previous = new Map<string, import("@milkdown/kit/prose/model").Node | null>();
    const crepe = new Crepe({
      root: root.current!,
      defaultValue: frontmatter(text).body.replaceAll("\r\n", "\n"),
      // Crepe's block image stores its size in Markdown alt text; keep the standard image schema.
      features: {
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.ImageBlock]: false,
      },
      featureConfigs: {
        [Crepe.Feature.CodeMirror]: { theme: { extension: codeHighlight }, renderPreview: renderMermaidBlock },
      },
    });
    crepe.setReadonly(!editable || inspect);
    crepe.editor.use(
      $prose(
        (ctx) =>
          new Plugin({
            filterTransaction(tr) {
              if (!tr.docChanged) return true;
              let safe = true;
              tr.doc.descendants((node) => {
                for (const mark of node.marks)
                  if (
                    mark.type.name === "link" &&
                    /^\s*(?:javascript|data|vbscript):/i.test(mark.attrs.href)
                  )
                    safe = false;
              });
              return safe;
            },
            view: (initial) => {
              // Returning to the loaded document must restore its original Markdown bytes.
              let baselineDoc = initial.state.doc;
              let baselineText = changing.current ? current.current : text;
              return {
                update(view, previous) {
                  if (stopped) return;
                  if (changing.current) {
                    baselineDoc = view.state.doc;
                    baselineText = current.current;
                    return;
                  }
                  if (view.state.doc.eq(previous.doc)) return;
                  // Crepe's automatic paragraph after a final code block or table is not an edit.
                  const { doc } = view.state;
                  if (doc.childCount === previous.doc.childCount + 1 && doc.lastChild?.type.name === "paragraph" && !doc.lastChild.content.size
                    && doc.cut(0, doc.content.size - doc.lastChild.nodeSize).eq(previous.doc)) {
                    if (previous.doc.eq(baselineDoc)) baselineDoc = doc;
                    return;
                  }
                  const next = view.state.doc.eq(baselineDoc)
                    ? baselineText
                    : replaceBody(current.current, ctx.get(serializerCtx)(view.state.doc));
                  applied.current = next;
                  callback.current(next);
                },
              };
            },
            props: {
              // Crepe changes view props; a decoration update also refreshes nested CodeMirror read-only state.
              decorations(state) {
                const editing = canEdit.current, { version, changes, active, search } = marks.current;
                if (drawn?.doc === state.doc && drawn.version === version && drawn.editing === editing) return drawn.set;
                const items: Decoration[] = [];
                let drawnMath = 0;
                const hidden: [number, number][] = [];
                let sources: ReturnType<typeof mathSources> | undefined;
                const inMarkdown = (text: string) => (sources ??= mathSources(frontmatter(current.current).body))(text);
                const math = (from: number, to: number, source: string, display: boolean, at: number) => {
                  if (source.length > MAX_MATH_SOURCE || ++drawnMath > MAX_MATH_PER_DOCUMENT) return;
                  hidden.push([from, to]);
                  items.push(Decoration.inline(from, to, { class: 'math-source' }));
                  items.push(Decoration.widget(at, () => mathWidget(source, display), { key: `math:${display}:${source}`, side: -1, ignoreSelection: true }));
                };
                state.doc.descendants((node, pos, parent) => {
                  if (node.type.name === 'code_block') {
                    items.push(Decoration.node(pos, pos + node.nodeSize, { 'data-sidelit-editable': String(editing) }));
                    return false;
                  }
                  // Math is drawn over the text while reading; the document itself never holds it.
                  if (editing || !renderMath) return;
                  if (node.type.name === 'paragraph' && node.childCount) {
                    let plain = true;
                    node.forEach(child => { if (child.marks.length || !(child.isText || child.type.name === 'hardbreak')) plain = false; });
                    const shown = plain ? displayMath(node.textBetween(0, node.content.size, '\n', '\n')) : undefined;
                    const source = shown && inMarkdown(shown);
                    if (source) { math(pos + 1, pos + node.nodeSize - 1, source, true, pos + 1); return false; }
                  }
                  if (node.isText && parent?.type.name !== 'code_block' && !node.marks.some(mark => mark.type.name === 'inlineCode')) {
                    for (const match of findInlineMath(node.text!)) {
                      const source = inMarkdown(match.source);
                      if (source) math(pos + match.from, pos + match.to, source, false, pos + match.from);
                    }
                  }
                });
                if (changes) {
                  const fits = blocksFit(changes.richCount, state.doc);
                  queueMicrotask(() => unmapped.current?.(!fits));
                  if (fits) {
                    const tops: { node: typeof state.doc; pos: number }[] = [];
                    state.doc.forEach((node, pos) => { tops.push({ node, pos }); });
                    changes.changes.forEach((change, index) => {
                      const className = 'sidelit-change' + (index === active ? ' active' : '');
                      for (let at = change.richFrom; at < change.richTo; at++) {
                        const { node, pos } = tops[at];
                        items.push(Decoration.node(pos, pos + node.nodeSize, { class: className, 'data-sidelit-change': String(index) }));
                      }
                      if (change.kind === 'removed') {
                        items.push(Decoration.widget(tops[change.richFrom]?.pos ?? state.doc.content.size, () => {
                          const dom = removedWidget(change.oldText);
                          dom.dataset.sidelitChange = String(index);
                          if (index === active) dom.classList.add('active');
                          return dom;
                        }, { key: `removed:${index}:${index === active}:${change.oldText.length}`, side: -1 }));
                      }
                      if (change.kind === 'changed' && change.richTo === change.richFrom + 1) {
                        const { node, pos } = tops[change.richFrom];
                        let old = previous.get(change.oldText);
                        if (old === undefined) {
                          try { old = ctx.get(parserCtx)(change.oldText).firstChild; } catch { old = null; }
                          previous.set(change.oldText, old ?? null);
                        }
                        if (old && node.isTextblock && old.type === node.type) {
                          const start = node.content.findDiffStart(old.content), end = node.content.findDiffEnd(old.content);
                          if (start !== null && end && end.a > start) items.push(Decoration.inline(pos + 1 + start, pos + 1 + end.a, { class: 'sidelit-change-text' }));
                        }
                      }
                    });
                  }
                }
                if (search?.query.trim()) {
                  const found = findInDocument(state.doc, search.query, hidden);
                  queueMicrotask(() => searched.current?.(found.length));
                  const focused = found[Math.min(search.index, found.length - 1)];
                  const blocks = new Set<number>();
                  for (const match of found) {
                    if (!match.code) items.push(Decoration.inline(match.from, match.to, { class: 'sidelit-find' + (match === focused ? ' active' : '') }));
                    else if (match === focused) items.push(Decoration.node(match.code.from, match.code.to, { class: 'sidelit-find-block active', 'data-sidelit-find-nth': String(match.code.nth) }));
                    else if (!blocks.has(match.code.from) && match.code.from !== focused?.code?.from) { blocks.add(match.code.from); items.push(Decoration.node(match.code.from, match.code.to, { class: 'sidelit-find-block' })); }
                  }
                }
                const set = DecorationSet.create(state.doc, items);
                drawn = { doc: state.doc, version, editing, set };
                return set;
              },
              nodeViews: {
                image(node) {
                  const image = document.createElement("img");
                  image.alt = node.attrs.alt ?? "";
                  image.title = node.attrs.title ?? "";
                  let disposed = false;
                  let read = 0;
                  const reload = () => {
                    const token = ++read;
                    void api
                    .image(path, node.attrs.src)
                    .then((url) => {
                      if (!disposed && token === read) { image.src = url; image.alt = node.attrs.alt ?? ''; }
                    })
                    .catch(() => {
                      if (!disposed && token === read) { image.removeAttribute('src'); image.alt = (node.attrs.alt ?? '') + " (image unavailable or outside allowed folders)"; }
                    });
                  };
                  images.current.add(reload); reload();
                  return {
                    dom: image,
                    destroy: () => {
                      disposed = true;
                      images.current.delete(reload);
                    },
                  };
                },
              },
            },
          }),
      ),
    );
    void crepe
      .create()
      .then(() => {
        if (stopped) {
          void crepe.destroy();
          return;
        }
        instance.current = crepe;
        crepe.setReadonly(!canEdit.current);
        setReady(true);
        if (current.current !== applied.current) {
          changing.current = true;
          crepe.editor.action(
            replaceAll(frontmatter(current.current).body.replaceAll("\r\n", "\n"), true),
          );
          changing.current = false;
          applied.current = current.current;
        }
        const position = positions.get(path);
        if (position) {
          crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const at = Math.min(
              position.selection,
              view.state.doc.content.size,
            );
            view.dispatch(
              view.state.tr.setSelection(
                TextSelection.near(view.state.doc.resolve(at)),
              ),
            );
          });
          root.current!.scrollTop = position.scroll;
        }
      })
      .catch(errors.current);
    return () => {
      stopped = true;
      if (instance.current) {
        crepe.editor.action((ctx) =>
          positions.set(path, {
            selection: ctx.get(editorViewCtx).state.selection.anchor,
            scroll: root.current?.scrollTop ?? 0,
          }),
        );
        void crepe.destroy();
        instance.current = null;
      }
    };
  }, [path]);
  useEffect(() => {
    if (!ready || !changeNav?.nonce) return;
    const frame = requestAnimationFrame(() => root.current?.querySelector(`[data-sidelit-change="${changeNav.index}"]`)?.scrollIntoView({ block: "center" }));
    return () => cancelAnimationFrame(frame);
  }, [ready, changeNav?.nonce]);
  useEffect(() => {
    if (!ready || renderMath || !text.includes("$")) return;
    let live = true;
    void (mathRenderer ??= import("./math-render")).then((module) => {
      renderMath = module.renderMath;
      if (live) redraw();
    }).catch(errors.current);
    return () => { live = false; };
  }, [ready, text]);
  useEffect(() => {
    if (!ready || !claimJump(jump, "rich")) return;
    const node = root.current?.querySelector(".ProseMirror");
    if (!node) return;
    if (jump.heading) {
      node.querySelectorAll("h1,h2,h3,h4,h5,h6")[jump.heading.index]?.scrollIntoView({ block: "start" });
      return;
    }
    const target = jump.text ? findText(node, jump.text) : null;
    if (!target) { onJumpMissed?.(jump); return; }
    const clear = markTarget(node, target, true);
    const done = () => { clear(); document.removeEventListener("pointerdown", done, true); document.removeEventListener("keydown", done, true); };
    // Wait a beat, so the click or key that led here does not clear the mark at once.
    const timer = setTimeout(() => { document.addEventListener("pointerdown", done, true); document.addEventListener("keydown", done, true); }, 300);
    highlight.current?.();
    highlight.current = () => { clearTimeout(timer); done(); };
  }, [ready, jump?.nonce]);
  useEffect(() => () => highlight.current?.(), []);
  useEffect(() => {
    if (instance.current && applied.current !== text) {
      const scroll = root.current!.scrollTop;
      changing.current = true;
      // Disk replacements start new history; Undo must not restore an obsolete version.
      instance.current.editor.action(replaceAll(frontmatter(text).body.replaceAll("\r\n", "\n"), true));
      changing.current = false;
      applied.current = text;
      root.current!.scrollTop = scroll;
    }
  }, [text]);
  useEffect(() => {
    marks.current.changes = changes;
    marks.current.active = changeNav?.index ?? 0;
    if (!changes) unmapped.current?.(false);
    if (ready) redraw();
  }, [changes, changeNav?.index, ready]);
  useEffect(() => {
    marks.current.search = search;
    if (!ready) return;
    redraw();
    if (!search?.query.trim()) { searched.current?.(0); return; }
    let clear: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      const target = root.current?.querySelector<HTMLElement>('.sidelit-find.active, .sidelit-find-block.active');
      target?.scrollIntoView({ block: 'center' });
      if (target?.dataset.sidelitFindNth === undefined) return;
      // Decorations cannot reach inside a code block, and it may only now be mounting.
      timer = setTimeout(() => {
        const words = findText(target, search.query, Number(target.dataset.sidelitFindNth));
        if (words) { clear = markTarget(root.current!, words, false); }
      }, 150);
    });
    return () => { cancelAnimationFrame(frame); clearTimeout(timer); clear?.(); };
  }, [ready, search?.query, search?.index, search?.nonce]);
  return (
    <div
      className={'rich-editor' + (!editable ? ' reading' : '')}
      ref={root}
      onMouseUp={captureText}
      onKeyUp={event => { if (event.shiftKey && event.key.startsWith('Arrow')) captureText(); }}
      onPointerDownCapture={event => { if (inspection.current) event.preventDefault(); }}
      onMouseMove={(event) => {
        const target = (event.target as Element).closest?.(".ProseMirror > *, .ProseMirror > * *");
        if (!inspection.current || !target || !root.current?.contains(target)) {
          root.current?.querySelectorAll("[data-sidelit-inspect-hover]").forEach((node) => node.removeAttribute("data-sidelit-inspect-hover"));
          return;
        }
        root.current?.querySelectorAll("[data-sidelit-inspect-hover]").forEach((node) => {
          if (node !== target) node.removeAttribute("data-sidelit-inspect-hover");
        });
        target.setAttribute("data-sidelit-inspect-hover", "true");
      }}
      onMouseLeave={() => root.current?.querySelectorAll("[data-sidelit-inspect-hover]").forEach((node) => node.removeAttribute("data-sidelit-inspect-hover"))}
      onClickCapture={(event) => {
        if (inspection.current) {
          const target = (event.target as Element).closest?.(".ProseMirror > *, .ProseMirror > * *");
          if (target && root.current?.contains(target)) {
            event.preventDefault();
            event.stopPropagation();
            elementInspection.current?.(elementContext(target, current.current));
          }
          return;
        }
        const link = (event.target as Element).closest("a");
        if (!link) return;
        event.preventDefault();
        event.stopPropagation();
        void api
          .link(path, link.getAttribute("href") ?? "")
          .catch(errors.current);
      }}
    />
  );
}
