import { useEffect, useRef } from "react";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, serializerCtx } from "@milkdown/kit/core";
import { $prose, replaceAll } from "@milkdown/kit/utils";
import { Plugin, TextSelection } from "@milkdown/kit/prose/state";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { api } from "./api";
import { frontmatter, replaceBody } from "./fidelity";
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
}: {
  path: string;
  text: string;
  onChange: (text: string) => void;
  onError: (e: unknown) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const instance = useRef<Crepe | null>(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const errors = useRef(onError);
  errors.current = onError;
  const applied = useRef(text);
  const current = useRef(text);
  current.current = text;
  const changing = useRef(false);
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
            view: () => ({
              update(view, previous) {
                if (
                  changing.current ||
                  stopped ||
                  view.state.doc.eq(previous.doc)
                )
                  return;
                const next = replaceBody(
                  current.current,
                  ctx.get(serializerCtx)(view.state.doc),
                );
                applied.current = next;
                callback.current(next);
              },
            }),
            props: {
              nodeViews: {
                image(node) {
                  const image = document.createElement("img");
                  image.alt = node.attrs.alt ?? "";
                  image.title = node.attrs.title ?? "";
                  let disposed = false;
                  void api
                    .image(path, node.attrs.src)
                    .then((url) => {
                      if (!disposed) image.src = url;
                    })
                    .catch(() => {
                      if (!disposed)
                        image.alt +=
                          " (image unavailable or outside allowed folders)";
                    });
                  return {
                    dom: image,
                    destroy: () => {
                      disposed = true;
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
        if (current.current !== applied.current) {
          changing.current = true;
          crepe.editor.action(
            replaceAll(frontmatter(current.current).body.replaceAll("\r\n", "\n")),
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
      instance.current.editor.action(replaceAll(frontmatter(text).body.replaceAll("\r\n", "\n")));
      changing.current = false;
      applied.current = text;
      root.current!.scrollTop = scroll;
    }
  }, [text]);
  return (
    <div
      className="rich-editor"
      ref={root}
      onClickCapture={(event) => {
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
