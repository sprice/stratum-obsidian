import { Prec, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { editorInfoField, editorLivePreviewField, Menu } from "obsidian";
import type { CitationService } from "./citation-service";
import { citationDocument, type CitationDocument } from "./citation-document";
import { openCitationComposer } from "./citation-composer";
class InlineCitation extends WidgetType {
  constructor(
    private text: string,
    private offset: number,
    private key: string,
    private service: CitationService,
  ) {
    super();
  }
  eq(other: InlineCitation): boolean {
    return (
      other.text === this.text &&
      other.offset === this.offset &&
      other.key === this.key
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const el = createSpan();
    el.className = "stratum-editable-citation";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute(
      "aria-label",
      `Citation ${this.key}. Open citation actions`,
    );
    el.title = this.key;
    el.textContent = this.text;
    const open = (event: MouseEvent | KeyboardEvent) => {
      const info = view.state.field(editorInfoField);
      const editor = info.editor;
      if (!editor) return;
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("Edit citation").onClick(() => {
          editor.setCursor(editor.offsetToPos(this.offset));
          void openCitationComposer(this.service.plugin, editor);
        }),
      );
      menu.addItem((item) =>
        item.setTitle("Open in reader").onClick(() => {
          const file = info.file;
          if (!file) return;
          const text = editor.getValue();
          const citation = citationDocument(text, false).citations.find(
            (c) => c.from === this.offset,
          );
          if (!citation) return;
          void import("./citation-evidence").then(({ openCitationEvidence }) =>
            openCitationEvidence(
              this.service.plugin,
              citation.draft.items.map((item) => item.key),
              file.path,
              text,
            ),
          );
        }),
      );
      menu.addItem((item) =>
        item.setTitle("Show sources").onClick(() => {
          this.service.plugin.sources.showCurrent();
          this.service.plugin.activeViewTab = "sources";
          void this.service.plugin.activateView();
        }),
      );
      if (event instanceof MouseEvent) menu.showAtMouseEvent(event);
      else {
        const rect = el.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom });
      }
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(event);
      }
    });
    return el;
  }
  ignoreEvent(): boolean {
    return true;
  }
}
/** Authoring uses source identities only; CSL formatting belongs to Reading view. */
export function citationEditor(service: CitationService): Extension {
  const decorations = (
    state: import("@codemirror/state").EditorState,
    model: CitationDocument,
  ): DecorationSet => {
    if (!state.field(editorLivePreviewField, false)) return Decoration.none;
    const ranges = model.citations.map((citation) => {
      const selected = state.selection.ranges.some(
        (range) => range.from <= citation.to && range.to >= citation.from,
      );
      if (selected)
        return Decoration.mark({ class: "stratum-editable-citation" }).range(
          citation.from,
          citation.to,
        );
      return Decoration.replace({
        widget: new InlineCitation(
          state.doc.sliceString(citation.from, citation.to),
          citation.from,
          citation.draft.items.map((item) => `@${item.key}`).join("; "),
          service,
        ),
      }).range(citation.from, citation.to);
    });
    return Decoration.set(ranges, true);
  };
  const field = StateField.define<{
    model: CitationDocument;
    decorations: DecorationSet;
  }>({
    create(state) {
      const model = citationDocument(state.doc.toString(), false);
      return { model, decorations: decorations(state, model) };
    },
    update(previous, tr) {
      const model = tr.docChanged
        ? citationDocument(tr.state.doc.toString(), false)
        : previous.model;
      return { model, decorations: decorations(tr.state, model) };
    },
    provide: (field) =>
      EditorView.decorations.from(field, (value) => value.decorations),
  });
  return Prec.highest(field);
}
