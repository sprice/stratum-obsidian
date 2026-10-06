import assert from "node:assert/strict";
import test from "node:test";
import * as state from "@codemirror/state";
import * as view from "@codemirror/view";
import type * as Editor from "../literature-note-editor";
import { loadRuntime } from "./runtime-harness";
import { composeLiteratureNoteBody } from "../literature-note-layout";
import {
  MANAGED_START,
  MANAGED_END,
  SYNC_BOUNDARY,
} from "../literature-note-content-types";

const toggle = state.StateEffect.define<boolean>();
const live = state.StateField.define({
  create: () => true,
  update(value, transaction) {
    return (
      transaction.effects.find((effect) => effect.is(toggle))?.value ?? value
    );
  },
});
const { literatureNoteEditor } = loadRuntime<typeof Editor>(
  "literature-note-editor.ts",
  { editorLivePreviewField: live, parseYaml: JSON.parse },
  {},
  "browser",
  { "@codemirror/state": state, "@codemirror/view": view },
);
const managed = `${MANAGED_START}\n> [!quote] Reference\n> Synthetic source\n${MANAGED_END}\n`;
const source = (
  personal = "## My Notes\n\nWriting\n\n",
  type = "literature-note",
) =>
  `---\n${JSON.stringify({ stratum_note_type: type, stratum_note_layout: 2 })}\n---\n${composeLiteratureNoteBody(personal, managed)}`;
const create = (doc: string) =>
  state.EditorState.create({ doc, extensions: [live, literatureNoteEditor()] });
function hidden(editor: state.EditorState): string[] {
  const result: string[] = [];
  for (const decoration of editor.facet(view.EditorView.decorations)) {
    assert.notEqual(typeof decoration, "function");
    (decoration as view.DecorationSet).between(
      0,
      editor.doc.length,
      (from, to) => {
        result.push(editor.doc.sliceString(from, to));
      },
    );
  }
  return result;
}

test("Live Preview hides complete marker lines without changing the document", () => {
  const doc = source();
  let editor = create(doc);
  assert.deepEqual(
    hidden(editor),
    [SYNC_BOUNDARY, MANAGED_START, MANAGED_END].map((marker) => `${marker}\n`),
  );
  assert.equal(editor.doc.toString(), doc);
  editor = editor.update({
    selection: { anchor: doc.indexOf(SYNC_BOUNDARY) + 3 },
  }).state;
  assert.equal(hidden(editor).length, 3);
  editor = editor.update({ effects: toggle.of(false) }).state;
  assert.deepEqual(hidden(editor), []);
  assert.equal(editor.doc.toString(), doc);
  editor = editor.update({ effects: toggle.of(true) }).state;
  assert.equal(hidden(editor).length, 3);
});

test("examples in personal writing and ordinary notes stay visible", () => {
  const personal = `## My Notes\n\n\`\`\`md\n${SYNC_BOUNDARY}\n${MANAGED_START}\n${MANAGED_END}\n\`\`\`\n\n> ${MANAGED_START}\n\n`;
  assert.equal(hidden(create(source(personal))).length, 3);
  const identicalExample = `## My Notes\n\n\`\`\`md\n${managed}\`\`\`\n\n`;
  assert.equal(hidden(create(source(identicalExample))).length, 3);
  assert.deepEqual(hidden(create(source(personal, "writing-note"))), []);
});

test("decorations track edits and undo without modifying marker bytes", () => {
  const doc = source();
  let editor = create(doc);
  const at = doc.indexOf("Writing");
  editor = editor.update({ changes: { from: at, insert: "More " } }).state;
  assert.equal(hidden(editor).length, 3);
  assert.equal(
    editor.doc.toString(),
    doc.slice(0, at) + "More " + doc.slice(at),
  );
  editor = editor.update({ changes: { from: at, to: at + 5 } }).state;
  assert.equal(editor.doc.toString(), doc);
  assert.equal(hidden(editor).length, 3);
});

test("unselected deletion cannot accidentally remove a hidden marker", () => {
  const doc = source();
  const from = doc.indexOf(SYNC_BOUNDARY);
  const to = from + SYNC_BOUNDARY.length + 1;
  for (const [anchor, userEvent] of [
    [to, "delete.backward"],
    [from, "delete.forward"],
  ] as const) {
    let editor = create(doc).update({ selection: { anchor } }).state;
    editor = editor.update({ changes: { from, to }, userEvent }).state;
    assert.equal(editor.doc.toString(), doc);
    assert.equal(hidden(editor).length, 3);
  }
  let editor = create(doc).update({
    effects: toggle.of(false),
    selection: { anchor: to },
  }).state;
  editor = editor.update({
    changes: { from, to },
    userEvent: "delete.backward",
  }).state;
  assert.equal(editor.doc.toString(), doc.slice(0, from) + doc.slice(to));
});
