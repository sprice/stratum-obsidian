import { Modal, type App, type TFile, type ToggleComponent } from "obsidian";
import type { PublishController } from "./publish-controller";
import type { PublicationForm } from "./publication-editor";
import { PublicationPropertyControls } from "./publication-property-controls";
import { publicationAuthors } from "./publication-metadata";
import { AASTEX_HEADING_WARNING } from "./publication-headings";
import {
  AASTEX_OPTION_LABELS,
  aastexOptionToggle,
} from "./publication-option-controls";
import {
  createStratumButton,
  createStratumSelect,
  createStratumDisclosure,
  createStratumSummary,
} from "./ui-controls";
import { renderPublishCustomization } from "./publish-customize";
import { resetNoteCitationStyle } from "./citation-style-choice";
import { openStratumSettings } from "./view-helpers";
import type { PublishOptions } from "./publish-options";
import {
  publishingIssueText,
  type PublishingIssue,
} from "./publish-properties";
import type { AastexPdfOptions } from "./publication-options";

interface OptionDraftState {
  failures: Map<string, { work: () => Promise<void>; error: string }>;
  latest: Map<string, number>;
  revision: number;
}
const optionDrafts = new WeakMap<
  PublishController,
  WeakMap<TFile, Map<string, OptionDraftState>>
>();
function optionDraftState(
  publish: PublishController,
  file: TFile | null,
  template: string,
): OptionDraftState {
  if (!file) return { failures: new Map(), latest: new Map(), revision: 0 };
  let notes = optionDrafts.get(publish);
  if (!notes) {
    notes = new WeakMap();
    optionDrafts.set(publish, notes);
  }
  let templates = notes.get(file);
  if (!templates) {
    templates = new Map();
    notes.set(file, templates);
  }
  let state = templates.get(template);
  if (!state) {
    state = { failures: new Map(), latest: new Map(), revision: 0 };
    templates.set(template, state);
  }
  return state;
}
/** Change a persistent live region only when its text changes, so screen readers announce it once. */
function setLiveText(element: HTMLElement, text: string): void {
  if (element.textContent === text) return;
  element.setText(text);
  element.hidden = !text;
}
const blockKeys = new WeakMap<HTMLElement, string>();
/** Rebuild a block's children only when its rendered content changes. */
function patchBlock(
  container: HTMLElement,
  key: string,
  render: (container: HTMLElement) => void,
): void {
  if (blockKeys.get(container) === key) return;
  blockKeys.set(container, key);
  container.empty();
  render(container);
}
/** One captured note, shared editor drafts, serialized option saves; no file-write fallback. */
export class PublishingSettingsModal extends Modal {
  private file: TFile | null;
  private noteKey: string;
  private templateId?: string;
  private alive = false;
  private refreshing = false;
  private revision = 0;
  private pending = new Map<string, { value: boolean; revision: number }>();
  private toggles = new Map<keyof AastexPdfOptions, ToggleComponent>();
  private unsubscribe?: () => void;
  private properties?: PublicationPropertyControls;
  private authors?: PublicationForm;
  private details!: HTMLElement;
  private authorContainer!: HTMLElement;
  private message!: HTMLElement;
  private validation!: HTMLElement;
  private academicAlert!: HTMLElement;
  private validationNotes!: HTMLElement;
  private error!: HTMLElement;
  private done!: HTMLButtonElement;
  private reset!: HTMLButtonElement;
  private cleanup!: HTMLButtonElement;
  private ctime: number;
  private citation?: HTMLSelectElement;
  private title?: HTMLSelectElement;
  private closingError = false;
  private cleanupError = false;
  private actionListener = () => this.updateActions();
  private retryButton!: HTMLButtonElement;
  private drafts: OptionDraftState;
  private saving = 0;
  private busyControls = new WeakMap<
    HTMLInputElement | HTMLButtonElement,
    boolean
  >();
  private refreshAdvanced?: () => void;
  private compatibility?: {
    alert: HTMLElement;
    approve: HTMLElement;
    headings: HTMLElement;
    list?: HTMLElement;
  };
  constructor(
    app: App,
    private publish: PublishController,
    private launcher: HTMLElement,
  ) {
    super(app);
    this.file = publish.document;
    this.ctime = this.file?.stat.ctime ?? 0;
    this.noteKey = this.currentNoteKey();
    this.templateId = publish.notePreferences.templateId;
    this.drafts = optionDraftState(publish, this.file, this.templateId ?? "");
    this.modalEl.addClass(
      "stratum-modal",
      "stratum-document-options-modal",
      "stratum-publishing-settings-modal",
    );
  }
  private currentNoteKey(): string {
    const file = this.publish.document;
    return file ? `${file.path}:${file.stat.ctime}` : "";
  }
  onOpen(): void {
    this.alive = true;
    this.setTitle("Publishing settings");
    this.contentEl.addEventListener("input", this.actionListener);
    this.contentEl.addEventListener("change", this.actionListener);
    this.contentEl.createEl("p", {
      text: this.file?.basename ?? "",
      cls: "stratum-publish-meta",
    });
    this.message = this.contentEl.createEl("p", {
      cls: "stratum-publish-meta",
      attr: { role: "status", "aria-live": "polite" },
    });
    this.contentEl.createEl("h4", {
      cls: "stratum-subheading",
      text: "Document details",
    });
    this.details = this.contentEl.createDiv({
      cls: "stratum-publishing-details",
    });
    this.authorContainer = this.contentEl.createDiv();
    this.validation = this.contentEl.createDiv({
      cls: "stratum-publishing-validation",
      attr: { role: "status" },
    });
    // One line per issue, in the warning color of the inline messages.
    this.academicAlert = this.validation.createEl("p", {
      cls: "stratum-publish-notice",
      attr: { role: "alert" },
    });
    this.academicAlert.hidden = true;
    this.validationNotes = this.validation.createDiv();
    this.contentEl.createEl("h4", {
      cls: "stratum-subheading",
      text: "PDF options",
    });
    const options = this.contentEl.createDiv({
      cls: "stratum-publishing-pdf-options",
    });
    options.addClass("stratum-publishing-options");
    const aastex = this.publish.selectedTemplate?.renderer === "aastex";
    const title = createStratumSelect(options, {
      label: "Title source",
      ariaLabel: "Title source",
      value: this.publish.layout.titleSource,
      choices: [
        { value: "properties", label: "Title property" },
        {
          value: "body",
          label: aastex ? "Leading # heading in document" : "Title in document",
        },
      ],
    });
    this.title = title;
    title.addEventListener("change", () =>
      this.layout({ titleSource: title.value as "body" | "properties" }),
    );
    if (aastex) {
      for (const key of Object.keys(
        AASTEX_OPTION_LABELS,
      ) as (keyof AastexPdfOptions)[])
        this.toggles.set(
          key,
          aastexOptionToggle(
            options,
            key,
            (value) => {
              if (this.refreshing) return;
              const revision = ++this.revision;
              this.pending.set(key, { value, revision });
              this.save(
                () => this.publish.updateAastexPdfOptions({ [key]: value }),
                () => {
                  if (this.pending.get(key)?.revision === revision)
                    this.pending.delete(key);
                },
                `aastex:${key}`,
              );
            },
            this.pending.get(key)?.value ?? this.publish.aastexPdfOptions[key],
          ),
        );
      const compatibility = options.createDiv({
        cls: "stratum-publishing-compatibility",
      });
      const alert = compatibility.createEl("p", { attr: { role: "alert" } });
      alert.hidden = true;
      this.compatibility = {
        alert,
        approve: compatibility.createDiv(),
        headings: compatibility.createDiv(),
      };
    } else {
      const citations = options.createDiv();
      void this.publish
        .citationStyleChoices()
        .then((choices) => {
          if (!this.alive || !choices) return;
          this.citation = createStratumSelect(citations, {
            label: "Citation style",
            ariaLabel: "Citation style for this note",
            value: choices.inherited ? "" : choices.selected,
            choices: [
              { value: "", label: "Use plugin default" },
              ...choices.options.map((option) => ({
                value: option.id,
                label: option.title,
              })),
            ],
          });
          this.citation.addEventListener("change", () => {
            const style = this.citation!.value;
            this.save(
              () =>
                style
                  ? this.publish.changeCitationStyle(style)
                  : resetNoteCitationStyle(this.publish.plugin, this.file!),
              undefined,
              "citation",
            );
          });
        })
        .catch((error) => this.fail(error));
      const advanced = createStratumDisclosure(options, {
        cls: "stratum-control-disclosure-spaced",
      });
      createStratumSummary(advanced, { text: "Advanced layout" });
      const body = advanced.createDiv();
      let mounted = false;
      advanced.addClass("stratum-publishing-advanced");
      const mount = () => {
        if (!advanced.open) return;
        body.empty();
        mounted = true;
        const focus = renderPublishCustomization(
          body,
          this.publish.layout,
          (patch) => this.saveLayout(patch),
          (error) => this.fail(error),
          "pdf",
          false,
        );
        if (this.publish.fontError) {
          const key = this.publish.fontError.fonts.some(
            (font) =>
              font.toLowerCase() === this.publish.layout.bodyFont.toLowerCase(),
          )
            ? "bodyFont"
            : "titleFont";
          focus(key);
        }
      };
      this.refreshAdvanced = mount;
      advanced.addEventListener("toggle", () => {
        if (!mounted) mount();
      });
      if (this.publish.fontError) advanced.open = true;
    }
    if (!this.publish.readiness?.pdf) {
      options.createEl("p", {
        text: "PDF tools need setup.",
      });
      const setup = createStratumButton(options, {
        text: "Open Stratum settings",
      });
      setup.addEventListener("click", () => {
        this.close();
        openStratumSettings(this.publish.plugin);
      });
    }
    this.error = this.contentEl.createDiv({
      cls: "stratum-publish-error",
      attr: { role: "alert" },
    });
    const retry = (this.retryButton = createStratumButton(this.error, {
      text: "Retry saving options",
    }));
    retry.addEventListener("click", () => {
      void this.retryOptions();
    });
    this.error.hidden = true;
    const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
    // Obsidian keeps the secondary group at the start on desktop, before Done.
    const leading = actions.createDiv({
      cls: "stratum-publish-actions mod-secondary",
    });
    this.reset = createStratumButton(leading, {
      text: "Reset to defaults",
      wrap: true,
      className: "stratum-publishing-reset",
    });
    this.reset.addEventListener("click", () =>
      this.save(
        async () => {
          await this.publish.resetSettings();
          this.pending.clear();
          for (const key of this.drafts.failures.keys())
            if (key.startsWith(aastex ? "aastex:" : "layout:"))
              this.drafts.failures.delete(key);
          this.refreshAdvanced?.();
        },
        undefined,
        "reset",
      ),
    );
    this.cleanup = createStratumButton(leading, {
      text: "Remove empty properties",
      wrap: true,
      className: "stratum-publishing-cleanup",
    });
    // Keep the focused draft until click: blur validation can move the footer
    // between mouse-down and mouse-up. Cleanup captures and flushes it below.
    this.cleanup.addEventListener("mousedown", (event) =>
      event.preventDefault(),
    );
    this.cleanup.addEventListener("click", () => {
      try {
        if (
          this.saving ||
          this.publish.preferencesSaving ||
          this.drafts.failures.size
        )
          throw new Error(
            "Save or retry the pending settings before removing empty properties.",
          );
        if (
          !this.alive ||
          this.publish.busy ||
          this.publish.document !== this.file ||
          this.currentNoteKey() !== this.noteKey ||
          this.publish.notePreferences.templateId !== this.templateId
        )
          throw new Error(
            "Return to the original note and template to remove empty properties.",
          );
        const service = this.publish.plugin.publicationEditor;
        if (!service || !this.file)
          throw new Error(
            "Open this note for editing to remove empty properties.",
          );
        service.removeEmptyProperties(
          this.file,
          this.ctime,
          this.publish.layout,
          this.publish.selectedTemplate?.renderer === "aastex",
        );
        this.closingError = false;
        this.cleanupError = false;
        this.error.hidden = true;
        this.update();
      } catch (error) {
        this.cleanupError = true;
        this.fail(error);
      }
    });
    this.done = createStratumButton(actions, {
      text: "Done",
      primary: true,
      className: "stratum-publishing-done",
    });
    this.done.addEventListener("click", () => {
      if (this.saving || this.publish.preferencesSaving) return;
      if (
        this.file &&
        this.publish.plugin.publicationEditor &&
        !this.publish.plugin.publicationEditor.flush(this.file.path)
      ) {
        this.closingError = true;
        this.fail(
          new Error(
            "Resolve or discard the pending publication edit before closing.",
          ),
        );
        return;
      }
      if (this.drafts.failures.size) return;
      this.close();
    });
    this.unsubscribe = this.publish.subscribe(() => this.update());
    this.update();
    queueMicrotask(() => {
      if (!this.publish.fontError) this.focusDetails();
    });
  }
  /** Focus the first missing required field, or the first property field. */
  private focusDetails(): void {
    if (!this.alive) return;
    const inputs = Array.from(
      this.details.querySelectorAll<HTMLInputElement>("input"),
    );
    const authorInputs = Array.from(
      this.authorContainer.querySelectorAll<HTMLInputElement>("input"),
    );
    const missing = [...inputs, ...authorInputs].find(
      (input) =>
        input.getAttribute("aria-required") === "true" && !input.value.trim(),
    );
    (missing ?? inputs[0])?.focus();
  }
  /** Patch in place so the disclosure keeps its open state and focus across emits. */
  private updateCompatibility(): void {
    const view = this.compatibility;
    if (!view) return;
    const problem = this.publish.aastexPackageProblem;
    setLiveText(view.alert, problem);
    if (!problem) view.approve.empty();
    else if (!view.approve.childElementCount)
      createStratumButton(view.approve, {
        text: "Use installed version",
      }).addEventListener("click", () =>
        this.save(() => this.publish.acceptAastexPackage()),
      );
    const warnings = this.publish.aastexHeadingProblems;
    if (!warnings.length) {
      view.headings.empty();
      view.list = undefined;
      return;
    }
    if (!view.list) {
      const disclosure = createStratumDisclosure(view.headings);
      createStratumSummary(disclosure, { text: "Review heading numbers" });
      disclosure.createEl("p", { text: AASTEX_HEADING_WARNING });
      view.list = disclosure.createEl("ul");
    }
    patchBlock(view.list, warnings.join("\n"), (list) => {
      for (const warning of warnings) list.createEl("li", { text: warning });
    });
  }
  private fail(error: unknown): void {
    if (!this.alive || !this.error) return;
    this.error.hidden = false;
    let text = this.error.querySelector("p");
    if (!text) text = this.error.createEl("p");
    setLiveText(
      text,
      error instanceof Error
        ? error.message
        : "Could not save publishing settings.",
    );
  }
  private layout(patch: Partial<PublishOptions>): void {
    void this.saveLayout(patch).catch(() => {});
  }
  private saveLayout(patch: Partial<PublishOptions>): Promise<void> {
    return this.saveAsync(
      () => this.publish.updateLayout(patch),
      undefined,
      "layout:" + Object.keys(patch).sort().join(","),
    );
  }
  private async retryOptions(): Promise<void> {
    for (const [key, draft] of [...this.drafts.failures]) {
      try {
        await this.saveAsync(draft.work, undefined, key);
      } catch {
        return;
      }
    }
    this.refreshAdvanced?.();
  }
  private save(
    work: () => Promise<void>,
    finish?: () => void,
    key = "options",
  ): void {
    void this.saveAsync(work, finish, key).catch(() => {});
  }
  private async saveAsync(
    work: () => Promise<void>,
    finish?: () => void,
    key = "options",
  ): Promise<void> {
    if (
      !this.alive ||
      this.publish.document !== this.file ||
      this.currentNoteKey() !== this.noteKey ||
      this.publish.notePreferences.templateId !== this.templateId ||
      this.publish.busy
    )
      return;
    const revision = ++this.drafts.revision;
    this.drafts.latest.set(key, revision);
    this.drafts.failures.delete(key);
    this.error.hidden = this.drafts.failures.size === 0;
    this.saving++;
    try {
      await work();
      if (this.drafts.latest.get(key) === revision)
        this.drafts.failures.delete(key);
    } catch (error) {
      if (this.drafts.latest.get(key) === revision) {
        const message =
          error instanceof Error
            ? error.message
            : "Could not save publishing settings.";
        this.drafts.failures.set(key, { work, error: message });
        this.fail(error);
      }
      throw error;
    } finally {
      this.saving--;
      finish?.();
      this.update();
      if (!this.alive) this.publish.emit();
    }
  }
  private updateActions(): void {
    if (!this.alive || !this.done) return;
    const busy =
      this.publish.busy || this.saving > 0 || this.publish.preferencesSaving;
    this.done.disabled = busy;
    const aastex = this.publish.selectedTemplate?.renderer === "aastex";
    const failedReset = [...this.drafts.failures.keys()].some((key) =>
      key.startsWith(aastex ? "aastex:" : "layout:"),
    );
    this.reset.disabled =
      busy || (!this.publish.settingsResetChanges && !failedReset);
    this.cleanup.disabled =
      busy ||
      !!this.drafts.failures.size ||
      !this.file ||
      !this.publish.plugin.publicationEditor?.cleanupChanges(
        this.file,
        this.ctime,
        this.publish.layout,
        aastex,
      );
  }
  private update(): void {
    if (!this.alive) return;
    if (
      !this.file ||
      this.publish.document !== this.file ||
      this.currentNoteKey() !== this.noteKey ||
      this.publish.notePreferences.templateId !== this.templateId
    ) {
      this.close();
      return;
    }
    setLiveText(
      this.message,
      this.saving || this.publish.preferencesSaving ? "Saving settings…" : "",
    );
    this.updateCompatibility();
    const service = this.publish.plugin.publicationEditor;
    const target = service?.editableView(this.file);
    if (service && target && !this.properties) {
      this.details.empty();
      this.properties = new PublicationPropertyControls(
        this.details,
        this.publish,
        service,
        this.file,
        (patch) => this.saveLayout(patch),
      );
    } else if (!target && !this.properties && !this.details.childElementCount) {
      this.details.createEl("p", {
        text: "Open this note for editing to change its properties.",
      });
      const open = createStratumButton(this.details, {
        text: "Open note for editing",
        tooltip: "Open note for editing",
      });
      // The note opens behind this window, and `update` mounts its fields
      // once it is editable. Opening it can move focus to the editor, so focus
      // returns to the fields, or to this button when none mounted. The button
      // stays enabled, since disabling it would drop focus to the body.
      let opening = false;
      open.addEventListener("click", () => {
        if (opening) return;
        opening = true;
        open.setAttribute("aria-disabled", "true");
        void this.publish.editPublicationDetails().finally(() => {
          opening = false;
          open.removeAttribute("aria-disabled");
          if (this.properties) this.focusDetails();
          else if (open.isConnected) open.focus();
        });
      });
    }
    this.properties?.refresh();
    if (
      this.title &&
      (!this.publish.preferencesSaving ||
        this.title.ownerDocument.activeElement !== this.title)
    )
      this.title.value = this.publish.layout.titleSource;
    let showAuthors =
      this.publish.selectedTemplate?.documentType === "academic";
    // The author form has a card for each author only once they are structured.
    let authorCards = false;
    try {
      authorCards = publicationAuthors(this.publish.noteProperties).structured;
      showAuthors ||=
        authorCards ||
        (Object.hasOwn(this.publish.noteProperties, "author") &&
          !Object.hasOwn(this.publish.noteProperties, "authors"));
    } catch {
      /* The field controls report malformed YAML. */
    }
    if (target && service && showAuthors && !this.authors)
      this.authors = service.mountAuthors(this.authorContainer, this.file);
    if (!showAuthors && this.authors) {
      this.authors.destroy();
      this.authors = undefined;
      this.authorContainer.empty();
    }
    for (const input of Array.from(
      this.authorContainer.querySelectorAll<
        HTMLInputElement | HTMLButtonElement
      >("input,button"),
    ))
      if (this.publish.busy) {
        if (!this.busyControls.has(input))
          this.busyControls.set(input, input.disabled);
        input.disabled = true;
      } else if (this.busyControls.has(input)) {
        input.disabled = this.busyControls.get(input)!;
        this.busyControls.delete(input);
      }
    // Title and author issues show at their fields once those are mounted.
    const inline = (issue: PublishingIssue) =>
      (issue.target === "title" && !!this.properties) ||
      (issue.target === "author" && !!this.authors && authorCards);
    const issues = this.publish.publishingIssues.filter(
      (issue) => !inline(issue),
    );
    setLiveText(
      this.academicAlert,
      issues
        .filter((issue) => issue.blocking)
        .map(publishingIssueText)
        .join("\n"),
    );
    const notes = issues
      .filter((issue) => !issue.blocking)
      .map(publishingIssueText);
    if (
      this.publish.selectedTemplate?.renderer !== "aastex" &&
      this.publish.duplicateTitleWarning
    )
      notes.push("Title may appear twice. Review the title source.");
    patchBlock(this.validationNotes, notes.join("\n"), (container) => {
      for (const note of notes)
        container.createEl("p", { text: note, cls: "stratum-publish-meta" });
    });
    this.refreshing = true;
    try {
      for (const [key, toggle] of this.toggles) {
        toggle.setValue(
          this.pending.get(key)?.value ?? this.publish.aastexPdfOptions[key],
        );
        toggle.setDisabled(
          this.publish.busy ||
            (this.publish.preferencesSaving &&
              !toggle.toggleEl.contains(
                toggle.toggleEl.ownerDocument.activeElement,
              )),
        );
      }
    } finally {
      this.refreshing = false;
    }
    this.retryButton.hidden = !this.drafts.failures.size;
    if (this.drafts.failures.size)
      this.fail(
        new Error(
          [...this.drafts.failures.values()]
            .map((draft) => draft.error)
            .join("\n"),
        ),
      );
    if (!this.drafts.failures.size && !this.closingError && !this.cleanupError)
      this.error.hidden = true;
    if (this.closingError && this.file && !service?.pending(this.file.path)) {
      this.closingError = false;
      this.error.hidden = !this.drafts.failures.size && !this.cleanupError;
    }
    this.updateActions();
  }
  onClose(): void {
    this.contentEl.removeEventListener("input", this.actionListener);
    this.contentEl.removeEventListener("change", this.actionListener);
    this.properties?.capture();
    if (this.file) this.publish.plugin.publicationEditor?.flush(this.file.path);
    this.alive = false;
    this.unsubscribe?.();
    this.properties?.destroy();
    this.authors?.destroy();
    this.contentEl.empty();
    this.publish.settingsClosed(this);
    if (this.launcher.isConnected) this.launcher.focus();
  }
  adoptLauncher(launcher: HTMLElement): void {
    if (!this.launcher.isConnected) this.launcher = launcher;
  }
}
