import assert from "node:assert/strict";
import test from "node:test";
import * as state from "@codemirror/state";
import * as view from "@codemirror/view";
import type * as Editor from "../citation-editor";
import { loadRuntime } from "./runtime-harness";

const live = state.StateField.define({
  create: () => true,
  update: (value) => value,
});
const info = state.StateField.define({
  create: () => ({}),
  update: (value) => value,
});
const { citationEditor } = loadRuntime<typeof Editor>(
  "citation-editor.ts",
  {
    editorLivePreviewField: live,
    editorInfoField: info,
    Modal: class {},
    SuggestModal: class {},
    FuzzySuggestModal: class {},
  },
  {
    document: { createElement: () => ({}) },
    createSpan: () => ({
      setAttribute() {},
      addEventListener() {},
      textContent: "",
    }),
  },
  "browser",
  { "@codemirror/state": state, "@codemirror/view": view },
);

test("Live Preview uses stable source labels without formatting or writing the document", () => {
  const source = "A claim [@example2024, pp. 3–4].\n\nAnother [@missing2025].";
  const extension = citationEditor({
    format() {
      throw new Error("Authoring must not format");
    },
  } as never);
  let editor = state.EditorState.create({
    doc: source,
    extensions: [live, info, extension],
  });
  const labels = () =>
    editor.facet(view.EditorView.decorations).flatMap((value) => {
      assert.notEqual(typeof value, "function");
      const result: string[] = [];
      (value as view.DecorationSet).between(
        0,
        editor.doc.length,
        (_from, _to, decoration) => {
          const { widget } = decoration.spec as { widget?: view.WidgetType };
          if (widget)
            result.push(widget.toDOM({} as view.EditorView).textContent ?? "");
        },
      );
      return result;
    });
  assert.deepEqual(labels(), ["[@example2024, pp. 3–4]", "[@missing2025]"]);
  editor = editor.update({
    selection: { anchor: source.indexOf("example") },
  }).state;
  assert.deepEqual(labels(), ["[@missing2025]"]);
  assert.equal(editor.doc.toString(), source);
  editor = editor.update({
    changes: { from: 0, insert: "Intro. " },
    selection: { anchor: 0 },
  }).state;
  assert.deepEqual(labels(), ["[@example2024, pp. 3–4]", "[@missing2025]"]);
});

test("a citation menu cannot act on changed manuscript text", () => {
  const source = "Claim [@example2024].";
  let text = source;
  let open!: (event: unknown) => void;
  let notices = 0;
  const callbacks: (() => void)[] = [];
  const editor = {
    getValue: () => text,
    setCursor() {
      throw new Error("Stale action moved the cursor");
    },
  };
  const editorInfo = state.StateField.define({
    create: () => ({ editor, file: { path: "Papers/Example.md" } }),
    update: (value) => value,
  });
  const runtime = loadRuntime<typeof Editor>(
    "citation-editor.ts",
    {
      editorLivePreviewField: live,
      editorInfoField: editorInfo,
      Notice: class {
        constructor() {
          notices++;
        }
      },
      Modal: class {},
      SuggestModal: class {},
      FuzzySuggestModal: class {},
      Menu: class {
        addItem(build: (item: unknown) => void) {
          const item = {
            setTitle() {
              return item;
            },
            onClick(fn: () => void) {
              callbacks.push(fn);
              return item;
            },
          };
          build(item);
        }
        showAtMouseEvent() {}
      },
    },
    {
      MouseEvent: Object,
      document: { createElement: () => ({}) },
      createSpan: () => ({
        setAttribute() {},
        addEventListener(name: string, fn: typeof open) {
          if (name === "click") open = fn;
        },
      }),
    },
    "browser",
    { "@codemirror/state": state, "@codemirror/view": view },
  );
  const s = state.EditorState.create({
    doc: source,
    extensions: [
      live,
      editorInfo,
      runtime.citationEditor({ plugin: { isUnloaded: false } } as never),
    ],
  });
  for (const value of s.facet(view.EditorView.decorations)) {
    (value as view.DecorationSet).between(0, s.doc.length, (_a, _b, d) => {
      const { widget } = d.spec as { widget?: view.WidgetType };
      widget?.toDOM({ state: s } as view.EditorView);
    });
  }
  open({});
  text = "Claim [@another2025].";
  callbacks.forEach((fn) => fn());
  assert.equal(notices, 3);
});
