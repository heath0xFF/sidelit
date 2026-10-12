import { useEffect, useRef } from "react";
import { api } from "./api";
import { MONOSPACE_FONT } from "./appearance";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/markdown/register.js";
import "monaco-editor/features/register.all.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
const views = new Map<string, monaco.editor.ICodeEditorViewState>();
const models = new Map<string, monaco.editor.ITextModel>();
function applyTheme(dark: boolean) {
  const style = getComputedStyle(document.documentElement);
  const color = (name: string) => style.getPropertyValue(`--${name}`).trim();
  monaco.editor.defineTheme("sidelit-one", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "", foreground: color("text").slice(1) },
      {
        token: "comment",
        foreground: color("muted").slice(1),
        fontStyle: "italic",
      },
      { token: "keyword", foreground: color("syntax-keyword").slice(1) },
      { token: "string", foreground: color("syntax-string").slice(1) },
      { token: "number", foreground: color("syntax-number").slice(1) },
      { token: "type", foreground: color("syntax-type").slice(1) },
      { token: "variable", foreground: color("syntax-variable").slice(1) },
      { token: "string.link", foreground: color("accent").slice(1) },
    ],
    colors: {
      "editor.background": color("paper"),
      "editor.foreground": color("text"),
      "editorLineNumber.foreground": color("muted"),
      "editorLineNumber.activeForeground": color("text"),
      "editorCursor.foreground": color("accent"),
      "editor.selectionBackground": color("selected"),
      "editor.inactiveSelectionBackground": color("selected"),
      "editor.lineHighlightBackground": color("chrome"),
      "editorGutter.background": color("paper"),
      "editorWidget.background": color("chrome"),
      "editorWidget.border": color("line"),
      "editorWidget.foreground": color("text"),
      "input.background": color("paper"),
      "input.foreground": color("text"),
      "input.border": color("line"),
      focusBorder: color("accent"),
      "diffEditor.border": color("line"),
      "diffEditorGutter.insertedLineBackground": "#98c37922",
      "diffEditorGutter.removedLineBackground": "#e06c7522",
      "diffEditor.insertedTextBackground": "#98c37933",
      "diffEditor.removedTextBackground": "#e06c7533",
    },
  });
  monaco.editor.setTheme("sidelit-one");
}
export function disposeSource(path: string) {
  models.get(path)?.dispose();
  models.delete(path);
  views.delete(path);
}
export default function Source({
  path,
  text,
  onChange,
  dark,
  fontSize,
  original,
  readOnly = false,
}: {
  path: string;
  text: string;
  onChange: (text: string) => void;
  dark: boolean;
  fontSize: number;
  original?: string;
  readOnly?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const editor = useRef<
    | monaco.editor.IStandaloneCodeEditor
    | monaco.editor.IStandaloneDiffEditor
    | null
  >(null);
  const callback = useRef(onChange);
  callback.current = onChange;
  const changing = useRef(false);
  useEffect(() => {
    const uri = monaco.Uri.file(path);
    let model = models.get(path);
    if (!model) {
      model = monaco.editor.createModel(text, "markdown", uri);
      models.set(path, model);
    }
    if (model.getValue() !== text) model.setValue(text);
    applyTheme(dark);
    const options = {
      automaticLayout: true,
      readOnly,
      wordWrap: "on" as const,
      minimap: { enabled: false },
      fontFamily: MONOSPACE_FONT,
      fontSize,
      lineHeight: Math.round(fontSize * 1.5),
      padding: { top: 24 },
      scrollBeyondLastLine: false,
      theme: "sidelit-one",
      fixedOverflowWidgets: true,
    };
    let previous: monaco.editor.ITextModel | undefined;
    if (original !== undefined) {
      const diff = monaco.editor.createDiffEditor(root.current!, {
        ...options,
        renderSideBySide: true,
        useInlineViewWhenSpaceIsLimited: false,
        originalEditable: false,
        ignoreTrimWhitespace: false,
        renderGutterMenu: true,
      });
      previous = monaco.editor.createModel(original, "markdown");
      diff.setModel({ original: previous, modified: model });
      editor.current = diff;
    } else {
      const code = monaco.editor.create(root.current!, { ...options, model });
      editor.current = code;
      if (views.has(path)) code.restoreViewState(views.get(path)!);
    }
    const links = monaco.editor.registerLinkOpener({
      open: (resource) => {
        void api.link(path, resource.toString()).catch(console.error);
        return true;
      },
    });
    const listener = model.onDidChangeContent(() => {
      if (!changing.current) callback.current(model!.getValue());
    });
    return () => {
      if (
        !model.isDisposed() &&
        editor.current &&
        "getValue" in editor.current
      ) {
        const view = editor.current.saveViewState();
        if (view) views.set(path, view);
      }
      links.dispose();
      listener.dispose();
      editor.current?.dispose();
      editor.current = null;
      previous?.dispose();
    };
  }, [path, original !== undefined]);
  useEffect(() => {
    const model = models.get(path);
    if (model && model.getValue() !== text) {
      changing.current = true;
      const view = editor.current?.saveViewState();
      model.setValue(text);
      if (view && editor.current && "getValue" in editor.current)
        editor.current.restoreViewState(
          view as monaco.editor.ICodeEditorViewState,
        );
      changing.current = false;
    }
    if (
      editor.current &&
      !("getValue" in editor.current) &&
      original !== undefined
    )
      editor.current.getModel()?.original.setValue(original);
  }, [path, text, original]);
  useEffect(() => {
    applyTheme(dark);
  }, [dark]);
  useEffect(() => {
    editor.current?.updateOptions({ readOnly });
  }, [readOnly]);
  useEffect(() => {
    editor.current?.updateOptions({
      fontSize,
      lineHeight: Math.round(fontSize * 1.5),
    });
  }, [fontSize]);
  useEffect(() => {
    void document.fonts
      .load(`16px ${MONOSPACE_FONT}`)
      .then(() => monaco.editor.remeasureFonts())
      .catch(console.error);
  }, []);
  return (
    <div
      ref={root}
      className="source-editor"
      aria-label={
        original !== undefined
          ? "Disk and draft comparison"
          : "Markdown source editor"
      }
    />
  );
}
