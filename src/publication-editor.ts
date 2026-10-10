import {
  EditorState,
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
} from "@codemirror/view";
import {
  Component,
  MarkdownView,
  Notice,
  editorInfoField,
  editorLivePreviewField,
  type TFile,
} from "obsidian";
import type StratumPlugin from "./plugin";
import { aastexProblems } from "./publication-package";
import {
  authorRevision,
  changePublicationAuthors,
  publicationAuthors,
  publicationYaml,
  type AuthorOperation,
} from "./publication-metadata";

const refreshPublication = StateEffect.define<null>();
interface Draft {
  operation: AuthorOperation;
  revision: string;
  conflict: string;
  status?: "committing" | "committed";
}
interface NoteSession {
  visible: boolean;
  open: boolean;
  drafts: Map<string, Draft>;
}

/** Session-only drafts stay attached to their note, never to a stale editor index. */
export class PublicationEditor extends Component {
  private sessions = new Map<string, NoteSession>();
  private views = new Set<EditorView>();
  private activeViews = new Map<string, EditorView>();
  private forms = new Set<PublicationForm>();
  private alive = true;
  private refreshQueued = false;
  constructor(readonly plugin: StratumPlugin) {
    super();
  }
  session(path: string): NoteSession {
    let state = this.sessions.get(path);
    if (!state) {
      state = { visible: false, open: true, drafts: new Map() };
      this.sessions.set(path, state);
    }
    return state;
  }
  registerView(view: EditorView): () => void {
    this.views.add(view);
    return () => {
      this.views.delete(view);
      for (const [path, active] of this.activeViews)
        if (active === view) this.activeViews.delete(path);
    };
  }
  activate(view: EditorView, path: string): void {
    this.activeViews.set(path, view);
  }
  registerForm(form: PublicationForm): () => void {
    this.forms.add(form);
    return () => this.forms.delete(form);
  }
  refresh(): void {
    if (!this.alive || this.refreshQueued) return;
    this.refreshQueued = true;
    queueMicrotask(() => {
      this.refreshQueued = false;
      if (!this.alive) return;
      for (const view of this.views)
        view.dispatch({ effects: refreshPublication.of(null) });
      for (const form of this.forms) form.refresh();
      this.plugin.publish?.emit();
    });
  }
  async open(file: TFile, view?: MarkdownView): Promise<void> {
    this.session(file.path).visible = this.session(file.path).open = true;
    if (view) {
      await view.setState(
        { ...view.getState(), mode: "source", source: false },
        { history: false },
      );
    }
    this.refresh();
    const timer = window.setTimeout(() => {
      if (!this.alive) return;
      const form = [...this.forms].find((item) => item.path === file.path);
      form?.focus();
    }, 0);
    this.register(() => window.clearTimeout(timer));
  }
  flush(path: string, preferred = this.activeViews.get(path)): boolean {
    if (!this.alive) return true;
    for (const form of this.forms) if (form.path === path) form.capture();
    const view =
      preferred && this.views.has(preferred)
        ? preferred
        : [...this.views].find(
            (item) =>
              item.state.field(editorInfoField, false)?.file?.path === path,
          );
    const session = this.session(path);
    if (!view) return session.drafts.size === 0;
    for (const [key, draft] of session.drafts)
      if (!draft.conflict) this.commit(view, path, key, draft);
    return session.drafts.size === 0;
  }
  focusNext(
    view: EditorView,
    path: string,
    key: string,
    backwards: boolean,
  ): void {
    queueMicrotask(() => {
      if (!this.alive) return;
      for (const form of this.forms)
        if (form.matches(view, path)) form.focusNext(key, backwards);
    });
  }
  focusControl(view: EditorView, path: string, key: string): void {
    queueMicrotask(() => {
      if (!this.alive) return;
      for (const form of this.forms)
        if (form.matches(view, path)) form.focusControl(key);
    });
  }
  pending(path: string): boolean {
    return !!this.sessions.get(path)?.drafts.size;
  }
  flushAll(): boolean {
    let saved = true;
    for (const path of this.sessions.keys()) {
      if (!this.flush(path)) saved = false;
    }
    return saved;
  }
  commit(view: EditorView, path: string, key: string, draft: Draft): boolean {
    try {
      if (view.state.field(editorInfoField, false)?.file?.path !== path)
        throw new Error(
          "This note is no longer open. Return to it to apply the draft.",
        );
      const text = view.state.doc.toString();
      if (
        view.state.facet(EditorState.readOnly) ||
        !view.state.facet(EditorView.editable)
      )
        throw new Error(
          "This note is read-only. Make it editable before applying publication details.",
        );
      const properties = publicationYaml(text).properties;
      if (authorRevision(properties) !== draft.revision)
        throw new Error(
          "The author list changed. Your draft is retained. Select its current target or discard it.",
        );
      const change = changePublicationAuthors(text, draft.operation);
      const editor = view.state.field(editorInfoField, false)?.editor;
      if (!editor)
        throw new Error(
          "This view cannot save publication details. Open the note in its Markdown editor.",
        );
      if (editor.getValue() !== text)
        throw new Error(
          "The note changed in another editor. Your draft is retained. Return to the current note to resolve it.",
        );
      draft.status = "committing";
      editor.transaction({
        changes: [
          {
            from: editor.offsetToPos(change.from),
            to: editor.offsetToPos(change.to),
            text: change.insert,
          },
        ],
      });
      const expected =
        text.slice(0, change.from) + change.insert + text.slice(change.to);
      // Live Preview can protect hidden frontmatter from multiline transactions.
      // Retry the validated, targeted edit through the public CM transaction API
      // only if the first transaction left both representations entirely intact.
      if (
        editor.getValue() === text &&
        view.state.doc.toString() === text &&
        expected !== text
      )
        view.dispatch({
          changes: change,
          filter: false,
          userEvent: "input.publication",
        });
      if (
        editor.getValue() !== expected ||
        view.state.doc.toString() !== expected
      )
        throw new Error(
          "The editor did not retain the complete metadata change. Your draft is retained; review it in Source mode before retrying.",
        );
      draft.status = "committed";
      this.session(path).drafts.delete(key);
      this.refresh();
      return true;
    } catch (error) {
      draft.status = undefined;
      draft.conflict =
        error instanceof Error
          ? error.message
          : "The edit could not be applied.";
      this.session(path).drafts.set(key, draft);
      this.refresh();
      return false;
    }
  }
  onunload(): void {
    this.flushAll();
    this.alive = false;
    this.views.clear();
    this.activeViews.clear();
    this.forms.clear();
    this.sessions.clear();
  }
  extension(): Extension {
    const registerView = (view: EditorView) => this.registerView(view);
    const refreshForms = () => {
      if (!this.alive) return;
      for (const form of this.forms) form.refresh();
    };
    const decorations = (
      state: import("@codemirror/state").EditorState,
    ): DecorationSet => {
      if (!state.field(editorLivePreviewField, false)) return Decoration.none;
      const file = state.field(editorInfoField, false)?.file;
      if (!file) return Decoration.none;
      const text = state.doc.toString();
      const frontmatter =
        /^(?:\uFEFF)?---\r?\n([\s\S]*?)(?:\r?\n(?:---|\.\.\.)(?:\r?\n|$)|$)/.exec(
          text,
        )?.[1] ?? "";
      let offset = 0;
      let hasNamespace = /(?:^|[,{]\s*)["']?stratum_publish["']?\s*:/m.test(
        frontmatter,
      );
      try {
        const parsed = publicationYaml(text);
        offset = parsed.end;
        hasNamespace = Object.hasOwn(parsed.properties, "stratum_publish");
      } catch {
        offset =
          /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/.exec(
            text,
          )?.[0].length ?? 0;
      }
      if (!this.session(file.path).visible && !hasNamespace)
        return Decoration.none;
      return Decoration.set([
        Decoration.widget({
          widget: new PublicationWidget(this, file.path),
          block: true,
          side: -1,
        }).range(offset),
      ]);
    };
    const field = StateField.define<DecorationSet>({
      create: decorations,
      update(previous, tr) {
        return tr.docChanged ||
          tr.effects.some((effect) => effect.is(refreshPublication)) ||
          tr.state.field(editorLivePreviewField, false) !==
            tr.startState.field(editorLivePreviewField, false)
          ? decorations(tr.state)
          : previous;
      },
      provide: (value) => EditorView.decorations.from(value),
    });
    return [
      field,
      ViewPlugin.fromClass(
        class {
          private cleanup: () => void;
          constructor(view: EditorView) {
            this.cleanup = registerView(view);
          }
          update(update: import("@codemirror/view").ViewUpdate) {
            if (update.docChanged) queueMicrotask(refreshForms);
          }
          destroy() {
            this.cleanup();
          }
        },
      ),
    ];
  }
}

class PublicationWidget extends WidgetType {
  constructor(
    private service: PublicationEditor,
    private path: string,
  ) {
    super();
  }
  eq(other: PublicationWidget): boolean {
    return this.path === other.path;
  }
  toDOM(view: EditorView): HTMLElement {
    return new PublicationForm(this.service, view, this.path).element;
  }
  ignoreEvent(): boolean {
    return true;
  }
  destroy(dom: HTMLElement): void {
    formsByElement.get(dom)?.destroy();
  }
}
const formsByElement = new WeakMap<HTMLElement, PublicationForm>();
class PublicationForm {
  readonly element: HTMLDetailsElement;
  private content: HTMLElement;
  private summary: HTMLElement;
  private cleanup: () => void;
  private active: {
    input: HTMLInputElement;
    key: string;
    draft: Draft;
  } | null = null;
  private last = "";
  private structure = "";
  private destroyed = false;
  constructor(
    private service: PublicationEditor,
    private view: EditorView,
    readonly path: string,
  ) {
    this.element = createEl("details");
    this.element.className = "stratum-publication-details";
    this.element.open = service.session(path).open;
    this.summary = this.element.createEl("summary", {
      text: "Publication details",
    });
    this.content = this.element.createDiv({
      cls: "stratum-publication-content",
    });
    this.element.addEventListener("toggle", () => {
      this.service.session(path).open = this.element.open;
      if (!this.element.open) this.service.flush(path);
      this.view.requestMeasure();
    });
    this.cleanup = service.registerForm(this);
    formsByElement.set(this.element, this);
    this.refresh();
  }
  focus(): void {
    this.element.open = true;
    this.content.querySelector<HTMLElement>("input,button")?.focus();
  }
  matches(view: EditorView, path: string): boolean {
    return this.view === view && this.path === path;
  }
  focusNext(key: string, backwards: boolean): void {
    const controls = Array.from(
      this.content.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        "[data-publication-control]",
      ),
    ).filter((control) => !control.disabled);
    const index = controls.findIndex(
      (control) => control.dataset.publicationControl === key,
    );
    if (backwards && index === 0) this.summary.focus();
    else controls[index + (backwards ? -1 : 1)]?.focus();
  }
  focusControl(key: string): void {
    Array.from(
      this.content.querySelectorAll<HTMLElement>("[data-publication-control]"),
    )
      .find((control) => control.dataset.publicationControl === key)
      ?.focus();
  }
  capture(): void {
    if (
      !this.active ||
      this.active.input.value ===
        (this.active.draft.operation as { value: string }).value
    )
      return;
    const { key, draft, input } = this.active;
    if (
      draft.operation.type !== "field" &&
      draft.operation.type !== "affiliation"
    )
      return;
    draft.operation.value = input.value;
    this.service.session(this.path).drafts.set(key, draft);
  }
  destroy(): void {
    this.capture();
    this.destroyed = true;
    this.active = null;
    this.cleanup();
    queueMicrotask(() => this.service.flush(this.path, this.view));
  }
  private action(
    label: string,
    action: () => void,
    parent = this.content,
    disabled = false,
  ): HTMLButtonElement {
    const button = parent.createEl("button", {
      text: label,
      attr: { type: "button", "aria-label": label },
    });
    button.className = "stratum-control-button";
    button.dataset.publicationControl = label;
    button.disabled = disabled;
    // A blur commit can replace this widget before the subsequent click arrives.
    // Keep the input focused until the click handler can flush and act together.
    button.addEventListener("pointerdown", (event) => {
      if (this.active && this.element.contains(document.activeElement))
        event.preventDefault();
    });
    button.addEventListener("click", () => {
      if (!this.destroyed) action();
    });
    return button;
  }
  private operate(operation: AuthorOperation): void {
    this.structure = "";
    this.service.activate(this.view, this.path);
    if (!this.service.flush(this.path, this.view)) {
      new Notice("Resolve the pending author edit before changing the list.");
      return;
    }
    this.active = null;
    try {
      const properties = publicationYaml(
        this.view.state.doc.toString(),
      ).properties;
      const model = publicationAuthors(properties);
      const revision = authorRevision(properties);
      let focus = "0:name";
      if (operation.type === "add") focus = `${model.authors.length}:name`;
      else if (operation.type === "move")
        focus = `${operation.author + operation.direction}:name`;
      else if (operation.type === "remove")
        focus =
          model.authors.length > 1
            ? `${Math.min(operation.author, model.authors.length - 2)}:name`
            : "Add author";
      else if (operation.type === "add-affiliation")
        focus = `${operation.author}:affiliation:${model.authors[operation.author].affiliations.length}`;
      else if (operation.type === "remove-affiliation")
        focus = `${operation.author}:name`;
      if (
        this.service.commit(this.view, this.path, "list-action", {
          operation,
          revision,
          conflict: "",
        })
      )
        this.service.focusControl(this.view, this.path, focus);
    } catch (error) {
      new Notice(
        error instanceof Error
          ? error.message
          : "Repair the note's YAML first.",
      );
    }
  }
  private input(
    parent: HTMLElement,
    label: string,
    value: string,
    operation: AuthorOperation,
    key: string,
  ): void {
    const row = parent.createEl("label", { cls: "stratum-publication-field" });
    row.createSpan({ text: label });
    const draft = this.service.session(this.path).drafts.get(key);
    const input = row.createEl("input", {
      attr: { type: "text", "aria-label": label },
    });
    input.className = "stratum-control-input";
    input.dataset.publicationControl = key;
    input.value =
      draft && "value" in draft.operation ? draft.operation.value : value;
    let original = input.value;
    let fieldDraft: Draft = draft ?? {
      operation: { ...operation, value: input.value } as AuthorOperation,
      revision: authorRevision(
        publicationYaml(this.view.state.doc.toString()).properties,
      ),
      conflict: "",
    };
    const record = () => {
      if (this.destroyed) return;
      if (
        fieldDraft.operation.type !== "field" &&
        fieldDraft.operation.type !== "affiliation"
      )
        return;
      if (fieldDraft.status && input.value === fieldDraft.operation.value)
        return;
      if (fieldDraft.status === "committed") {
        fieldDraft = {
          operation: { ...operation, value: input.value } as AuthorOperation,
          revision: authorRevision(
            publicationYaml(this.view.state.doc.toString()).properties,
          ),
          conflict: "",
        };
      }
      this.service.activate(this.view, this.path);
      if (!("value" in fieldDraft.operation)) return;
      fieldDraft.operation.value = input.value;
      this.service.session(this.path).drafts.set(key, fieldDraft);
      this.active = { input, key, draft: fieldDraft };
      this.summary.setText("Publication details · pending edits");
    };
    input.addEventListener("focus", () => {
      if (this.destroyed) return;
      this.service.activate(this.view, this.path);
      original = input.value;
      fieldDraft = this.service.session(this.path).drafts.get(key) ?? {
        operation: { ...operation, value: input.value } as AuthorOperation,
        revision: authorRevision(
          publicationYaml(this.view.state.doc.toString()).properties,
        ),
        conflict: "",
      };
      this.active = { input, key, draft: fieldDraft };
    });
    input.addEventListener("input", record);
    input.addEventListener("blur", () => {
      if (this.destroyed) return;
      if (input.value !== original) record();
      const pending = this.service.session(this.path).drafts.get(key);
      if (this.active?.input === input) this.active = null;
      if (pending && !pending.conflict) {
        if (this.service.commit(this.view, this.path, key, pending))
          original = input.value;
      } else this.refresh();
    });
    input.addEventListener("keydown", (event) => {
      if (this.destroyed) return;
      const commit = () => {
        input.blur();
        const pending = this.service.session(this.path).drafts.get(key);
        if (
          pending &&
          !pending.conflict &&
          this.service.commit(this.view, this.path, key, pending)
        )
          original = input.value;
      };
      if (event.key === "Tab") {
        event.preventDefault();
        commit();
        this.service.focusNext(this.view, this.path, key, event.shiftKey);
      } else if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        commit();
      }
    });
  }
  refresh(): void {
    if (this.destroyed) return;
    const session = this.service.session(this.path);
    this.summary.setText(
      `Publication details${session.drafts.size ? " · pending edits" : ""}`,
    );
    if (
      this.active &&
      this.element.contains(document.activeElement) &&
      !this.active.draft.conflict
    )
      return;
    const text = this.view.state.doc.toString();
    const publish = this.service.plugin.publish;
    const signature =
      text +
      JSON.stringify([...session.drafts]) +
      publish?.notePreferences.templateId +
      publish?.selectedFormat +
      publish?.layout.titleSource;
    if (signature === this.last) return;
    this.last = signature;
    const focused =
      document.activeElement instanceof HTMLElement &&
      this.element.contains(document.activeElement)
        ? document.activeElement.dataset.publicationControl
        : undefined;
    try {
      const { properties } = publicationYaml(text);
      const model = publicationAuthors(properties);
      const revision = authorRevision(properties);
      const structure = JSON.stringify({
        shape: model.authors.map((author) => author.affiliations.length),
        structured: model.structured,
        legacy: model.legacy,
        template: publish?.notePreferences.templateId,
        format: publish?.selectedFormat,
        titleSource: publish?.layout.titleSource,
        conflicts: [...session.drafts].filter(([, draft]) => draft.conflict),
      });
      if (structure === this.structure) {
        for (const input of Array.from(
          this.content.querySelectorAll<HTMLInputElement>(
            "input[data-publication-control]",
          ),
        )) {
          const key = input.dataset.publicationControl!;
          const [index, field, affiliation] = key.split(":");
          const author = model.authors[Number(index)];
          const pending = session.drafts.get(key);
          input.value =
            pending && "value" in pending.operation
              ? pending.operation.value
              : field === "name"
                ? author.name
                : field === "email"
                  ? author.email
                  : author.affiliations[Number(affiliation)];
        }
        this.updateValidation(text);
        this.view.requestMeasure();
        return;
      }
      this.structure = structure;
      this.content.empty();

      this.content.createEl("p", {
        text: "Authors are saved in this note. Each author can have several affiliations.",
        cls: "stratum-publication-help",
      });
      const aastex =
        this.service.plugin.publish?.document?.path === this.path &&
        this.service.plugin.publish?.selectedTemplate?.renderer === "aastex";
      if (aastex)
        this.content.createEl("p", {
          text: "For PDF, each author needs a name, email and affiliation. Emails are supplied to the class without being printed. Word review drafts can be incomplete.",
          cls: "stratum-publication-help",
        });
      this.content.createDiv({
        cls: "stratum-publication-validation",
        attr: { "data-author": "general" },
      });
      if (!model.structured && model.legacy.length) {
        this.content.createEl("p", {
          text: "Existing authors: " + model.legacy.join(", "),
        });
        this.action("Use existing authors", () =>
          this.operate({ type: "import" }),
        );
      }
      for (const [index, author] of (model.structured
        ? model.authors
        : []
      ).entries()) {
        const card = this.content.createEl("fieldset", {
          cls: "stratum-publication-author",
        });
        card.createEl("legend", { text: `Author ${index + 1}` });
        this.input(
          card,
          `Author ${index + 1} name`,
          author.name,
          { type: "field", author: index, key: "name", value: author.name },
          `${index}:name`,
        );
        this.input(
          card,
          `Author ${index + 1} email`,
          author.email,
          { type: "field", author: index, key: "email", value: author.email },
          `${index}:email`,
        );
        card.createDiv({
          cls: "stratum-publication-validation",
          attr: { "data-author": String(index + 1) },
        });
        author.affiliations.forEach((value, affiliation) => {
          this.input(
            card,
            `Author ${index + 1} affiliation ${affiliation + 1}`,
            value,
            { type: "affiliation", author: index, index: affiliation, value },
            `${index}:affiliation:${affiliation}`,
          );
          this.action(
            `Remove affiliation ${affiliation + 1} from author ${index + 1}`,
            () =>
              this.operate({
                type: "remove-affiliation",
                author: index,
                index: affiliation,
              }),
            card,
          );
        });
        const actions = card.createDiv({ cls: "stratum-publication-actions" });
        this.action(
          `Add affiliation to author ${index + 1}`,
          () => this.operate({ type: "add-affiliation", author: index }),
          actions,
        );
        this.action(
          `Move author ${index + 1} up`,
          () => this.operate({ type: "move", author: index, direction: -1 }),
          actions,
          index === 0,
        );
        this.action(
          `Move author ${index + 1} down`,
          () => this.operate({ type: "move", author: index, direction: 1 }),
          actions,
          index === model.authors.length - 1,
        );
        this.action(
          `Remove author ${index + 1}`,
          () => this.operate({ type: "remove", author: index }),
          actions,
        );
      }
      this.action("Add author", () => this.operate({ type: "add" }));
      for (const [key, draft] of session.drafts)
        if (draft.conflict) {
          const conflict = this.content.createDiv({
            cls: "stratum-publication-conflict",
            attr: { role: "alert" },
          });
          conflict.createEl("p", { text: draft.conflict });
          if ("value" in draft.operation) {
            conflict.createEl("p", {
              text: `Retained draft: ${draft.operation.value}`,
            });
            model.authors.forEach((author, index) => {
              conflict.createEl("p", {
                text: `Current author ${index + 1}: ${author.name}`,
              });
              const apply = (affiliation?: number) => {
                if (draft.operation.type === "affiliation") {
                  if (affiliation === undefined) return;
                  draft.operation = {
                    ...draft.operation,
                    author: index,
                    index: affiliation,
                  };
                } else {
                  draft.operation = {
                    ...draft.operation,
                    author: index,
                  } as AuthorOperation;
                }
                draft.revision = revision;
                draft.conflict = "";
                this.service.commit(this.view, this.path, key, draft);
              };
              if (draft.operation.type === "affiliation") {
                author.affiliations.forEach((value, affiliation) => {
                  conflict.createEl("p", {
                    text: `Current affiliation ${affiliation + 1}: ${value}`,
                  });
                  this.action(
                    `Apply draft to author ${index + 1}, affiliation ${affiliation + 1}`,
                    () => apply(affiliation),
                    conflict,
                  );
                });
              } else {
                const value =
                  draft.operation.type === "field"
                    ? author[draft.operation.key]
                    : "";
                conflict.createEl("p", { text: `Current value: ${value}` });
                this.action(
                  `Apply draft to author ${index + 1}`,
                  () => apply(),
                  conflict,
                );
              }
            });
          }
          this.action(
            "Discard this draft",
            () => {
              session.drafts.delete(key);
              this.service.refresh();
            },
            conflict,
          );
        }
      this.updateValidation(text);
    } catch (error) {
      this.structure = "";
      this.content.empty();
      this.content.createEl("p", {
        text:
          error instanceof Error
            ? error.message
            : "Repair the note's YAML in Source mode.",
        cls: "stratum-publication-warning",
        attr: { role: "alert" },
      });
      if (session.drafts.size)
        this.action("Discard pending edits", () => {
          session.drafts.clear();
          this.service.refresh();
        });
    }
    if (focused)
      Array.from(
        this.content.querySelectorAll<HTMLElement>(
          "[data-publication-control]",
        ),
      )
        .find((control) => control.dataset.publicationControl === focused)
        ?.focus();
    this.view.requestMeasure();
  }
  private updateValidation(text: string): void {
    const publish = this.service.plugin.publish;
    const problems =
      publish?.document?.path === this.path &&
      publish.selectedTemplate?.renderer === "aastex"
        ? aastexProblems(
            text,
            publish.layout.titleSource,
            publish.selectedFormat || "docx",
          )
        : null;
    for (const group of Array.from(
      this.content.querySelectorAll<HTMLElement>(
        ".stratum-publication-validation",
      ),
    )) {
      group.empty();
      for (const [label, messages] of [
        ["Required", problems?.errors ?? []],
        ["Guidance", problems?.warnings ?? []],
      ] as const)
        for (const message of messages) {
          const author = /^Author (\d+) /.exec(message)?.[1] ?? "general";
          if (group.dataset.author === author)
            group.createEl("p", {
              text: `${label}: ${message}`,
              cls: "stratum-publication-warning",
            });
        }
    }
  }
}
