import {
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  ViewPlugin,
  type DecorationSet,
} from "@codemirror/view";
import {
  editorInfoField,
  editorLivePreviewField,
  Menu,
  Notice,
} from "obsidian";
import type { CitationService } from "./citation-service";
import {
  citationDocument,
  citationAuthoringDocument,
  type CitationDocument,
} from "./citation-document";
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
      const originalText = editor.getValue();
      const originalFile = info.file;
      const current = () => {
        const latest = view.state.field(editorInfoField);
        if (
          this.service.plugin.isUnloaded ||
          latest.editor !== editor ||
          latest.file !== originalFile ||
          editor.getValue() !== originalText
        ) {
          new Notice("The paper changed. Select the citation again.");
          return false;
        }
        return true;
      };
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("Edit citation").onClick(() => {
          if (!current()) return;
          editor.setCursor(editor.offsetToPos(view.posAtDOM(el)));
          void openCitationComposer(this.service.plugin, editor);
        }),
      );
      menu.addItem((item) =>
        item.setTitle("Open in reader").onClick(() => {
          if (!current()) return;
          const file = info.file;
          if (!file) return;
          const text = editor.getValue();
          const citation = citationDocument(text, false).citations.find(
            (c) => c.from === view.posAtDOM(el),
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
          if (!current()) return;
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
    const ranges = model.citations
      .filter(
        (citation) =>
          !citation.draft.narrative ||
          service.knownKey?.(citation.draft.items[0].key),
      )
      .map((citation) => {
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
  const parsed = StateEffect.define<CitationDocument>();
  const field = StateField.define<{
    model: CitationDocument;
    decorations: DecorationSet;
  }>({
    create(state) {
      const model = citationAuthoringDocument(
        state.field(editorLivePreviewField, false) ? state.doc.toString() : "",
      );
      return { model, decorations: decorations(state, model) };
    },
    update(previous, tr) {
      const effect = tr.effects.find((effect) => effect.is(parsed));
      const live = tr.state.field(editorLivePreviewField, false);
      const model = effect
        ? effect.value
        : !live
          ? citationAuthoringDocument("")
          : tr.docChanged
            ? {
                ...previous.model,
                citations: previous.model.citations
                  .map((citation) => ({
                    ...citation,
                    from: tr.changes.mapPos(citation.from),
                    to: tr.changes.mapPos(citation.to, 1),
                  }))
                  .filter((citation) => citation.to > citation.from),
              }
            : previous.model;
      return { model, decorations: decorations(tr.state, model) };
    },
    provide: (field) =>
      EditorView.decorations.from(field, (value) => value.decorations),
  });
  const scheduler = ViewPlugin.fromClass(
    class {
      private timer: number | undefined;
      constructor(private view: EditorView) {}
      update(update: import("@codemirror/view").ViewUpdate) {
        if (
          !update.docChanged &&
          update.startState.field(editorLivePreviewField, false) ===
            update.state.field(editorLivePreviewField, false)
        )
          return;
        if (this.timer !== undefined) window.clearTimeout(this.timer);
        if (!update.state.field(editorLivePreviewField, false)) return;
        this.timer = window.setTimeout(() => {
          this.timer = undefined;
          const model = citationAuthoringDocument(
            this.view.state.doc.toString(),
          );
          this.view.dispatch({ effects: parsed.of(model) });
        }, 120);
      }
      destroy() {
        if (this.timer !== undefined) window.clearTimeout(this.timer);
      }
    },
  );
  return Prec.highest([field, scheduler]);
}
