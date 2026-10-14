import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin } from "@codemirror/view";
import {
  Component,
  MarkdownView,
  Notice,
  editorInfoField,
  TFile,
} from "obsidian";
import type StratumPlugin from "./plugin";
import {
  authorRevision,
  changePublicationAuthors,
  publicationAuthors,
  publicationYaml,
  type AuthorOperation,
  changePublicationProperty,
  publicationPropertyRevision,
  type PublicationPropertyKey,
  type PublicationPropertyOperation,
  type PublicationChange,
} from "./publication-metadata";

import { cleanupPublicationProperties } from "./publication-cleanup";
import type { PublishOptions } from "./publish-options";
import { publishingIssueText } from "./publish-properties";
import {
  createStratumButton,
  createStratumField,
  createStratumFieldset,
  createStratumIconButton,
  createStratumInput,
  setStratumDescription,
} from "./ui-controls";
import { focusControlByKey, StableRender } from "./ui-render";

let authorValidationCount = 0;
const validationMessages = new WeakMap<HTMLElement, string>();

interface Draft {
  operation: AuthorOperation;
  revision: string;
  conflict: string;
  status?: "committing" | "committed";
  file?: TFile;
  ctime?: number;
}
export interface PropertyDraft {
  operation: PublicationPropertyOperation;
  revision: string;
  conflict: string;
  file: TFile;
  ctime: number;
}
interface PropertyForm {
  path: string;
  capture(): void;
  refresh(): void;
}
interface NoteSession {
  drafts: Map<string, Draft>;
  properties: Map<PublicationPropertyKey, PropertyDraft>;
}

/** Session-only drafts stay attached to their note, never to a stale editor index. */
export class PublicationEditor extends Component {
  private sessions = new Map<string, NoteSession>();
  private views = new Set<EditorView>();
  private activeViews = new Map<string, EditorView>();
  private forms = new Set<PublicationForm>();
  private propertyForms = new Set<PropertyForm>();
  private alive = true;
  /** Paths whose forms refresh in the queued microtask; `null` means every form. */
  private refreshQueue?: { paths: Set<string> | null };
  constructor(readonly plugin: StratumPlugin) {
    super();
  }
  onload(): void {
    const vault = this.plugin.app?.vault;
    if (vault?.on)
      this.registerEvent(
        vault.on("rename", (file, oldPath) => {
          if (file instanceof TFile) this.renameNote(file, oldPath);
        }),
      );
  }
  renameNote(file: TFile, oldPath: string): void {
    const session = this.sessions.get(oldPath);
    if (
      session &&
      (!this.sessions.has(file.path) ||
        (!this.sessions.get(file.path)!.drafts.size &&
          !this.sessions.get(file.path)!.properties.size))
    ) {
      this.sessions.delete(oldPath);
      this.sessions.set(file.path, session);
    }
    for (const form of this.forms)
      if (form.path === oldPath) form.path = file.path;
    for (const form of this.propertyForms)
      if (form.path === oldPath) form.path = file.path;
    this.refresh();
  }
  session(path: string): NoteSession {
    let state = this.sessions.get(path);
    if (!state) {
      state = {
        drafts: new Map(),
        properties: new Map(),
      };
      this.sessions.set(path, state);
    }
    return state;
  }
  registerView(view: EditorView): () => void {
    this.views.add(view);
    return () => {
      this.views.delete(view);
      this.refresh();
      for (const [path, active] of this.activeViews)
        if (active === view) this.activeViews.delete(path);
    };
  }
  activate(view: EditorView, path: string): void {
    this.activeViews.set(path, view);
  }
  editableView(file: TFile): EditorView | undefined {
    const vault = this.plugin.app?.vault;
    if (
      vault?.getAbstractFileByPath &&
      vault.getAbstractFileByPath(file.path) !== file
    )
      return;
    return [...this.views].find((view) => {
      const current = view.state.field(editorInfoField, false)?.file;
      return (
        current === file &&
        !view.state.facet(EditorState.readOnly) &&
        view.state.facet(EditorView.editable)
      );
    });
  }
  removeEmptyProperties(
    file: TFile,
    ctime: number,
    layout: PublishOptions,
    aastex: boolean,
  ): void {
    const view = this.editableView(file);
    if (!this.alive || !view || file.stat.ctime !== ctime)
      throw new Error(
        "Open the original note for editing before removing empty properties.",
      );
    if (!this.flush(file.path, view))
      throw new Error(
        "Resolve or discard the pending publication edit before removing empty properties.",
      );
    if (this.editableView(file) !== view || file.stat.ctime !== ctime)
      throw new Error("The original note is no longer editable.");
    const text = view.state.doc.toString();
    const change = cleanupPublicationProperties(text, layout, aastex);
    if (change.from === change.to && !change.insert) return;
    this.applyChange(view, file.path, change);
    this.refresh();
  }
  mountAuthors(
    container: HTMLElement,
    file: TFile,
  ): PublicationForm | undefined {
    const view = this.editableView(file);
    if (!view) return;
    const form = new PublicationForm(this, view, file.path);
    container.append(form.element);
    return form;
  }
  registerPropertyForm(form: PropertyForm): () => void {
    this.propertyForms.add(form);
    return () => this.propertyForms.delete(form);
  }
  commitProperty(
    path: string,
    key: PublicationPropertyKey,
    draft: PropertyDraft,
  ): boolean {
    try {
      const view = this.editableView(draft.file);
      if (
        !view ||
        draft.file.path !== path ||
        draft.file.stat.ctime !== draft.ctime
      )
        throw new Error(
          "Open the original note for editing before saving this draft.",
        );
      const text = view.state.doc.toString();
      this.applyChange(view, path, this.propertyChange(text, key, draft));
      this.session(path).properties.delete(key);
      this.refresh();
      return true;
    } catch (error) {
      draft.conflict =
        error instanceof Error
          ? error.message
          : "The property could not be saved.";
      this.session(path).properties.set(key, draft);
      this.refresh();
      return false;
    }
  }
  private propertyChange(
    text: string,
    key: PublicationPropertyKey,
    draft: PropertyDraft,
  ): PublicationChange {
    if (
      publicationPropertyRevision(publicationYaml(text).properties, key) !==
      draft.revision
    )
      throw new Error(
        "This property changed elsewhere. Your draft is retained; review the current value before applying it.",
      );
    return changePublicationProperty(text, draft.operation);
  }
  private authorChange(text: string, draft: Draft): PublicationChange {
    if (authorRevision(publicationYaml(text).properties) !== draft.revision)
      throw new Error(
        "The author list changed. Your draft is retained. Select its current target or discard it.",
      );
    return changePublicationAuthors(text, draft.operation);
  }
  cleanupChanges(
    file: TFile,
    ctime: number,
    layout: PublishOptions,
    aastex: boolean,
  ): boolean {
    try {
      const view = this.editableView(file);
      if (!this.alive || !view || file.stat.ctime !== ctime) return false;
      for (const form of this.forms)
        if (form.path === file.path) form.capture();
      for (const form of this.propertyForms)
        if (form.path === file.path) form.capture();
      let text = view.state.doc.toString();
      const project = (change: PublicationChange) => {
        text =
          text.slice(0, change.from) + change.insert + text.slice(change.to);
      };
      const session = this.session(file.path);
      for (const draft of session.drafts.values()) {
        if (
          draft.conflict ||
          (draft.file && (draft.file !== file || draft.ctime !== ctime))
        )
          return false;
        project(this.authorChange(text, draft));
      }
      for (const [key, draft] of session.properties) {
        if (draft.conflict || draft.file !== file || draft.ctime !== ctime)
          return false;
        project(this.propertyChange(text, key, draft));
      }
      const change = cleanupPublicationProperties(text, layout, aastex);
      return change.from !== change.to || !!change.insert;
    } catch {
      return false;
    }
  }
  registerForm(form: PublicationForm): () => void {
    this.forms.add(form);
    return () => this.forms.delete(form);
  }
  /**
   * Batches form refreshes into one microtask. Without a path, every form
   * refreshes and the Publish tab updates. With a path, only that note's forms
   * refresh; the controller's debounced `editor-change` updates the tab.
   */
  refresh(path?: string): void {
    if (!this.alive) return;
    if (this.refreshQueue) {
      if (path === undefined) this.refreshQueue.paths = null;
      else this.refreshQueue.paths?.add(path);
      return;
    }
    const queue = {
      paths: path === undefined ? null : new Set([path]),
    };
    this.refreshQueue = queue;
    queueMicrotask(() => {
      this.refreshQueue = undefined;
      if (!this.alive) return;
      const { paths } = queue;
      for (const form of this.forms)
        if (!paths || paths.has(form.path)) form.refresh();
      for (const form of this.propertyForms)
        if (!paths || paths.has(form.path)) form.refresh();
      if (!paths) this.plugin.publish?.emit();
    });
  }
  async open(view: MarkdownView): Promise<void> {
    await view.setState(
      { ...view.getState(), mode: "source", source: false },
      { history: false },
    );
    this.refresh();
  }
  flush(path: string, preferred = this.activeViews.get(path)): boolean {
    if (!this.alive) return true;
    for (const form of this.forms) if (form.path === path) form.capture();
    for (const form of this.propertyForms)
      if (form.path === path) form.capture();
    const view =
      preferred && this.views.has(preferred)
        ? preferred
        : [...this.views].find(
            (item) =>
              item.state.field(editorInfoField, false)?.file?.path === path,
          );
    const session = this.session(path);
    if (!view)
      return session.drafts.size === 0 && session.properties.size === 0;
    for (const [key, draft] of session.drafts)
      if (!draft.conflict) this.commit(view, path, key, draft);
    for (const [key, draft] of session.properties)
      if (!draft.conflict) this.commitProperty(path, key, draft);
    return session.drafts.size === 0 && session.properties.size === 0;
  }
  focusControl(view: EditorView, path: string, key: string): void {
    queueMicrotask(() => {
      if (!this.alive) return;
      for (const form of this.forms)
        if (form.matches(view, path)) form.focusControl(key);
    });
  }
  pending(path: string): boolean {
    return !!(
      this.sessions.get(path)?.drafts.size ||
      this.sessions.get(path)?.properties.size
    );
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
      const current = view.state.field(editorInfoField, false)?.file;
      if (
        draft.file &&
        (current !== draft.file ||
          current.stat.ctime !== draft.ctime ||
          !this.editableView(draft.file))
      )
        throw new Error(
          "Open the original note for editing before saving this draft.",
        );
      const change = this.authorChange(text, draft);
      draft.status = "committing";
      this.applyChange(view, path, change);
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
  private applyChange(
    view: EditorView,
    path: string,
    change: PublicationChange,
  ): void {
    if (
      view.state.field(editorInfoField, false)?.file?.path !== path ||
      view.state.facet(EditorState.readOnly) ||
      !view.state.facet(EditorView.editable)
    )
      throw new Error("The original note is not editable.");
    const text = view.state.doc.toString();
    const expected =
      text.slice(0, change.from) + change.insert + text.slice(change.to);
    // Reject an invalid replacement before changing either editor representation.
    publicationYaml(expected);
    const editor = view.state.field(editorInfoField, false)?.editor;
    if (!editor)
      throw new Error(
        "This view cannot save publication details. Open the note in its Markdown editor.",
      );
    if (editor.getValue() !== text)
      throw new Error(
        "The note changed in another editor. Your draft is retained. Return to the current note to resolve it.",
      );
    editor.transaction({
      changes: [
        {
          from: editor.offsetToPos(change.from),
          to: editor.offsetToPos(change.to),
          text: change.insert,
        },
      ],
    });
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
  }
  onunload(): void {
    this.flushAll();
    this.alive = false;
    this.views.clear();
    this.activeViews.clear();
    this.forms.clear();
    this.propertyForms.clear();
    this.sessions.clear();
  }
  extension(): Extension {
    const registerView = (view: EditorView) => this.registerView(view);
    const refreshAll = () => this.refresh();
    // Typing refreshes only that note's open forms. Read-only changes also
    // update the Publish tab at once; text changes reach it through the
    // controller's debounced workspace `editor-change` handler.
    const refreshNote = (view: EditorView) => {
      if (!this.forms.size && !this.propertyForms.size) return;
      const path = view.state.field(editorInfoField, false)?.file?.path;
      if (path) this.refresh(path);
    };
    return [
      ViewPlugin.fromClass(
        class {
          private cleanup: () => void;
          constructor(view: EditorView) {
            this.cleanup = registerView(view);
          }
          update(update: import("@codemirror/view").ViewUpdate) {
            if (
              update.startState.facet(EditorState.readOnly) !==
                update.state.facet(EditorState.readOnly) ||
              update.startState.facet(EditorView.editable) !==
                update.state.facet(EditorView.editable)
            )
              refreshAll();
            else if (update.docChanged) refreshNote(update.view);
          }
          destroy() {
            this.cleanup();
          }
        },
      ),
    ];
  }
}

export class PublicationForm {
  readonly element: HTMLElement;
  private cleanup: () => void;
  private active: {
    input: HTMLInputElement;
    key: string;
    draft: Draft;
  } | null = null;
  private render: StableRender;
  private destroyed = false;
  private file?: TFile;
  private ctime?: number;
  constructor(
    private service: PublicationEditor,
    private view: EditorView,
    public path: string,
  ) {
    this.file = view.state.field(editorInfoField, false)?.file ?? undefined;
    this.ctime = this.file?.stat.ctime;
    this.element = createDiv({ cls: "stratum-publication-content" });
    this.render = new StableRender(this.element, "data-publication-control");
    this.cleanup = service.registerForm(this);
    this.refresh();
  }
  matches(view: EditorView, path: string): boolean {
    return this.view === view && this.path === path;
  }
  focusControl(key: string): void {
    focusControlByKey(this.element, "data-publication-control", key);
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
    if (
      !this.service.session(this.path).drafts.has(key) &&
      draft.operation.value === input.value
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
  /**
   * `label` is the accessible name, tooltip and focus key. Text buttons show
   * `text` when the surrounding card already names the author.
   */
  private action(
    label: string,
    action: () => void,
    parent = this.element,
    options: { text?: string; icon?: string; disabled?: boolean } = {},
  ): HTMLButtonElement {
    const button = options.icon
      ? createStratumIconButton(parent, {
          icon: options.icon,
          ariaLabel: label,
        })
      : createStratumButton(parent, {
          text: options.text ?? label,
          tooltip: options.text && options.text !== label ? label : undefined,
        });
    button.setAttribute("aria-label", label);
    button.dataset.publicationControl = label;
    button.disabled = options.disabled ?? false;
    // A blur commit can replace this widget before the subsequent click arrives.
    // Keep the input focused until the click handler can flush and act together.
    button.addEventListener("pointerdown", (event) => {
      if (this.active && this.element.contains(this.element.doc.activeElement))
        event.preventDefault();
    });
    button.addEventListener("click", () => {
      if (!this.destroyed) action();
    });
    return button;
  }
  private operate(operation: AuthorOperation): void {
    this.render.invalidate();
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
          file: this.file,
          ctime: this.ctime,
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
    const field = createStratumField(parent, label);
    const draft = this.service.session(this.path).drafts.get(key);
    const input = createStratumInput(field, {
      type: "text",
      attr: {
        "aria-label": label,
        "aria-required": String(
          this.service.plugin.publish?.document?.path === this.path &&
            this.service.plugin.publish.selectedTemplate?.renderer === "aastex",
        ),
      },
    });
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
      file: this.file,
      ctime: this.ctime,
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
          file: this.file,
          ctime: this.ctime,
        };
      }
      this.service.activate(this.view, this.path);
      if (!("value" in fieldDraft.operation)) return;
      fieldDraft.operation.value = input.value;
      this.service.session(this.path).drafts.set(key, fieldDraft);
      this.active = { input, key, draft: fieldDraft };
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
        file: this.file,
        ctime: this.ctime,
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
      if (this.destroyed || event.key !== "Enter" || event.isComposing) return;
      event.preventDefault();
      input.blur();
      const pending = this.service.session(this.path).drafts.get(key);
      if (
        pending &&
        !pending.conflict &&
        this.service.commit(this.view, this.path, key, pending)
      )
        original = input.value;
    });
  }
  refresh(): void {
    if (this.destroyed) return;
    const session = this.service.session(this.path);
    if (
      this.active &&
      this.element.contains(this.element.doc.activeElement) &&
      !this.active.draft.conflict
    )
      return;
    const text = this.view.state.doc.toString();
    const publish = this.service.plugin.publish;
    const signature =
      text +
      JSON.stringify(
        [...session.drafts].map(([key, draft]) => [
          key,
          draft.operation,
          draft.revision,
          draft.conflict,
          draft.status,
        ]),
      ) +
      publish?.notePreferences.templateId +
      publish?.layout.titleSource;
    if (!this.render.changed(signature)) return;
    let restoreFocus: () => void;
    try {
      const { properties } = publicationYaml(text);
      const model = publicationAuthors(properties);
      const revision = authorRevision(properties);
      const structure = JSON.stringify({
        shape: model.authors.map((author) => author.affiliations.length),
        structured: model.structured,
        legacy: model.legacy,
        template: publish?.notePreferences.templateId,
        titleSource: publish?.layout.titleSource,
        conflicts: [...session.drafts]
          .filter(([, draft]) => draft.conflict)
          .map(([key, draft]) => [
            key,
            draft.operation,
            draft.revision,
            draft.conflict,
            revision,
          ]),
      });
      if (this.render.keeps(structure)) {
        for (const input of Array.from(
          this.element.querySelectorAll<HTMLInputElement>(
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
              : ["institution", "city", "country"].includes(field)
                ? (author[field as "institution" | "city" | "country"] ?? "")
                : field === "name"
                  ? author.name
                  : field === "email"
                    ? author.email
                    : author.affiliations[Number(affiliation)];
        }
        this.updateValidation();
        return;
      }
      restoreFocus = this.render.clear();

      this.element.createEl("p", {
        text: "Authors are saved in this note. Each author can have several affiliations.",
        cls: "stratum-publication-help",
      });
      const aastex =
        this.service.plugin.publish?.document?.path === this.path &&
        this.service.plugin.publish?.selectedTemplate?.renderer === "aastex";
      if (aastex)
        this.element.createEl("p", {
          text: "For PDF, each author needs a name, email and affiliation. Emails are supplied to the class without being printed.",
          cls: "stratum-publication-help",
        });
      if (
        !aastex &&
        !publish?.journalProfile &&
        publish?.selectedTemplate?.documentType === "academic"
      )
        this.element.createEl("p", {
          text: "Email and affiliations are optional for this template. Email is saved in the note and is not printed.",
          cls: "stratum-publication-help",
        });
      if (!model.structured && model.legacy.length) {
        this.element.createEl("p", {
          text: "Existing authors: " + model.legacy.join(", "),
        });
        if (
          Array.isArray(properties.affiliations) &&
          properties.affiliations.length
        )
          this.element.createEl("p", {
            text:
              "Existing affiliations: " +
              properties.affiliations.join("; ") +
              ". Using grouped authors keeps these properties in the note, but affiliations must be assigned to individual authors for PDF output.",
            cls: "stratum-publication-help",
          });
        this.action("Use existing authors", () =>
          this.operate({ type: "import" }),
        );
      }
      if (publish?.journalProfile)
        this.element.createEl("p", {
          text: "This journal profile uses the authors and affiliations below. Complete any required institution, city and country fields. Set the corresponding author email in document details.",
          cls: "stratum-publication-help",
        });
      for (const [index, author] of (model.structured
        ? model.authors
        : []
      ).entries()) {
        const card = createStratumFieldset(this.element, {
          legend: `Author ${index + 1}`,
        });
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
        if (publish?.journalProfile?.family === "acm")
          for (const field of ["institution", "city", "country"] as const)
            this.input(
              card,
              `Author ${index + 1} ${field}`,
              author[field] ?? "",
              {
                type: "field",
                author: index,
                key: field,
                value: author[field] ?? "",
              },
              `${index}:${field}`,
            );
        card.createDiv({
          cls: "stratum-publication-validation",
          attr: {
            "data-author": String(index),
            id: `stratum-author-validation-${++authorValidationCount}`,
          },
        });
        author.affiliations.forEach((value, affiliation) => {
          const row = card.createDiv({
            cls: "stratum-publication-affiliation",
          });
          this.input(
            row,
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
            row,
            { icon: "trash-2" },
          );
        });
        const actions = card.createDiv({ cls: "stratum-control-actions" });
        this.action(
          `Add affiliation to author ${index + 1}`,
          () => this.operate({ type: "add-affiliation", author: index }),
          actions,
          { text: "Add affiliation" },
        );
        const order = actions.createDiv({
          cls: "stratum-publication-author-order",
        });
        this.action(
          `Move author ${index + 1} up`,
          () => this.operate({ type: "move", author: index, direction: -1 }),
          order,
          { icon: "arrow-up", disabled: index === 0 },
        );
        this.action(
          `Move author ${index + 1} down`,
          () => this.operate({ type: "move", author: index, direction: 1 }),
          order,
          { icon: "arrow-down", disabled: index === model.authors.length - 1 },
        );
        this.action(
          `Remove author ${index + 1}`,
          () => this.operate({ type: "remove", author: index }),
          order,
          { icon: "trash-2" },
        );
      }
      this.action("Add author", () => this.operate({ type: "add" }));
      for (const [key, draft] of session.drafts)
        if (draft.conflict) {
          const conflict = this.element.createDiv({
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
      this.updateValidation();
    } catch (error) {
      this.render.invalidate();
      restoreFocus = this.render.clear();
      this.element.createEl("p", {
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
    restoreFocus();
  }
  /** Author issues show in their cards; Settings shows the rest. */
  private updateValidation(): void {
    const publish = this.service.plugin.publish;
    const issues =
      publish?.document?.path === this.path ? publish.publishingIssues : [];
    for (const group of Array.from(
      this.element.querySelectorAll<HTMLElement>(
        ".stratum-publication-validation",
      ),
    )) {
      const author = Number(group.dataset.author);
      const own = issues.filter(
        (issue) => issue.target === "author" && issue.author === author,
      );
      const message = own.map(publishingIssueText).join("\n");
      if (validationMessages.get(group) !== message) {
        validationMessages.set(group, message);
        group.empty();
        for (const issue of own)
          group.createEl("p", {
            text: publishingIssueText(issue),
            cls: "stratum-publication-warning",
          });
      }
      const card = group.closest("fieldset");
      for (const input of Array.from(
        card?.querySelectorAll<HTMLInputElement>(
          "input[data-publication-control]",
        ) ?? [],
      )) {
        const key = input.dataset.publicationControl?.split(":")[1];
        const field = key === "affiliation" ? "affiliations" : key;
        const affected = own.filter(
          (issue) => issue.target === "author" && issue.field === field,
        );
        setStratumDescription(input, group.id, !!affected.length);
        if (affected.some((issue) => issue.blocking))
          input.setAttribute("aria-invalid", "true");
        else input.removeAttribute("aria-invalid");
      }
    }
  }
}
