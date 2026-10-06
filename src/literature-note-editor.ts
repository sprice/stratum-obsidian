import { EditorState, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { editorLivePreviewField, parseYaml } from "obsidian";
import { splitFrontmatterContent } from "./literature-note-frontmatter";
import {
  boundaryLines,
  NOTE_LAYOUT_KEY,
  readLiteratureNoteLayout,
} from "./literature-note-layout";
import {
  MANAGED_START,
  MANAGED_END,
  SYNC_BOUNDARY,
} from "./literature-note-content-types";

function markerDecorations(state: EditorState): DecorationSet {
  if (!state.field(editorLivePreviewField, false)) return Decoration.none;
  const source = state.doc.toString();
  const { frontmatter, body } = splitFrontmatterContent(source, parseYaml);
  if (frontmatter.stratum_note_type !== "literature-note")
    return Decoration.none;
  const layout = readLiteratureNoteLayout(body, frontmatter[NOTE_LAYOUT_KEY]);
  if (!layout) return Decoration.none;
  const bodyOffset = source.length - body.length;
  const managedFrom = layout.legacy
    ? body.indexOf(layout.managed)
    : body.length - layout.managed.length;
  const managedTo = managedFrom + layout.managed.length;
  const ranges = boundaryLines(body)
    .filter(
      (line) =>
        ((line.text === MANAGED_START || line.text === MANAGED_END) &&
          line.from >= managedFrom &&
          line.to <= managedTo) ||
        (!layout.legacy &&
          line.text === SYNC_BOUNDARY &&
          line.from === layout.personal.length),
    )
    .map((line) =>
      Decoration.replace({ block: true }).range(
        bodyOffset + line.from,
        bodyOffset + line.to,
      ),
    );
  return Decoration.set(ranges, true);
}

/** Presentation only: reserved marker bytes remain in the editor document. */
export function literatureNoteEditor(): Extension {
  const field = StateField.define<DecorationSet>({
    create: markerDecorations,
    update(previous, transaction) {
      return transaction.docChanged ||
        transaction.state.field(editorLivePreviewField, false) !==
          transaction.startState.field(editorLivePreviewField, false)
        ? markerDecorations(transaction.state)
        : previous;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  return [
    field,
    EditorView.atomicRanges.of((view) => view.state.field(field)),
    EditorState.transactionFilter.of((transaction) => {
      if (
        !transaction.docChanged ||
        !transaction.isUserEvent("delete") ||
        transaction.startState.selection.ranges.some((range) => !range.empty)
      )
        return transaction;
      // Atomic cursor movement also makes delete commands remove whole hidden
      // ranges. Do not let an ordinary keypress erase an invisible sync marker.
      let removesMarker = false;
      const markers = transaction.startState.field(field);
      transaction.changes.iterChangedRanges((from, to) => {
        markers.between(from, to, (markerFrom, markerTo) => {
          if (from < markerTo && to > markerFrom) removesMarker = true;
        });
      });
      return removesMarker ? [] : transaction;
    }),
  ];
}
