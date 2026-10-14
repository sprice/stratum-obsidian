import assert from "node:assert/strict";
import test from "node:test";
import * as state from "@codemirror/state";
import * as view from "@codemirror/view";
import type * as EditorModule from "../publication-editor";
import { loadRuntime } from "./runtime-harness";

const info = state.StateField.define<{ file: { path: string } | null }>({
  create: () => ({ file: null }),
  update: (value) => value,
});
type EditorPlugin = new (view: { state: state.EditorState }) => {
  update(update: {
    docChanged: boolean;
    startState: state.EditorState;
    state: state.EditorState;
    view: { state: state.EditorState };
  }): void;
  destroy(): void;
};

function setup() {
  let emits = 0;
  const refreshed: string[] = [];
  const { PublicationEditor } = loadRuntime<typeof EditorModule>(
    "publication-editor.ts",
    {
      Component: class {},
      MarkdownView: class {},
      Notice: class {},
      TFile: class {},
      editorInfoField: info,
    },
    { queueMicrotask, Error },
    "browser",
    {
      "@codemirror/state": state,
      // Capture the plugin class; constructing an EditorView needs a DOM.
      "@codemirror/view": {
        ...view,
        ViewPlugin: { fromClass: (plugin: EditorPlugin) => plugin },
      },
    },
  );
  const service = new PublicationEditor({
    publish: {
      emit: () => {
        emits++;
      },
    },
  } as never);
  const [Plugin] = service.extension() as unknown as [EditorPlugin];
  const editor = (path: string) => {
    let current = state.EditorState.create({
      doc: "---\ntitle: Synthetic\n---\nBody",
      extensions: [info.init(() => ({ file: { path } }))],
    });
    const target = { state: current };
    const plugin = new Plugin(target);
    const apply = (spec: state.TransactionSpec) => {
      const transaction = current.update(spec);
      const startState = current;
      current = target.state = transaction.state;
      plugin.update({
        docChanged: transaction.docChanged,
        startState,
        state: current,
        view: target,
      });
    };
    return {
      type: (text: string) =>
        apply({ changes: { from: current.doc.length, insert: text } }),
      makeReadOnly: () =>
        apply({
          effects: state.StateEffect.appendConfig.of(
            state.EditorState.readOnly.of(true),
          ),
        }),
    };
  };
  const form = (path: string, kind: string) => ({
    path,
    capture() {},
    refresh: () => refreshed.push(`${kind}:${path}`),
  });
  return {
    service,
    editor,
    form,
    refreshed,
    emits: () => emits,
    settle: () => new Promise((resolve) => setImmediate(resolve)),
  };
}

test("typing without open publication forms does no refresh work", async () => {
  const s = setup();
  s.editor("Papers/Synthetic A.md").type("x");
  await s.settle();
  assert.equal(s.emits(), 0);
  s.service.refresh();
  await s.settle();
  assert.equal(s.emits(), 1, "a later full refresh still runs");
});

test("typing refreshes only that note's forms once per batch without a Publish tab update", async () => {
  const s = setup();
  s.service.registerForm(s.form("Papers/Synthetic A.md", "authors") as never);
  s.service.registerPropertyForm(s.form("Papers/Synthetic A.md", "properties"));
  s.service.registerPropertyForm(s.form("Papers/Synthetic B.md", "properties"));
  const note = s.editor("Papers/Synthetic A.md");
  note.type("x");
  note.type("y");
  await s.settle();
  assert.deepEqual(s.refreshed, [
    "authors:Papers/Synthetic A.md",
    "properties:Papers/Synthetic A.md",
  ]);
  assert.equal(s.emits(), 0);
});

test("read-only changes refresh every form and update the Publish tab at once", async () => {
  const s = setup();
  s.service.registerForm(s.form("Papers/Synthetic A.md", "authors") as never);
  s.service.registerPropertyForm(s.form("Papers/Synthetic B.md", "properties"));
  s.editor("Papers/Synthetic B.md").type("x");
  s.editor("Papers/Synthetic A.md").makeReadOnly();
  await s.settle();
  assert.deepEqual(s.refreshed, [
    "authors:Papers/Synthetic A.md",
    "properties:Papers/Synthetic B.md",
  ]);
  assert.equal(s.emits(), 1);
});
