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
