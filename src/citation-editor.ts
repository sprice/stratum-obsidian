import {
  Prec,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  Component,
  editorInfoField,
  editorLivePreviewField,
  Menu,
} from "obsidian";
import type { CitationService } from "./citation-service";
import type { FormattedDocument } from "./citation-format";
import { citationDisplayEdits, citationScope } from "./citation-display";
import { renderCsl, renderDocumentNotes } from "./citation-render";
import { citationDocument } from "./citation-document";
import { openCitationComposer } from "./citation-composer";
interface Result {
  text: string;
  path: string;
  scope?: string;
  value?: FormattedDocument;
  error?: string;
}
const setResult = StateEffect.define<Result>();
class InlineCitation extends WidgetType {
  constructor(
    private html: string,
    private offset: number,
    private key: string,
    private service: CitationService,
  ) {
    super();
  }
  eq(other: InlineCitation): boolean {
    return (
      other.html === this.html &&
      other.offset === this.offset &&
      other.key === this.key
    );
  }
  toDOM(view: EditorView): HTMLElement {
    const el = createSpan();
    el.className = "stratum-formatted-citation";
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.setAttribute(
      "aria-label",
      `Citation ${this.key}. Open citation actions`,
    );
    el.title = this.key;
    renderCsl(el, this.html);
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
class ExplanatoryReference extends WidgetType {
  constructor(
    private number: number,
    private definition: number,
  ) {
    super();
  }
  eq(other: ExplanatoryReference): boolean {
    return other.number === this.number && other.definition === this.definition;
  }
  toDOM(view: EditorView): HTMLElement {
    const button = createEl("button", {
      cls: "stratum-note-button",
      text: String(this.number),
    });
    button.setAttribute("aria-label", `Edit explanatory note ${this.number}`);
    button.addEventListener("click", () => {
      view.dispatch({
        selection: { anchor: this.definition },
        scrollIntoView: true,
      });
      view.focus();
    });
    return button;
  }
  ignoreEvent(): boolean {
    return true;
  }
}
class ReferenceBlock extends WidgetType {
  private owner: Component | null = null;
  constructor(
    private result: Result,
    private service: CitationService,
    private notes: boolean,
  ) {
    super();
  }
  eq(other: ReferenceBlock): boolean {
    return other.result === this.result && other.notes === this.notes;
  }
  toDOM(): HTMLElement {
    const el = createDiv();
    el.className = "stratum-reference-output";
    this.owner = new Component();
    this.owner.load();
    if (this.result.error) el.setText(this.result.error);
    else if (this.result.value) {
      if (this.notes)
        void renderDocumentNotes(
          el,
          this.result.text,
          this.result.path,
          this.result.value,
          this.service,
          this.owner,
          this.result.scope,
        );
      else renderCsl(el, this.result.value.bibliography);
    }
    return el;
  }
  destroy(): void {
    this.owner?.unload();
    this.owner = null;
  }
}
export function citationEditor(service: CitationService): Extension {
  const field = StateField.define<{
    result: Result | null;
    decorations: DecorationSet;
  }>({
    create: () => ({ result: null, decorations: Decoration.none }),
    update(previous, tr) {
      let result = tr.docChanged ? null : previous.result;
      for (const effect of tr.effects)
        if (effect.is(setResult)) result = effect.value;
      if (
        !result ||
        !tr.state.field(editorLivePreviewField, false) ||
        result.text !== tr.state.doc.toString()
      )
        return { result, decorations: Decoration.none };
      const selected = (from: number, to: number) =>
        tr.state.selection.ranges.some(
          (range) => range.from <= to && range.to >= from,
        );
      const ranges = [];
      if (result.value) {
        for (const edit of citationDisplayEdits(
          result.text,
          result.scope ?? result.path,
          result.value,
        ))
          if (
            !selected(edit.from, edit.to) &&
            !result.value.model.notes.some(
              (n) =>
                !selected(n.from, n.to) &&
                edit.from >= n.from &&
                edit.to <= n.to,
            )
          ) {
            const citation = result.value.model.citations.find(
              (c) => c.from >= edit.from && c.to <= edit.to,
            )!;
            ranges.push(
              Decoration.replace({
                widget: new InlineCitation(
                  edit.html,
                  citation.from,
                  citation.draft.items.map((i) => `@${i.key}`).join("; "),
                  service,
                ),
              }).range(edit.from, edit.to),
            );
          }
        for (const ref of result.value.model.references)
          if (!selected(ref.from, ref.to))
            ranges.push(
              Decoration.replace({
                widget: new ExplanatoryReference(
                  ref.number,
                  result.value.model.notes.find(
                    (n) => n.identifier === ref.identifier,
                  )!.bodyFrom,
                ),
              }).range(ref.from, ref.to),
            );
        // Definition text stays editable; outside the selection the combined notes
        // area presents definitions in reading order alongside generated notes.
        for (const note of result.value.model.notes)
          if (!selected(note.from, note.to))
            ranges.push(Decoration.replace({}).range(note.from, note.to));
        if (
          result.value.model.notes.length ||
          result.value.model.citations.some((c) => c.generatedNote)
        )
          ranges.push(
            Decoration.widget({
              widget: new ReferenceBlock(result, service, true),
              block: true,
              side: 1,
            }).range(tr.state.doc.length),
          );
      }
      for (const match of (
        result.value?.model ?? citationDocument(result.text, false)
      ).bibliographies)
        if (!selected(match.from, match.to))
          ranges.push(
            Decoration.replace({
              widget: new ReferenceBlock(result, service, false),
              block: true,
            }).range(match.from, match.to),
          );
      return { result, decorations: Decoration.set(ranges, true) };
    },
    provide: (field) =>
      EditorView.decorations.from(field, (value) => value.decorations),
  });
  const watcher = ViewPlugin.fromClass(
    class {
      timer: number | null = null;
      generation = 0;
      unsubscribe: () => void;
      constructor(private view: EditorView) {
        this.unsubscribe = service.subscribe(() => this.schedule());
        this.schedule();
      }
      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.startState.field(editorLivePreviewField, false) !==
            update.state.field(editorLivePreviewField, false)
        )
          this.schedule();
      }
      schedule(): void {
        const generation = ++this.generation;
        if (this.timer) window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
          this.timer = null;
          if (!this.view.state.field(editorLivePreviewField, false)) return;
          const path = this.view.state.field(editorInfoField).file?.path;
          if (!path) return;
          const text = this.view.state.doc.toString();
          if (!text.includes("@") && !text.includes("refs")) return;
          void service
            .format(text, path)
            .then((value) => this.receive({ text, path, value }, generation))
            .catch((error: unknown) =>
              this.receive(
                {
                  text,
                  path,
                  error:
                    error instanceof Error
                      ? error.message
                      : "Citation formatting failed.",
                },
                generation,
              ),
            );
        }, 250);
      }
      receive(result: Result, generation: number): void {
        result.scope = citationScope(this.view.dom, result.path);
        if (generation === this.generation)
          this.view.dispatch({ effects: setResult.of(result) });
      }
      destroy(): void {
        this.generation++;
        if (this.timer) window.clearTimeout(this.timer);
        this.unsubscribe();
      }
    },
  );
  return [Prec.highest(field), watcher];
}
