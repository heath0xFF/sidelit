import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { $prose, replaceAll } from "@milkdown/kit/utils";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import { undo, redo } from "@milkdown/kit/prose/history";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { api } from "./api";
import { frontmatter, replaceBody } from "./fidelity";
import type { EditorHistory } from "./history";
import { elementContext, textContext, type SelectionContext } from "./inspection";
import { locateSelection, markSelection } from './selection-dom';
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
}) {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const canEdit = useRef(editable && !inspect); canEdit.current = editable && !inspect;
  const lastReveal = useRef(0);
  const instance = useRef<Crepe | null>(null);
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
    const crepe = new Crepe({
      root: root.current!,
      defaultValue: frontmatter(text).body.replaceAll("\r\n", "\n"),
      // Crepe's block image stores its size in Markdown alt text; keep the standard image schema.
      features: {
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.ImageBlock]: false,
      },
      featureConfigs: {
        [Crepe.Feature.CodeMirror]: { theme: { extension: codeHighlight } },
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
                const marks: Decoration[] = [];
                state.doc.descendants((node, pos) => {
                  if (node.type.name === 'code_block') marks.push(Decoration.node(pos, pos + node.nodeSize, { 'data-sidelit-editable': String(canEdit.current) }));
                });
                return DecorationSet.create(state.doc, marks);
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
